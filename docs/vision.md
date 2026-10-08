# Browser vision and try-on

`frontend/features/camera/MirrorCamera.tsx` owns camera permission, stream lifecycle and local inference. MediaPipe Tasks Vision 0.10.35 runs a two-person Pose Landmarker with segmentation and a Face Landmarker. Pose inference is capped at 20 frames per second; face inference runs every fourth processed frame. Actual speed depends on device, camera resolution and GPU support. The renderer uses `requestAnimationFrame`; model initialization attempts GPU and falls back to CPU.

Camera frames, face landmarks, segmentation masks and sampled cheek pixels are processed only in the browser. These modules make no image-upload calls. Session metadata may be sent by the shopping application, but raw camera frames are never part of a body profile. Stopping, switching, pausing or unmounting the camera cancels animation, stops stream tracks, closes task instances and releases mask canvases. Customer screenshots are not saved by these modules.

Models and runtime assets are served from the same frontend origin. No CDN is required after the app is installed. Missing files produce a local model error; demo mode remains available. Camera access requires HTTPS or localhost. The static task files were downloaded from Google's official MediaPipe model bucket:

| File | Official source | SHA-256 |
| --- | --- | --- |
| `pose_landmarker_lite.task` | [Pose Landmarker Lite float16 v1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `face_landmarker.task` | [Face Landmarker float16 v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

WASM and loader assets in `frontend/public/mediapipe/wasm` are copied from the installed `@mediapipe/tasks-vision` package. Keep those files synchronized when upgrading the package. They are third-party runtime files and should be excluded from application linting.

## Overlay boundary

`VirtualTryOnEngine` defines garment loading, frame rendering and disposal. `RealtimeOverlayEngine` implements this interface: a time-based low-pass filter smooths pose landmarks, body anchors scale and rotate a garment mesh, affine triangle transforms apply perspective approximation, and the person mask suppresses background spill. The mask is slightly dilated for garment hems; dresses may extend beyond existing legs below the hip line. A forearm crossing the torso removes the garment in a rough arm capsule, revealing the original camera layer.

The illustrated demo and camera use the same geometry/rendering engine. The bundled SVG assets are original vector illustrations, not product photography or realistic cloth simulation. Custom raster garment images are supported; automatic SVG color changes apply only to the sample assets' `#596c57` fabric fill.

`AIVirtualTryOnEngine` is an explicit future adapter and throws an informative error if invoked. No generative VTON provider is connected. Cloth drape, reliable 3D depth ordering, garment-specific anchors, cloth textures and photorealism require a later provider and quality validation.

## Fashion estimates

Body profiles contain image-space shoulder, hip and torso proportions. Physical measurements are absent until the customer optionally enters their height and stands upright with their whole body visible. A frontal camera cannot observe chest circumference, so this implementation does not invent one. The customer-entered height is a calibration reference, not an independently detected measurement. All inferred measurements remain approximate and are affected by perspective, pose and camera placement.

Face shape is a 2D geometric fashion heuristic, with an explicit estimate label. The cheek color range describes camera appearance under current lighting and is labeled accordingly. These modules never infer identity, attractiveness, race, ethnicity, religion or health. Low lighting, oblique head angles and poor visibility can make these estimates unreliable. Size choices should be confirmed against the brand's official chart.

## Verification

`features/try-on/geometry.test.ts` checks scale/translation invariance, rotation, missing and low-confidence anchors, exact triangle transforms, smoothing/dropout behavior and calibration privacy. Live camera performance and physical garment fit require validation on the actual kiosk camera and hardware; unit tests do not establish a real-world FPS or tailor-level accuracy.
