export type Size = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export interface ProductColor { name: string; hex: string }
export interface Product {
 id: string; sku: string; name: string; brand: string; description: string;
 category: string; gender: 'Men' | 'Women' | 'Unisex'; price: number; discount: number;
 sizes: Size[]; colors: ProductColor[]; stock: number; image: string;
 garmentImage: string; frontImage: string; backImage: string; mask: string;
 measurements: Record<string, { chest: number; length: number; shoulder: number }>;
 rack: string; floor: number; section: string; store: string; occasions: string[];
 silhouette: 'top' | 'bottom' | 'dress'; featured?: boolean;
}
export interface BodyProfile {
 shoulderRatio: number; torsoRatio: number; hipRatio: number;
 heightCm?: number; shoulderCm?: number; chestCm?: number; torsoCm?: number;
 armCm?: number; legCm?: number; faceShape?: string; skinTone?: string;
 confidence: number; source: 'demo' | 'camera';
}
export interface StyleScore {
 style: number; color: number; fit: number; occasion: number; overall: number;
 explanation: string; recommendedSize: Size; sizeConfidence: number;
 colors: string[];
}
export interface Look { productId: string; color: string; size: Size; score: number }
export interface CartItem extends Look { id: string; quantity: number }
export type StaffStatus = 'Waiting' | 'Accepted' | 'Bringing Product' | 'Completed';
export interface StaffRequest { id: string; station: string; productId: string; productName: string; size: Size; color: string; rack: string; status: StaffStatus; createdAt: string }
export interface AnalyticsEvent { id: string; type: string; productId?: string; color?: string; size?: string; timestamp: string; sessionId: string }
export interface Landmark { x: number; y: number; z: number; visibility?: number }
