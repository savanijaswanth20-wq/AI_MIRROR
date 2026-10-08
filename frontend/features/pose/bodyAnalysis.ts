import type { BodyProfile, Landmark } from '@/lib/types';
import { distance } from '../try-on/geometry';

export const DEMO_PROFILE: BodyProfile={shoulderRatio:1.38,torsoRatio:.33,hipRatio:.73,faceShape:'Oval (demo)',skinTone:'Medium, warm lighting (demo)',confidence:.7,source:'demo'};

export function analyzeBody(points:Landmark[],width:number,height:number,knownHeightCm?:number):BodyProfile|null {
  if(points.length<33||[11,12,23,24].some(i=>(points[i].visibility??0)<.5)) return null;
  const p=(i:number)=>({x:points[i].x*width,y:points[i].y*height});
  const shoulder=distance(p(11),p(12)),hips=distance(p(23),p(24));
  const shoulderMid={x:(p(11).x+p(12).x)/2,y:(p(11).y+p(12).y)/2};
  const hipMid={x:(p(23).x+p(24).x)/2,y:(p(23).y+p(24).y)/2};
  const torso=distance(shoulderMid,hipMid),headY=Math.min(p(1).y,p(4).y)-distance(p(7),p(8))*.7;
  const fullHeight=Math.max(p(29).y,p(30).y)-headY;
  const fullBody=[27,28,29,30].every(i=>(points[i].visibility??0)>.6&&points[i].y<.98&&points[i].y>0);
  const confidence=Math.min(...[11,12,23,24].map(i=>points[i].visibility??0))*(fullBody?.8:.55);
  if(shoulder<12||torso<16||hips<8) return null;
  const result:BodyProfile={shoulderRatio:shoulder/hips,hipRatio:hips/shoulder,torsoRatio:fullBody?torso/fullHeight:torso/(torso+shoulder*1.75),confidence,source:'camera'};
  if(fullBody&&knownHeightCm&&knownHeightCm>=100&&knownHeightCm<=230&&fullHeight>100) {
    const scale=knownHeightCm/fullHeight;
    result.heightCm=knownHeightCm;result.shoulderCm=shoulder*scale;result.torsoCm=torso*scale;
    result.armCm=(distance(p(11),p(13))+distance(p(13),p(15)))*scale;
    result.legCm=(distance(p(23),p(25))+distance(p(25),p(27)))*scale;
    // Chest circumference cannot be observed from a single frontal frame.
  }
  return result;
}

/** A fashion-only 2D geometry heuristic, affected by head angle and camera perspective. */
export function estimateFaceShape(points:Landmark[],width:number,height:number):string|undefined {
  if(points.length<468) return;
  const p=(i:number)=>({x:points[i].x*width,y:points[i].y*height});
  const faceWidth=distance(p(234),p(454)),faceHeight=distance(p(10),p(152));
  const jawWidth=distance(p(172),p(397)),foreheadWidth=distance(p(103),p(332));
  if(faceWidth<20) return;
  const faceCenter=(p(234).x+p(454).x)/2;
  if(Math.abs(p(1).x-faceCenter)/faceWidth>.18||[10,152,234,454].some(i=>points[i].x<=0||points[i].x>=1||points[i].y<=0||points[i].y>=1))return 'Uncertain — face the mirror';
  const ratio=faceHeight/faceWidth,jawRatio=jawWidth/faceWidth;
  if(foreheadWidth>jawWidth*1.3) return 'Heart (estimate)';
  if(foreheadWidth<faceWidth*.72&&jawWidth<faceWidth*.72) return 'Diamond (estimate)';
  if(ratio>1.48) return jawRatio>.83?'Rectangle (estimate)':'Oval (estimate)';
  if(ratio<1.18) return 'Round (estimate)';
  return jawRatio>.83?'Square (estimate)':'Oval (estimate)';
}

/** Samples cheek appearance under current lighting; never infers identity or ethnicity. */
export function estimateSkinAppearance(context:CanvasRenderingContext2D,face:Landmark[],width:number,height:number):string|undefined {
  if(face.length<468) return;
  const areas=[50,280].map(i=>({x:Math.max(0,Math.min(width-6,Math.round(face[i].x*width))),y:Math.max(0,Math.min(height-6,Math.round(face[i].y*height)))}));
  let r=0,g=0,b=0,count=0;
  for(const area of areas) {const pixels=context.getImageData(area.x,area.y,5,5).data;for(let i=0;i<pixels.length;i+=4) {r+=pixels[i];g+=pixels[i+1];b+=pixels[i+2];count++;}}
  r/=count;g/=count;b/=count;
  const brightness=.2126*r+.7152*g+.0722*b;
  if(brightness<30||brightness>245) return 'Uncertain — improve lighting';
  const depth=brightness>180?'Light':brightness>110?'Medium':'Deep';
  const lighting=r-b>25?'warm':b-r>8?'cool':'neutral';
  return `${depth}, ${lighting} lighting (estimate)`;
}
