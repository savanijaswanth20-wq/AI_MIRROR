import type { Landmark, Product } from '@/lib/types';
import { alignGarmentFrame, createGarmentFrame, distance, POSE_CONNECTIONS, triangleTransform, type Point } from './geometry';
import { alphaBounds, isPhotoGarment, type TextureBounds } from './garmentTexture';
import type { TryOnFrame, VirtualTryOnEngine } from './VirtualTryOnEngine';

export class RealtimeOverlayEngine implements VirtualTryOnEngine {
  readonly kind='realtime-overlay' as const;
  private image: HTMLCanvasElement | null=null;
  private silhouette: Product['silhouette']='top';
  private revision=0;
  private layer: HTMLCanvasElement | null=null;
  private maskLayer: HTMLCanvasElement | null=null;
  private bounds: TextureBounds | null=null;
  private photograph=false;
  private loadedKey='';

  async setGarment(product: Product,color: string) {
    const key=`${product.garmentImage}:${isPhotoGarment(product.garmentImage)?'original':color}:${product.silhouette}`;
    if(this.loadedKey===key&&this.image)return;
    const revision=++this.revision;
    this.image=null;
    this.bounds=null;this.loadedKey='';
    const response=await fetch(product.garmentImage);
    if (!response.ok) throw new Error('Garment image unavailable. Select another item.');
    const chosen=product.colors.find(c=>c.name===color||c.hex===color)?.hex ?? product.colors[0]?.hex ?? '#596c57';
    const blob=await response.blob();
    const isSvg=blob.type.includes('svg')||product.garmentImage.split('?')[0].endsWith('.svg');
    let svg=isSvg?(await blob.text()).replace(/#596c57/gi,/^#[\da-f]{6}$/i.test(chosen)?chosen:'#596c57'):'';
    // An SVG with only a viewBox can report zero intrinsic dimensions in WebKit.
    if(isSvg)svg=svg.replace(/<svg\b([^>]*)>/i,(_match,attributes:string)=>`<svg${attributes}${/\bwidth\s*=/.test(attributes)?'':' width="400"'}${/\bheight\s*=/.test(attributes)?'':' height="600"'}>`);
    const asset=isSvg?new Blob([svg],{type:'image/svg+xml'}):blob;
    const url=URL.createObjectURL(asset);
    try {
      const image=new Image(); image.src=url; await image.decode();
      if (revision===this.revision) {
        // Rasterize while the object URL is alive; mesh drawing then uses a stable bitmap.
        const texture=document.createElement('canvas');
        const naturalWidth=image.naturalWidth||400,naturalHeight=image.naturalHeight||600,scale=Math.min(1,1024/Math.max(naturalWidth,naturalHeight));
        texture.width=Math.max(1,Math.round(naturalWidth*scale));texture.height=Math.max(1,Math.round(naturalHeight*scale));
        const context=texture.getContext('2d');if(!context)throw new Error('This browser cannot initialize the garment texture.');
        context.drawImage(image,0,0,texture.width,texture.height);
        const photograph=!isSvg;
        const bounds=photograph?alphaBounds(context.getImageData(0,0,texture.width,texture.height).data,texture.width,texture.height):{x:0,y:0,width:texture.width,height:texture.height};
        if(!bounds)throw new Error('This garment image is empty. Upload a visible garment photo.');
        this.image=texture;this.silhouette=product.silhouette;this.bounds=bounds;this.photograph=photograph;this.loadedKey=key;
      }
    } finally { URL.revokeObjectURL(url); }
  }
  render(context: CanvasRenderingContext2D,frame: TryOnFrame) {
    const {width,height,landmarks}=frame;
    context.clearRect(0,0,width,height);
    const base=createGarmentFrame(landmarks,width,height,this.silhouette,this.photograph);
    const garment=base?alignGarmentFrame(base,landmarks,width,height,frame.alignment):null;
    if (!this.image || !this.bounds || !garment) { if(frame.debug) this.drawDebug(context,landmarks,width,height); return; }
    this.layer ??= document.createElement('canvas');
    if(this.layer.width!==width||this.layer.height!==height) {this.layer.width=width;this.layer.height=height;}
    const layer=this.layer.getContext('2d'); if(!layer) return;
    layer.clearRect(0,0,width,height);
    const columns=4, rows=garment.rows.length-1;
    const texturePoint=(col:number,row:number):Point=>({x:this.bounds!.x+col/columns*this.bounds!.width,y:this.bounds!.y+row/rows*this.bounds!.height});
    const bodyPoint=(col:number,row:number):Point=>({x:garment.rows[row].left.x+(garment.rows[row].right.x-garment.rows[row].left.x)*col/columns,y:garment.rows[row].left.y+(garment.rows[row].right.y-garment.rows[row].left.y)*col/columns});
    for(let row=0;row<rows;row++) for(let col=0;col<columns;col++) {
      this.drawTriangle(layer,[texturePoint(col,row),texturePoint(col+1,row),texturePoint(col+1,row+1)],[bodyPoint(col,row),bodyPoint(col+1,row),bodyPoint(col+1,row+1)]);
      this.drawTriangle(layer,[texturePoint(col,row),texturePoint(col+1,row+1),texturePoint(col,row+1)],[bodyPoint(col,row),bodyPoint(col+1,row+1),bodyPoint(col,row+1)]);
    }
    if(frame.segmentation) {
      // Slight dilation permits garment hems while suppressing background spill.
      this.maskLayer ??= document.createElement('canvas');
      if(this.maskLayer.width!==width||this.maskLayer.height!==height) {this.maskLayer.width=width;this.maskLayer.height=height;}
      const mask=this.maskLayer.getContext('2d');
      if(mask) {
        mask.clearRect(0,0,width,height);mask.filter='blur(2px)';
        const dilation=Math.max(4,width*.012);
        for(const [dx,dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]])mask.drawImage(frame.segmentation,dx*dilation,dy*dilation,width,height);
        mask.filter='none';
        // A flared skirt must extend beyond the customer's existing leg silhouette.
        if(this.silhouette==='dress'){mask.fillStyle='#fff';mask.fillRect(0,Math.max(landmarks[23].y,landmarks[24].y)*height,width,height);}
        layer.globalCompositeOperation='destination-in';layer.drawImage(this.maskLayer,0,0);layer.globalCompositeOperation='source-over';
      }
    }
    this.restoreCrossingForearms(layer,landmarks,width,height);
    context.drawImage(this.layer,0,0);
    if(frame.debug) this.drawDebug(context,landmarks,width,height);
  }
  private drawTriangle(context:CanvasRenderingContext2D,source:[Point,Point,Point],target:[Point,Point,Point]) {
    const transform=triangleTransform(source,target); if(!transform||!this.image) return;
    // Overlap neighboring clips to cover anti-aliased diagonal cracks.
    const center={x:(target[0].x+target[1].x+target[2].x)/3,y:(target[0].y+target[1].y+target[2].y)/3};
    const clip=target.map(point=>{const radius=Math.max(.01,distance(point,center)),scale=(radius+.9)/radius;return{x:center.x+(point.x-center.x)*scale,y:center.y+(point.y-center.y)*scale};});
    context.save();context.beginPath();context.moveTo(clip[0].x,clip[0].y);context.lineTo(clip[1].x,clip[1].y);context.lineTo(clip[2].x,clip[2].y);context.closePath();context.clip();context.transform(...transform);context.drawImage(this.image,0,0);context.restore();
  }
  private restoreCrossingForearms(context:CanvasRenderingContext2D,points:Landmark[],width:number,height:number) {
    if(this.silhouette==='bottom') return;
    const minX=Math.min(points[11].x,points[12].x),maxX=Math.max(points[11].x,points[12].x);
    const minY=Math.min(points[11].y,points[12].y),maxY=Math.max(points[23].y,points[24].y);
    for(const [elbow,wrist] of [[13,15],[14,16]]) {
      const w=points[wrist],e=points[elbow];
      if((w.visibility??0)<.6||(e.visibility??0)<.6||w.x<minX||w.x>maxX||w.y<minY||w.y>maxY) continue;
      const a={x:e.x*width,y:e.y*height},b={x:w.x*width,y:w.y*height};
      context.save();context.globalCompositeOperation='destination-out';context.lineCap='round';context.lineWidth=Math.max(12,distance({x:points[11].x*width,y:points[11].y*height},{x:points[12].x*width,y:points[12].y*height})*.11);context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();context.restore();
    }
  }
  private drawDebug(context:CanvasRenderingContext2D,points:Landmark[],width:number,height:number) {
    context.save();context.strokeStyle='#9df7b4';context.fillStyle='#faf4da';context.lineWidth=2;
    for(const [a,b] of POSE_CONNECTIONS) if(points[a]&&points[b]&&(points[a].visibility??1)>.4&&(points[b].visibility??1)>.4) {context.beginPath();context.moveTo(points[a].x*width,points[a].y*height);context.lineTo(points[b].x*width,points[b].y*height);context.stroke();}
    for(const p of points) if((p.visibility??1)>.4) {context.beginPath();context.arc(p.x*width,p.y*height,3,0,Math.PI*2);context.fill();}
    context.restore();
  }
  dispose() {this.revision++;this.image=null;this.bounds=null;this.loadedKey='';this.layer=null;this.maskLayer=null;}
}
