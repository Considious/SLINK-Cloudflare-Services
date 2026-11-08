// Public, read-only delivery of a fixed, game-only dictionary namespace.
const route=/^\/api\/cracking-dictionary\/v1\/(4|5|6|7|8|9|10)\/(common|dot|[A-Z0-9_])\/([0-9]|1[0-5])$/;
export async function handleCrackingDictionary(request,env){
  const parsed=new URL(request.url),match=parsed.pathname.match(route);
  const headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'};
  const reply=(status,error)=>new Response(JSON.stringify({ok:false,error}),{status,headers});
  if(request.method!=='GET'||!match||parsed.search)return reply(404,'Dictionary shard not found.');
  if(!env.CRACKING_DICTIONARY)return reply(503,'Dictionary storage unavailable.');
  const [,length,bucket,page]=match;
  const key='crime-dictionaries/cracking/v1/'+length+'/'+bucket+'/'+page+'.json';
  const object=await env.CRACKING_DICTIONARY.get(key);
  if(!object)return reply(404,'Dictionary shard not published.');
  if(object.size>65536)return reply(503,'Dictionary shard exceeds its delivery limit.');
  const etag=object.httpEtag;
  if(etag)headers.ETag=etag;
  headers['Cache-Control']='public, max-age=86400, stale-while-revalidate=604800';
  if(etag&&request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers});
  return new Response(object.body,{headers});
}
