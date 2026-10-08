'use client';

import { useState } from 'react';
import { Check, ImagePlus, LoaderCircle, X } from 'lucide-react';
import type { Product, Size } from '@/lib/types';
import GarmentPhotoStudio from '@/features/garments/garment-photo-studio';
import { uploadGarmentAsset, SIZES } from './admin-model';

interface Props { product: Product; onClose: () => void; onSave: (product: Product) => Promise<void> }
const imageFields: { key: 'image' | 'garmentImage' | 'frontImage' | 'backImage' | 'mask'; label: string }[] = [
  { key: 'image', label: 'Catalogue image' }, { key: 'garmentImage', label: 'Transparent garment' },
  { key: 'frontImage', label: 'Front image' }, { key: 'backImage', label: 'Back image' }, { key: 'mask', label: 'Garment mask' },
];

export default function ProductEditor({ product, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Product>(structuredClone(product));
  const [colorsText, setColorsText] = useState(product.colors.map(color => `${color.name}:${color.hex}`).join(', '));
  const [occasions, setOccasions] = useState(product.occasions.join(', '));
  const [measurements, setMeasurements] = useState(JSON.stringify(product.measurements, null, 2));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setField = <K extends keyof Product>(key: K, value: Product[K]) => setDraft(previous => ({ ...previous, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const colors = colorsText.split(',').filter(value => value.trim()).map(value => {
        const parts = value.trim().split(':');
        const [name, hex] = parts;
        if (parts.length !== 2 || !name?.trim() || name.trim().length > 40 || !/^#[0-9a-f]{6}$/i.test(hex?.trim() ?? '')) throw new Error('Colors must use Name:#RRGGBB, separated by commas. Keep names under 40 characters.');
        return { name: name.trim(), hex: hex.trim() };
      });
      if (!colors.length || !draft.sizes.length) throw new Error('Choose at least one color and one size.');
      if (colors.length > 12 || new Set(colors.map(color => color.name.toLowerCase())).size !== colors.length) throw new Error('Choose up to 12 colors with unique names.');
      const selectedOccasions = occasions.split(',').map(value => value.trim()).filter(Boolean);
      const validOccasions = ['Casual', 'Office', 'Interview', 'College', 'Party', 'Wedding', 'Festival', 'Travel', 'Date', 'Formal event'];
      if (!selectedOccasions.length || selectedOccasions.some(value => !validOccasions.includes(value))) throw new Error(`Choose occasions from: ${validOccasions.join(', ')}.`);
      const parsed: unknown = JSON.parse(measurements);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Measurements must be an object keyed by garment size.');
      for (const [size, measurement] of Object.entries(parsed)) {
        if (!SIZES.includes(size as Size) || !measurement || typeof measurement !== 'object') throw new Error('Measurement keys must be XS, S, M, L, XL or XXL.');
        for (const field of ['chest', 'length', 'shoulder']) {
          const value = (measurement as Record<string, unknown>)[field];
          const maximum = field === 'shoulder' ? 100 : 200;
          if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > maximum) throw new Error(`${size} ${field} must be a positive centimetre measurement up to ${maximum}.`);
        }
      }
      if (draft.sizes.some(size => !(size in parsed))) throw new Error('Add chest, length and shoulder measurements for every available size.');
      if (!draft.name.trim() || !draft.sku.trim() || !draft.category.trim()) throw new Error('Name, SKU and category are required.');
      for (const field of imageFields) {
        const asset = draft[field.key];
        if (asset && !/^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|webp|svg\+xml);base64,)/i.test(asset)) throw new Error(`${field.label} must be an HTTPS/HTTP image, a local path or an uploaded image.`);
      }
      setBusy(true);
      const normalized = Object.fromEntries(Object.entries(parsed).map(([size, value]) => { const measurement = value as Product['measurements'][string]; return [size, { chest: measurement.chest, length: measurement.length, shoulder: measurement.shoulder }]; }));
      await onSave({ ...draft, name: draft.name.trim(), sku: draft.sku.trim(), colors, occasions: selectedOccasions, measurements: normalized });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the product.'); }
    finally { setBusy(false); }
  }

  return <div className="admin-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="admin-modal" role="dialog" aria-modal="true" aria-label="Product editor">
      <div className="admin-modal-heading"><div><span className="admin-eyebrow">CATALOGUE STUDIO</span><h2>{product.sku ? 'Edit product' : 'Add a new product'}</h2></div><button type="button" className="admin-icon-button" onClick={onClose} disabled={busy} aria-label="Close product editor"><X size={21}/></button></div>
      <form onSubmit={save}>
        <div className="admin-form-grid">
          <label className="admin-field admin-span-2">Product name<input required maxLength={120} value={draft.name} onChange={event => setField('name', event.target.value)} placeholder="The Everyday Linen Shirt"/></label>
          <label className="admin-field">SKU<input required maxLength={50} value={draft.sku} onChange={event => setField('sku', event.target.value)} placeholder="ASM-SH-031"/></label>
          <label className="admin-field">Brand<input required maxLength={80} value={draft.brand} onChange={event => setField('brand', event.target.value)}/></label>
          <label className="admin-field">Category<input required maxLength={60} value={draft.category} onChange={event => setField('category', event.target.value)} list="admin-category-list"/><datalist id="admin-category-list">{['T-shirts', 'Shirts', 'Sweaters', 'Hoodies', 'Jackets', 'Blazers', 'Dresses', 'Kurtis', 'Jeans', 'Trousers', 'Ethnic wear'].map(category => <option key={category}>{category}</option>)}</datalist></label>
          <label className="admin-field">Collection<select value={draft.gender} onChange={event => setField('gender', event.target.value as Product['gender'])}><option>Men</option><option>Women</option><option>Unisex</option></select></label>
          <label className="admin-field">Price · INR<input required type="number" min={1} max={1000000} step="1" value={draft.price} onChange={event => setField('price', Number(event.target.value))}/></label>
          <label className="admin-field">Discount · %<input required type="number" min={0} max={90} step="1" value={draft.discount} onChange={event => setField('discount', Number(event.target.value))}/></label>
          <label className="admin-field">Available stock<input required type="number" min={0} max={100000} step="1" value={draft.stock} onChange={event => setField('stock', Number(event.target.value))}/></label>
          <label className="admin-field">Overlay silhouette<select value={draft.silhouette} onChange={event => setField('silhouette', event.target.value as Product['silhouette'])}><option value="top">Top</option><option value="bottom">Bottom</option><option value="dress">Dress</option></select></label>
          <label className="admin-field admin-span-2">Description<textarea required maxLength={1500} rows={3} value={draft.description} onChange={event => setField('description', event.target.value)}/></label>
          <div className="admin-field admin-span-2"><span>Available sizes</span><div className="admin-size-controls">{SIZES.map(size => <button className={draft.sizes.includes(size) ? 'selected' : ''} type="button" key={size} onClick={() => setField('sizes', draft.sizes.includes(size) ? draft.sizes.filter(value => value !== size) : [...draft.sizes, size])}>{size}</button>)}</div></div>
          <label className="admin-field admin-span-2">Colors · Name:#RRGGBB<input required value={colorsText} onChange={event => setColorsText(event.target.value)} placeholder="Stone:#d7d0c3, Olive:#63745b"/><small>Comma-separated color names and six-digit hex values.</small></label>
          <label className="admin-field">Rack / location<input required maxLength={30} value={draft.rack} onChange={event => setField('rack', event.target.value)} placeholder="B12"/></label>
          <label className="admin-field">Floor<input type="number" min={0} max={50} value={draft.floor} onChange={event => setField('floor', Number(event.target.value))}/></label>
          <label className="admin-field">Store<input required maxLength={100} value={draft.store} onChange={event => setField('store', event.target.value)}/></label>
          <label className="admin-field">Section<input required maxLength={100} value={draft.section} onChange={event => setField('section', event.target.value)}/></label>
          <label className="admin-field admin-span-2">Occasions<input value={occasions} onChange={event => setOccasions(event.target.value)} placeholder="Casual, Office, Travel"/></label>
          <label className="admin-field admin-span-2">Garment measurements · centimetres<textarea className="admin-code-field" rows={6} value={measurements} onChange={event => setMeasurements(event.target.value)} spellCheck={false}/><small>Example: {'{"M":{"chest":104,"length":72,"shoulder":46}}'}. Review the sample measurements and include every selected size.</small></label>
          <GarmentPhotoStudio silhouette={draft.silhouette} disabled={busy} onBusyChange={setBusy} onApply={(url, updateCatalogue) => setDraft(previous => ({ ...previous, garmentImage: url, ...(updateCatalogue ? { image: url, frontImage: url } : {}) }))}/>
          <div className="admin-span-2 admin-form-section"><span className="admin-eyebrow">GARMENT ASSETS</span><p>Prepared photo overlays appear here. You can also use a transparent PNG or self-contained SVG directly. Uploaded assets are limited to 2 MB.</p></div>
          {imageFields.map(field => <label className="admin-field admin-span-2" key={field.key}>{field.label}<div className="admin-asset-control"><input value={draft[field.key]} onChange={event => setField(field.key, event.target.value)} placeholder="/assets/garments/shirt.svg or https://…"/><label className="admin-upload"><ImagePlus size={17}/><span>Upload</span><input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try { setBusy(true); setField(field.key, await uploadGarmentAsset(file)); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed.'); } finally { setBusy(false); }
            event.target.value = '';
          }}/></label></div>{draft[field.key].startsWith('data:') && <small><Check size={12}/> Uploaded image ready to save</small>}</label>)}
        </div>
        {error && <div className="admin-error" role="alert">{error}</div>}
        <div className="admin-modal-actions"><button type="button" className="admin-button admin-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="admin-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="admin-spin" size={17}/> : <Check size={17}/>} Save product</button></div>
      </form>
    </section>
  </div>;
}
