'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, FlipHorizontal2, Maximize2, RefreshCw, ShieldCheck, ScanLine } from 'lucide-react';
import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { BodyProfile, Landmark, Product } from '@/lib/types';
import { RealtimeOverlayEngine } from '../try-on/RealtimeOverlayEngine';
import { LandmarkSmoother } from '../try-on/geometry';
import { analyzeBody, DEMO_PROFILE, estimateFaceShape, estimateSkinAppearance } from '../pose/bodyAnalysis';
import { demoPose } from '../pose/demoPose';
import styles from './MirrorCamera.module.css';

interface MirrorCameraProps {
  product: Product; color: string; mode: 'demo'|'camera';
  onModeChange: (mode:'demo'|'camera')=>void;
  onProfile: (profile:BodyProfile)=>void;
  debug?: boolean; active?: boolean;
}

function cameraError(error:unknown):string {
  if(error instanceof DOMException) {
    if(error.name==='NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser, then try again.';
    if(error.name==='NotFoundError') return 'No camera found. Connect a camera or explore the illustrated demo.';
    if(error.name==='NotReadableError') return 'Camera is busy in another app. Close that app, then try again.';
    if(error.name==='OverconstrainedError') return 'This camera is unavailable. Switch to another camera.';
  }
  return error instanceof Error?error.message:'The camera could not start. You can continue in demo mode.';
}

export function MirrorCamera({product,color,mode,onModeChange,onProfile,debug=false,active=true}:MirrorCameraProps) {
  const root=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const callback=useRef(onProfile),heightRef=useRef<number|undefined>(undefined),debugRef=useRef(debug),silhouetteRef=useRef(product.silhouette),activeDevice=useRef('');
  const engine=useMemo(()=>new RealtimeOverlayEngine(),[]);
  const [mirrored,setMirrored]=useState(true),[facing,setFacing]=useState<'user'|'environment'>('user');
  const [restart,setRestart]=useState(0),[heightInput,setHeightInput]=useState('');
  const [deviceId,setDeviceId]=useState(''),[switching,setSwitching]=useState(false);
  const [status,setStatus]=useState('Illustrated demo · choose a piece to begin');
  const [error,setError]=useState(''),[assetError,setAssetError]=useState('');
  const [tracking,setTracking]=useState(false),[faceReady,setFaceReady]=useState(false),[maskReady,setMaskReady]=useState(false),[fps,setFps]=useState(0);

  useEffect(()=>{callback.current=onProfile;},[onProfile]);
  useEffect(()=>{debugRef.current=debug;},[debug]);
  useEffect(()=>{silhouetteRef.current=product.silhouette;},[product.silhouette]);
  useEffect(()=>{const height=Number(heightInput);heightRef.current=height>=100&&height<=230?height:undefined;},[heightInput]);
  useEffect(()=>{
    let cancelled=false;
    engine.setGarment(product,color).then(()=>{if(!cancelled)setAssetError('');}).catch((reason:unknown)=>{if(!cancelled)setAssetError(cameraError(reason));});
    return ()=>{cancelled=true;};
  },[engine,product,color]);
  useEffect(()=>()=>engine.dispose(),[engine]);

  useEffect(()=>{
    if(mode!=='demo'||!active) return;
    setError('');setTracking(false);setMaskReady(false);setFaceReady(false);setFps(0);
    setStatus('Illustrated demo · live garment preview');callback.current(DEMO_PROFILE);
    const demoCanvas=canvas.current;
    let animation=0,lastDraw=0;
    const draw=(time:number)=>{
      animation=requestAnimationFrame(draw);
      if(time-lastDraw<33)return;
      lastDraw=time;
      const target=canvas.current,context=target?.getContext('2d');
      if(target&&context) {if(target.width!==600||target.height!==900){target.width=600;target.height=900;}engine.render(context,{width:600,height:900,landmarks:demoPose(time),debug:debugRef.current});}
    };
    animation=requestAnimationFrame(draw);
    return ()=>{cancelAnimationFrame(animation);demoCanvas?.getContext('2d')?.clearRect(0,0,demoCanvas.width,demoCanvas.height);};
  },[mode,active,engine]);

  useEffect(()=>{
    if(mode!=='camera'||!active) return;
    let cancelled=false,animation=0,stream:MediaStream|null=null,pose:PoseLandmarker|null=null,face:FaceLandmarker|null=null;
    let lastInference=0,lastVideoTime=-1,lastProfile=0,lastStatus=0,frameCount=0,fpsAt=performance.now(),fpsCount=0;
    let cachedFace:Landmark[]=[],faceShape:string|undefined,skinTone:string|undefined,lowLight=false;
    const smoother=new LandmarkSmoother(),mask=document.createElement('canvas'),sample=document.createElement('canvas');
    const maskContext=mask.getContext('2d'),sampleContext=sample.getContext('2d',{willReadFrequently:true});
    setError('');setTracking(false);setFaceReady(false);setMaskReady(false);setFps(0);setStatus('Waiting for camera permission…');
    const clear=()=>{const target=canvas.current;target?.getContext('2d')?.clearRect(0,0,target.width,target.height);};
    const stop=()=>{
      cancelAnimationFrame(animation);stream?.getTracks().forEach(track=>track.stop());
      pose?.close();face?.close();pose=null;face=null;
      if(video.current)video.current.srcObject=null;
    };
    const start=async()=>{
      try {
        if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS or localhost in a supported browser. Demo remains available.');
        const localStream=await navigator.mediaDevices.getUserMedia({video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facing}}),width:{ideal:720},height:{ideal:1080},frameRate:{ideal:30,max:30}},audio:false});
        if(cancelled){localStream.getTracks().forEach(track=>track.stop());return;}
        stream=localStream;activeDevice.current=stream.getVideoTracks()[0]?.getSettings().deviceId??deviceId;
        const player=video.current;if(!player)throw new Error('Camera display could not initialize. Please retry.');
        player.srcObject=stream;await player.play();
        if(cancelled)return;
        setStatus('Loading local body + face models…');
        const vision=await import('@mediapipe/tasks-vision');
        const files=await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        if(cancelled)return;
        const makePose=(delegate:'GPU'|'CPU')=>vision.PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task',delegate},runningMode:'VIDEO',numPoses:2,minPoseDetectionConfidence:.55,minTrackingConfidence:.55,outputSegmentationMasks:true});
        try{pose=await makePose('GPU');}catch{pose=await makePose('CPU');}
        if(cancelled){pose.close();pose=null;return;}
        const makeFace=(delegate:'GPU'|'CPU')=>vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/models/face_landmarker.task',delegate},runningMode:'VIDEO',numFaces:2,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false});
        try{try{face=await makeFace('GPU');}catch{face=await makeFace('CPU');}}catch{setError('Face analysis is unavailable on this device. Body try-on still works.');}
        if(cancelled){pose?.close();face?.close();pose=null;face=null;return;}
        setStatus('Step into the frame · keep your shoulders and hips visible');
        const draw=(now:number)=>{
          if(cancelled)return;
          animation=requestAnimationFrame(draw);
          const player=video.current,target=canvas.current;
          if(!player||!target||!pose||player.readyState<2||now-lastInference<50||player.currentTime===lastVideoTime)return;
          lastInference=now;lastVideoTime=player.currentTime;
          const width=player.videoWidth,height=player.videoHeight;
          if(!width||!height)return;
          if(target.width!==width||target.height!==height){target.width=width;target.height=height;}
          const context=target.getContext('2d');if(!context)return;
          let result:ReturnType<PoseLandmarker['detectForVideo']>|undefined;
          try {
            result=pose.detectForVideo(player,now);frameCount++;fpsCount++;
            if(now-fpsAt>=1000){setFps(Math.round(fpsCount*1000/(now-fpsAt)));fpsCount=0;fpsAt=now;}
            if(frameCount%4===0&&face){cachedFace=face.detectForVideo(player,now).faceLandmarks[0]??[];}
            const points=result.landmarks[0];
            let guidance='';
            if(!points){guidance='No person detected · step into the frame';clear();smoother.reset();}
            else if(result.landmarks.length>1){guidance='One person at a time · keep the mirror just for you';clear();smoother.reset();}
            else {
              const filtered=smoother.update(points,now);
              const lower=silhouetteRef.current==='bottom'||silhouetteRef.current==='dress';
              const visible=[11,12,23,24,...(lower?[27,28]:[])].every(i=>(points[i].visibility??0)>.5&&points[i].y>.01&&points[i].y<.99);
              if(!visible){guidance=lower?'Step back so your full body and feet are visible':'Step back slightly so your shoulders and hips are visible';clear();}
              else {
                let segmentation:HTMLCanvasElement|undefined;
                const personMask=result.segmentationMasks?.[0];
                if(personMask&&maskContext){
                  if(mask.width!==personMask.width||mask.height!==personMask.height){mask.width=personMask.width;mask.height=personMask.height;}
                  const values=personMask.getAsFloat32Array(),pixels=maskContext.createImageData(mask.width,mask.height);
                  for(let i=0;i<values.length;i++){const offset=i*4;pixels.data[offset]=255;pixels.data[offset+1]=255;pixels.data[offset+2]=255;pixels.data[offset+3]=values[i]>.35?255:0;}
                  maskContext.putImageData(pixels,0,0);segmentation=mask;
                }
                engine.render(context,{width,height,landmarks:filtered,source:player,segmentation,debug:debugRef.current});
                guidance='Body tracking active · move naturally';
                if(now-lastProfile>1200){
                  const profile=analyzeBody(filtered,width,height,heightRef.current);
                  if(sampleContext){
                    // Pixel samples stay in this browser and are discarded at cleanup.
                    sample.width=width;sample.height=height;sampleContext.drawImage(player,0,0,width,height);
                    if(cachedFace.length){faceShape=estimateFaceShape(cachedFace,width,height);skinTone=estimateSkinAppearance(sampleContext,cachedFace,width,height);}
                    const center=sampleContext.getImageData(Math.max(0,Math.floor(width*.45)),Math.max(0,Math.floor(height*.3)),12,12).data;
                    let brightness=0;for(let i=0;i<center.length;i+=4)brightness+=(center[i]+center[i+1]+center[i+2])/3;
                    lowLight=brightness/(center.length/4)<35;
                  }
                  if(profile)callback.current({...profile,faceShape,skinTone});
                  lastProfile=now;
                }
                if(lowLight)guidance='Lighting is low · face a brighter, even light';
              }
            }
            if(now-lastStatus>350){setStatus(guidance);setTracking(!!points&&result.landmarks.length===1&&guidance.startsWith('Body tracking'));setFaceReady(cachedFace.length>0);setMaskReady(!!result.segmentationMasks?.length);lastStatus=now;}
          }catch(reason){if(!cancelled){setError(`Local vision stopped: ${cameraError(reason)}`);setTracking(false);cancelAnimationFrame(animation);stop();}}
          finally{result?.close();}
        };
        animation=requestAnimationFrame(draw);
      }catch(reason){if(!cancelled){setError(cameraError(reason));setStatus('Camera unavailable · demo is ready');stop();}}
    };
    void start();
    return ()=>{cancelled=true;stop();clear();sample.width=0;sample.height=0;mask.width=0;mask.height=0;};
  },[mode,active,facing,deviceId,restart,engine]);

  const switchCamera=useCallback(async()=>{
    setSwitching(true);
    try {
      // Camera labels/IDs become available after getUserMedia permission is granted.
      const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput');
      if(devices.length>1){
        const current=devices.findIndex(device=>device.deviceId===activeDevice.current);
        setDeviceId(devices[(current+1)%devices.length].deviceId);
      }else{setDeviceId('');setFacing(value=>value==='user'?'environment':'user');}
    }catch{setDeviceId('');setFacing(value=>value==='user'?'environment':'user');}
    finally{setSwitching(false);}
  },[]);

  const fullscreen=useCallback(async()=>{
    try {if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen();}catch{setError('Fullscreen is unavailable in this browser.');}
  },[]);

  return <div ref={root} className={`mirror-camera ${styles.stage}`}>
    {mode==='demo'?<img src="/demo/model.svg" className={styles.media} style={{transform:mirrored?'scaleX(-1)':'none'}} alt="Illustrated fashion mannequin for the demo preview"/>:<video ref={video} className={styles.media} style={{transform:mirrored?'scaleX(-1)':'none'}} autoPlay muted playsInline aria-label="Your private live camera preview"/>}
    <canvas ref={canvas} className={styles.media} style={{transform:mirrored?'scaleX(-1)':'none'}} aria-label="Garment overlay preview"/>
    <div className={styles.vignette}/>
    <div className={styles.viewTools}>
      <button onClick={()=>setMirrored(value=>!value)} title="Toggle mirror mode" aria-label="Toggle mirror mode" aria-pressed={mirrored}><FlipHorizontal2 size={18}/></button>
      <button onClick={fullscreen} title="Fullscreen" aria-label="Open fullscreen mirror"><Maximize2 size={18}/></button>
      {mode==='camera'&&<button onClick={switchCamera} disabled={switching} title="Switch camera" aria-label="Switch camera"><RefreshCw size={18}/></button>}
    </div>
    {(error||assetError)&&<div className={styles.error} role="alert"><p>{error||assetError}</p><button onClick={()=>setRestart(value=>value+1)}>Retry camera</button><button onClick={()=>onModeChange('demo')}>Use demo</button></div>}
    {!active&&<div className={styles.paused}>Session paused · camera stopped</div>}
    <div className={styles.bottom}>
      {(mode==='camera'||debug)&&<div className={styles.tracking} aria-live="polite"><ScanLine size={12}/><span>{status}</span>{fps>0&&<small>{fps} FPS</small>}</div>}
      {mode==='camera'&&debug&&<div className={styles.chips}><span className={tracking?styles.checked:''}>Body</span><span className={faceReady?styles.checked:''}>Face</span><span className={maskReady?styles.checked:''}>Segmentation</span></div>}
      <div className={`camera-toolbar ${styles.toolbar}`}>
        <span className={styles.privacy}><ShieldCheck size={12}/> {mode==='demo'?'Studio preview':'Local processing'}</span>
        {mode==='camera'&&<details className={styles.calibration}><summary>Calibrate</summary><label>Optional height (cm)<input type="number" min="100" max="230" placeholder="e.g. 172" value={heightInput} onChange={event=>setHeightInput(event.target.value)}/></label><small>Measurements are camera-based estimates. Use an upright, full-body view.</small></details>}
        <button className={styles.cameraButton} onClick={()=>onModeChange(mode==='demo'?'camera':'demo')}>{mode==='demo'?<Camera size={16}/>:<CameraOff size={16}/>} {mode==='demo'?'Start camera':'Stop camera'}</button>
      </div>
      {mode==='camera'&&<div className={styles.disclaimer}>Your camera is used for virtual try-on. Images are not permanently stored unless you choose to save them.</div>}
    </div>
  </div>;
}
