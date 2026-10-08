import type { Landmark, Product } from '@/lib/types';

export interface TryOnFrame {
  width: number; height: number; landmarks: Landmark[];
  source?: CanvasImageSource;
  /** A locally generated pose segmentation canvas; never uploaded. */
  segmentation?: CanvasImageSource;
  debug?: boolean;
}
export interface VirtualTryOnEngine {
  readonly kind: 'realtime-overlay' | 'ai-vton';
  setGarment(product: Product, color: string): Promise<void>;
  render(context: CanvasRenderingContext2D, frame: TryOnFrame): void;
  dispose(): void;
}

/** Future adapter boundary. No generative service or photorealism is claimed by this MVP. */
export class AIVirtualTryOnEngine implements VirtualTryOnEngine {
  readonly kind='ai-vton' as const;
  async setGarment(): Promise<void> { throw new Error('An AI VTON provider must be configured before using this adapter.'); }
  render(): void { throw new Error('AI VTON is not connected. Use RealtimeOverlayEngine.'); }
  dispose(): void { /* Future provider owns cancellation and ephemeral image retention. */ }
}
