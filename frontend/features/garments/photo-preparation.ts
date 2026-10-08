export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }
export interface PixelBounds { x: number; y: number; width: number; height: number }
export type GarmentSilhouette = 'top' | 'bottom' | 'dress';
export interface CutoutResult {
  image: PixelImage;
  backgroundRemoved: boolean;
  alreadyTransparent: boolean;
  removedFraction: number;
  backgroundConsistency: number;
  warnings: string[];
}

export const GARMENT_TEXTURE_SIZE = { width: 400, height: 600 };
export const GARMENT_PHOTO_BOUNDS: Record<GarmentSilhouette, PixelBounds> = {
  top: { x: 22, y: 66, width: 356, height: 454 },
  dress: { x: 35, y: 34, width: 330, height: 546 },
  bottom: { x: 82, y: 28, width: 236, height: 529 },
};

function validateImage(image: PixelImage) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1
    || image.width * image.height > 4_000_000 || image.data.length !== image.width * image.height * 4) {
    throw new Error('The garment image has invalid dimensions.');
  }
}

function edgeSamples(image: PixelImage) {
  const samples: number[] = [];
  const stride = Math.max(1, Math.floor((image.width + image.height) / 160));
  for (let x = 0; x < image.width; x += stride) {
    samples.push(x, (image.height - 1) * image.width + x);
  }
  for (let y = 1; y < image.height - 1; y += stride) {
    samples.push(y * image.width, y * image.width + image.width - 1);
  }
  return samples;
}

/** Only edge-connected plain background is removed, preserving enclosed prints. */
export function removePlainBackground(source: PixelImage, sensitivity = 38): CutoutResult {
  validateImage(source);
  const image = { ...source, data: new Uint8ClampedArray(source.data) };
  const samples = edgeSamples(source);
  const opaque = samples.filter(index => source.data[index * 4 + 3] > 32);
  const transparentFraction = 1 - opaque.length / samples.length;
  if (transparentFraction > .6) {
    return { image, alreadyTransparent: true, backgroundRemoved: false, removedFraction: transparentFraction, backgroundConsistency: 1, warnings: [] };
  }
  if (!opaque.length) {
    return { image, alreadyTransparent: true, backgroundRemoved: false, removedFraction: 1, backgroundConsistency: 1, warnings: [] };
  }

  // The dominant border cluster withstands a hanger or sleeve touching one edge.
  const clusters = new Map<string, number[]>();
  for (const index of opaque) {
    const offset = index * 4;
    const key = [0, 1, 2].map(channel => Math.round(source.data[offset + channel] / 28)).join(',');
    const cluster = clusters.get(key) ?? [];
    cluster.push(index); clusters.set(key, cluster);
  }
  const dominant = [...clusters.values()].sort((a, b) => b.length - a.length)[0];
  const background = [0, 1, 2].map(channel => dominant.reduce((sum, index) => sum + source.data[index * 4 + channel], 0) / dominant.length);
  const colorDistance = (index: number) => {
    const offset = index * 4;
    return Math.hypot(source.data[offset] - background[0], source.data[offset + 1] - background[1], source.data[offset + 2] - background[2]);
  };
  const tolerance = Math.max(8, Math.min(110, Number.isFinite(sensitivity) ? sensitivity : 38));
  const feather = 18;
  const consistency = opaque.filter(index => colorDistance(index) < 55).length / opaque.length;
  const count = source.width * source.height;
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0, tail = 0, removed = 0;
  const enqueue = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    if (source.data[index * 4 + 3] <= 16 || colorDistance(index) <= tolerance + feather) queue[tail++] = index;
  };
  for (let x = 0; x < source.width; x++) { enqueue(x); enqueue((source.height - 1) * source.width + x); }
  for (let y = 1; y < source.height - 1; y++) { enqueue(y * source.width); enqueue(y * source.width + source.width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const offset = index * 4;
    const alpha = source.data[offset + 3];
    const retained = Math.max(0, Math.min(1, (colorDistance(index) - tolerance) / feather));
    image.data[offset + 3] = Math.round(alpha * retained);
    if (alpha > 16 && image.data[offset + 3] < alpha) removed++;
    const x = index % source.width;
    if (x > 0) enqueue(index - 1);
    if (x < source.width - 1) enqueue(index + 1);
    if (index >= source.width) enqueue(index - source.width);
    if (index < count - source.width) enqueue(index + source.width);
  }
  const removedFraction = removed / count;
  const warnings: string[] = [];
  if (consistency < .75) warnings.push('This background is uneven. Use a plain contrasting backdrop or upload an existing transparent cutout.');
  if (removedFraction < .04) warnings.push('Very little background was removed. Inspect the preview before applying.');
  if (removedFraction > .96) warnings.push('Most of the garment disappeared. Lower the sensitivity or photograph it against a contrasting background.');
  return { image, alreadyTransparent: false, backgroundRemoved: removed > 0, removedFraction, backgroundConsistency: consistency, warnings };
}

export function findAlphaBounds(image: PixelImage, minimumAlpha = 16): PixelBounds | null {
  validateImage(image);
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] <= minimumAlpha) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Fit without stretching fabric; the live mirror offers fine alignment controls. */
export function fitPhotoBounds(source: PixelBounds, silhouette: GarmentSilhouette): PixelBounds {
  if (source.width <= 0 || source.height <= 0) throw new Error('The cutout is empty.');
  const target = GARMENT_PHOTO_BOUNDS[silhouette];
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = source.width * scale, height = source.height * scale;
  return { x: target.x + (target.width - width) / 2, y: target.y, width, height };
}

export function createNormalizedPhotoCanvas(image: PixelImage, silhouette: GarmentSilhouette): HTMLCanvasElement {
  const bounds = findAlphaBounds(image);
  if (!bounds || bounds.width < 4 || bounds.height < 4) throw new Error('No garment remains in the cutout. Lower the sensitivity or use a contrasting background.');
  const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
  const sourceContext = source.getContext('2d');
  const output = document.createElement('canvas'); output.width = GARMENT_TEXTURE_SIZE.width; output.height = GARMENT_TEXTURE_SIZE.height;
  const context = output.getContext('2d');
  if (!sourceContext || !context) throw new Error('This browser cannot prepare a garment photo.');
  const pixels = sourceContext.createImageData(image.width, image.height); pixels.data.set(image.data); sourceContext.putImageData(pixels, 0, 0);
  const target = fitPhotoBounds(bounds, silhouette);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, target.x, target.y, target.width, target.height);
  return output;
}

export async function decodeGarmentPhoto(file: File): Promise<PixelImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP garment photo.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Choose a garment photo smaller than 12 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (image.naturalWidth < 16 || image.naturalHeight < 16 || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('Use a photo between 16 pixels and 40 megapixels.');
    const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot read the garment photo.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: pixels.data };
  } catch (cause) {
    if (cause instanceof Error && !['EncodingError', 'InvalidStateError'].includes(cause.name)) throw cause;
    throw new Error('This garment photo could not be decoded. Export it as PNG or JPEG and try again.');
  } finally { URL.revokeObjectURL(url); }
}

export function canvasToPngFile(canvas: HTMLCanvasElement, name = 'garment-photo.png'): Promise<File> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('Could not export the garment cutout.')), 'image/png'));
}
