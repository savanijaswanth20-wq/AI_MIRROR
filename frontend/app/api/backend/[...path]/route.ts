import { NextRequest, NextResponse } from 'next/server';
async function proxy(request:NextRequest, context:{params:Promise<{path:string[]}>}) {
 const {path} = await context.params;
 if (path.some(p=>p==='..' || !/^[a-zA-Z0-9_.-]+$/.test(p))) return NextResponse.json({detail:'Invalid path'},{status:400});
 const base = process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000';
 const headers:Record<string,string> = {'Content-Type':request.headers.get('content-type')||'application/json','X-Mirror-Proxy':'1'};
 const token = request.headers.get('authorization'); if (token) headers.Authorization=token;
 else if(process.env.MIRROR_LOCAL_DEMO==='1'&&process.env.INTERNAL_ADMIN_TOKEN)headers.Authorization=`Bearer ${process.env.INTERNAL_ADMIN_TOKEN}`;
 try {
 const response = await fetch(`${base}/api/${path.join('/')}${request.nextUrl.search}`, {method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),signal:AbortSignal.timeout(12000),cache:'no-store'});
 if([204,205,304].includes(response.status))return new NextResponse(null,{status:response.status});
 return new NextResponse(await response.text(),{status:response.status,headers:{'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store'}});
 } catch {return NextResponse.json({detail:'The local backend is offline. Demo mode is still available.'},{status:503});}
}
export const GET=proxy; export const POST=proxy; export const PATCH=proxy; export const DELETE=proxy; export const PUT=proxy;
