'use client';

import { useMemo, useState } from 'react';
import { Check, ImagePlus, LoaderCircle, RotateCcw, Scissors } from 'lucide-react';
import { uploadGarmentAsset } from '@/features/admin/admin-model';
import { canvasToPngFile, createNormalizedPhotoCanvas, decodeGarmentPhoto, removePlainBackground, type GarmentSilhouette, type PixelImage } from './photo-preparation';

interface Props {
  silhouette: GarmentSilhouette;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onApply: (url: string, updateCatalogue: boolean) => void;
}

function originalPreview(image: PixelImage) {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot preview the garment photo.');
  const pixels = context.createImageData(image.width, image.height); pixels.data.set(image.data); context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

export default function GarmentPhotoStudio({ silhouette, disabled, onBusyChange, onApply }: Props) {
  const [source, setSource] = useState<PixelImage | null>(null);
  const [original, setOriginal] = useState('');
  const [name, setName] = useState('');
  const [sensitivity, setSensitivity] = useState(38);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [updateCatalogue, setUpdateCatalogue] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);

  const prepared = useMemo(() => {
    if (!source) return null;
    try {
      const result = removeBackground ? removePlainBackground(source, sensitivity) : {
        image: source, alreadyTransparent: false, warnings: ['Original background is retained and will appear on camera. Use a transparent cutout for a clean overlay.'],
      };
      const canvas = createNormalizedPhotoCanvas(result.image, silhouette);
      return { canvas, preview: canvas.toDataURL('image/png'), warnings: result.warnings, alreadyTransparent: result.alreadyTransparent, error: '' };
    } catch (cause) { return { canvas: null, preview: '', warnings: [], alreadyTransparent: false, error: cause instanceof Error ? cause.message : 'Could not prepare this photo.' }; }
  }, [source, sensitivity, removeBackground, silhouette]);

  async function choose(file: File) {
    setLoading(true); onBusyChange(true); setError(''); setApplied(false);
    try {
      const decoded = await decodeGarmentPhoto(file);
      setOriginal(originalPreview(decoded)); setSource(decoded); setName(file.name); setSensitivity(38); setRemoveBackground(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read the garment photo.'); }
    finally { setLoading(false); onBusyChange(false); }
  }

  async function apply() {
    if (!prepared?.canvas) return;
    setLoading(true); onBusyChange(true); setError('');
    try {
      const file = await canvasToPngFile(prepared.canvas);
      const url = await uploadGarmentAsset(file);
      onApply(url, updateCatalogue); setApplied(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply the garment photo.'); }
    finally { setLoading(false); onBusyChange(false); }
  }

  return <section className="garment-photo-studio admin-span-2" aria-label="Real garment photo studio">
    <div className="garment-photo-heading"><span className="garment-photo-icon"><Scissors size={18}/></span><div><h3>Real garment photo</h3><p>Prepare a photograph for the live mirror.</p></div><span className="garment-photo-local">Processed on this device</span></div>
    <p className="garment-photo-guidance">Use a straight, front-facing photo of the garment laid flat or on a hanger, against a plain contrasting background. PNG cutouts also work. Avoid photos of people.</p>
    <label className={`garment-photo-upload ${disabled ? 'disabled' : ''}`}><ImagePlus size={22}/><span><strong>{name || 'Choose a garment photo'}</strong><small>PNG, JPEG or WebP · up to 12 MB</small></span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose real garment photo" disabled={disabled || loading} onChange={event => {
      const file = event.target.files?.[0]; if (file) void choose(file); event.target.value = '';
    }}/>{loading ? <LoaderCircle className="admin-spin" size={17}/> : <span className="garment-photo-upload-action">{source ? 'Replace' : 'Browse'}</span>}</label>
    {source && prepared && <>
      <div className="garment-photo-previews">
        <figure><div><img src={original} alt="Original supplied garment photograph"/></div><figcaption>Original photograph</figcaption></figure>
        <figure><div className="garment-photo-checker">{prepared.preview ? <img src={prepared.preview} alt="Prepared garment photo with transparent background"/> : <span>No garment detected</span>}</div><figcaption>Camera overlay · {silhouette}</figcaption></figure>
      </div>
      <div className="garment-photo-controls">
        <label className="garment-photo-option"><input type="checkbox" checked={removeBackground} disabled={disabled || loading} onChange={event => { setRemoveBackground(event.target.checked); setApplied(false); }}/><span>Remove plain background</span></label>
        {removeBackground && !prepared.alreadyTransparent && <label className="garment-photo-sensitivity"><span>Background sensitivity <output>{sensitivity}</output></span><input type="range" aria-label="Background removal sensitivity" min={8} max={110} step={2} value={sensitivity} disabled={disabled || loading} onChange={event => { setSensitivity(Number(event.target.value)); setApplied(false); }}/><small>Lower preserves more fabric. Higher removes more background.</small></label>}
        {prepared.alreadyTransparent && <p className="garment-photo-transparent"><Check size={13}/> Existing transparency preserved.</p>}
        <label className="garment-photo-option"><input type="checkbox" checked={updateCatalogue} disabled={disabled || loading} onChange={event => setUpdateCatalogue(event.target.checked)}/><span>Also use this photo for the catalogue and front image</span></label>
      </div>
      {prepared.warnings.map(warning => <p className="garment-photo-warning" key={warning}>{warning}</p>)}
      {prepared.error && <p className="garment-photo-warning" role="alert">{prepared.error}</p>}
      <div className="garment-photo-actions"><button type="button" className="admin-text-button" disabled={disabled || loading} onClick={() => { setSensitivity(38); setRemoveBackground(true); setApplied(false); }}><RotateCcw size={13}/> Reset cutout</button><button type="button" className="admin-button" disabled={disabled || loading || !prepared.canvas} onClick={() => void apply()}>{loading ? <LoaderCircle className="admin-spin" size={15}/> : <Check size={15}/>} Apply photo to overlay</button></div>
      {applied && <p className="garment-photo-success" role="status"><Check size={14}/> Photo added to this draft. Save product to make it available in the mirror.</p>}
    </>}
    {error && <p className="garment-photo-warning" role="alert">{error}</p>}
    <p className="garment-photo-note">The mirror preserves the photographed color and fabric details. Use one photographed color per item. This is a moving 2D preview; fine-tune placement in the mirror. Only the prepared garment PNG is uploaded when you apply it.</p>
  </section>;
}
