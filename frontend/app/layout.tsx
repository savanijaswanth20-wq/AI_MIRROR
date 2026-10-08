import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'AI Smart Mirror — Try before you wear',description:'A personal fitting room. Live virtual try-on, considered style suggestions, and your store collection.'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
