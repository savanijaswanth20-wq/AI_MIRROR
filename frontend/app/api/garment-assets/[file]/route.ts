import { NextRequest, NextResponse } from 'next/server';
export async function GET(request:NextRequest,{params}:{params:Promise<{file:string}>}){
 const {file}=await params;
 if(!/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|svg)$/.test(file))return NextResponse.json({detail:'Invalid asset'},{status:400});
 try{const response=await fetch(`${process.env.INTERNAL_API_URL||'http://127.0.0.1:8000'}/assets/${file}`,{signal:AbortSignal.timeout(7000)});return new NextResponse(await response.arrayBuffer(),{status:response.status,headers:{'Content-Type':response.headers.get('content-type')||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600'}});}catch{return NextResponse.json({detail:'Asset service unavailable'},{status:503});}
}
