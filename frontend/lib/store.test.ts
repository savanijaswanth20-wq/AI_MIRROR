import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getCart, getEvents, getLooks, getProducts, saveCart, saveLooks, saveProducts, track } from './store';
import type { CartItem, Look } from './types';

function memoryStorage() {
 const values = new Map<string, string>();
 return {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {values.set(key, value);},
  removeItem: (key: string) => {values.delete(key);},
 };
}
const look: Look = {productId:'asm-01-01',color:'Navy',size:'M',score:80};
const item: CartItem = {...look,id:'cart-one',quantity:1};

describe('customer session isolation',()=>{
 beforeEach(()=>{
  vi.stubGlobal('window',new EventTarget());
  vi.stubGlobal('localStorage',memoryStorage());
  vi.stubGlobal('sessionStorage',memoryStorage());
 });
 afterEach(()=>vi.unstubAllGlobals());
 it('keeps cart and saved looks isolated while sharing store inventory',()=>{
  const firstTab=sessionStorage;
  const products=getProducts().map(p=>({...p,stock:7}));
  saveProducts(products);saveCart([item]);saveLooks([look]);
  vi.stubGlobal('sessionStorage',memoryStorage());
  expect(getCart()).toEqual([]);expect(getLooks()).toEqual([]);
  expect(getProducts()[0].stock).toBe(7);
  clearSession();
  vi.stubGlobal('sessionStorage',firstTab);
  expect(getCart()).toEqual([item]);expect(getLooks()).toEqual([look]);
 });
 it('ending a session removes current and legacy customer metadata',()=>{
  localStorage.setItem('mirror.v1.cart',JSON.stringify([item]));
  localStorage.setItem('mirror.v1.looks',JSON.stringify([look]));
  saveCart([item]);saveLooks([look]);clearSession();
  expect(getCart()).toEqual([]);expect(getLooks()).toEqual([]);
  expect(localStorage.getItem('mirror.v1.cart')).toBeNull();
  expect(localStorage.getItem('mirror.v1.looks')).toBeNull();
 });
 it('persists anonymous session grouping while returning the original API capability',()=>{
  const bearer='private-api-session-capability';
  const first=track('try_on',bearer,{productId:look.productId});
  const second=track('add_to_cart',bearer,{color:look.color});
  track('try_on','another-private-api-capability');
  const local=getEvents();
  expect(first.sessionId).toBe(bearer);expect(second.sessionId).toBe(bearer);
  expect(local[0].sessionId).not.toBe(bearer);
  expect(local[1].sessionId).toBe(local[0].sessionId);
  expect(local[2].sessionId).not.toBe(local[0].sessionId);
  expect(local[0].id).toBe(first.id);expect(local[1].id).toBe(second.id);
  expect(local[0].productId).toBe(look.productId);
  const persisted=localStorage.getItem('mirror.v1.events');
  expect(persisted).not.toContain(bearer);
  expect(persisted).not.toContain('another-private-api-capability');
 });
 it('sanitizes legacy capabilities once without notifying store subscribers',()=>{
  const bearer='legacy-api-bearer-capability';
  const anonymous='anon-7ac528df-21f7-4aa9-8d2f-aa74a215934c';
  const timestamp=new Date().toISOString();
  localStorage.setItem('mirror.v1.events',JSON.stringify([
   {id:'legacy-one',type:'try_on',sessionId:bearer,timestamp},
   ...Array.from({length:300},(_,index)=>({id:`legacy-${index}`,type:'try_on',sessionId:`legacy-other-capability-${index}`,timestamp})),
   {id:'legacy-two',type:'add_to_cart',sessionId:bearer,timestamp},
   {id:'already-anonymous',type:'try_on',sessionId:anonymous,timestamp},
  ]));
  const subscriber=vi.fn();window.addEventListener('mirror-store-change',subscriber);
  const persist=vi.spyOn(localStorage,'setItem');
  const migrated=getEvents();
  expect(migrated[0].sessionId).toMatch(/^anon-/);
  expect(migrated[301].sessionId).toBe(migrated[0].sessionId);
  expect(migrated[302].sessionId).toBe(anonymous);
  expect(localStorage.getItem('mirror.v1.events')).not.toContain('capability');
  expect(subscriber).not.toHaveBeenCalled();expect(persist).toHaveBeenCalledTimes(1);
  expect(getEvents()).toEqual(migrated);expect(persist).toHaveBeenCalledTimes(1);
  const returned=track('save_look',bearer);
  expect(returned.sessionId).toBe(bearer);
  expect(getEvents().at(-1)?.sessionId).toBe(migrated[0].sessionId);
 });
});
