import {ChatError,readText} from './protocol.js';
// Do not mistake an edge/HTML/plaintext service failure for malformed user JSON.
// Never echo the response body: it can contain tokens, stack traces or HTML.
export async function setupResponse(response,service,max=16384){
 const raw=await readText(response,max),status=Number(response.status)||0,type=String(response.headers.get('Content-Type')||'not supplied').split(';')[0].slice(0,80);
 let value;try{value=JSON.parse(raw);}catch{}
 if(value&&typeof value==='object'&&!Array.isArray(value))return value;
 const code=raw.match(/(?:error\s*(?:code)?\s*[:=]?\s*|\b)(10\d{2}|11\d{2})(?:\b|\s)/i)?.[1];
 const detail=code==='1042'?'Cloudflare blocked a Worker-to-Worker request (1042). Both test Workers need the repository update enabling global_fetch_strictly_public.':code?'Cloudflare error '+code+'.':!raw.trim()?'The response was empty.':/^\s*(?:<!doctype|<html)/i.test(raw)?'The response was an HTML error page.':'The response was not a JSON object.';
 throw new ChatError('SETUP_SERVICE_RESPONSE',service+' returned HTTP '+status+'; content type '+type+'. '+detail,502);
}
