import type { BodyProfile, Product, Size, StyleScore } from '@/lib/types';
export const DEMO_PROFILE: BodyProfile = { shoulderRatio: 1.04, torsoRatio: 0.32, hipRatio: 0.94, confidence: 0.6, source: 'demo' };
export const OCCASIONS = ['Casual', 'Office', 'Interview', 'College', 'Party', 'Wedding', 'Festival', 'Travel', 'Date', 'Formal event'];
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
export function scoreProduct(product: Product, color: string, occasion: string, profile: BodyProfile = DEMO_PROFILE): StyleScore {
 const matching = product.occasions.some(o => o.toLowerCase() === occasion.toLowerCase());
 const occasionScore = matching ? 96 : 61;
 const style = clamp(86 + (profile.shoulderRatio >= 0.95 && ['Shirts', 'Blazers', 'Jackets'].includes(product.category) ? 7 : 2));
 const muted = ['Navy', 'Olive', 'Beige', 'Charcoal', 'Black', 'White', 'Sage', 'Cream'];
 const warm=profile.source==='camera'&&profile.skinTone?.includes('warm')&&!profile.skinTone.includes('Uncertain');
 const cool=profile.source==='camera'&&profile.skinTone?.includes('cool')&&!profile.skinTone.includes('Uncertain');
 const palette=warm?['Olive','Beige','Cream','Maroon','Sand']:cool?['Navy','Charcoal','White','Teal','Rose']:muted;
 const colorScore = palette.some(c => color.toLowerCase().includes(c.toLowerCase())) ? 94 : 85;
 const measured = profile.source === 'camera' && (!!profile.chestCm || (!!profile.shoulderCm&&!!profile.torsoCm));
 let chart=product.measurements;
 if(typeof window!=='undefined'){try{const custom=JSON.parse(localStorage.getItem('mirror.admin.sizeCharts')??'{}')[product.brand];if(custom&&product.sizes.every(s=>custom[s]&&['chest','length','shoulder'].every(k=>Number.isFinite(custom[s][k])&&custom[s][k]>0)))chart=custom;}catch{/* Keep the product chart if a local override is invalid. */}}
 let size: Size = product.sizes.includes('M') ? 'M' : product.sizes[0];
 let fit = 72;
 if (measured) {
  const ranked = product.sizes.map(s => ({size: s, difference: profile.chestCm?Math.abs((chart[s]?.chest ?? 100) - (profile.chestCm + 8)):Math.abs((chart[s]?.shoulder??44)-profile.shoulderCm!)*3+Math.abs((chart[s]?.length??70)-(profile.torsoCm!+15))*.3})).sort((a,b) => a.difference-b.difference);
  size = ranked[0].size; fit = clamp(95-ranked[0].difference*1.8);
 }
 const colors = product.colors.filter(c => palette.some(m => c.name.includes(m))).map(c => c.name);
 return {style, color: colorScore, fit, occasion: occasionScore, overall: clamp(style*0.25+colorScore*0.2+fit*0.25+occasionScore*0.3), recommendedSize:size, sizeConfidence: measured ? Math.min(product.silhouette==='bottom'?40:65, Math.round(profile.confidence*100)) : 35,
  colors:colors.length?colors:product.colors.map(c=>c.name),
  explanation: `${product.category === 'Blazers' ? 'The structured shoulders' : 'The relaxed proportions'} and ${color.toLowerCase()} palette ${matching ? `pair well with your ${occasion.toLowerCase()} preference` : `offer an alternative for ${occasion.toLowerCase()}; explore the occasion edit for a closer match`}. ${measured ? 'Fit uses your height-calibrated camera estimate.' : 'Set your height in camera mode for an approximate fit estimate.'}`};
}
export function recommend(products: Product[], occasion: string, profile: BodyProfile, budget = Infinity): Product[] {
 return products.filter(p=>p.stock>0 && p.price*(1-p.discount/100)<=budget).sort((a,b)=>scoreProduct(b,b.colors[0].name,occasion,profile).overall-scoreProduct(a,a.colors[0].name,occasion,profile).overall).slice(0,4);
}
export function fashionAnswer(question: string, products: Product[], selected: Product, occasion: string, profile: BodyProfile): {text:string; products:Product[]} {
 const q = question.toLowerCase();
 const match = q.match(/(?:under|below|budget|₹|rs\.?)[\s₹]*(\d[\d,]*)/);
 const budget = match ? Number(match[1].replaceAll(',','')) : Infinity;
 const target = q.includes('interview') ? 'Interview' : q.includes('wedding') ? 'Wedding' : q.includes('party') ? 'Party' : occasion;
 const relevant=q.includes('shirt')?products.filter(p=>p.category==='Shirts'||p.category==='T-shirts'):products;
 let picks = recommend(relevant, target, profile, budget);
 if(q.includes('complete')||q.includes('outfit')){
  const ranked=recommend(products,target,profile,budget);
  const top=ranked.find(p=>p.silhouette==='dress')??ranked.find(p=>p.silhouette==='top');
  const bottom=recommend(products.filter(p=>p.silhouette==='bottom'),target,profile,budget-(top?top.price*(1-top.discount/100):0))[0];
  picks=top?[top,...(top.silhouette!=='dress'&&bottom?[bottom]:[])]:ranked;
 }
 if (q.includes('jeans') || q.includes('match')) picks = picks.filter(p=>p.silhouette !== selected.silhouette).concat(recommend(products.filter(p=>p.silhouette!==selected.silhouette),target,profile,budget)).slice(0,3);
 if (q.includes('color') || q.includes('colour')) {
  if (selected.stock <= 0) return {text:`${selected.name} is currently out of stock. Choose an available piece to explore its colors.`,products:[]};
  if (selected.price*(1-selected.discount/100)>budget) return {text:'That piece is above your budget. Choose an in-budget product to explore its colors.',products:[]};
  return {text:`For ${selected.name}, try ${scoreProduct(selected,selected.colors[0].name,target,profile).colors.join(' or ')}. These are available catalogue colors. Choose the one you enjoy wearing; skin appearance varies with camera lighting.`,products:[selected]};
 }
 if (!picks.length) return {text:'No in-stock products match that budget. Try a higher budget or another occasion.',products:[]};
 return {text:`For ${target.toLowerCase()}${isFinite(budget)?` under ₹${budget.toLocaleString('en-IN')}`:''}, I’d start with ${picks[0].name}. ${scoreProduct(picks[0],picks[0].colors[0].name,target,profile).explanation} These suggestions come from current inventory and transparent style rules.`,products:picks.slice(0,3)};
}
