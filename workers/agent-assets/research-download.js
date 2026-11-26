// Private R2 export objects use a dedicated prefix; never serve arbitrary keys.
export const EXPORT_PREFIX = 'research-exports/v1/';
export const DOWNLOAD_ROUTE = '/v1/research-download/';
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TOKEN=/^[a-f0-9]{64}$/;
const TTL=60*60*1000;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const keyFor=async token=>EXPORT_PREFIX+hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))))+'.xlsx';
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
const error=(code,message,status)=>Response.json({ok:false,error:{code,message}},{status,headers});
export async function saveResearchExport(bytes,id,env,now=Date.now()) {
  if(!env.GRAPHICS_ASSETS) throw new Error('Configure the existing GRAPHICS_ASSETS R2 binding.');
  if(!/^[1-9]\d{0,14}$/.test(String(id))) throw new Error('Invalid faction ID for export.');
  let origin;
  try {
    const u=new URL(env.RESEARCH_DOWNLOAD_ORIGIN);
    if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash) throw Error();
    origin=u.origin;
  } catch { throw new Error('Set RESEARCH_DOWNLOAD_ORIGIN to the HTTPS origin of this Worker.'); }
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  const key=await keyFor(token);
  const filename='faction-'+id+'-intelligence.xlsx';
  const expires=now+TTL;
  const stored=await env.GRAPHICS_ASSETS.put(key,bytes,{
    onlyIf:new Headers({'If-None-Match':'*'}),
    httpMetadata:{contentType:MIME},
    customMetadata:{filename,expires_at:String(expires)}
  });
  if(!stored) throw new Error('Temporary export object collision; rerun the export.');
  return {ok:true,format:'xlsx',filename,bytes:bytes.length,download_url:origin+DOWNLOAD_ROUTE+token,expires_at:new Date(expires).toISOString()};
}
export async function downloadResearchExport(request,env,now=Date.now()) {
  const url=new URL(request.url);
  if(request.method!=='GET')return error('METHOD_NOT_ALLOWED','Use GET to download the Excel file.',405);
  const token=url.pathname.slice(DOWNLOAD_ROUTE.length);
  if(!TOKEN.test(token)||url.search)return error('INVALID_DOWNLOAD','Invalid download link.',404);
  if(!env.GRAPHICS_ASSETS)return error('MISSING_BUCKET','The export storage binding is unavailable.',503);
  try {
    const key=await keyFor(token);
    const object=await env.GRAPHICS_ASSETS.get(key);
    if(!object)return error('DOWNLOAD_NOT_FOUND','Download does not exist or has expired. Run the export again.',404);
    const expiry=Number(object.customMetadata?.expires_at);
    const filename=object.customMetadata?.filename||'';
    if(!Number.isFinite(expiry)||expiry<=now){
      return error('DOWNLOAD_EXPIRED','Download link has expired. Run the export again.',410);
    }
    if(!/^faction-[1-9]\d{0,14}-intelligence\.xlsx$/.test(filename)||object.httpMetadata?.contentType!==MIME)
      return error('INVALID_EXPORT','Stored export metadata is invalid; run the export again.',502);
    return new Response(object.body,{headers:{...headers,'Content-Type':MIME,'Content-Disposition':'attachment; filename="'+filename+'"','Content-Length':String(object.size)}});
  } catch {
    // Never log the token, object path, or provider credentials.
    return error('DOWNLOAD_STORAGE_ERROR','R2 could not read the temporary export. Retry the link or rerun the export.',503);
  }
}
