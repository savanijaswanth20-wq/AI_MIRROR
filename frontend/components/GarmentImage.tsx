'use client';
import { useEffect, useState } from 'react';
import type { Product } from '@/lib/types';
const originals=new Map<string,Promise<string>>();
const colored=new Map<string,string>();
export function GarmentImage({product,color,alt='',...props}:{product:Product;color?:string;alt?:string;className?:string;loading?:'lazy'|'eager'}){
 const source=product.image;
 const hex=color??product.colors[0]?.hex??'#596c57';
 const key=`${source}:${hex}`;
 const [url,setUrl]=useState(source);
 useEffect(()=>{
  let active=true;
  if(!source.split('?')[0].endsWith('.svg')){setUrl(source);return;}
  if(colored.has(key)){setUrl(colored.get(key)!);return;}
  if(!originals.has(source))originals.set(source,fetch(source).then(async r=>{if(!r.ok)throw new Error('Asset unavailable');return r.text();}));
  void originals.get(source)!.then(svg=>{const tinted=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/#596c57/gi,/^#[\da-f]{6}$/i.test(hex)?hex:'#596c57'))}`;colored.set(key,tinted);if(active)setUrl(tinted);}).catch(()=>{if(active)setUrl('/garments/shirts.svg');originals.delete(source);});
  return()=>{active=false;};
 },[source,key,hex]);
 return <img {...props} src={url} alt={alt}/>;
}
