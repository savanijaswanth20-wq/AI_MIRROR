import seed from '../../shared/catalog.json';
import type { Product, StaffRequest, AnalyticsEvent, CartItem, Look } from './types';
const PREFIX = 'mirror.v1.';
const EVENT = 'mirror-store-change';
// Backend session IDs grant API access; never persist them in shared analytics.
const analyticsSessionIds = new Map<string, string>();
const MAX_ANALYTICS_SESSION_IDS = 256;
const ANONYMOUS_SESSION_ID = /^anon-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function rememberAnalyticsSessionId(sessionId: string, anonymousId: string): void {
 analyticsSessionIds.delete(sessionId);
 analyticsSessionIds.set(sessionId, anonymousId);
 if (analyticsSessionIds.size > MAX_ANALYTICS_SESSION_IDS) {
  const oldest = analyticsSessionIds.keys().next().value;
  if (oldest !== undefined) analyticsSessionIds.delete(oldest);
 }
}
function analyticsSessionId(sessionId: string): string {
 const existing = analyticsSessionIds.get(sessionId);
 const anonymousId = existing ?? `anon-${crypto.randomUUID()}`;
 rememberAnalyticsSessionId(sessionId, anonymousId);
 return anonymousId;
}
export function read<T>(key: string, fallback: T): T {
 if (typeof window === 'undefined') return fallback;
 try { return JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null') as T ?? fallback; } catch { return fallback; }
}
export function write<T>(key: string, value: T): void {
 if (typeof window === 'undefined') return;
 localStorage.setItem(PREFIX + key, JSON.stringify(value));
 window.dispatchEvent(new Event(EVENT));
}
export function subscribe(listener: () => void): () => void {
 window.addEventListener(EVENT, listener); window.addEventListener('storage', listener);
 return () => {window.removeEventListener(EVENT, listener);window.removeEventListener('storage', listener);};
}
export const getProducts = (): Product[] => read('products', seed as Product[]);
export const saveProducts = (products: Product[]): void => write('products', products);
export const getStaffRequests = (): StaffRequest[] => read('staff', []);
export const saveStaffRequests = (requests: StaffRequest[]): void => write('staff', requests);
export function getEvents(): AnalyticsEvent[] {
 const events = read<AnalyticsEvent[]>('events', []);
 if (!Array.isArray(events)) return [];
 let changed = false;
 // Temporary grouping map preserves a whole legacy archive even beyond the cache limit.
 const migratedIds = new Map<string, string>();
 const sanitized = events.map(event => {
  if (ANONYMOUS_SESSION_ID.test(event.sessionId)) return event;
  changed = true;
  const anonymousId = migratedIds.get(event.sessionId) ?? analyticsSessionId(event.sessionId);
  migratedIds.set(event.sessionId, anonymousId);
  rememberAnalyticsSessionId(event.sessionId, anonymousId);
  return {...event, sessionId: anonymousId};
 });
 if (changed && typeof window !== 'undefined') {
  // A migration is storage maintenance, not a new event; avoid recursive subscribers.
  localStorage.setItem(PREFIX + 'events', JSON.stringify(sanitized));
 }
 return sanitized;
}
// Customer state belongs to one mirror tab; store inventory and staff tasks are shared.
function readSession<T>(key: string, fallback: T): T {
 if (typeof window === 'undefined') return fallback;
 try { return JSON.parse(sessionStorage.getItem(PREFIX + key) ?? 'null') as T ?? fallback; } catch { return fallback; }
}
function writeSession<T>(key: string, value: T): void {
 if (typeof window === 'undefined') return;
 sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
 window.dispatchEvent(new Event(EVENT));
}
export const getCart = (): CartItem[] => readSession('cart', []);
export const saveCart = (cart: CartItem[]): void => writeSession('cart', cart);
export const getLooks = (): Look[] => readSession('looks', []);
export const saveLooks = (looks: Look[]): void => writeSession('looks', looks);
export function track(type: string, sessionId: string, metadata: Partial<Pick<AnalyticsEvent, 'productId' | 'color' | 'size'>> = {}): AnalyticsEvent {
 const event: AnalyticsEvent = {id: crypto.randomUUID(), type, sessionId, timestamp: new Date().toISOString(), ...metadata};
 const localEvent = {...event, sessionId: analyticsSessionId(sessionId)};
 write('events', [...getEvents().filter(e => Date.now() - Date.parse(e.timestamp) < 30 * 86400000), localEvent].slice(-2000));
 return event;
}
export function clearSession(): void {
 saveCart([]);saveLooks([]);
 if (typeof window !== 'undefined') {
  // Remove data written by older builds from the shared browser store.
  localStorage.removeItem(PREFIX + 'cart');localStorage.removeItem(PREFIX + 'looks');
 }
}
