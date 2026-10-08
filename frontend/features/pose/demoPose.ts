import type { Landmark } from '@/lib/types';

/** Landmarks correspond to the bundled 600×900 illustrated mannequin. */
export function demoPose(time=0):Landmark[] {
  const sway=Math.sin(time/2600)*.002;
  const points:Array<[number,number]>= [
    [.5,.146],[.477,.136],[.47,.136],[.463,.137],[.523,.136],[.53,.136],[.537,.137],[.449,.152],[.551,.152],[.48,.176],[.52,.176],
    [.382,.258],[.618,.258],[.337,.393],[.663,.393],[.32,.533],[.68,.533],[.309,.55],[.691,.55],[.315,.548],[.685,.548],[.328,.54],[.672,.54],
    [.418,.524],[.582,.524],[.423,.708],[.577,.708],[.414,.889],[.586,.889],[.41,.902],[.59,.902],[.378,.931],[.622,.931]
  ];
  return points.map(([x,y])=>({x:x+sway,y,z:0,visibility:1}));
}
