import { describe, expect, it } from 'vitest';
import catalog from '../../../shared/catalog.json';
import type { Product } from '@/lib/types';
import { DEMO_PROFILE, fashionAnswer, recommend, scoreProduct } from './scoring';
const products = catalog as Product[];
describe('inventory-grounded style suggestions',()=>{
 it('uses calibrated shoulder and torso dimensions without inventing chest circumference',()=>{const p=products.find(p=>p.category==='Shirts')!;const chart=p.measurements.L;const score=scoreProduct(p,p.colors[0].name,'Casual',{...DEMO_PROFILE,source:'camera',shoulderCm:chart.shoulder,torsoCm:chart.length-15,confidence:.8});expect(score.recommendedSize).toBe('L');expect(score.sizeConfidence).toBe(65);});
 it('keeps uncertain demo sizing honest',()=>{const score=scoreProduct(products[0],products[0].colors[0].name,'Casual',DEMO_PROFILE);expect(score.sizeConfidence).toBeLessThan(50);expect(products[0].sizes).toContain(score.recommendedSize);});
 it('excludes unavailable and over-budget products',()=>{const candidates=products.map((p,i)=>({...p,stock:i===0?0:p.stock}));const picks=recommend(candidates,'Casual',DEMO_PROFILE,2500);expect(picks.every(p=>p.stock>0&&p.price*(1-p.discount/100)<=2500)).toBe(true);expect(picks.some(p=>p.id===candidates[0].id)).toBe(false);});
 it('handles a budget with no inventory',()=>{const answer=fashionAnswer('Show me outfits under ₹1',products,products[0],'Casual',DEMO_PROFILE);expect(answer.products).toHaveLength(0);expect(answer.text).toContain('No in-stock');});
 it('gives an available color rather than inventing a variant',()=>{const answer=fashionAnswer('Which color?',products,products[0],'Casual',DEMO_PROFILE);expect(answer.products[0].id).toBe(products[0].id);expect(products[0].colors.some(c=>answer.text.includes(c.name))).toBe(true);});
 it('does not suggest an unavailable selected item for a color question',()=>{const selected={...products[0],stock:0};const answer=fashionAnswer('Which color?',products,selected,'Casual',DEMO_PROFILE);expect(answer.products).toHaveLength(0);expect(answer.text).toContain('out of stock');});
 it('respects a budget when asked about colors',()=>{const answer=fashionAnswer('Which colour under ₹1?',products,products[0],'Casual',DEMO_PROFILE);expect(answer.products).toHaveLength(0);expect(answer.text).toContain('above your budget');});
});
