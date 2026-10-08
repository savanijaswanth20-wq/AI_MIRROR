import { describe,expect,it } from 'vitest';
import type { Landmark } from '@/lib/types';
import { LivePoseTracker } from './LivePoseTracker';

const pose=(x:number):Landmark[]=>Array.from({length:33},()=>({x,y:.5,z:0,visibility:.9}));

describe('live pose display timing',()=>{
  it('updates the displayed garment between camera observations',()=>{
    const tracker=new LivePoseTracker();tracker.observe(pose(.4),0);tracker.observe(pose(.45),50);
    const a=tracker.sample(50)![11].x,b=tracker.sample(66)![11].x,c=tracker.sample(82)![11].x;
    expect(a).toBeGreaterThan(.4);expect(a).toBeLessThan(.45);expect(b).toBeGreaterThan(a);expect(c).toBeGreaterThan(b);
  });
  it('filters small frame jitter and preserves the latest visibility',()=>{
    const tracker=new LivePoseTracker();tracker.observe(pose(.5),0);
    const next=pose(.506);next[11].visibility=.55;tracker.observe(next,50);
    expect(tracker.sample(50)![11].x).toBeLessThan(.506);expect(tracker.sample(50)![11].visibility).toBe(.55);
  });
  it('bounds prediction even when frames stop arriving',()=>{
    const tracker=new LivePoseTracker();tracker.observe(pose(.4),0);tracker.observe(pose(.5),50);
    for(const time of [66,82,100,150,200,250])expect(tracker.sample(time)![11].x).toBeLessThanOrEqual(.525);
  });
  it('clears stale observations and reacquires without trailing the old person',()=>{
    const tracker=new LivePoseTracker();tracker.observe(pose(.4),0);expect(tracker.sample(251)).toBeNull();
    tracker.observe(pose(.8),300);expect(tracker.sample(300)![11].x).toBe(.8);
    tracker.observe(pose(.4),350);expect(tracker.sample(350)![11].x).toBe(.4);
  });
  it('resets invalid observations instead of sending bad geometry to the renderer',()=>{
    const tracker=new LivePoseTracker();tracker.observe(pose(.4),0);tracker.observe(pose(Number.NaN),50);expect(tracker.sample(51)).toBeNull();
    tracker.observe(pose(.5),60);tracker.reset();expect(tracker.sample(61)).toBeNull();
  });
  it('keeps private copies and resets when the clock moves backwards',()=>{
    const tracker=new LivePoseTracker(),points=pose(.4);tracker.observe(points,20);points[11].x=.8;
    const display=tracker.sample(20)!;expect(display[11].x).toBe(.4);display[11].x=.9;expect(tracker.sample(20)![11].x).toBe(.4);
    expect(tracker.sample(19)).toBeNull();
  });
});
