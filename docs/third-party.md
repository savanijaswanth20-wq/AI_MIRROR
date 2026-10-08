# Bundled vision assets

MediaPipe Tasks Vision 0.10.35 supplies the files under `frontend/public/mediapipe/wasm/`. Its installed package declares the Apache-2.0 license. A copy of the official MediaPipe license is retained at `frontend/public/mediapipe/LICENSE.txt`.

Pose and face task model downloads, original Google source URLs and SHA-256 hashes are listed in [vision.md](vision.md). Keep models and WASM runtime versions synchronized when upgrading them.

The mannequin in `frontend/public/demo/model.svg` and SVG garment shapes in `frontend/public/garments/` are original illustrations made for this prototype. The separate `frontend/public/garments/photos/` directory contains licensed sample photographs and derivatives; authors, source URLs, CC BY-SA 3.0 license and modification notices are listed in [garment-photo-sources.md](garment-photo-sources.md) and the in-app Photo credits link.

Other JavaScript and Python dependencies retain their package metadata and license files in the installed dependency tree. Package lock files record the versions used for local verification.
