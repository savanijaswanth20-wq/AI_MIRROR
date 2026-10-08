import type { Landmark } from '@/lib/types';

export interface Point { x: number; y: number }
export interface GarmentFrame { rows: { left: Point; right: Point }[]; confidence: number }
export const POSE_CONNECTIONS = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t) });
const midpoint = (a: Point, b: Point) => mix(a,b,.5);

/** Image-space proportions only: a camera has no physical scale without calibration. */
export function createGarmentFrame(landmarks: Landmark[], width: number, height: number, silhouette: 'top'|'bottom'|'dress'): GarmentFrame | null {
  if (landmarks.length < 33 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const needed = silhouette === 'bottom' ? [23,24,27,28] : silhouette === 'dress' ? [11,12,23,24,27,28] : [11,12,23,24];
  if (needed.some(i => !Number.isFinite(landmarks[i].x) || !Number.isFinite(landmarks[i].y) || (landmarks[i].visibility ?? 1) < .45)) return null;
  const p = (i: number): Point => ({ x: landmarks[i].x * width, y: landmarks[i].y * height });
  const shoulders = [p(11),p(12)].sort((a,b)=>a.x-b.x);
  const hips = [p(23),p(24)].sort((a,b)=>a.x-b.x);
  const ankles = [p(27),p(28)].sort((a,b)=>a.x-b.x);
  const shoulderMid = midpoint(shoulders[0],shoulders[1]), hipMid = midpoint(hips[0],hips[1]);
  const shoulderWidth = distance(...shoulders as [Point,Point]), hipWidth = distance(...hips as [Point,Point]);
  const torso = distance(shoulderMid,hipMid);
  if (shoulderWidth < 12 || hipWidth < 8 || torso < 16) return null;
  const rows: GarmentFrame['rows'] = [];
  const angle = Math.atan2(shoulders[1].y-shoulders[0].y,shoulders[1].x-shoulders[0].x);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  for (let r=0;r<=8;r++) {
    const t=r/8;
    let center: Point, span: number;
    if (silhouette==='bottom') {
      const footMid=midpoint(ankles[0],ankles[1]);
      center=mix(hipMid,footMid,lerp(-.08,1.04,t));
      span=lerp(hipWidth*1.8,Math.max(hipWidth*1.5,distance(ankles[0],ankles[1])*1.4),t);
    } else if (silhouette==='dress') {
      const footMid=midpoint(ankles[0],ankles[1]);
      center=mix(shoulderMid,footMid,lerp(-.13,1.02,t));
      span=t<.4 ? lerp(shoulderWidth*1.9,hipWidth*1.9,t/.4) : lerp(hipWidth*1.9,hipWidth*2.9,(t-.4)/.6);
    } else {
      center=mix(shoulderMid,hipMid,lerp(-.27,1.23,t));
      span=lerp(shoulderWidth*1.82,Math.max(hipWidth*1.9,shoulderWidth*1.5),t);
    }
    rows.push({left:{x:center.x-axis.x*span/2,y:center.y-axis.y*span/2},right:{x:center.x+axis.x*span/2,y:center.y+axis.y*span/2}});
  }
  return {rows,confidence:Math.min(...needed.map(i=>landmarks[i].visibility??1))};
}

/** Low-pass filtering is time-based, so 15 fps and 30 fps respond similarly. */
export class LandmarkSmoother {
  private previous: Landmark[] | null = null;
  private timestamp=0;
  update(points: Landmark[], now: number): Landmark[] {
    if (!this.previous || now-this.timestamp>450 || this.previous.length!==points.length) {
      this.previous=points.map(p=>({...p}));
    } else {
      const alpha=1-Math.exp(-Math.max(1,now-this.timestamp)/70);
      this.previous=points.map((p,i)=>({x:lerp(this.previous![i].x,p.x,alpha),y:lerp(this.previous![i].y,p.y,alpha),z:lerp(this.previous![i].z,p.z,alpha),visibility:p.visibility}));
    }
    this.timestamp=now;
    return this.previous;
  }
  reset() { this.previous=null; this.timestamp=0; }
}

/** Affine coefficients mapping one texture triangle to one body triangle. */
export function triangleTransform(source: [Point,Point,Point], target: [Point,Point,Point]): [number,number,number,number,number,number] | null {
  const [s0,s1,s2]=source,[d0,d1,d2]=target;
  const denominator=(s1.x-s0.x)*(s2.y-s0.y)-(s2.x-s0.x)*(s1.y-s0.y);
  if (Math.abs(denominator)<1e-6) return null;
  const a=((d1.x-d0.x)*(s2.y-s0.y)-(d2.x-d0.x)*(s1.y-s0.y))/denominator;
  const c=((s1.x-s0.x)*(d2.x-d0.x)-(s2.x-s0.x)*(d1.x-d0.x))/denominator;
  const b=((d1.y-d0.y)*(s2.y-s0.y)-(d2.y-d0.y)*(s1.y-s0.y))/denominator;
  const d=((s1.x-s0.x)*(d2.y-d0.y)-(s2.x-s0.x)*(d1.y-d0.y))/denominator;
  return [a,b,c,d,d0.x-a*s0.x-c*s0.y,d0.y-b*s0.x-d*s0.y];
}
