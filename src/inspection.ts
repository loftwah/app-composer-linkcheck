import { Data, Effect } from 'effect';
import { Parser } from 'htmlparser2';
import { imageSize } from 'image-size';

// Forks change this reviewed source list, never accept host authority from a browser.
export const hosts = ['composer.loftwah.com','guestbook.loftwah.com','showcase.loftwah.com','ready.loftwah.com','ai.loftwah.com','share.loftwah.com'];
export class InvalidTarget extends Data.TaggedError('InvalidTarget')<{message:string}> {}
export class FetchFailed extends Data.TaggedError('FetchFailed')<{message:string}> {}
export class TooLarge extends Data.TaggedError('TooLarge')<{message:string}> {}
export class InvalidContent extends Data.TaggedError('InvalidContent')<{message:string}> {}
export type InspectionError = InvalidTarget | FetchFailed | TooLarge | InvalidContent;
export function target(input:string) {
 let url:URL;
 try { url=new URL(input); } catch { throw new InvalidTarget({message:'Enter a complete HTTPS URL.'}); }
 if(input.length>2048 || url.protocol!=='https:' || url.port || url.username || url.password || url.search || url.hash || !hosts.includes(url.hostname) || /[\u0000-\u0020\\%]/.test(input) || /\/(?:_emdash|api|admin|studio|owner|private)(?:\/|$)/i.test(url.pathname)) throw new InvalidTarget({message:'Use a public page on a supported hostname, without credentials, query strings or private paths.'});
 return url;
}
export async function boundedFetch(input:string,limit:number,signal:AbortSignal,fetcher:typeof fetch=fetch) {
 let url=target(input); const redirects:string[]=[];
 for(let hop=0;hop<4;hop++) {
  const response=await fetcher(url.href,{redirect:'manual',signal,headers:{'User-Agent':'AppComposer-LinkCheck/1.0','Accept':'text/html,image/png,image/jpeg,image/webp,image/gif'}});
  if([301,302,303,307,308].includes(response.status)) {
   await response.body?.cancel();const next=response.headers.get('location');
   if(!next || hop===3) throw new FetchFailed({message:'The redirect chain did not reach a public response within three redirects.'});
   url=target(new URL(next,url).href);redirects.push(url.href);continue;
  }
  if(!response.ok) {await response.body?.cancel();throw new FetchFailed({message:`The target returned HTTP ${response.status}.`});}
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new TooLarge({message:'The response exceeds the inspection byte limit.'});}
  if(!response.body) throw new InvalidContent({message:'The target returned an empty response.'});
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new TooLarge({message:'The streamed response exceeds the inspection byte limit.'});}chunks.push(value);}} finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {url:url.href,redirects,bytes,type:(response.headers.get('content-type')||'').split(';')[0].toLowerCase(),robots:response.headers.get('x-robots-tag')||''};
 }
 throw new FetchFailed({message:'Unable to fetch the target.'});
}
export type Finding={status:'pass'|'fix'|'review';label:string;detail:string};
type ImageReport={kind:string;declared?:string;url?:string;status:string;message:string;width?:number;height?:number;bytes?:number;type?:string;redirects?:string[]};
export function metadata(html:string,url:string,headerRobots='') {
 const tags:Record<string,string[]>={};const titles:string[]=[];const canonicals:string[]=[];const jsonld:string[]=[];
 let head=false,title=false,ld=false,h1=0,lang='',titleText='',ldText='';
 const parser=new Parser({
  onopentag(name,attrs){
   if(name==='html')lang=attrs.lang||'';if(name==='head')head=true;if(name==='h1')h1++;
   if(!head)return;
   if(name==='title'){title=true;titleText='';}
   if(name==='meta'){const key=(attrs.property||attrs.name||'').toLowerCase();if(key && attrs.content!==undefined)(tags[key]??=[]).push(attrs.content.slice(0,4000));}
   if(name==='link'&&(attrs.rel||'').toLowerCase().split(/\s+/).includes('canonical'))canonicals.push(attrs.href||'');
   if(name==='script'&&attrs.type==='application/ld+json'){ld=true;ldText='';}
  },
  ontext(text){if(title)titleText+=text;if(ld)ldText+=text;},
  onclosetag(name){if(name==='head')head=false;if(name==='title'&&title){titles.push(titleText.trim().slice(0,4000));title=false;}if(name==='script'&&ld){jsonld.push(ldText);ld=false;}}
 },{decodeEntities:true});parser.end(html);
 const first=(key:string)=>tags[key]?.[0]||'';const findings:Finding[]=[];
 const check=(label:string,ok:boolean,good:string,bad:string)=>findings.push({status:ok?'pass':'fix',label,detail:ok?good:bad});
 check('Page title',titles.length===1&&!!titles[0],titles[0]||'','Publish one useful title in the server-rendered head.');
 check('Description',!!first('description'),first('description'),'Add a concise page-specific description. Search engines may choose another snippet.');
 check('Canonical URL',canonicals.length===1&&/^https:\/\//.test(canonicals[0]),canonicals[0]||'','Publish one absolute HTTPS canonical.');
 if(canonicals[0]&&canonicals[0]!==url)findings.push({status:'review',label:'Canonical destination',detail:'The declared canonical differs from the inspected URL. Confirm that this duplication is intentional.'});
 for(const key of ['og:title','og:type','og:url','og:image'])check(key,!!first(key),first(key),`Add ${key} to the server-rendered head.`);
 check('Image description',!!first('og:image:alt'),first('og:image:alt'),'Describe the image using og:image:alt.');
 check('Language',!!lang,lang,'Declare the page language on the html element.');
 check('Mobile viewport',!!first('viewport'),first('viewport'),'Add a mobile viewport declaration.');
 check('Main heading',h1===1,`${h1} h1 element`,`${h1} h1 elements found. Review the visible page hierarchy.`);
 const robots=[first('robots'),headerRobots].filter(Boolean).join('; ');
 findings.push({status:/\b(noindex|none)\b/i.test(robots)?'review':'pass',label:'Indexing directive',detail:robots||'No noindex directive in the response. This does not prove robots.txt access or search indexing.'});
 for(const [key,values] of Object.entries(tags))if(values.length>1&&key!=='og:image'&&key!=='og:locale:alternate')findings.push({status:'review',label:`Repeated ${key}`,detail:'More than one value was found. Check for conflicting template defaults.'});
 const structured=jsonld.map(text=>{try{const value=JSON.parse(text);return {valid:true,type:value['@type']||'JSON document'};}catch{return {valid:false,type:'Invalid JSON'};}});
 if(structured.some(s=>!s.valid))findings.push({status:'fix',label:'Structured data',detail:'An application/ld+json block is not valid JSON.'});
 return {title:titles[0]||'',description:first('description'),canonical:canonicals[0]||'',tags,lang,h1,robots,structured,findings};
}
export function inspect(input:string,fetcher:typeof fetch=fetch) {
 return Effect.tryPromise({try:async(signal)=>{
  const page=await boundedFetch(input,512*1024,signal,fetcher);
  if(page.type!=='text/html')throw new InvalidContent({message:'The page must return text/html.'});
  const meta=metadata(new TextDecoder().decode(page.bytes),page.url,page.robots);
  const images:ImageReport[]=[];const candidates=[{kind:'Open Graph',url:meta.tags['og:image']?.[0]||meta.tags['og:image:url']?.[0]},{kind:'X / Twitter',url:meta.tags['twitter:image']?.[0]||meta.tags['og:image']?.[0]||meta.tags['og:image:url']?.[0]}];
  for(const candidate of candidates) {
   if(!candidate.url){images.push({...candidate,status:'missing',message:'No image declared.'});continue;}
   // Image failure is a report finding, never a false successful inspection.
   try {
    if(!candidate.url.startsWith('https://'))throw new InvalidTarget({message:'Use an absolute HTTPS image URL.'});
    const previous=images.find(i=>i.declared===candidate.url&&i.status==='verified');
    if(previous){images.push({...previous,kind:candidate.kind});continue;}
    const image=await boundedFetch(candidate.url,5*1024*1024,signal,fetcher);
    if(!['image/png','image/jpeg','image/gif','image/webp'].includes(image.type))throw new InvalidContent({message:'Use a PNG, JPEG, GIF or WebP image. SVG/HTML images are not accepted by this checker.'});
    const dimensions=imageSize(image.bytes);
    if(!dimensions.width||!dimensions.height||dimensions.width>10000||dimensions.height>10000)throw new InvalidContent({message:'Unsupported or excessive image dimensions.'});
    const types:Record<string,string>={png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
    if(types[dimensions.type||'']!==image.type)throw new InvalidContent({message:'Image bytes do not match the declared media type.'});
    images.push({kind:candidate.kind,declared:candidate.url,url:image.url,status:'verified',width:dimensions.width,height:dimensions.height,bytes:image.bytes.length,type:image.type,redirects:image.redirects,message:'Public image response and file dimensions inspected.'});
   } catch(error) {images.push({kind:candidate.kind,declared:candidate.url,status:'failed',message:error instanceof InvalidTarget||error instanceof FetchFailed||error instanceof TooLarge||error instanceof InvalidContent?error.message:'The image could not be inspected.'});}
  }
  return {contract:1,kind:'page-inspection',checkedAt:new Date().toISOString(),guidanceReviewed:'2026-10-13',url:page.url,redirects:page.redirects,htmlBytes:page.bytes.length,...meta,images,limits:{searchIndex:'not-verified',platformUnfurl:'not-verified',robotsTxt:'not-checked',renderedJavascript:'not-executed'}};
 },catch:(error):InspectionError=>error instanceof InvalidTarget||error instanceof FetchFailed||error instanceof TooLarge||error instanceof InvalidContent?error:new FetchFailed({message:'The public response could not be read. Retry or check the origin.'})}).pipe(Effect.timeoutOrElse({duration:'12 seconds',orElse:()=>Effect.fail(new FetchFailed({message:'Inspection timed out after 12 seconds. Retry when the origin responds.'}))}));
}
