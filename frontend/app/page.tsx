'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Columns2, Heart, Leaf, Loader2, MessageCircle, Minus, Plus, QrCode, ScanLine, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, UserRound, X } from 'lucide-react';
import QRCode from 'qrcode';
import { MirrorCamera } from '@/features/camera/MirrorCamera';
import { DEMO_PROFILE, fashionAnswer, OCCASIONS, recommend, scoreProduct } from '@/features/recommendations/scoring';
import { clearSession, getCart, getLooks, getProducts, getStaffRequests, saveCart, saveLooks, saveProducts, saveStaffRequests, subscribe, track } from '@/lib/store';
import type { BodyProfile, CartItem, Look, Product, Size } from '@/lib/types';
import { api, beginSession, json, loadCatalogue, requestStaff, sendEvent, transfer } from '@/services/api';
import seed from '../../shared/catalog.json';
import { GarmentImage } from '@/components/GarmentImage';
const money = (n:number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const price = (p:Product) => p.price*(1-p.discount/100);
type Panel = 'cart'|'compare'|'saved'|'qr'|'assistant'|'privacy'|null;
export default function MirrorPage() {
 const initialSession=useRef<Promise<{id:string;online:boolean}>|null>(null);
 const sessionStaffIds=useRef<Set<string>>(new Set());
 const [products,setProducts]=useState<Product[]>(getProducts);
 const [selectedId,setSelectedId]=useState('');
 const [color,setColor]=useState('');
 const [size,setSize]=useState<Size>('M');
 const [occasion,setOccasion]=useState('Casual');
 const [category,setCategory]=useState('All');
 const [gender,setGender]=useState('All collections');
 const [search,setSearch]=useState('');
 const [sort,setSort]=useState('Curated');
 const [mode,setMode]=useState<'demo'|'camera'>('demo');
 const [profile,setProfile]=useState<BodyProfile>(DEMO_PROFILE);
 const [active,setActive]=useState(true);
 const [session,setSession]=useState('');
 const [online,setOnline]=useState(false);
 const [cart,setCart]=useState<CartItem[]>([]);
 const [looks,setLooks]=useState<Look[]>([]);
 const [comparison,setComparison]=useState<Look[]>([]);
 const [panel,setPanel]=useState<Panel>(null);
 const [toast,setToast]=useState('');
 const [debug,setDebug]=useState(false);
 const [qr,setQr]=useState('');
 const [qrUrl,setQrUrl]=useState('');
 const [transferOrigin,setTransferOrigin]=useState('');
 const [qrBusy,setQrBusy]=useState(false);
 const [question,setQuestion]=useState('');
 const [conversation,setConversation]=useState<{role:'user'|'assistant';text:string;products?:Product[]}[]>([]);
 const selected = useMemo(()=>products.find(p=>p.id===selectedId)??products[0]??{...seed[0],stock:0,name:'The catalogue is empty'} as Product,[products,selectedId]);
 const selectedColor=selected.colors.find(c=>c.name===color)??selected.colors[0];
 const score=useMemo(()=>scoreProduct(selected,selectedColor.name,occasion,profile),[selected,selectedColor.name,occasion,profile]);
 const currentLook:Look={productId:selected.id,color:selectedColor.name,size,score:score.overall};
 const notify=useCallback((message:string)=>setToast(message),[]);
 const record=useCallback((type:string,metadata:Partial<{productId:string;color:string;size:string}>={})=>{if(!session)return;const event=track(type,session,metadata);if(online)void sendEvent(event).catch(()=>{});},[session,online]);
 useEffect(()=>{
  clearSession();setCart([]);setLooks([]);
  const unsubscribe=subscribe(()=>{setProducts(getProducts());setCart(getCart());setLooks(getLooks());});
  let live=true;
  void loadCatalogue().then(p=>{if(live){saveProducts(p);setOnline(true);}}).catch(()=>{});
  initialSession.current??=beginSession('demo').then(s=>({id:s.id,online:true})).catch(()=>({id:crypto.randomUUID(),online:false}));
  void initialSession.current.then(s=>{if(live){setSession(s.id);track('session_start',s.id);setOnline(s.online);}});
  setTransferOrigin(process.env.NEXT_PUBLIC_TRANSFER_ORIGIN||window.location.origin);
  return ()=>{live=false;unsubscribe();};
 },[]);
 useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),4200);return ()=>clearTimeout(t);}},[toast]);
 useEffect(()=>{
  if(!session)return;
  const timeout=setTimeout(()=>{track('session_end',session);clearSession();setActive(false);setProfile(DEMO_PROFILE);setConversation([]);setComparison([]);setMode('demo');setPanel(null);if(online)void api(`/sessions/${session}`,{method:'DELETE'}).catch(()=>{});notify('Session expired. Start a fresh experience.');},60*60000);
  return()=>clearTimeout(timeout);
 },[session,online,notify]);
 const filtered=useMemo(()=>{
  const p=products.filter(p=>(category==='All'||p.category===category)&&(gender==='All collections'||p.gender===gender||p.gender==='Unisex')&&`${p.name} ${p.brand}`.toLowerCase().includes(search.toLowerCase()));
  return sort==='Price: low to high'?p.sort((a,b)=>price(a)-price(b)):sort==='Best style match'?p.sort((a,b)=>scoreProduct(b,b.colors[0].name,occasion,profile).overall-scoreProduct(a,a.colors[0].name,occasion,profile).overall):p;
 },[products,category,gender,search,sort,occasion,profile]);
 const choose=(product:Product)=>{if(!active){notify('Start an experience to try a look.');return;}setSelectedId(product.id);setColor(product.colors[0].name);setSize(product.sizes.includes('M')?'M':product.sizes[0]);record('try_on',{productId:product.id,color:product.colors[0].name});};
 const step=(direction:number)=>{const index=filtered.findIndex(p=>p.id===selected.id);if(filtered.length)choose(filtered[(index+direction+filtered.length)%filtered.length]);};
 const addCart=async()=>{
  if(!active){notify('Start an experience first.');return;}
  const existing=cart.find(i=>i.productId===selected.id&&i.color===selectedColor.name&&i.size===size);
  if(cart.filter(i=>i.productId===selected.id).reduce((s,i)=>s+i.quantity,0)>=selected.stock){notify('All available stock for this product is already in your bag.');return;}
  const next=existing?cart.map(i=>i.id===existing.id?{...i,quantity:i.quantity+1}:i):[...cart,{...currentLook,id:crypto.randomUUID(),quantity:1}];
  if(online){try{await api('/cart',json({sessionId:session,productId:selected.id,color:selectedColor.name,size,quantity:1,score:score.overall}));}catch(e){notify(e instanceof Error?e.message:'Could not add item');return;}}
  saveCart(next);record('add_to_cart',{productId:selected.id,color:selectedColor.name,size});notify(`${selected.name} added to your bag`);
 };
 const updateQuantity=async(id:string,delta:number)=>{
  const item=cart.find(i=>i.id===id);if(!item)return;
  const product=products.find(p=>p.id===item.productId);if(!product)return;
  if(delta>0&&cart.filter(i=>i.productId===product.id).reduce((s,i)=>s+i.quantity,0)>=product.stock){notify('Available inventory limit reached.');return;}
  const next=cart.map(i=>i.id===id?{...i,quantity:i.quantity+delta}:i).filter(i=>i.quantity>0);
  // Replace the cart through the API so browser and server item identifiers stay independent.
  if(online){try{await api(`/cart/${session}`,{method:'PUT',body:JSON.stringify({items:next})});}catch(e){notify(e instanceof Error?e.message:'Could not update bag');return;}}
  saveCart(next);
 };
 const save=()=>{if(looks.some(l=>l.productId===selected.id&&l.color===selectedColor.name&&l.size===size)){notify('This look is already saved.');return;}saveLooks([...looks,currentLook]);record('save_look',{productId:selected.id});notify('Look saved for this session. No camera image was saved.');};
 const compare=()=>{const next=comparison.some(l=>l.productId===selected.id&&l.color===selectedColor.name)?comparison:[...comparison,currentLook].slice(-3);setComparison(next);record('compare',{productId:selected.id});setPanel('compare');};
 const callStaff=async()=>{
  if(!active){notify('Start an experience first.');return;}
  const duplicate=getStaffRequests().find(r=>sessionStaffIds.current.has(r.id)&&r.productId===selected.id&&r.size===size&&r.color===selectedColor.name&&r.status!=='Completed');
  if(duplicate){notify(`Staff request is ${duplicate.status.toLowerCase()}.`);return;}
  try {const request=online?await requestStaff(session,currentLook):{id:crypto.randomUUID(),station:'Station 04',productId:selected.id,productName:selected.name,size,color:selectedColor.name,rack:selected.rack,status:'Waiting' as const,createdAt:new Date().toISOString()};sessionStaffIds.current.add(request.id);saveStaffRequests([...getStaffRequests(),request]);record('staff_request',{productId:selected.id});notify(online?`Staff request sent · ${size} · Rack ${selected.rack}`:'Demo staff request created. View it in the store dashboard.');} catch(e){notify(e instanceof Error?e.message:'Could not reach staff');}
 };
 const createQR=async()=>{
  setQrBusy(true);setPanel('qr');
  try {
   const origin=new URL(transferOrigin);if(!['http:','https:'].includes(origin.protocol))throw new Error('Enter an http or https store address.');
   let url:string;
   if(online){const t=await transfer(session,currentLook,cart);url=`${origin.origin}/look/${t.token}`;}
   else {const data=encodeURIComponent(JSON.stringify({look:currentLook,cart,expiresAt:Date.now()+15*60000}));url=`${origin.origin}/look/demo#${data}`;}
   setQrUrl(url);setQr(await QRCode.toDataURL(url,{width:280,margin:2,color:{dark:'#283b2a',light:'#ffffff'},errorCorrectionLevel:'M'}));record('qr_transfer');
  }catch(e){notify(e instanceof Error?e.message:'Could not generate transfer');}finally{setQrBusy(false);}
 };
 const ask=(q:string)=>{if(!q.trim())return;const answer=fashionAnswer(q,products,selected,occasion,profile);setConversation(c=>[...c,{role:'user',text:q},{role:'assistant',...answer}]);setQuestion('');record('recommendation',{productId:answer.products[0]?.id});};
 const end=async()=>{record('session_end');setActive(false);setMode('demo');setProfile(DEMO_PROFILE);clearSession();setComparison([]);setConversation([]);setPanel(null);if(online)await api(`/sessions/${session}`,{method:'DELETE'}).catch(()=>{});notify('Session ended. Your cart, saved looks, and camera state were cleared.');};
 const start=async()=>{clearSession();setActive(true);setMode('demo');try{const s=await beginSession('demo');setSession(s.id);setOnline(true);track('session_start',s.id);}catch{const id=crypto.randomUUID();setSession(id);setOnline(false);track('session_start',id);}};
 const subtotal=cart.reduce((n,i)=>n+(products.find(p=>p.id===i.productId)?.price??0)*i.quantity,0);
 const total=cart.reduce((n,i)=>n+price(products.find(p=>p.id===i.productId)??selected)*i.quantity,0);
 const tax=total*0.05;
 const suggestions=recommend(products,occasion,profile);
 return <div className="app-shell">
  <header className="site-header">
   <Link href="/" className="brand"><span className="brand-symbol"><ScanLine size={27}/></span><span>AI SMART MIRROR<small>TRY BEFORE YOU WEAR</small></span></Link>
   <nav className="main-nav"><button className="nav-active" onClick={()=>setPanel(null)}>Fitting room</button><button onClick={()=>setPanel('saved')}>Saved looks {looks.length>0&&<span>{looks.length}</span>}</button><Link href="/admin">Store dashboard <ArrowRight size={13}/></Link></nav>
   <div className="header-actions"><span className="store-status"><i/>{online?'Store connected':'Local demo'}</span><button aria-label="Privacy and help" className="icon-btn" onClick={()=>setPanel('privacy')}><CircleHelp size={20}/></button><button className="bag-button" onClick={()=>setPanel('cart')}><ShoppingBag size={19}/><span>My bag</span><b>{cart.reduce((s,i)=>s+i.quantity,0)}</b></button></div>
  </header>
  <main>
   <div className="breadcrumb"><span>ATELIER FLAGSHIP <span className="slash">/</span> YOUR VIRTUAL FITTING ROOM</span><span className="station"><span className="status-dot"/> STATION 04 · FLOOR 01</span></div>
   <div className="intro"><div><div className="eyebrow"><Sparkles size={13}/> A NEW WAY TO FIND YOUR FIT</div><h1>Your style. <em>A little more you.</em></h1><p>Try something new. Find what feels right. Make it yours.</p></div><div className="occasion-control"><span>DRESSING FOR</span><div><Sparkles size={16}/><select aria-label="Occasion" value={occasion} onChange={e=>{setOccasion(e.target.value);record('occasion_change');}}>{OCCASIONS.map(o=><option key={o}>{o}</option>)}</select><ChevronDown size={15}/></div></div></div>
   <div className="fitting-layout">
    <section className="mirror-section">
     <div className="section-heading"><div><span className="number-tag">01</span><h2>The fitting room</h2></div><div className="mode-switch"><button className={mode==='demo'?'active':''} onClick={()=>{setMode('demo');setProfile(DEMO_PROFILE);}}>Demo model</button><button className={mode==='camera'?'active':''} onClick={()=>setMode('camera')}>Live camera <span/></button></div></div>
     <div className="mirror-frame">
      <div className="mirror-top"><span className="mirror-badge"><i/>{mode==='demo'?'DEMO EXPERIENCE':'LIVE TRY-ON'}</span><button className="score-chip" onClick={()=>document.getElementById('analysis')?.scrollIntoView({behavior:'smooth'})}><Sparkles size={13}/>{score.overall}% style match</button></div>
      {active?<MirrorCamera product={selected} color={selectedColor.hex} mode={mode} onModeChange={setMode} onProfile={setProfile} debug={debug} active={active}/>:<div className="start-screen"><ScanLine size={48}/><h2>Find your next favorite.</h2><p>A personal fitting room, made for you.</p><button className="primary-button" onClick={()=>void start()}>Start experience <ArrowRight size={18}/></button></div>}
      <div className="mirror-caption"><div><span>YOU’RE TRYING ON</span><h3>{selected.name}</h3><p>{selectedColor.name} <span>·</span> Size {size}</p></div><button aria-label="Save this look" className={looks.some(l=>l.productId===selected.id)?'heart-btn saved':'heart-btn'} onClick={save}><Heart size={21}/></button></div>
     </div>
     <div className="mirror-bottom"><span><ShieldCheck size={14}/> Your camera. Your privacy.</span><button onClick={()=>setDebug(!debug)}>{debug?'Hide landmarks':'Tracking details'}</button><button onClick={()=>{setSelectedId(products[0]?.id??'');setColor('');setSize('M');setProfile(DEMO_PROFILE);notify('Try-on preferences reset.');}}>Reset</button><button onClick={()=>void end()}>End session</button></div>
     {debug&&<div className="body-details"><span>{profile.source==='demo'?'Illustrated sample proportions':'Fashion-only camera analysis'} · {Math.round(profile.confidence*100)}% tracking confidence</span><dl><div><dt>Shoulder / hip ratio</dt><dd>{profile.shoulderRatio.toFixed(2)}</dd></div><div><dt>Torso proportion</dt><dd>{profile.torsoRatio.toFixed(2)}</dd></div>{[['Entered height',profile.heightCm],['Shoulder width',profile.shoulderCm],['Torso length',profile.torsoCm],['Arm length',profile.armCm],['Leg length',profile.legCm]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{typeof value==='number'?`${Math.round(value)} cm`:'Calibrate in camera mode'}</dd></div>)}<div><dt>Face geometry</dt><dd>{profile.faceShape??'Waiting for face'}</dd></div><div><dt>Color appearance</dt><dd>{profile.skinTone??'Waiting for even lighting'}</dd></div></dl><p>Measurements are camera-based estimates. Chest circumference and depth cannot be measured from a single frontal image.</p></div>}
    </section>
    <section className="catalog-section">
     <div className="section-heading"><div><span className="number-tag">02</span><h2>Discover your next look</h2></div><span className="item-count">{products.length} pieces, picked for you</span></div>
     <div className="catalog-tools"><div className="search-box"><Search size={17}/><input aria-label="Search collection" placeholder="Find your favorite piece..." value={search} onChange={e=>setSearch(e.target.value)}/></div><label className="collection-select"><select aria-label="Collection" value={gender} onChange={e=>setGender(e.target.value)}>{['All collections','Men','Women','Unisex'].map(g=><option key={g}>{g}</option>)}</select><ChevronDown size={14}/></label></div>
     <div className="category-row">{['All','Shirts','T-shirts','Blazers','Dresses','Jackets','Hoodies','Kurtis','Jeans','Trousers','Traditional wear','Ethnic wear'].map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c)}>{c}</button>)}</div>
     <div className="catalog-meta"><span>{filtered.length} styles to explore</span><label><SlidersHorizontal size={12}/><select aria-label="Sort collection" value={sort} onChange={e=>setSort(e.target.value)}>{['Curated','Price: low to high','Best style match'].map(s=><option key={s}>{s}</option>)}</select><ChevronDown size={12}/></label></div>
     <div className="product-grid">{filtered.map((p,index)=><motion.button initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:Math.min(index,5)*0.025}} key={p.id} className={`product-card ${p.id===selected.id?'chosen':''}`} onClick={()=>choose(p)} aria-label={`Try ${p.name}`}><div className={`product-image bg-${index%4}`}><GarmentImage product={p} color={p.id===selected.id?selectedColor.hex:undefined} alt={p.name} loading="lazy"/>{p.id===selected.id?<span className="product-try"><Check size={12}/> TRYING ON</span>:p.featured&&<span className="product-tag">THE EDIT</span>}<span className="product-arrow"><ArrowUpRightIcon/></span></div><div className="product-details"><span className="product-brand">{p.brand} <span>{p.category}</span></span><h3>{p.name}</h3><div className="product-price"><strong>{money(price(p))}</strong>{p.discount>0&&<del>{money(p.price)}</del>}<div className="mini-swatches">{p.colors.slice(0,4).map(c=><i key={c.name} style={{background:c.hex}}/>)}</div></div></div></motion.button>)}{!filtered.length&&<div className="empty-state"><Search size={25}/><h3>No pieces found</h3><p>Try another category or search term.</p><button onClick={()=>{setSearch('');setCategory('All');setGender('All collections');}}>Show all pieces</button></div>}</div>
    </section>
   </div>
   <section className="selection-strip"><div className="strip-product"><span className="tiny-thumb"><GarmentImage product={selected} color={selectedColor.hex}/></span><div><span>YOUR CURRENT LOOK</span><strong>{selected.name}</strong><small><i className="status-dot"/>{selected.stock>0?'In stock':'Unavailable'} · Rack {selected.rack} · {selected.section}</small></div></div><div className="variant-control"><span>COLOR <b>{selectedColor.name}</b></span><div className="swatches">{selected.colors.map(c=><button key={c.name} title={c.name} aria-label={`Choose ${c.name}`} aria-pressed={selectedColor.name===c.name} style={{background:c.hex}} className={selectedColor.name===c.name?'active':''} onClick={()=>setColor(c.name)}/>)}</div></div><div className="variant-control"><span>SIZE <b>{score.sizeConfidence>50?`Suggested ${score.recommendedSize}`:'Choose your fit'}</b></span><div className="sizes">{selected.sizes.map(s=><button key={s} className={size===s?'active':''} onClick={()=>setSize(s)}>{s}</button>)}</div></div><div className="selection-actions"><strong>{money(price(selected))}</strong><button className="primary-button" disabled={selected.stock<1||!active} onClick={()=>void addCart()}><ShoppingBag size={17}/> Add to bag <Plus size={16}/></button></div></section>
   <p className="size-disclaimer">Suggested size {score.recommendedSize} · {score.sizeConfidence}% confidence. Camera-based size recommendations are approximate. Confirm using the official store size chart.</p><section id="analysis" className="analysis-panel"><div className="analysis-title"><span className="number-tag">03</span><div><span className="eyebrow">A LITTLE STYLE INTELLIGENCE</span><h2>A look that works for you.</h2><p>{profile.source==='demo'?'Preview scoring · demo proportions':'Camera proportions · approximate estimates'}</p></div></div><div className="overall-score"><div className="score-ring" style={{'--score':`${score.overall}%`} as React.CSSProperties}><strong>{score.overall}<small>%</small></strong></div><div><b>STYLE MATCH</b><span>{score.overall>=85?'A great place to start':'Worth exploring'}</span></div></div><div className="score-breakdown">{[['Style',score.style],['Color',score.color],['Fit estimate',score.fit],['Occasion',score.occasion]].map(([label,value])=><div key={label}><span>{label}<b>{value}%</b></span><div><i style={{width:`${value}%`}}/></div></div>)}</div><div className="style-explanation"><span><Sparkles size={13}/> WHY THIS WORKS</span><p>{score.explanation}</p><button onClick={()=>setPanel('assistant')}>Ask your style assistant <ArrowRight size={14}/></button></div></section>
   <div className="below-actions"><p><Leaf size={15}/> Less trying. More discovering. <span>Measurements are camera-based estimates.</span></p><div><button className="secondary-button" onClick={()=>step(-1)} aria-label="Previous product"><ChevronLeft size={16}/></button><button className="secondary-button" onClick={()=>step(1)}>Next look <ChevronRight size={16}/></button><button className="secondary-button" onClick={compare}><Columns2 size={16}/> Compare looks</button><button className="secondary-button" onClick={save}><Heart size={16}/> Save look</button><button className="secondary-button" onClick={()=>void callStaff()}><UserRound size={16}/> Call staff</button><button className="secondary-button" onClick={()=>void createQR()}><QrCode size={16}/> Take it with you</button></div></div>
   <div className="recommendation-edit"><div><span className="eyebrow">THE {occasion.toUpperCase()} EDIT</span><h2>A few more possibilities.</h2></div><div className="suggestion-row">{suggestions.filter(p=>p.id!==selected.id).slice(0,3).map(p=><button key={p.id} onClick={()=>choose(p)}><GarmentImage product={p}/><span><small>{p.category}</small><strong>{p.name}</strong><b>{money(price(p))}</b></span><ArrowRight size={19}/></button>)}</div></div>
  </main>
  <footer className="site-footer"><span>AI SMART MIRROR <i>SEE IT. STYLE IT. WEAR IT.</i></span><span>Thoughtful technology. Personal style. <button onClick={()=>setPanel('privacy')}>Privacy</button></span></footer>
  <button className="assistant-float" onClick={()=>setPanel('assistant')}><Sparkles size={18}/> Your style assistant <MessageCircle size={17}/></button>
  <AnimatePresence>{toast&&<motion.div role="status" className="toast" initial={{opacity:0,y:15}} animate={{opacity:1,y:0}} exit={{opacity:0,y:10}}><Check size={17}/>{toast}<button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={14}/></button></motion.div>}</AnimatePresence>
  <AnimatePresence>{panel&&<><motion.div className="modal-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setPanel(null)}/><motion.aside role="dialog" aria-modal="true" aria-label={`${panel} panel`} className={`drawer ${panel==='compare'?'drawer-wide':''}`} initial={{x:50,opacity:0}} animate={{x:0,opacity:1}} exit={{x:50,opacity:0}}><div className="drawer-header"><span className="eyebrow">YOUR PERSONAL FITTING ROOM</span><button aria-label="Close panel" className="icon-btn" onClick={()=>setPanel(null)}><X/></button></div>
   {panel==='cart'&&<><h2>A bag of possibilities.</h2><p className="muted">Your pieces are ready for an in-store fitting.</p>{cart.length?cart.map(item=>{const p=products.find(p=>p.id===item.productId);return p&&<div className="cart-item" key={item.id}><GarmentImage product={p} alt={p.name}/><div><h3>{p.name}</h3><p>{item.color} · {item.size} · Rack {p.rack}</p><b>{money(price(p))}</b><div className="quantity"><button aria-label={`Reduce quantity of ${p.name}`} onClick={()=>void updateQuantity(item.id,-1)}><Minus size={13}/></button>{item.quantity}<button aria-label={`Increase quantity of ${p.name}`} onClick={()=>void updateQuantity(item.id,1)}><Plus size={13}/></button></div></div></div>}):<Empty icon={<ShoppingBag/>} title="Your bag is waiting" text="Try a piece and add it to your bag."/>}{cart.length>0&&<><div className="cart-totals"><p>Subtotal <b>{money(subtotal)}</b></p><p>Discount <b>−{money(subtotal-total)}</b></p><p>Estimated tax (5%) <b>{money(tax)}</b></p><h3>Total <b>{money(total+tax)}</b></h3></div><button className="primary-button full-width" onClick={()=>void createQR()}><QrCode size={17}/> Transfer bag to phone</button><p className="fine-print">Demo tax is configurable in the backend. Payment and purchase are completed by store staff; this bag does not reserve stock.</p></>}</>}
   {(panel==='saved'||panel==='compare')&&<><h2>{panel==='saved'?'Keep the looks you love.':'A side-by-side perspective.'}</h2><p className="muted">{panel==='saved'?'Only outfit details are saved for this session.':'Add up to three looks. Scores reflect your current occasion.'}</p>{panel==='compare'&&<button className="secondary-button" onClick={()=>{if(!comparison.some(l=>l.productId===currentLook.productId&&l.color===currentLook.color)){setComparison([...comparison,currentLook].slice(-3));record('compare',{productId:selected.id});}}}><Plus size={15}/> Add current look</button>}<div className={panel==='compare'?'comparison-grid':'saved-grid'}>{(panel==='saved'?looks:comparison).map((look,i)=>{const p=products.find(p=>p.id===look.productId);if(!p)return null;const rating=scoreProduct(p,look.color,occasion,profile);return <div className="look-card" key={`${p.id}-${look.color}-${i}`}><GarmentImage product={p} alt={p.name}/><h3>{p.name}</h3><p>{look.color} · Size {look.size}</p><div className="look-score"><Sparkles size={14}/>{rating.overall}% overall</div><small>Style {rating.style}% · Color {rating.color}%</small><p>{rating.explanation}</p><div><button onClick={()=>{choose(p);setColor(look.color);setSize(look.size);setPanel(null);}}>Try this look <ArrowRight size={13}/></button><button aria-label={`Remove ${p.name}`} onClick={()=>panel==='saved'?saveLooks(looks.filter((_,j)=>j!==i)):setComparison(comparison.filter((_,j)=>j!==i))}><X size={14}/></button></div></div>;})}</div>{(panel==='saved'?looks:comparison).length===0&&<Empty icon={<Heart/>} title="Make room for a favorite" text="Save or compare a look from your fitting room."/>}{panel==='compare'&&comparison.length>1&&<div className="assistant-note"><Sparkles size={17}/><p>For {occasion.toLowerCase()}, {products.find(p=>p.id===[...comparison].sort((a,b)=>{const pa=products.find(p=>p.id===a.productId)!;const pb=products.find(p=>p.id===b.productId)!;return scoreProduct(pb,b.color,occasion,profile).overall-scoreProduct(pa,a.color,occasion,profile).overall;})[0].productId)?.name} has the highest combined style, color, and occasion score. Your preference is the deciding factor.</p></div>}</>}
   {panel==='qr'&&<><h2>Take your style with you.</h2><p className="muted">Scan your look and shopping bag. Outfit details only; no camera images.</p><div className="qr-box">{qrBusy?<Loader2 className="spin"/>:qr?<img src={qr} alt="QR code to transfer current outfit and bag"/>:<QrCode size={60}/>}</div><label className="field-label">Store frontend address<input value={transferOrigin} onChange={e=>setTransferOrigin(e.target.value)} placeholder="https://your-store.example"/></label><button className="secondary-button full-width" onClick={()=>void createQR()}>Update QR code</button>{qrUrl&&<a className="transfer-link" href={qrUrl} target="_blank" rel="noreferrer">Open transferred look <ArrowRight size={14}/></a>}<p className="fine-print">Expires in 15 minutes. A phone needs a reachable frontend address. Localhost works on this computer only. For a LAN demo, enter this computer’s LAN address and port 3000. Camera use on a phone requires HTTPS.</p></>}
   {panel==='assistant'&&<><div className="assistant-heading"><Sparkles size={30}/><h2>A second opinion,<br/><em>made for your style.</em></h2></div><p className="muted">A catalogue-grounded assistant using transparent style rules. All suggestions are from available pieces.</p><div className="question-chips">{['Is this good for an interview?','Show me outfits under ₹5000','Which color should I choose?','What matches these jeans?'].map(q=><button key={q} onClick={()=>ask(q)}>{q} <ArrowRight size={12}/></button>)}</div><div className="chat-messages">{conversation.map((message,i)=><div className={`message ${message.role}`} key={i}><small>{message.role==='user'?'YOU':'STYLE ASSISTANT'}</small><p>{message.text}</p>{message.products?.map(p=><button className="chat-product" key={p.id} onClick={()=>{choose(p);setPanel(null);}}><GarmentImage product={p}/><span>{p.name}<b>{money(price(p))}</b></span><ArrowRight size={14}/></button>)}</div>)}</div><form className="chat-form" onSubmit={e=>{e.preventDefault();ask(question);}}><input aria-label="Ask a fashion question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What are you dressing for?"/><button aria-label="Send question"><ArrowRight size={18}/></button></form></>}
   {panel==='privacy'&&<><ShieldCheck size={35}/><h2>Your camera.<br/><em>Your privacy.</em></h2><p>Your camera is used for virtual try-on. Images are not permanently stored unless you choose to save them.</p><p>Camera frames, pose landmarks, segmentation, and face proportions are processed in your browser. We do not identify people or infer race, ethnicity, religion, or health.</p><p>Save Look stores product, color, size, and score metadata only. Ending the session clears the bag and saved looks. Anonymous store analytics do not contain images or face data.</p><h3>A considered approximation</h3><p>Measurements are camera-based estimates. Set your height to calibrate proportions. Camera-based size recommendations are approximate. Confirm using the store’s official size chart.</p><p>Style scores are explainable rules, not a judgment of attractiveness. The preview uses a moving 2D overlay; fabric drape and realistic fit need a future VTON model.</p><button className="primary-button" onClick={()=>{setMode('camera');setPanel(null);}}>Start live camera <ArrowRight size={17}/></button></>}
  </motion.aside></>}</AnimatePresence>
 </div>;
}
function ArrowUpRightIcon(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 18 18 6M6 6h12v12"/></svg>;}
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty-state">{icon}<h3>{title}</h3><p>{text}</p></div>;}
