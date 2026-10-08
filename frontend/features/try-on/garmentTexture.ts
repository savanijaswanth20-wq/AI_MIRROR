export interface TextureBounds { x: number; y: number; width: number; height: number }

/** Padding in an uploaded cutout must not shift its collar or hem on the body. */
export function alphaBounds(pixels: ArrayLike<number>, width: number, height: number): TextureBounds | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) return null;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] < 24) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function isPhotoGarment(source: string): boolean {
  return !/\.svg(?:[?#]|$)|^data:image\/svg\+xml/i.test(source);
}
