import type { AnalyticsEvent, CartItem, Look, Product, StaffRequest } from '@/lib/types';
export const API = process.env.NEXT_PUBLIC_API_URL || '/api/backend';
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
 const response = await fetch(`${API}${path}`, {...init, headers:{'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(7000)});
 if (!response.ok) {const body = await response.json().catch(()=>({detail:'Service unavailable'}));throw new Error(typeof body.detail === 'string' ? body.detail : 'Request could not be completed');}
 if(response.status===204)return undefined as T;
 return response.json() as Promise<T>;
}
export const json = (body: unknown):RequestInit => ({method:'POST',body:JSON.stringify(body)});
export const loadCatalogue = () => api<Product[]>('/products');
export const beginSession = (mode: string) => api<{id:string}>('/sessions', json({station:'Station 04',mode}));
export const sendEvent = (event: AnalyticsEvent) => api('/events',json(event));
export const requestStaff = (sessionId:string,look:Look) => api<StaffRequest>('/staff-request',json({sessionId,...look,station:'Station 04'}));
export const transfer = (sessionId:string,look:Look,cart:CartItem[]) => api<{token:string;expiresAt:string;url:string}>('/transfers',json({sessionId,look,cart}));
