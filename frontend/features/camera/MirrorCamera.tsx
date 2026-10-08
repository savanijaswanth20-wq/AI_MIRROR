'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, FlipHorizontal2, Maximize2, RefreshCw, ShieldCheck, ScanLine, LoaderCircle, SlidersHorizontal } from 'lucide-react';
import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { BodyProfile, Landmark, Product } from '@/lib/types';
import { RealtimeOverlayEngine } from '../try-on/RealtimeOverlayEngine';
import { LivePoseTracker } from './LivePoseTracker';
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
  const [photoFit,setPhotoFit]=useState({productId:product.id,scaleX:1,scaleY:1,offsetY:0});
  const fit=photoFit.productId===product.id?photoFit:{productId:product.id,scaleX:1,scaleY:1,offsetY:0};
  const alignment=useRef({scaleX:1,scaleY:1,offsetX:0,offsetY:0});
  const isPhoto=!product.garmentImage.split(/[?#]/)[0].toLowerCase().endsWith('.svg');
  const engine=useMemo(()=>new RealtimeOverlayEngine(),[]);
  const [mirrored,setMirrored]=useState(true),[facing,setFacing]=useState<'user'|'environment'>('user');
  const [restart,setRestart]=useState(0),[assetRetry,setAssetRetry]=useState(0),[heightInput,setHeightInput]=useState('');
  const [deviceId,setDeviceId]=useState(''),[switching,setSwitching]=useState(false);
  const [status,setStatus]=useState('Illustrated demo · choose a piece to begin');
  const [error,setError]=useState(''),[assetError,setAssetError]=useState('');
  const [tracking,setTracking]=useState(false),[faceReady,setFaceReady]=useState(false),[maskReady,setMaskReady]=useState(false),[fps,setFps]=useState(0),[renderFps,setRenderFps]=useState(0);
  const [phase,setPhase]=useState<'idle'|'permission'|'loading'|'searching'|'tracking'|'error'>('idle');
  const [faceWarning,setFaceWarning]=useState('');

  useEffect(()=>{callback.current=onProfile;},[onProfile]);
  useEffect(()=>{debugRef.current=debug;},[debug]);
  useEffect(()=>{silhouetteRef.current=product.silhouette;},[product.silhouette]);
  useEffect(()=>{setPhotoFit({productId:product.id,scaleX:1,scaleY:1,offsetY:0});},[product.id]);
  useEffect(()=>{alignment.current={scaleX:fit.scaleX,scaleY:fit.scaleY,offsetX:0,offsetY:fit.offsetY};},[fit.scaleX,fit.scaleY,fit.offsetY]);
  useEffect(()=>{const height=Number(heightInput);heightRef.current=height>=100&&height<=230?height:undefined;},[heightInput]);
  useEffect(()=>{
    let cancelled=false;
    engine.setGarment(product,color).then(()=>{if(!cancelled)setAssetError('');}).catch((reason:unknown)=>{if(!cancelled)setAssetError(cameraError(reason));});
    return ()=>{cancelled=true;};
  },[engine,product,color,assetRetry]);
  useEffect(()=>()=>engine.dispose(),[engine]);

  useEffect(()=>{
    if(mode!=='demo'||!active) return;
    setError('');setTracking(false);setMaskReady(false);setFaceReady(false);setFps(0);setRenderFps(0);setPhase('idle');setFaceWarning('');
    setStatus('Illustrated demo · live garment preview');callback.current(DEMO_PROFILE);
    const demoCanvas=canvas.current;
    let animation=0,lastDraw=0;
    const draw=(time:number)=>{
      animation=requestAnimationFrame(draw);
      if(time-lastDraw<33)return;
      lastDraw=time;
      const target=canvas.current,context=target?.getContext('2d');
      if(target&&context) {if(target.width!==600||target.height!==900){target.width=600;target.height=900;}engine.render(context,{width:600,height:900,landmarks:demoPose(time),debug:debugRef.current,alignment:alignment.current});}
    };
    animation=requestAnimationFrame(draw);
    return ()=>{cancelAnimationFrame(animation);demoCanvas?.getContext('2d')?.clearRect(0,0,demoCanvas.width,demoCanvas.height);};
  },[mode,active,engine]);

  useEffect(()=>{
    if(mode!=='camera'||!active) return;
    let cancelled=false,stopped=false,animation=0,inferenceTimer:ReturnType<typeof setTimeout>|undefined;
    let stream:MediaStream|null=null,pose:PoseLandmarker|null=null,face:FaceLandmarker|null=null;
    let lastVideoTime=-1,lastProfile=0,lastStatus=0,lastFace=0,fpsAt=performance.now(),fpsCount=0,drawCount=0;
    let cachedFace:Landmark[]=[],faceShape:string|undefined,skinTone:string|undefined,lowLight=false;
    let hasSegmentation=false,wasRendering=false;
    const tracker=new LivePoseTracker(),mask=document.createElement('canvas'),sample=document.createElement('canvas');
    const maskContext=mask.getContext('2d'),sampleContext=sample.getContext('2d',{willReadFrequently:true});
    const player=video.current;
    setError('');setTracking(false);setFaceReady(false);setMaskReady(false);setFps(0);setRenderFps(0);setFaceWarning('');setPhase('permission');setStatus('Waiting for camera permission…');
    const clear=()=>{const target=canvas.current;target?.getContext('2d')?.clearRect(0,0,target.width,target.height);};
    const losePose=()=>{tracker.reset();cachedFace=[];hasSegmentation=false;faceShape=undefined;skinTone=undefined;clear();};
    const stop=()=>{
      stopped=true;cancelAnimationFrame(animation);clearTimeout(inferenceTimer);tracker.reset();stream?.getTracks().forEach(track=>track.stop());
      pose?.close();face?.close();pose=null;face=null;
      // An old async startup must not detach a replacement camera's stream.
      if(player&&player.srcObject===stream)player.srcObject=null;
    };
    const fail=(reason:unknown)=>{
      if(cancelled||stopped)return;
      setError(cameraError(reason));setStatus('Camera stopped · retry or use the demo');setTracking(false);setMaskReady(false);setFaceReady(false);setFps(0);setRenderFps(0);setPhase('error');stop();clear();
    };
    const updateStatus=(guidance:string,isTracking:boolean,now:number)=>{
      if(now-lastStatus>350){setStatus(guidance);setTracking(isTracking);setPhase(isTracking?'tracking':'searching');setFaceReady(cachedFace.length>0);setMaskReady(hasSegmentation);lastStatus=now;}
    };
    const visibility=()=>{
      if(document.hidden){losePose();wasRendering=false;setTracking(false);setStatus('Camera preview paused while this tab is hidden');setPhase('searching');}
    };
    document.addEventListener('visibilitychange',visibility);
    const start=async()=>{
      try {
        if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS or localhost in a supported browser. Demo remains available.');
        const localStream=await navigator.mediaDevices.getUserMedia({video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:facing}}),width:{ideal:720},height:{ideal:1080},frameRate:{ideal:30,max:30}},audio:false});
        if(cancelled||stopped){localStream.getTracks().forEach(track=>track.stop());return;}
        stream=localStream;activeDevice.current=stream.getVideoTracks()[0]?.getSettings().deviceId??deviceId;
        for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>fail(new Error('Camera disconnected. Reconnect it, then retry.')),{once:true});
        if(!player)throw new Error('Camera display could not initialize. Please retry.');
        player.srcObject=stream;await player.play();
        if(cancelled||stopped)return;
        setPhase('loading');setStatus('Loading local body + face models…');
        const vision=await import('@mediapipe/tasks-vision');
        const files=await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        if(cancelled||stopped)return;
        const makePose=(delegate:'GPU'|'CPU')=>vision.PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task',delegate},runningMode:'VIDEO',numPoses:2,minPoseDetectionConfidence:.55,minTrackingConfidence:.55,outputSegmentationMasks:true});
        let createdPose:PoseLandmarker;
        try{createdPose=await makePose('GPU');}catch{if(cancelled||stopped)return;createdPose=await makePose('CPU');}
        if(cancelled||stopped){createdPose.close();return;}pose=createdPose;
        const makeFace=(delegate:'GPU'|'CPU')=>vision.FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'/models/face_landmarker.task',delegate},runningMode:'VIDEO',numFaces:2,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false});
        try{
          let createdFace:FaceLandmarker;
          try{createdFace=await makeFace('GPU');}catch{if(cancelled||stopped)return;createdFace=await makeFace('CPU');}
          if(cancelled||stopped){createdFace.close();return;}face=createdFace;
        }catch{if(!cancelled&&!stopped)setFaceWarning('Face analysis unavailable; garment tracking remains active.');}
        if(cancelled||stopped)return;
        setPhase('searching');setStatus('Step into the frame · keep your shoulders and hips visible');fpsAt=performance.now();
        // Rendering uses the latest observations at the display cadence. Synchronous
        // MediaPipe inference still takes main-thread time; FPS reflects this device.
        const draw=()=>{
          if(cancelled||stopped)return;
          // rAF's timestamp can precede a just-completed inference task.
          const now=performance.now();
          animation=requestAnimationFrame(draw);
          if(document.hidden)return;
          const target=canvas.current;
          if(!target||player.readyState<2)return;
          const width=player.videoWidth,height=player.videoHeight;
          if(!width||!height)return;
          if(target.width!==width||target.height!==height){target.width=width;target.height=height;}
          const context=target.getContext('2d');if(!context)return;
          const points=tracker.sample(now);
          if(points){
            try{engine.render(context,{width,height,landmarks:points,source:player,segmentation:hasSegmentation?mask:undefined,debug:debugRef.current,alignment:alignment.current});drawCount++;wasRendering=true;}
            catch(reason){fail(new Error(`Garment preview stopped: ${cameraError(reason)}`));return;}
          }else if(wasRendering){losePose();wasRendering=false;lastStatus=0;updateStatus('Tracking paused · stand in view of the camera',false,now);}
          if(now-fpsAt>=1000){setFps(Math.round(fpsCount*1000/(now-fpsAt)));setRenderFps(Math.round(drawCount*1000/(now-fpsAt)));fpsCount=0;drawCount=0;fpsAt=now;}
        };
        const infer=()=>{
          if(cancelled||stopped)return;
          const now=performance.now();
          if(document.hidden||player.readyState<2||player.currentTime===lastVideoTime){inferenceTimer=setTimeout(infer,50);return;}
          lastVideoTime=player.currentTime;
          const width=player.videoWidth,height=player.videoHeight;
          if(!width||!height){inferenceTimer=setTimeout(infer,50);return;}
          let result:ReturnType<PoseLandmarker['detectForVideo']>|undefined;
          try {
            result=pose!.detectForVideo(player,now);fpsCount++;
            const points=result.landmarks[0];
            let guidance='',isTracking=false;
            if(!points){guidance='No person detected · step into the frame';losePose();}
            else if(result.landmarks.length>1){guidance='One person at a time · keep the mirror just for you';losePose();}
            else {
              const lower=silhouetteRef.current==='bottom'||silhouetteRef.current==='dress';
              const visible=[11,12,23,24,...(lower?[27,28]:[])].every(i=>points[i]&&(points[i].visibility??0)>.5&&points[i].y>.01&&points[i].y<.99&&points[i].x>.01&&points[i].x<.99);
              if(!visible){guidance=lower?'Step back so your full body and feet are visible':'Step back slightly so your shoulders and hips are visible';losePose();}
              else {
                tracker.observe(points,now);isTracking=true;
                if(face&&now-lastFace>=180){
                  try{const faces=face.detectForVideo(player,now).faceLandmarks;cachedFace=faces.length===1?faces[0]:[];lastFace=now;}
                  catch{face.close();face=null;cachedFace=[];setFaceWarning('Face analysis unavailable; garment tracking remains active.');}
                }
                const personMask=result.segmentationMasks?.[0];
                hasSegmentation=false;
                if(personMask&&maskContext){
                  if(mask.width!==personMask.width||mask.height!==personMask.height){mask.width=personMask.width;mask.height=personMask.height;}
                  const values=personMask.getAsFloat32Array(),pixels=maskContext.createImageData(mask.width,mask.height);
                  for(let i=0;i<values.length;i++){const offset=i*4;pixels.data[offset]=255;pixels.data[offset+1]=255;pixels.data[offset+2]=255;pixels.data[offset+3]=values[i]>.35?255:0;}
                  maskContext.putImageData(pixels,0,0);hasSegmentation=true;
                }
                guidance='Live garment tracking · move naturally';
                if(now-lastProfile>1200){
                  const profile=analyzeBody(points,width,height,heightRef.current);
                  if(sampleContext){
                    // Small pixel samples stay in this browser and are discarded at cleanup.
                    sample.width=Math.min(160,width);sample.height=Math.max(12,Math.round(height*sample.width/width));sampleContext.drawImage(player,0,0,sample.width,sample.height);
                    faceShape=cachedFace.length?estimateFaceShape(cachedFace,width,height):undefined;
                    skinTone=cachedFace.length?estimateSkinAppearance(sampleContext,cachedFace,sample.width,sample.height):undefined;
                    const center=sampleContext.getImageData(Math.max(0,Math.floor(sample.width*.45)),Math.max(0,Math.floor(sample.height*.3)),12,12).data;
                    let brightness=0;for(let i=0;i<center.length;i+=4)brightness+=(center[i]+center[i+1]+center[i+2])/3;
                    lowLight=brightness/(center.length/4)<35;
                  }
                  if(profile)callback.current({...profile,faceShape,skinTone});
                  lastProfile=now;
                }
                if(lowLight)guidance='Lighting is low · face a brighter, even light';
              }
            }
            updateStatus(guidance,isTracking,now);
          }catch(reason){fail(new Error(`Local vision stopped: ${cameraError(reason)}`));}
          finally{result?.close();}
          if(!cancelled&&!stopped)inferenceTimer=setTimeout(infer,Math.max(0,50-(performance.now()-now)));
        };
        animation=requestAnimationFrame(draw);
        inferenceTimer=setTimeout(infer,0);
      }catch(reason){fail(reason);}
    };
    void start();
    return ()=>{cancelled=true;document.removeEventListener('visibilitychange',visibility);stop();clear();sample.width=0;sample.height=0;mask.width=0;mask.height=0;};
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
    {mode==='camera'&&<div className={`${styles.liveBadge} ${tracking&&active?styles.liveActive:''}`}><i/>{!active?'Camera paused':phase==='error'?'Camera stopped':phase==='permission'||phase==='loading'?'Preparing camera':tracking?'Live clothing':'Finding your pose'}</div>}
    {mode==='camera'&&active&&(phase==='permission'||phase==='loading')&&<div className={styles.setup} role="status"><LoaderCircle size={22}/><strong>{phase==='permission'?'Allow camera access':'Preparing your live fitting room'}</strong><span>{phase==='permission'?'Your camera starts only with your permission.':'Body models load locally. First startup can take a moment.'}</span></div>}
    {mode==='camera'&&phase==='searching'&&active&&!error&&<div className={styles.frameGuide} aria-hidden="true"><span/><span/><span/><span/></div>}
    <div className={styles.viewTools}>
      <button onClick={()=>setMirrored(value=>!value)} title="Toggle mirror mode" aria-label="Toggle mirror mode" aria-pressed={mirrored}><FlipHorizontal2 size={18}/></button>
      <button onClick={fullscreen} title="Fullscreen" aria-label="Open fullscreen mirror"><Maximize2 size={18}/></button>
      {mode==='camera'&&<button onClick={switchCamera} disabled={switching} title="Switch camera" aria-label="Switch camera"><RefreshCw size={18}/></button>}
    </div>
    {(error||assetError)&&<div className={styles.error} role="alert"><p>{error||assetError}</p><button onClick={()=>error?setRestart(value=>value+1):setAssetRetry(value=>value+1)}>{error?'Retry camera':'Retry garment'}</button><button onClick={()=>onModeChange('demo')}>Use demo</button></div>}
    {!active&&<div className={styles.paused}>Session paused · camera stopped</div>}
    <div className={styles.bottom}>
      {(mode==='camera'||debug)&&<div className={styles.tracking}><ScanLine size={12}/><span role="status">{active?status:'Session paused · camera stopped'}</span>{mode==='camera'&&active&&fps>0&&<small title="Observed pose inference and garment drawing rates on this device">{fps} pose/s · {renderFps} draw/s</small>}</div>}
      {mode==='camera'&&debug&&<div className={styles.chips}><span className={tracking?styles.checked:''}>Body</span><span className={faceReady?styles.checked:''}>Face</span><span className={maskReady?styles.checked:''}>Segmentation</span>{faceWarning&&<small>{faceWarning}</small>}</div>}
      <div className={`camera-toolbar ${styles.toolbar}`}>
        <span className={styles.privacy}><ShieldCheck size={12}/> {mode==='demo'?'Studio preview':'Local processing'}</span>
        {isPhoto&&<details className={styles.photoFit}><summary><SlidersHorizontal size={11}/> Photo fit</summary><strong>Adjust photo fit</strong><label>Width <output>{Math.round(fit.scaleX*100)}%</output><input aria-label="Photo garment width" type="range" min=".7" max="1.3" step=".01" value={fit.scaleX} onChange={event=>setPhotoFit({...fit,scaleX:Number(event.target.value)})}/></label><label>Length <output>{Math.round(fit.scaleY*100)}%</output><input aria-label="Photo garment length" type="range" min=".7" max="1.3" step=".01" value={fit.scaleY} onChange={event=>setPhotoFit({...fit,scaleY:Number(event.target.value)})}/></label><label>Vertical position <output>{fit.offsetY>0?'+':''}{Math.round(fit.offsetY*100)}%</output><input aria-label="Photo garment vertical position" type="range" min="-.2" max=".2" step=".01" value={fit.offsetY} onChange={event=>setPhotoFit({...fit,offsetY:Number(event.target.value)})}/></label><button type="button" onClick={()=>setPhotoFit({productId:product.id,scaleX:1,scaleY:1,offsetY:0})}>Reset fit</button><small>Adjust the approximate overlay placement. This does not measure garment size.</small></details>}
        {mode==='camera'&&<details className={styles.calibration}><summary>Calibrate</summary><label>Optional height (cm)<input type="number" min="100" max="230" placeholder="e.g. 172" value={heightInput} onChange={event=>setHeightInput(event.target.value)}/></label><small>Measurements are camera-based estimates. Use an upright, full-body view.</small></details>}
        <button className={styles.cameraButton} onClick={()=>onModeChange(mode==='demo'?'camera':'demo')}>{mode==='demo'?<Camera size={16}/>:<CameraOff size={16}/>} {mode==='demo'?'Start camera':'Stop camera'}</button>
      </div>
      {mode==='camera'&&<div className={styles.disclaimer}>Camera frames stay in this browser and are never uploaded or saved.</div>}
    </div>
  </div>;
}
