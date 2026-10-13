import { Effect } from 'effect';
import { inspect,hosts } from './inspection';
import { sha } from './build';
type Env={ASSETS:Fetcher;INSPECTION_LIMIT:RateLimit};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {
 async fetch(request:Request,env:Env){
  const url=new URL(request.url);
  if(request.method!=='GET')return json({error:'GET requests only.'},405);
  if(url.pathname==='/build.json')return json({sha,app:'linkcheck',contract:1});
  if(url.pathname==='/manifest.json')return json({id:'linkcheck',contract:1,runtime:'cloudflare-worker',dataVersion:1,routes:['/linkcheck'],capabilities:['page-inspection:read'],configuration:{hosts:{type:'reviewed-source-list'}},source:'https://github.com/loftwah/app-composer-linkcheck',hosts});
  if(url.pathname==='/api/inspect'){
   const allowed=await env.INSPECTION_LIMIT.limit({key:'public-inspection'});
   if(!allowed.success)return json({error:'Inspection capacity reached. Wait one minute and retry.'},429);
   const value=url.searchParams.get('url')||'';
   return Effect.runPromise(inspect(value).pipe(Effect.match({onSuccess:report=>json({sourceSha:sha,...report}),onFailure:error=>json({error:error.message,kind:error._tag},error._tag==='InvalidTarget'?400:422)})));
  }
  const asset=await env.ASSETS.fetch(request);const headers=new Headers(asset.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://composer.loftwah.com https://guestbook.loftwah.com https://showcase.loftwah.com https://ready.loftwah.com https://ai.loftwah.com https://share.loftwah.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(asset.body,{status:asset.status,headers});
 }
};
