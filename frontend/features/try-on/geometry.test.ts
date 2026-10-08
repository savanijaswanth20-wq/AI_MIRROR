import { describe,it,expect } from 'vitest';
import { createGarmentFrame,LandmarkSmoother,triangleTransform } from './geometry';
import { demoPose } from '../pose/demoPose';
import { analyzeBody,estimateFaceShape } from '../pose/bodyAnalysis';

describe('garment geometry',()=>{
  it('scales and translates with the person',()=>{
    const pose=demoPose();const a=createGarmentFrame(pose,600,900,'top')!;
    const b=createGarmentFrame(pose.map(p=>({...p,x:p.x*.5+.1,y:p.y*.5+.1})),600,900,'top')!;
    expect(b.rows[0].right.x-b.rows[0].left.x).toBeCloseTo((a.rows[0].right.x-a.rows[0].left.x)*.5);
    expect(b.rows[0].left.x).toBeCloseTo(a.rows[0].left.x*.5+60);
  });
  it('rejects missing anchors and low visibility',()=>{
    expect(createGarmentFrame([],600,900,'top')).toBeNull();
    const pose=demoPose();pose[11].visibility=.1;expect(createGarmentFrame(pose,600,900,'top')).toBeNull();
  });
  it('rotates the mesh with the shoulder line',()=>{
    const pose=demoPose();pose[12].y+=.04;
    const frame=createGarmentFrame(pose,600,900,'top')!;
    expect(frame.rows[0].right.y).toBeGreaterThan(frame.rows[0].left.y);
  });
  it('maps texture triangles exactly and rejects degenerate triangles',()=>{
    const transform=triangleTransform([{x:0,y:0},{x:100,y:0},{x:0,y:100}],[{x:12,y:20},{x:212,y:20},{x:12,y:320}])!;
    expect(transform).toEqual([2,0,0,3,12,20]);
    expect(triangleTransform([{x:0,y:0},{x:0,y:0},{x:0,y:0}],[{x:0,y:0},{x:1,y:0},{x:0,y:1}])).toBeNull();
  });
  it('smooths jitter and resets after losing the person',()=>{
    const smoother=new LandmarkSmoother();smoother.update(demoPose(),0);
    const moved=demoPose().map(p=>({...p,x:p.x+.1}));
    const filtered=smoother.update(moved,50);expect(filtered[11].x).toBeGreaterThan(.382);expect(filtered[11].x).toBeLessThan(.482);
    expect(smoother.update(moved,1000)[11].x).toBeCloseTo(.482);
  });
  it('never returns uncalibrated metric measurements or an invented chest circumference',()=>{
    const uncalibrated=analyzeBody(demoPose(),600,900)!;
    expect(uncalibrated.heightCm).toBeUndefined();expect(uncalibrated.shoulderCm).toBeUndefined();
    const calibrated=analyzeBody(demoPose(),600,900,172)!;
    expect(calibrated.heightCm).toBe(172);expect(calibrated.shoulderCm).toBeGreaterThan(20);expect(calibrated.chestCm).toBeUndefined();
  });
  it('withholds calibrated estimates when the feet are occluded',()=>{
    const pose=demoPose();pose[27].visibility=.2;
    const profile=analyzeBody(pose,600,900,172)!;
    expect(profile.heightCm).toBeUndefined();expect(profile.shoulderCm).toBeUndefined();expect(profile.confidence).toBeLessThan(.6);
  });
  it('withholds face shape certainty for a cropped or turned face',()=>{
    const face=Array.from({length:468},()=>({x:.5,y:.5,z:0,visibility:1}));
    face[234]={x:.4,y:.5,z:0,visibility:1};face[454]={x:.6,y:.5,z:0,visibility:1};
    face[10]={x:.5,y:.35,z:0,visibility:1};face[152]={x:.5,y:.65,z:0,visibility:1};face[1]={x:.59,y:.5,z:0,visibility:1};
    expect(estimateFaceShape(face,600,900)).toContain('Uncertain');
    expect(estimateFaceShape([],600,900)).toBeUndefined();
  });
});
