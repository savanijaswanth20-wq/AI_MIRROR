import type { Landmark } from '@/lib/types';

const clamp = (value:number,limit:number) => Math.max(-limit,Math.min(limit,value));
const clone = (points:Landmark[]) => points.map(point=>({...point}));

/** Smooth display frames between observations, without keeping a lost person's garment visible. */
export class LivePoseTracker {
  private latest:Landmark[]|null=null;
  private displayed:Landmark[]|null=null;
  private velocity:Landmark[]=[];
  private observedAt=0;
  private displayedAt=0;
  readonly staleAfterMs=250;

  observe(points:Landmark[],now:number):void {
    if(!Number.isFinite(now)||!points.length||points.some(point=>![point.x,point.y,point.z].every(Number.isFinite))){this.reset();return;}
    const elapsed=now-this.observedAt;
    const changedPerson=this.latest&&[11,12,23,24].some(index=>this.latest![index]&&points[index]&&Math.hypot(this.latest![index].x-points[index].x,this.latest![index].y-points[index].y)>.22);
    if(!this.latest||this.latest.length!==points.length||elapsed<=0||elapsed>this.staleAfterMs||changedPerson){
      this.latest=clone(points);this.displayed=clone(points);this.velocity=points.map(()=>({x:0,y:0,z:0}));this.displayedAt=now;
    }else{
      const alpha=1-Math.exp(-elapsed/70);
      this.velocity=points.map((point,index)=>({
        x:this.velocity[index].x+(clamp((point.x-this.latest![index].x)/elapsed,.0015)-this.velocity[index].x)*alpha,
        y:this.velocity[index].y+(clamp((point.y-this.latest![index].y)/elapsed,.0015)-this.velocity[index].y)*alpha,
        z:this.velocity[index].z+(clamp((point.z-this.latest![index].z)/elapsed,.0015)-this.velocity[index].z)*alpha,
      }));
      this.latest=clone(points);
    }
    this.observedAt=now;
  }

  sample(now:number):Landmark[]|null {
    if(!this.latest||!this.displayed||!Number.isFinite(now))return null;
    const age=now-this.observedAt;
    if(age<0||age>this.staleAfterMs){this.reset();return null;}
    // Short, bounded prediction reduces the gap between detections; it never drifts indefinitely.
    const horizon=Math.min(age,50);
    const alpha=1-Math.exp(-Math.max(0,now-this.displayedAt)/28);
    this.displayed=this.latest.map((point,index)=>{
      const predicted={x:point.x+clamp(this.velocity[index].x*horizon,.025),y:point.y+clamp(this.velocity[index].y*horizon,.025),z:point.z+clamp(this.velocity[index].z*horizon,.025)};
      const previous=this.displayed![index];
      return {x:previous.x+(predicted.x-previous.x)*alpha,y:previous.y+(predicted.y-previous.y)*alpha,z:previous.z+(predicted.z-previous.z)*alpha,visibility:point.visibility};
    });
    this.displayedAt=now;
    return clone(this.displayed);
  }

  reset():void {this.latest=null;this.displayed=null;this.velocity=[];this.observedAt=0;this.displayedAt=0;}
}
