import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = { devIndicators: false, allowedDevOrigins: ['localhost', '127.0.0.1'], turbopack: {root:path.resolve(process.cwd(),'..')}, outputFileTracingRoot:path.resolve(process.cwd(),'..') };
export default config;
