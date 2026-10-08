import type { AnalyticsEvent, Product, Size } from '@/lib/types';

export const ADMIN_TOKEN_KEY = 'mirror.admin.token';
export const SIZE_CHART_KEY = 'mirror.admin.sizeCharts';
export const STATIONS_KEY = 'mirror.admin.stations';
export const SIZES: Size[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const EVENT_TYPES = {
  session: ['session_start', 'session_started'],
  tryOn: ['try_on', 'try-on', 'product_try_on'],
  cart: ['add_to_cart', 'cart_add'],
  recommendation: ['recommendation', 'recommendation_viewed'],
  comparison: ['compare', 'comparison'],
  purchase: ['purchase', 'order_completed'],
};

export function isEvent(event: AnalyticsEvent, kind: keyof typeof EVENT_TYPES) {
  return EVENT_TYPES[kind].includes(event.type);
}

export function summarize(events: AnalyticsEvent[]) {
  const sessionIds = new Set(events.map(event => event.sessionId));
  const tries = events.filter(event => isEvent(event, 'tryOn'));
  const triedSessions = new Set(tries.map(event => event.sessionId));
  const convertedSessions = (kind: 'cart' | 'purchase') => new Set(events.filter(event => isEvent(event, kind) && tries.some(attempt => attempt.sessionId === event.sessionId && Date.parse(attempt.timestamp) <= Date.parse(event.timestamp))).map(event => event.sessionId));
  const convert = (kind: 'cart' | 'purchase') => triedSessions.size
    ? Math.round(convertedSessions(kind).size / triedSessions.size * 100) : 0;
  const durations: number[] = [];
  sessionIds.forEach(id => {
    const session = events.filter(event => event.sessionId === id).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const start = session.find(event => isEvent(event, 'session'));
    const end = session.find(event => event.type === 'session_end');
    if (start && end) durations.push(Math.max(0, (Date.parse(end.timestamp) - Date.parse(start.timestamp)) / 1000));
  });
  return {
    sessions: sessionIds.size,
    tries: tries.length,
    cartConversion: convert('cart'),
    purchaseConversion: convert('purchase'),
    purchases: events.filter(event => isEvent(event, 'purchase')).length,
    averageDuration: durations.length ? Math.round(durations.reduce((sum, time) => sum + time, 0) / durations.length) : null,
    dailySessions: new Set(events.filter(event => new Date(event.timestamp).toDateString() === new Date().toDateString()).map(event => event.sessionId)).size,
  };
}

export function groupEvents(events: AnalyticsEvent[], field: 'productId' | 'color' | 'size', kind?: keyof typeof EVENT_TYPES) {
  const counts = new Map<string, number>();
  events.filter(event => !kind || isEvent(event, kind)).forEach(event => {
    const key = event[field];
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export function newProduct(): Product {
  return {
    id: `product-${crypto.randomUUID()}`, sku: '', name: '', brand: 'ATELIER', description: '',
    category: 'Shirts', gender: 'Unisex', price: 2490, discount: 0, sizes: ['S', 'M', 'L', 'XL'],
    colors: [{ name: 'Stone', hex: '#d7d0c3' }], stock: 10,
    image: '/garments/shirts.svg', garmentImage: '/garments/shirts.svg', frontImage: '/garments/shirts.svg', backImage: '/garments/shirts.svg', mask: '/garments/shirts.svg',
    measurements: { S: { chest: 96, length: 68, shoulder: 42 }, M: { chest: 104, length: 70, shoulder: 44 }, L: { chest: 112, length: 72, shoulder: 46 }, XL: { chest: 120, length: 74, shoulder: 48 } },
    rack: '', floor: 1, section: 'New collection', store: 'Atelier Flagship · Bengaluru', occasions: ['Casual'], silhouette: 'top',
  };
}

export async function adminRequest(path: string, method = 'GET', body?: unknown) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || '/api/backend';
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token && process.env.NEXT_PUBLIC_API_URL) throw new Error('Enter your backend admin token in Settings before changing connected store data.');
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}${path.replace(/^\/api(?=\/)/, '')}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
  } catch (cause) {
    if (!process.env.NEXT_PUBLIC_API_URL && cause instanceof TypeError) return null;
    throw cause;
  }
  if (response.status === 503 && !process.env.NEXT_PUBLIC_API_URL) return null;
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const validation = Array.isArray(result.detail) ? result.detail[0] : null;
    const message = typeof result.detail === 'string' ? result.detail : validation?.msg
      ? `${Array.isArray(validation.loc) ? validation.loc.slice(1).join(' · ') + ': ' : ''}${validation.msg}`
      : `Store API returned ${response.status}. Your local data was not changed.`;
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function readGarmentAsset(file: File): Promise<string> {
  if (!['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, SVG, JPEG or WebP image.');
  }
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose an image smaller than 2 MB.');
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    const document = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('This SVG file is not valid.');
    if (document.querySelector('script, foreignObject, iframe, object, embed, image, use, animate, animateTransform, set, style') || /<!DOCTYPE|<!ENTITY/i.test(text)) {
      throw new Error('Use a self-contained garment SVG without scripts, animation, embedded images or external references.');
    }
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        const inertNamespace = (attribute.name === 'xmlns' && attribute.value === 'http://www.w3.org/2000/svg')
          || (attribute.name === 'xmlns:xlink' && attribute.value === 'http://www.w3.org/1999/xlink');
        if (inertNamespace) continue;
        if (/^on/i.test(attribute.name) || /javascript:|https?:|url\((?!\s*#)/i.test(attribute.value)) {
          throw new Error('This SVG contains an unsafe attribute. Export a plain, self-contained SVG.');
        }
      }
    }
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image.'));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadGarmentAsset(file: File): Promise<string> {
  const dataUrl = await readGarmentAsset(file);
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token && process.env.NEXT_PUBLIC_API_URL) throw new Error('Save a backend admin token in Settings before uploading connected assets.');
  let upload: Blob = file;
  if (file.type === 'image/svg+xml') {
    upload = await new Promise<Blob>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const longest = Math.max(image.naturalWidth || 1024, image.naturalHeight || 1024);
        const scale = Math.min(1, 1600 / longest);
        canvas.width = Math.max(1, Math.round((image.naturalWidth || 1024) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || 1024) * scale));
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('Could not convert SVG for upload.')); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not convert SVG for upload.')), 'image/png');
      };
      image.onerror = () => reject(new Error('This SVG could not be rendered. Choose a transparent PNG instead.'));
      image.src = dataUrl;
    });
  }
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || '/api/backend';
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/admin/assets`, {
      method: 'POST', headers: { 'Content-Type': upload.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: upload, signal: AbortSignal.timeout(15000),
    });
  } catch (cause) { if (!process.env.NEXT_PUBLIC_API_URL && cause instanceof TypeError) return dataUrl; throw cause; }
  if (response.status === 503 && !process.env.NEXT_PUBLIC_API_URL) return dataUrl;
  if (!response.ok) throw new Error(`Asset upload failed (${response.status}). Try a PNG smaller than 2 MB.`);
  const result = await response.json() as { url?: string };
  if (!result.url) throw new Error('The backend did not return an asset URL.');
  if (!process.env.NEXT_PUBLIC_API_URL) {
    const url = new URL(result.url, window.location.origin);
    if (url.pathname.startsWith('/assets/')) return `/api/garment-assets/${url.pathname.slice('/assets/'.length)}`;
  }
  return result.url;
}

export function currency(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
