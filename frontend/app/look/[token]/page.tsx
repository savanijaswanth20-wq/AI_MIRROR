'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, MapPin, ScanLine, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react';
import { getProducts } from '@/lib/store';
import { GarmentImage } from '@/components/GarmentImage';
import { api } from '@/services/api';
import type { CartItem, Look } from '@/lib/types';
type TransferData={look?:Look;cart?:CartItem[]|{items:CartItem[]};expiresAt:string|number;store?:{name?:string;address?:string;location?:string}};
export default function PhoneLook({params}:{params:Promise<{token:string}>}){
 const {token}=use(params);
 const [data,setData]=useState<TransferData|null>(null);
 const [error,setError]=useState('');
 const [products,setProducts]=useState(getProducts);
 useEffect(()=>{
  let active=true;
  const load=async()=>{
   try{
    await api<typeof products>('/products').then(p=>{if(active)setProducts(p);}).catch(()=>{});
    const transfer:TransferData=token==='demo'?JSON.parse(decodeURIComponent(window.location.hash.slice(1))):await api<TransferData>(`/transfers/${token}`);
    if(!transfer||new Date(transfer.expiresAt).getTime()<Date.now())throw new Error('This look has expired. Scan a fresh QR code at the mirror.');
    if(active)setData(transfer);
   }catch(e){if(active)setError(e instanceof Error?e.message:'This transfer is unavailable.');}
  };
  void load();return()=>{active=false;};
 },[token]);
 const cart=Array.isArray(data?.cart)?data.cart:data?.cart?.items??[];
 const items:Look[]=cart.length?cart:data?.look?[data.look]:[];
 const subtotal=cart.reduce((n,item)=>{const p=products.find(p=>p.id===item.productId);return n+(p?p.price*(1-p.discount/100):0)*item.quantity;},0);
 const money=(n:number)=>`₹${Math.round(n).toLocaleString('en-IN')}`;
 return <div className="phone-page"><header><Link className="brand" href="/"><span className="brand-symbol"><ScanLine size={23}/></span><span>AI SMART MIRROR<small>TAKE YOUR STYLE WITH YOU</small></span></Link><ShoppingBag size={21}/></header><main><span className="eyebrow"><Sparkles size={13}/> YOUR FITTING ROOM, TO GO</span><h1>A look worth<br/><em>taking with you.</em></h1><p className="muted">Your selected pieces from {data?.store?.name??'Atelier Flagship'}.</p>{error?<div className="phone-error"><ShieldCheck size={30}/><h2>This link needs a refresh.</h2><p>{error}</p><Link href="/">Back to the mirror <ArrowRight size={15}/></Link></div>:!data?<p className="muted phone-loading">Loading your outfit…</p>:<><div className="phone-items">{items.map((item,i)=>{const p=products.find(p=>p.id===item.productId);return p?<article key={i}><div className="phone-image"><GarmentImage product={p} color={p.colors.find(c=>c.name===item.color)?.hex} alt={p.name}/><span><Sparkles size={12}/>{Math.max(0,Math.min(100,item.score))}% style match</span></div><div><small>{p.brand} · {p.category}</small><h2>{p.name}</h2><p>{item.color} · Size {item.size}{'quantity'in item?` · Qty ${item.quantity}`:''}</p><strong>{money(p.price*(1-p.discount/100))}</strong><div className="phone-location"><MapPin size={17}/><span>Floor {p.floor} · {p.section}<b>Rack {p.rack} · {p.stock} available</b></span></div></div></article>:<p key={i}>This product is no longer in the collection.</p>;})}</div>{cart.length>0&&<div className="phone-summary"><span>Your bag total <strong>{money(subtotal*1.05)}</strong></span><p>Includes estimated 5% tax. Complete your purchase with store staff. Inventory is not reserved.</p></div>}<div className="phone-store"><MapPin size={22}/><div><span>FIND US IN STORE</span><h3>{data.store?.name??'Atelier Flagship'}</h3><p>{data.store?.address??data.store?.location??'Floor 01 · Fashion & Lifestyle · Ask at the welcome desk'}</p></div></div><div className="phone-privacy"><ShieldCheck size={17}/><p>Outfit details only. No customer camera images.<br/>This transfer expires in 15 minutes.</p></div></>}<Link className="phone-back" href="/"><ArrowLeft size={15}/> Return to the fitting room</Link></main><footer>SEE IT. STYLE IT. WEAR IT.</footer><style jsx>{`
 .phone-page{max-width:720px;margin:auto;background:#fafbf6;min-height:100vh}.phone-page header{padding:27px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e1e7d8}.phone-page main{padding:36px 24px}.phone-page h1{font-family:Georgia,serif;font-weight:400;letter-spacing:-1.4px;font-size:43px;line-height:1.14;margin:18px 0}.phone-page h1 em{color:#8a9b78}.phone-items{margin:30px 0}.phone-items article{border:1px solid #dce5d0;border-radius:11px;background:white;overflow:hidden;margin-bottom:19px}.phone-image{background:#e8ecdf;height:280px;position:relative;display:grid;place-items:center}.phone-image :global(img){height:235px;width:90%;max-height:235px;object-fit:contain}.phone-image>span{position:absolute;bottom:15px;right:15px;display:flex;gap:7px;align-items:center;font-size:10px;background:#fff;border-radius:20px;padding:8px 12px}.phone-items article>div:last-child{padding:21px}.phone-items small{font-size:8px;letter-spacing:1px;color:#8c9c7b}.phone-items h2{font-family:Georgia,serif;font-size:24px;margin:9px 0}.phone-items p{font-size:12px;color:#8c9d7a;margin:10px 0}.phone-items strong{font-size:19px;font-weight:400}.phone-location{display:flex;gap:9px;border-top:1px solid #e3e9dc;padding-top:16px;margin-top:19px;font-size:11px;color:#8b9a7b}.phone-location b{display:block;font-weight:400;color:#647c50;margin-top:5px}.phone-summary{border:1px solid #d9e3cc;border-radius:9px;background:#eef3e7;padding:22px}.phone-summary>span{display:flex;justify-content:space-between;font-size:16px}.phone-summary strong{font-weight:400}.phone-summary p{font-size:10px;color:#8c9d7a;line-height:1.7;margin-top:14px}.phone-store{display:flex;gap:16px;margin-top:30px;background:#f1f4e9;padding:23px;border-radius:9px}.phone-store span{font-size:7px;letter-spacing:1.3px;color:#8c9d7a}.phone-store h3{font-family:Georgia,serif;font-weight:400;font-size:22px;margin:9px 0}.phone-store p{font-size:11px;color:#8c9d7a;line-height:1.7}.phone-privacy{display:flex;gap:10px;font-size:10px;color:#9aa68c;line-height:1.8;margin:22px 0}.phone-back{display:flex;gap:8px;align-items:center;font-size:11px;color:#698454;margin-top:30px}.phone-page footer{text-align:center;letter-spacing:2px;padding:26px;border-top:1px solid #e1e7d8;font-size:8px;color:#98a68a}.phone-error{padding:35px 15px;border:1px solid #e3e6dc;border-radius:10px;margin-top:30px}.phone-error h2{font-family:Georgia,serif;margin:15px 0}.phone-error p{font-size:12px;line-height:1.8;color:#89977c}.phone-error a{display:flex;align-items:center;gap:8px;margin-top:15px;font-size:12px}.phone-loading{padding:50px 0}
 `}</style></div>;
}
