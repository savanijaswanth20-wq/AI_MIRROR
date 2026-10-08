'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowDownToLine, ArrowRight, Bell, Box, Check, ChevronRight, CircleHelp, ExternalLink, LayoutDashboard, LoaderCircle, Monitor, MoreHorizontal, Package, Pencil, Plus, Search, Settings, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Tags, Trash2, Users, X, type LucideIcon } from 'lucide-react';
import type { AnalyticsEvent, Product, StaffRequest, StaffStatus } from '@/lib/types';
import { getEvents, getProducts, getStaffRequests, saveProducts, saveStaffRequests, subscribe } from '@/lib/store';
import ProductEditor from '@/features/admin/product-editor';
import { ADMIN_TOKEN_KEY, STATIONS_KEY, SIZE_CHART_KEY, adminRequest, currency, groupEvents, isEvent, newProduct, summarize } from '@/features/admin/admin-model';
import './admin.css';

const navigation: { label: string; icon: LucideIcon; group?: string }[] = [
  { label: 'Dashboard', icon: LayoutDashboard }, { label: 'Products', icon: ShoppingBag },
  { label: 'Categories', icon: Tags }, { label: 'Inventory', icon: Box }, { label: 'Orders', icon: Package },
  { label: 'Customers', icon: Users }, { label: 'Mirror Stations', icon: Monitor, group: 'EXPERIENCE' },
  { label: 'Staff Requests', icon: Bell }, { label: 'AI Analytics', icon: Sparkles }, { label: 'Settings', icon: Settings, group: 'WORKSPACE' },
];
const statuses: StaffStatus[] = ['Waiting', 'Accepted', 'Bringing Product', 'Completed'];
interface Station { id: string; name: string; location: string; enabled: boolean }
const initialStations: Station[] = [{ id: 'station-04', name: 'Station 04', location: 'Floor 1 · Styling studio', enabled: true }];
const titles: Record<string, string> = {
  Dashboard: 'A little perspective. A better experience.', Products: 'Every piece, thoughtfully curated.',
  Categories: 'Find a place for every style.', Inventory: 'The right piece, within reach.',
  Orders: 'From discovery to a purchase.', Customers: 'Understand the experience. Respect the person.',
  'Mirror Stations': 'A connected floor. A seamless experience.', 'Staff Requests': 'A personal touch, at the right moment.',
  'AI Analytics': 'Turn everyday moments into insights.', Settings: 'Make this workspace your own.',
};

function Empty({ icon: Icon = Activity, title, children }: { icon?: LucideIcon; title: string; children: React.ReactNode }) {
  return <div className="admin-empty"><span><Icon size={27}/></span><h3>{title}</h3><p>{children}</p></div>;
}
function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`admin-panel ${className}`}><div className="admin-panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function RankList({ values, products, noun }: { values: [string, number][]; products?: Product[]; noun: string }) {
  if (!values.length) return <Empty title="Your story starts here">Recorded {noun} will appear when customers explore the mirror.</Empty>;
  const max = values[0][1];
  return <div className="admin-rank-list">{values.slice(0, 5).map(([key, count], index) => {
    const product = products?.find(product => product.id === key);
    return <div className="admin-rank-row" key={key}><span className="admin-rank-number">0{index + 1}</span>{product?.image && <img src={product.image} alt=""/>}<div><strong>{product?.name ?? key}</strong><div className="admin-rank-track"><span style={{ width: `${count / max * 100}%` }}/></div></div><b>{count}<small>{noun}</small></b></div>;
  })}</div>;
}
function InventoryRow({ product, onSave }: { product: Product; onSave: (product: Product) => Promise<void> }) {
  const [stock, setStock] = useState(product.stock);
  const [rack, setRack] = useState(product.rack);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = stock !== product.stock || rack !== product.rack;
  return <tr><td><strong>{product.name}</strong><small>{product.sku}</small></td><td>{product.category}</td><td><span className={`admin-status ${product.stock < 5 ? 'warning' : ''}`}>{product.stock === 0 ? 'Out of stock' : product.stock < 5 ? 'Low stock' : 'In stock'}</span></td><td><input aria-label={`Stock for ${product.name}`} className="admin-table-input" type="number" min={0} max={100000} value={stock} onChange={event => setStock(Math.max(0, Math.floor(Number(event.target.value))))}/></td><td><input aria-label={`Rack for ${product.name}`} className="admin-table-input" maxLength={30} value={rack} onChange={event => setRack(event.target.value)}/></td><td><button className="admin-icon-button" disabled={!changed || busy || !rack.trim()} onClick={async () => { setBusy(true); try { await onSave({ ...product, stock, rack: rack.trim() }); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Update failed.'); } finally { setBusy(false); } }} aria-label={`Save inventory for ${product.name}`}>{busy ? <LoaderCircle size={17} className="admin-spin"/> : <Check size={17}/>}</button>{error && <small className="admin-danger-text">{error}</small>}</td></tr>;
}

export default function AdminPage() {
  const [active, setActive] = useState('Dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [requests, setRequests] = useState<StaffRequest[]>([]);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [analyticsSource, setAnalyticsSource] = useState<'local' | 'api'>('local');
  const analyticsSourceRef = useRef<'local' | 'api'>('local');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All products');
  const [editor, setEditor] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [sizeChart, setSizeChart] = useState('{}');
  const [stations, setStations] = useState<Station[]>(initialStations);
  const [stationName, setStationName] = useState('');
  const [stationLocation, setStationLocation] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [backendConnected, setBackendConnected] = useState(false);

  const applyAnalytics = useCallback((source: 'local' | 'api', nextEvents: AnalyticsEvent[]) => {
    analyticsSourceRef.current = source;
    setEvents(nextEvents);
    setAnalyticsSource(source);
  }, []);

  const syncBackend = useCallback(async (manual = false) => {
    if (manual) { setBusy(true); setError(''); }
    try {
      const results = await Promise.allSettled([adminRequest('/api/products'), adminRequest('/api/staff-requests'), adminRequest('/api/admin/analytics')]);
      const [catalogue, staff, analytics] = results;
      const protectedSuccess = analytics.status === 'fulfilled' && analytics.value && Array.isArray(analytics.value.events);
      setBackendConnected(Boolean(protectedSuccess));
      if (catalogue.status === 'fulfilled' && Array.isArray(catalogue.value)) setProducts(catalogue.value as Product[]);
      if (staff.status === 'fulfilled' && Array.isArray(staff.value)) setRequests(staff.value as StaffRequest[]);
      if (protectedSuccess && analytics.status === 'fulfilled') applyAnalytics('api', analytics.value.events as AnalyticsEvent[]);
      else applyAnalytics('local', getEvents());
      if (manual) {
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        setToast(protectedSuccess ? 'Store catalogue, staff requests and analytics refreshed.' : 'Backend unavailable. Your local demo workspace is ready.');
      }
    } catch (cause) { if (manual) setError(cause instanceof Error ? cause.message : 'Could not refresh the store.'); }
    finally { if (manual) setBusy(false); }
  }, [applyAnalytics]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setProducts(getProducts());
      setRequests(getStaffRequests());
      if (analyticsSourceRef.current === 'local') applyAnalytics('local', getEvents());
    };
    refresh();
    const readSettings = () => {
      setToken(sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '');
      setSizeChart(localStorage.getItem(SIZE_CHART_KEY) ?? '{}');
      try { const saved = JSON.parse(localStorage.getItem(STATIONS_KEY) ?? 'null'); if (Array.isArray(saved) && saved.every(item => typeof item.name === 'string' && typeof item.location === 'string' && typeof item.id === 'string' && typeof item.enabled === 'boolean')) setStations(saved); } catch { /* Retain safe defaults for invalid settings. */ }
    };
    readSettings();
    void syncBackend();
    const unsubscribe = subscribe(() => { refresh(); clearTimeout(debounce); debounce = setTimeout(() => void syncBackend(), 800); });
    const interval = setInterval(() => void syncBackend(), 15000);
    return () => { unsubscribe(); clearTimeout(debounce); clearInterval(interval); };
  }, [syncBackend, applyAnalytics]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timeout); }, [toast]);

  const summary = useMemo(() => summarize(events), [events]);
  const categories = useMemo(() => [...new Set(products.map(product => product.category))].sort(), [products]);
  const filtered = products.filter(product => `${product.name} ${product.sku} ${product.brand} ${product.rack}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'All products' || product.category === filter));
  const pending = requests.filter(request => request.status !== 'Completed');
  const lowStock = products.filter(product => product.stock < 5);
  const triedProducts = groupEvents(events, 'productId', 'tryOn');
  const inventoryUnits = products.reduce((total, product) => total + product.stock, 0);
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - 6 + index); const matches = events.filter(event => new Date(event.timestamp).toDateString() === date.toDateString()); return { day: date.toLocaleDateString('en-IN', { weekday: 'short' }), sessions: new Set(matches.map(event => event.sessionId)).size, tries: matches.filter(event => isEvent(event, 'tryOn')).length }; });
  const maxDay = Math.max(1, ...days.map(day => Math.max(day.sessions, day.tries)));
  const switchPanel = (panel: string) => { setActive(panel); setQuery(''); setFilter('All products'); setError(''); };

  async function saveProduct(product: Product) {
    const existing = products.some(item => item.id === product.id);
    if (products.some(item => item.id !== product.id && item.sku.toLowerCase() === product.sku.toLowerCase())) throw new Error('This SKU is already used. Choose a unique product SKU.');
    const saved = await adminRequest(existing ? `/api/products/${encodeURIComponent(product.id)}` : '/api/products', existing ? 'PATCH' : 'POST', product);
    setBackendConnected(Boolean(saved));
    saveProducts(existing ? products.map(item => item.id === product.id ? product : item) : [...products, product]);
    setEditor(null);
    setToast(saved ? existing ? 'Product updated. Your catalogue is ready.' : 'New product added to your collection.' : 'Product saved locally. The backend is unavailable.');
  }
  async function advanceRequest(request: StaffRequest) {
    const next = statuses[Math.min(statuses.indexOf(request.status) + 1, statuses.length - 1)];
    setBusy(true); setError('');
    try { const saved = await adminRequest(`/api/staff-requests/${encodeURIComponent(request.id)}`, 'PATCH', { status: next }); setBackendConnected(Boolean(saved)); saveStaffRequests(requests.map(item => item.id === request.id ? { ...item, status: next } : item)); setToast(`${request.station}: ${next.toLowerCase()}${saved ? '.' : ' · saved locally.'}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update request.'); }
    finally { setBusy(false); }
  }
  function exportAnalytics() {
    const csv = 'timestamp,event,session,product,color,size\n' + events.map(event => [event.timestamp, event.type, event.sessionId, event.productId ?? '', event.color ?? '', event.size ?? ''].map(value => `"${value.replaceAll('"', '""').replace(/^[=+@-]/, "'")}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'smart-mirror-analytics.csv'; anchor.click(); URL.revokeObjectURL(url);
    setToast('Recorded events exported as CSV.');
  }
  const requestTable = (list: StaffRequest[]) => list.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Station / product</th><th>Variant</th><th>Rack</th><th>Requested</th><th>Status</th><th>Next step</th></tr></thead><tbody>{list.map(request => <tr key={request.id}><td><strong>{request.station}</strong><small>{request.productName}</small></td><td>{request.color} · {request.size}</td><td>{request.rack}</td><td>{new Date(request.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td><td><span className={`admin-status ${request.status === 'Waiting' ? 'warning' : ''}`}>{request.status}</span></td><td>{request.status === 'Completed' ? <Check size={17}/> : <button className="admin-text-button" onClick={() => advanceRequest(request)} disabled={busy}>{statuses[statuses.indexOf(request.status) + 1]}<ChevronRight size={14}/></button>}</td></tr>)}</tbody></table></div> : <Empty icon={Bell} title="Everything is taken care of">Staff requests from the customer mirror will appear here as soon as a customer calls for help.</Empty>;

  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <Link href="/" className="admin-brand"><span className="admin-brand-symbol"><Sparkles size={24}/></span><div>SMART MIRROR<small>RETAIL WORKSPACE</small></div></Link>
      <div className="admin-workspace-card"><span className="admin-store-icon"><ShoppingBag size={18}/></span><div><strong>Flagship store</strong><small>Bengaluru, India</small></div><ChevronRight size={15}/></div>
      <nav aria-label="Admin navigation"><span className="admin-nav-caption">OVERVIEW</span>{navigation.map(item => <div key={item.label}>{item.group && <span className="admin-nav-caption">{item.group}</span>}<button className={`admin-nav-item ${active === item.label ? 'active' : ''}`} onClick={() => switchPanel(item.label)}><item.icon size={18}/><span>{item.label}</span>{item.label === 'Staff Requests' && pending.length > 0 && <b>{pending.length}</b>}{active === item.label && <span className="admin-nav-dot"/>}</button></div>)}</nav>
      <div className="admin-sidebar-bottom"><Link href="/" className="admin-mirror-link"><Monitor size={19}/><span>Open mirror experience</span><ExternalLink size={13}/></Link><div className="admin-profile"><span>SM</span><div><strong>Store workspace</strong><small>{backendConnected ? 'Connected API mode' : 'Local demo mode'}</small></div><ShieldCheck size={17}/></div></div>
    </aside>
    <main className="admin-main">
      <header className="admin-topbar"><div className="admin-breadcrumb">Workspace<ChevronRight size={13}/><strong>{active}</strong></div><div className="admin-topbar-actions"><button className="admin-text-button" onClick={() => void syncBackend(true)} disabled={busy}>{busy ? <LoaderCircle size={13} className="admin-spin"/> : <Activity size={13}/>}Sync store</button><span className="admin-mode-label"><span/>{backendConnected ? 'Store connected' : 'Local demo'}</span><button className="admin-icon-button" aria-label="View staff requests" onClick={() => switchPanel('Staff Requests')}><Bell size={18}/>{pending.length > 0 && <i/>}</button><button className="admin-avatar" aria-label="Open workspace settings" onClick={() => switchPanel('Settings')}>SM</button></div></header>
      <div className="admin-content">
        <div className="admin-page-heading"><div><span className="admin-eyebrow">YOUR RETAIL WORKSPACE</span><h1>{active === 'Dashboard' ? 'Welcome to your store.' : active}</h1><p>{titles[active]}</p></div><div className="admin-heading-action">{active === 'Products' || active === 'Dashboard' ? <button className="admin-button" onClick={() => setEditor(newProduct())}><Plus size={17}/>Add product</button> : active === 'AI Analytics' ? <button className="admin-button admin-secondary" onClick={exportAnalytics}><ArrowDownToLine size={17}/>Export events</button> : <span className="admin-date">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span>}</div></div>
        {error && <div className="admin-error" role="alert">{error}<button className="admin-icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}

        {active === 'Dashboard' && <>
          <div className="admin-stat-grid">
            {[{ label: 'Mirror sessions', value: summary.sessions, icon: Monitor, note: `${summary.dailySessions} anonymous sessions today` }, { label: 'Virtual try-ons', value: summary.tries, icon: ShoppingBag, note: `${triedProducts.length} pieces explored` }, { label: 'Try-on to cart', value: `${summary.cartConversion}%`, icon: Activity, note: 'Of sessions with a try-on' }, { label: 'Available products', value: products.length, icon: Package, note: `${inventoryUnits} units across your store` }].map(stat => <div className="admin-stat" key={stat.label}><div><span>{stat.label}</span><stat.icon size={19}/></div><strong>{stat.value}</strong><small>{stat.note}</small></div>)}
          </div>
          <div className="admin-dashboard-grid">
            <Panel title="A week in your store" subtitle="Recorded mirror activity · last 7 days" action={<div className="admin-chart-legend"><span><i/>Sessions</span><span><i/>Try-ons</span></div>}>
              <div className="admin-chart"><div className="admin-chart-axis"><span>{maxDay}</span><span>{Math.round(maxDay / 2)}</span><span>0</span></div><div className="admin-chart-bars">{days.map((day, index) => <div className="admin-chart-day" key={index}><div className="admin-chart-bar-pair"><div title={`${day.sessions} sessions`} style={{ height: `${day.sessions / maxDay * 100}%` }}/><div title={`${day.tries} try-ons`} style={{ height: `${day.tries / maxDay * 100}%` }}/></div><span>{day.day}</span></div>)}</div></div>
              <div className="admin-chart-footer"><span><ShieldCheck size={14}/> {analyticsSource === 'api' ? 'Recorded store API activity' : 'Local events only · no sample traffic'}</span><button className="admin-text-button" onClick={() => switchPanel('AI Analytics')}>Explore insights<ArrowRight size={14}/></button></div>
            </Panel>
            <section className="admin-collection-card"><span className="admin-eyebrow">CURATE THE EXPERIENCE</span><h2>Great style starts<br/>with a great collection.</h2><p>Bring your catalogue to life. Add the pieces your customers will fall in love with.</p><button className="admin-button" onClick={() => switchPanel('Products')}>Manage collection<ArrowRight size={16}/></button><div className="admin-collection-art"><span/><span/><span/><ShoppingBag size={65} strokeWidth={1}/></div><small>{products.length} products · {categories.length} categories</small></section>
            <Panel title="Customer favourites" subtitle="Products with the most recorded try-ons" action={<button className="admin-icon-button" aria-label="View all product analytics" onClick={() => switchPanel('AI Analytics')}><MoreHorizontal size={21}/></button>}><RankList values={triedProducts} products={products} noun="try-ons"/></Panel>
            <Panel title="On the floor" subtitle="A quick look at what needs attention"><div className="admin-attention-list"><button onClick={() => switchPanel('Staff Requests')}><span className="admin-soft-icon"><Bell size={19}/></span><div><strong>{pending.length} requests waiting for a touch</strong><small>Help customers find their next favourite</small></div><ArrowRight size={17}/></button><button onClick={() => switchPanel('Inventory')}><span className="admin-soft-icon warm"><Box size={19}/></span><div><strong>{lowStock.length} products running low</strong><small>Fewer than 5 units left in stock</small></div><ArrowRight size={17}/></button><button onClick={() => switchPanel('Mirror Stations')}><span className="admin-soft-icon"><Monitor size={19}/></span><div><strong>{stations.length} configured mirror stations</strong><small>Review station placement and availability</small></div><ArrowRight size={17}/></button></div></Panel>
          </div>
          <Panel title="Staff requests" subtitle="A seamless handoff from mirror to store team" action={<button className="admin-text-button" onClick={() => switchPanel('Staff Requests')}>View all<ArrowRight size={14}/></button>}>{requestTable(pending.slice(0, 4))}</Panel>
        </>}

        {active === 'Products' && <Panel title="The collection" subtitle={`${products.length} products, ready for discovery`} action={<span className="admin-chip">{backendConnected ? 'Connected catalogue' : 'Demo catalogue'}</span>}>
          <div className="admin-table-toolbar"><label className="admin-search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search products, SKU or rack…" aria-label="Search products"/></label><label className="admin-filter"><SlidersHorizontal size={16}/><select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter category"><option>All products</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label><span>{filtered.length} products</span></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Variants</th><th>Stock</th><th>Rack</th><th aria-label="Actions"/></tr></thead><tbody>{filtered.map(product => <tr key={product.id}><td><div className="admin-product-cell">{product.image ? <img src={product.image} alt={product.name} onError={event => { event.currentTarget.style.display = 'none'; }}/> : <span className="admin-product-fallback"><ShoppingBag size={22}/></span>}<div><strong>{product.name}</strong><small>{product.sku} · {product.brand}</small></div></div></td><td>{product.category}<small>{product.gender}</small></td><td><strong>{currency(product.price * (1 - product.discount / 100))}</strong>{product.discount > 0 && <small>{product.discount}% off</small>}</td><td><div className="admin-color-dots">{product.colors.map(color => <i key={color.name} style={{ background: color.hex }} title={color.name}/>)}</div><small>{product.sizes.join(' · ')}</small></td><td><span className={`admin-status ${product.stock < 5 ? 'warning' : ''}`}>{product.stock} units</span></td><td>{product.rack}</td><td><div className="admin-row-actions"><button className="admin-icon-button" onClick={() => setEditor(product)} aria-label={`Edit ${product.name}`}><Pencil size={16}/></button><button className="admin-icon-button" onClick={() => setDeleting(product)} aria-label={`Delete ${product.name}`}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div>
          {filtered.length === 0 && <Empty icon={Search} title="No pieces found">Try a different search or category, or add your first product.</Empty>}
          <div className="admin-panel-footer">Showing {filtered.length} of {products.length} products<span>All prices in INR</span></div>
        </Panel>}

        {active === 'Categories' && <><div className="admin-info-note"><Tags size={18}/><p>Categories are derived from your products. Add a category in the product editor or move a product to organise your collection.</p><button className="admin-text-button" onClick={() => setEditor(newProduct())}>Add product<Plus size={15}/></button></div><div className="admin-category-grid">{categories.map(category => { const items = products.filter(product => product.category === category); return <button className="admin-category-card" key={category} onClick={() => { switchPanel('Products'); setFilter(category); }}><span className="admin-soft-icon"><ShoppingBag size={22}/></span><h2>{category}</h2><p>{items.length} pieces · {items.reduce((total, item) => total + item.stock, 0)} units</p><div>{[...new Set(items.map(item => item.gender))].join(' / ')}<ArrowRight size={18}/></div></button>; })}</div></>}

        {active === 'Inventory' && <><div className="admin-stat-grid admin-three-stats"><div className="admin-stat"><span>Total units</span><strong>{inventoryUnits}</strong><small>Available in your catalogue</small></div><div className="admin-stat"><span>Low stock products</span><strong>{lowStock.length}</strong><small>Less than 5 units remaining</small></div><div className="admin-stat"><span>Out of stock</span><strong>{products.filter(product => product.stock === 0).length}</strong><small>Hidden from available recommendations</small></div></div><Panel title="Inventory & locations" subtitle="Update quantities and rack locations. Save each changed row."><div className="admin-table-toolbar"><label className="admin-search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search inventory…" aria-label="Search inventory"/></label></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Category</th><th>Availability</th><th>Units</th><th>Rack</th><th>Save</th></tr></thead><tbody>{filtered.map(product => <InventoryRow key={`${product.id}-${product.stock}-${product.rack}`} product={product} onSave={saveProduct}/>)}</tbody></table></div>{!filtered.length && <Empty title="No matching inventory">Try searching for a product name or SKU.</Empty>}</Panel></>}

        {active === 'Orders' && <><div className="admin-info-note"><ShieldCheck size={18}/><p>The mirror supports a shopping cart and QR handoff. A purchase is recorded only when your checkout system sends a confirmed purchase event.</p></div><Panel title="Purchase activity" subtitle="Verified purchase events from the recorded activity">{summary.purchases ? <RankList values={groupEvents(events, 'productId', 'purchase')} products={products} noun="purchases"/> : <Empty icon={Package} title="No confirmed purchases yet">Your customers can build a cart and take it to their phone. Connect your store checkout to record completed purchases and measure conversion.</Empty>}</Panel></>}

        {active === 'Customers' && <><div className="admin-info-note"><ShieldCheck size={19}/><p>Customer activity is anonymous. This workspace does not identify visitors or keep a database of faces, photos or body measurements.</p></div><Panel title="Anonymous sessions" subtitle={`${summary.sessions} recorded sessions · no customer identities`}><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Session</th><th>First activity</th><th>Try-ons</th><th>Cart additions</th><th>Last activity</th></tr></thead><tbody>{[...new Set(events.map(event => event.sessionId))].map((id, index) => { const session = events.filter(event => event.sessionId === id).sort((a, b) => a.timestamp.localeCompare(b.timestamp)); return <tr key={id}><td><strong>Guest session {String(index + 1).padStart(2, '0')}</strong><small>{id.slice(0, 16)}</small></td><td>{new Date(session[0].timestamp).toLocaleString('en-IN')}</td><td>{session.filter(event => isEvent(event, 'tryOn')).length}</td><td>{session.filter(event => isEvent(event, 'cart')).length}</td><td>{new Date(session.at(-1)!.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td></tr>; })}</tbody></table></div>{!events.length && <Empty icon={Users} title="The next visit starts a story">Anonymous session activity appears here when the mirror experience is used.</Empty>}</Panel></>}

        {active === 'Mirror Stations' && <><div className="admin-info-note"><Monitor size={19}/><p>Station labels help your staff locate customers. Availability below is a store setting; a live device heartbeat is not connected.</p></div><div className="admin-station-grid">{stations.map(station => <Panel title={station.name} subtitle={station.location} key={station.id} action={<Monitor size={23}/>}><div className="admin-station-detail"><span className={`admin-status ${!station.enabled ? 'neutral' : ''}`}>{station.enabled ? 'Available for setup' : 'Paused'}</span><small>No live device heartbeat</small></div><div className="admin-station-requests"><span>Open staff requests</span><strong>{pending.filter(request => request.station === station.name).length}</strong></div><div className="admin-station-actions"><button className="admin-text-button" onClick={() => { const updated = stations.map(item => item.id === station.id ? { ...item, enabled: !item.enabled } : item); setStations(updated); localStorage.setItem(STATIONS_KEY, JSON.stringify(updated)); }}>{station.enabled ? 'Pause station' : 'Enable station'}<ArrowRight size={14}/></button><button className="admin-icon-button" onClick={() => { const updated = stations.filter(item => item.id !== station.id); setStations(updated); localStorage.setItem(STATIONS_KEY, JSON.stringify(updated)); }} aria-label={`Remove ${station.name}`}><Trash2 size={15}/></button></div></Panel>)}</div><Panel title="Add a station" subtitle="Configure a label and a physical location"><form className="admin-inline-form" onSubmit={event => { event.preventDefault(); const name = stationName.trim(); if (!name || !stationLocation.trim()) return; if (stations.some(station => station.name.toLowerCase() === name.toLowerCase())) { setError('Choose a unique station name.'); return; } const updated = [...stations, { id: crypto.randomUUID(), name, location: stationLocation.trim(), enabled: true }]; setStations(updated); localStorage.setItem(STATIONS_KEY, JSON.stringify(updated)); setStationName(''); setStationLocation(''); setToast('Station configured in this workspace.'); }}><label className="admin-field">Station name<input required maxLength={60} value={stationName} onChange={event => setStationName(event.target.value)} placeholder="Station 05"/></label><label className="admin-field">Location<input required maxLength={120} value={stationLocation} onChange={event => setStationLocation(event.target.value)} placeholder="Floor 1 · Men’s collection"/></label><button className="admin-button"><Plus size={17}/>Add station</button></form></Panel></>}

        {active === 'Staff Requests' && <><div className="admin-stat-grid admin-three-stats">{[{ label: 'Waiting for staff', value: requests.filter(request => request.status === 'Waiting').length }, { label: 'In progress', value: requests.filter(request => ['Accepted', 'Bringing Product'].includes(request.status)).length }, { label: 'Completed', value: requests.filter(request => request.status === 'Completed').length }].map(item => <div className="admin-stat" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>Recorded customer requests</small></div>)}</div><Panel title="Personal service, in motion" subtitle="Waiting → Accepted → Bringing Product → Completed">{requestTable([...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))}</Panel></>}

        {active === 'AI Analytics' && <><div className="admin-info-note"><Sparkles size={19}/><p>Insights come from {events.length} recorded events {analyticsSource === 'api' ? 'from the connected store API' : 'in this browser'}. Session conversion measures sessions that tried a product before a cart or purchase event.</p>{backendConnected && <button className="admin-text-button" disabled={busy} onClick={() => void syncBackend(true)}>Sync API<ArrowRight size={14}/></button>}</div><div className="admin-stat-grid"><div className="admin-stat"><span>Daily anonymous sessions</span><strong>{summary.dailySessions}</strong><small>Based on recorded session IDs</small></div><div className="admin-stat"><span>Try-on → cart</span><strong>{summary.cartConversion}%</strong><small>Sessions with a try-on</small></div><div className="admin-stat"><span>Try-on → purchase</span><strong>{summary.purchaseConversion}%</strong><small>Confirmed purchase events only</small></div><div className="admin-stat"><span>Average session</span><strong>{summary.averageDuration === null ? '—' : `${Math.floor(summary.averageDuration / 60)}m ${summary.averageDuration % 60}s`}</strong><small>Completed sessions only</small></div></div><div className="admin-dashboard-grid"><Panel title="Most tried products" subtitle="Recorded try-on selections"><RankList values={triedProducts} products={products} noun="try-ons"/></Panel><Panel title="Most recommended" subtitle="Catalogue recommendations recorded by the mirror"><RankList values={groupEvents(events, 'productId', 'recommendation')} products={products} noun="recommendations"/></Panel><Panel title="Popular colors" subtitle="Colors chosen during try-on"><RankList values={groupEvents(events, 'color', 'tryOn')} noun="selections"/></Panel><Panel title="Popular sizes" subtitle="Sizes selected during try-on"><RankList values={groupEvents(events, 'size', 'tryOn')} noun="selections"/></Panel><Panel title="Most compared pieces" subtitle="Products added to outfit comparison"><RankList values={groupEvents(events, 'productId', 'comparison')} products={products} noun="comparisons"/></Panel><Panel title="Try-ons without a purchase" subtitle="A discovery signal, not a completed-sales report"><RankList values={triedProducts.filter(([id]) => !events.some(event => event.productId === id && isEvent(event, 'purchase')))} products={products} noun="try-ons"/></Panel></div></>}

        {active === 'Settings' && <div className="admin-settings-grid"><Panel title="Store connection" subtitle="Secure access to your configured backend"><div className="admin-settings-body"><div className="admin-connection-info"><ShieldCheck size={23}/><div><strong>{backendConnected ? 'Store API configured' : 'Local demo workspace'}</strong><p>{backendConnected ? (process.env.NEXT_PUBLIC_API_URL || 'Local store API · secure loopback bridge') : 'Product edits, staff requests and analytics are stored in this browser.'}</p></div></div><label className="admin-field">Backend admin token<input type="password" autoComplete="off" value={token} onChange={event => { setToken(event.target.value); setSettingsSaved(false); }} placeholder="Enter the token configured on your backend"/></label><small>The token is retained only for this tab’s session and sent to the configured API. No token is included in the source code.</small><button className="admin-button" onClick={async () => { if (token.trim()) sessionStorage.setItem(ADMIN_TOKEN_KEY, token.trim()); else sessionStorage.removeItem(ADMIN_TOKEN_KEY); setSettingsSaved(true); await syncBackend(true); }}><Check size={16}/>{settingsSaved ? 'Saved' : 'Save connection'}</button></div></Panel><Panel title="Brand size charts" subtitle="Official centimetre measurements for fit guidance"><div className="admin-settings-body"><p>Configure a chart keyed by brand, then size. Each size uses chest, length and shoulder measurements in centimetres.</p><label className="admin-field">Size chart configuration<textarea className="admin-code-field" rows={10} value={sizeChart} onChange={event => setSizeChart(event.target.value)} spellCheck={false}/></label><small>{'Example: {"AURA":{"M":{"chest":104,"length":72,"shoulder":46}}}'}</small><button className="admin-button" onClick={async () => { try { const parsed: unknown = JSON.parse(sizeChart); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Size charts must be a JSON object keyed by brand.'); for (const [brand, chart] of Object.entries(parsed)) { if (!brand.trim() || !chart || typeof chart !== 'object' || Array.isArray(chart)) throw new Error('Each brand must contain a size chart.'); for (const [size, measurements] of Object.entries(chart)) { if (!['XS', 'S', 'M', 'L', 'XL', 'XXL'].includes(size) || !measurements || typeof measurements !== 'object') throw new Error('Use sizes XS through XXL with measurement objects.'); for (const field of ['chest', 'length', 'shoulder']) { const value = (measurements as Record<string, unknown>)[field]; if (typeof value !== 'number' || value <= 0 || value > 500) throw new Error(`${brand} ${size}: ${field} must be between 0 and 500 cm.`); } } } localStorage.setItem(SIZE_CHART_KEY, JSON.stringify(parsed)); setSizeChart(JSON.stringify(parsed, null, 2)); setToast('Official brand size charts saved for this browser.'); setError(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid size chart.'); } }}><Check size={16}/>Save size charts</button></div></Panel><Panel title="Privacy by design" subtitle="Customer trust is part of the experience" className="admin-span-2"><div className="admin-privacy-grid"><div><ShieldCheck size={21}/><h3>Camera stays local</h3><p>Frames are processed on the device. Customer photos are not stored by default.</p></div><div><Users size={21}/><h3>Anonymous insights</h3><p>Events record product interactions and session IDs without identity matching.</p></div><div><CircleHelp size={21}/><h3>Approximate fit guidance</h3><p>Camera estimates should be confirmed with the store’s official size chart.</p></div></div></Panel></div>}
        <footer className="admin-footer"><span><Sparkles size={13}/> AI SMART MIRROR</span><p>Thoughtful technology. Effortless style.</p><Link href="/">Back to mirror<ArrowRight size={13}/></Link></footer>
      </div>
    </main>
    {toast && <div className="admin-toast" role="status"><Check size={17}/>{toast}</div>}
    {editor && <ProductEditor key={editor.id} product={editor} onClose={() => setEditor(null)} onSave={saveProduct}/>}
    {deleting && <div className="admin-modal-backdrop"><section className="admin-modal admin-delete-modal" role="dialog" aria-modal="true" aria-label="Delete product"><span className="admin-soft-icon warm"><Trash2 size={25}/></span><h2>Remove this piece?</h2><p>{deleting.name} will be removed from the catalogue and will no longer be available for try-on.</p>{error && <div className="admin-error">{error}</div>}<div className="admin-modal-actions"><button className="admin-button admin-secondary" disabled={busy} onClick={() => { setDeleting(null); setError(''); }}>Keep product</button><button className="admin-button admin-danger" disabled={busy} onClick={async () => { setBusy(true); try { await adminRequest(`/api/products/${encodeURIComponent(deleting.id)}`, 'DELETE'); saveProducts(products.filter(product => product.id !== deleting.id)); setDeleting(null); setToast('Product removed from the collection.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove product.'); } finally { setBusy(false); } }}>{busy ? <LoaderCircle size={16} className="admin-spin"/> : <Trash2 size={16}/>}Remove product</button></div></section></div>}
  </div>;
}
