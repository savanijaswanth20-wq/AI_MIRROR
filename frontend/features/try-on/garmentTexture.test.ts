import { describe, expect, it } from 'vitest';
import { alphaBounds, isPhotoGarment } from './garmentTexture';
import { alignGarmentFrame, createGarmentFrame } from './geometry';
import { demoPose } from '../pose/demoPose';

describe('garment photo alignment', () => {
  it('ignores transparent padding and preserves the complete visible cutout', () => {
    const pixels = new Uint8ClampedArray(8 * 6 * 4);
    pixels[(2 * 8 + 1) * 4 + 3] = 255;
    pixels[(4 * 8 + 6) * 4 + 3] = 80;
    pixels[3] = 10;
    expect(alphaBounds(pixels, 8, 6)).toEqual({x: 1, y: 2, width: 6, height: 3});
  });
  it('rejects empty cutouts and malformed buffers', () => {
    expect(alphaBounds(new Uint8Array(16), 2, 2)).toBeNull();
    expect(alphaBounds(new Uint8Array(8), 2, 2)).toBeNull();
    expect(alphaBounds([], 0, 0)).toBeNull();
  });
  it('retains the original photograph instead of treating raster assets as tintable vectors', () => {
    expect(isPhotoGarment('/api/garment-assets/shirt.png')).toBe(true);
    expect(isPhotoGarment('/garments/shirt.svg?revision=2')).toBe(false);
    expect(isPhotoGarment('data:image/svg+xml;base64,test')).toBe(false);
  });
  it('fits the visible photo from collar to hip without sample-vector padding', () => {
    const photo = createGarmentFrame(demoPose(), 600, 900, 'top', true)!;
    const vector = createGarmentFrame(demoPose(), 600, 900, 'top')!;
    expect(photo.rows[0].left.y).toBeGreaterThan(vector.rows[0].left.y);
    expect(photo.rows[8].left.y).toBeLessThan(vector.rows[8].left.y);
  });
  it('changes width and length while pinning the collar midpoint', () => {
    const pose = demoPose(), original = createGarmentFrame(pose, 600, 900, 'top', true)!;
    const adjusted = alignGarmentFrame(original, pose, 600, 900, {scaleX: 1.2, scaleY: 1.3, offsetX: 0, offsetY: 0});
    expect((adjusted.rows[0].left.x + adjusted.rows[0].right.x) / 2).toBeCloseTo((original.rows[0].left.x + original.rows[0].right.x) / 2);
    expect(adjusted.rows[0].left.y).toBeCloseTo(original.rows[0].left.y);
    expect(adjusted.rows[0].right.x - adjusted.rows[0].left.x).toBeCloseTo((original.rows[0].right.x - original.rows[0].left.x) * 1.2);
    expect(adjusted.rows[8].left.y - adjusted.rows[0].left.y).toBeCloseTo((original.rows[8].left.y - original.rows[0].left.y) * 1.3);
  });
  it('moves in body-relative units and rejects unsafe adjustment values', () => {
    const pose = demoPose(), original = createGarmentFrame(pose, 600, 900, 'top', true)!;
    const moved = alignGarmentFrame(original, pose, 600, 900, {scaleX: 1, scaleY: 1, offsetX: .1, offsetY: .1});
    expect(moved.rows[0].left.x - original.rows[0].left.x).toBeCloseTo((pose[12].x - pose[11].x) * 600 * .1);
    expect(moved.rows[0].left.y - original.rows[0].left.y).toBeCloseTo((pose[23].y - pose[11].y) * 900 * .1);
    const safe = alignGarmentFrame(original, pose, 600, 900, {scaleX: NaN, scaleY: Infinity, offsetX: NaN, offsetY: NaN});
    expect(safe.rows).toEqual(original.rows);
  });
});
