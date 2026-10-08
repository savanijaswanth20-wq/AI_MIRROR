import { describe, expect, it } from 'vitest';
import { findAlphaBounds, fitPhotoBounds, removePlainBackground, type PixelImage } from './photo-preparation';

function fixture(width = 10, height = 10): PixelImage {
  return { width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, () => [245, 245, 245, 255]).flat()) };
}
function pixel(image: PixelImage, x: number, y: number, color: number[]) { image.data.set(color, (y * image.width + x) * 4); }
function rectangle(image: PixelImage, x: number, y: number, width: number, height: number, color = [22, 50, 95, 255]) {
  for (let dy = y; dy < y + height; dy++) for (let dx = x; dx < x + width; dx++) pixel(image, dx, dy, color);
}

describe('garment photo background preparation', () => {
  it('removes connected background but preserves enclosed light fabric details and original colors', () => {
    const image = fixture(); rectangle(image, 2, 2, 6, 6); pixel(image, 4, 4, [245, 245, 245, 255]);
    const result = removePlainBackground(image);
    expect(result.image.data[3]).toBe(0);
    expect([...result.image.data.slice((4 * 10 + 4) * 4, (4 * 10 + 4) * 4 + 4)]).toEqual([245, 245, 245, 255]);
    expect([...result.image.data.slice((3 * 10 + 3) * 4, (3 * 10 + 3) * 4 + 4)]).toEqual([22, 50, 95, 255]);
    expect(image.data[3]).toBe(255);
    expect(findAlphaBounds(result.image)).toEqual({ x: 2, y: 2, width: 6, height: 6 });
  });

  it('softens near-background edge pixels without removing contrasting foreground', () => {
    const image = fixture(); rectangle(image, 2, 2, 6, 6); pixel(image, 2, 3, [219, 219, 219, 255]);
    const result = removePlainBackground(image, 38);
    const edgeAlpha = result.image.data[(3 * 10 + 2) * 4 + 3];
    expect(edgeAlpha).toBeGreaterThan(0); expect(edgeAlpha).toBeLessThan(255);
    expect(result.image.data[(3 * 10 + 3) * 4 + 3]).toBe(255);
  });

  it('respects existing transparency and fabric cutout holes', () => {
    const image = fixture(); image.data.fill(0); rectangle(image, 2, 2, 6, 6); pixel(image, 5, 5, [0, 0, 0, 0]);
    const result = removePlainBackground(image);
    expect(result.alreadyTransparent).toBe(true); expect(result.image.data).toEqual(image.data);
  });

  it('warns when a same-color garment is removed along with its backdrop', () => {
    const result = removePlainBackground(fixture());
    expect(findAlphaBounds(result.image)).toBeNull();
    expect(result.warnings.join(' ')).toContain('contrasting background');
  });

  it('warns for a varied border instead of claiming arbitrary background removal', () => {
    const image = fixture(20, 20); rectangle(image, 4, 4, 12, 12);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (x < 4 || y < 4 || x >= 16 || y >= 16) pixel(image, x, y, x % 2 ? [30, 180, 70, 255] : [245, 245, 245, 255]);
    }
    const result = removePlainBackground(image);
    expect(result.backgroundConsistency).toBeLessThan(.75); expect(result.warnings.join(' ')).toContain('uneven');
  });

  it('bounds sensitivity and rejects malformed pixel buffers', () => {
    const image = fixture(); rectangle(image, 2, 2, 6, 6);
    expect(removePlainBackground(image, Number.NaN).image.data).toEqual(removePlainBackground(image, 38).image.data);
    expect(() => findAlphaBounds({ ...image, data: new Uint8ClampedArray(2) })).toThrow('dimensions');
  });
});

describe('garment texture normalization', () => {
  it('preserves the photo ratio and fits inside the expected 400 by 600 texture', () => {
    const fitted = fitPhotoBounds({ x: 20, y: 30, width: 100, height: 200 }, 'top');
    expect(fitted.height).toBe(454); expect(fitted.width).toBe(227); expect(fitted.y).toBe(66);
    expect(fitted.x + fitted.width / 2).toBe(200);
  });

  it('uses the lower garment region and rejects an empty cutout', () => {
    const fitted = fitPhotoBounds({ x: 0, y: 0, width: 100, height: 300 }, 'bottom');
    expect(fitted.y).toBe(28); expect(fitted.y + fitted.height).toBeLessThanOrEqual(557);
    expect(() => fitPhotoBounds({ x: 0, y: 0, width: 0, height: 0 }, 'top')).toThrow('empty');
  });
});
