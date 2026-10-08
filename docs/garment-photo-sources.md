# Garment photograph sample assets

These two garments are sample imagery for testing photo upload and pose-following overlays. They do not represent verified store inventory, a brand partnership, or physically accurate fit. The source photographs contain garments only, with no people. Source files are retained for provenance; use the transparent PNG derivatives for overlays.

Sources and licenses were inspected on 8 October 2026. Both the originals and the derivatives listed below are distributed under **Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)**. Keep this attribution, the source links, the license link, and the modification notices with redistributions. The photographers do not endorse this application.

License: <https://creativecommons.org/licenses/by-sa/3.0/>

## Blue cotton T-shirt

- Attribution: **Juan de Vojníkov (Juandev), “Ironed blue T-shirt (001).JPG,” 26 May 2010, CC BY-SA 3.0.**
- Authoritative source and license declaration: <https://commons.wikimedia.org/wiki/File:Ironed_blue_T-shirt_(001).JPG>
- Original download: <https://upload.wikimedia.org/wikipedia/commons/b/b3/Ironed_blue_T-shirt_%28001%29.JPG>
- Original local file: `frontend/public/garments/photos/cotton-tee-source.jpg` — 3312 × 4416, JPEG.
- Overlay local file: `frontend/public/garments/photos/cotton-tee-photo.png` — 1086 × 1448, transparent RGBA PNG.
- Front-facing cotton T-shirt; `top` silhouette; blue reference swatch `#657897`. The original contains a small interior neck label.

The source page includes Canon PowerShot G10 camera metadata. The overlay is a **photo-derived, AI-assisted edit** of this real photograph: the built-in image editing tool removed the wardrobe, hanger, and background to create transparency. It is not an unedited photograph or an image produced by the application's plain-background removal algorithm. AI editing may alter fine garment detail. This edited derivative is distributed under the same CC BY-SA 3.0 license.

## Grey turtleneck sweater

- Attribution: **Joan Rocaguinard, “Jersei-coll-alt.jpg,” 8 December 2011, CC BY-SA 3.0.**
- Authoritative source and license declaration: <https://commons.wikimedia.org/wiki/File:Jersei-coll-alt.jpg>
- Original download: <https://upload.wikimedia.org/wikipedia/commons/e/ea/Jersei-coll-alt.jpg>
- Original local file: `frontend/public/garments/photos/grey-turtleneck-source.jpg` — 678 × 768, JPEG.
- Overlay local file: `frontend/public/garments/photos/grey-turtleneck-cutout.png` — 400 × 600, transparent RGBA PNG.
- Front-facing textured sweater; `top` silhouette; grey reference swatch `#928f7e`.

This derivative uses the application's deterministic helper in `frontend/features/garments/photo-preparation.ts`: crop 29 pixels from the top to remove the loose strand above the collar; run `removePlainBackground` at sensitivity 85; compute alpha bounds with `findAlphaBounds`; fit those bounds with `fitPhotoBounds('top')`; resize and composite onto a transparent 400 × 600 canvas. Sharp performs image decoding, cropping, resizing, and PNG encoding. No garment recoloring, generative editing, or separate masking algorithm is applied. The original photographer's file already includes image editing metadata. This derivative is distributed under the same CC BY-SA 3.0 license.

## Validation and limits

Both final PNGs were visually inspected and checked for alpha values spanning 0–255. The sweater preparation reports background consistency 1 and no helper warnings. The sweater retains small photographic edge details; the blue tee carries the AI editing notice above. Rejected samples with visible background halos, fragmented carpet, or damaged fur trim were removed from the sample asset folder.

The camera overlay follows tracked body landmarks and resizes a flat photograph. It does not simulate fabric drape, recover a 3D garment, or predict size from these source images.

## Built-in image edit record

The blue tee sample used the built-in `image_gen` tool in transparent-background edit mode. The saved project artifact is `frontend/public/garments/photos/cotton-tee-photo.png`. Final prompt:

> Use case: background-extraction. Edit target: the attached actual photograph of a blue cotton T-shirt hanging against a wooden cabinet. Create a clean transparent-background garment cutout for a virtual fitting room. Remove only the entire wooden cabinet/background and the hanger above/inside the neckline; keep the T-shirt front, exact blue color, natural photographed fabric texture, existing wrinkles, stitching, seams, sleeve shape, hem silhouette, neckline and small interior label unchanged as closely as possible. Preserve the original front-view pose, asymmetric wrinkles and geometry: do not straighten, redesign, embellish, recolor, generate a different garment or put it on a person. Cut out background fully around sleeves and body, no wood residue, no shadow outside garment, no added text, no mannequin, no person, no backdrop. Use genuine alpha transparency, leave a small transparent margin around the entire visible garment, high fidelity product-photo extraction.
