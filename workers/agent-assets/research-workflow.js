import { researchRoute } from './research.js';

const ROOT = 'https://internal.invalid/v1/research';
const MAX_OUTPUT = 700 * 1024; // comfortably below Workflows' 1 MiB non-stream result ceiling
const allowed = {
  health: ['operation'],
  torn: ['operation','path','query'],
  kal: ['operation','path','query'],
  ffscouter: ['operation','ids'],
  faction: ['operation','faction_id'],
  faction_export: ['operation','faction_id','images']
};
const positive = v => (typeof v === 'number' || typeof v === 'string') && /^[1-9]\d{0,14}$/.test(String(v)) && Number.isSafeInteger(Number(v));
const error = (code,message,details={}) => ({ok:false,error:{code,message,...details}});
function jobURL(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Object.hasOwn(allowed,p.operation) ||
      Object.keys(p).some(k=>!allowed[p.operation].includes(k))) throw new Error('Use a supported operation and only its documented parameters.');
  const op=p.operation;
  if(op==='health') return new URL(ROOT+'/health');
  if(op==='faction'||op==='faction_export'){
    if(!positive(p.faction_id) || (p.images!==undefined && typeof p.images!=='boolean')) throw new Error('Supply a positive faction_id and, for exports, optional boolean images.');
    const u=new URL(ROOT+'/faction/'+p.faction_id+(op==='faction_export'?'/export.xlsx':''));
    if(p.images!==undefined)u.searchParams.set('images',String(p.images));
    return u;
  }
  if(op==='ffscouter'){
    if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>100||!p.ids.every(positive))throw new Error('Supply 1–100 positive player IDs.');
    const u=new URL(ROOT+'/ffscouter/stats');
    u.searchParams.set('ids',p.ids.join(','));
    return u;
  }
  if(typeof p.path!=='string'||!/^\/[a-zA-Z0-9_,\-]+(?:\/[a-zA-Z0-9_,\-]+)*$/.test(p.path)||p.path.length>256)throw new Error('Supply a provider API path, not a URL or query string.');
  const u=new URL(ROOT+'/'+op+p.path);
  if(p.query!==undefined){
    if(!p.query||typeof p.query!=='object'||Array.isArray(p.query)||Object.keys(p.query).length>30)throw new Error('Query must be an object with at most 30 parameters.');
    for(const [k,v] of Object.entries(p.query)){
      if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)||/^(key|api_?key|authorization|token|access_?token)$/i.test(k)||!['string','number','boolean'].includes(typeof v)||String(v).length>4096)throw new Error('Invalid query parameter or credential field.');
      u.searchParams.set(k,String(v));
    }
  }
  return u;
}
async function gzipBase64(bytes) {
  const compressed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary='';
  for(let i=0;i<compressed.length;i+=8192)binary+=String.fromCharCode(...compressed.subarray(i,i+8192));
  return btoa(binary);
}
export async function runResearchJob(payload, env, fetcher=fetch) {
  let url;
  try {url=jobURL(payload);}
  catch(e){return error('INVALID_JOB',e.message);}
  // HTTP auth is not bypassed by a request parameter; this internal module is only
  // invoked after Cloudflare authorizes the Workflow instance creation.
  const response=await researchRoute(url,env,fetcher);
  if(!response.ok)return { ...(await response.json()),status:response.status };
  const isWorkbook=payload.operation==='faction_export';
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(!isWorkbook && bytes.length<=MAX_OUTPUT)return {ok:true,format:'json',data:JSON.parse(new TextDecoder().decode(bytes))};
  const encoded=await gzipBase64(bytes);
  if(encoded.length>MAX_OUTPUT)return error('OUTPUT_TOO_LARGE','Compressed output exceeds the Workflow result budget. Use smaller individual lookups or the authenticated HTTP export.',{bytes:bytes.length,compressed_base64_bytes:encoded.length});
  return {ok:true,format:isWorkbook?'xlsx':'json',encoding:'gzip+base64',filename:isWorkbook?'faction-'+payload.faction_id+'-intelligence.xlsx':undefined,bytes:bytes.length,data:encoded};
}
