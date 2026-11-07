// Public, aggregate release metadata. No API keys, player IDs or per-user version tracking.
const SOURCES={extension:{repo:'SLINK-Browser-Extension',path:'manifest.json',url:'https://github.com/Considious/SLINK-Browser-Extension/archive/refs/heads/main.zip'},pda:{repo:'Torn-Scripts',path:'SLINK-PDA/package.json',url:'https://raw.githubusercontent.com/Considious/Torn-Scripts/main/SLINK-PDA/SLINK_PDA_Dashboard.user.js'}};
export async function releaseResponse(request,env,ctx,{fetcher=fetch,cache=globalThis.caches?.default}={}){
  if(request.method!=='GET')return new Response('Method not allowed',{status:405,headers:{Allow:'GET'}});
  // One cache key regardless of user-supplied query strings; prevents cache-busting amplification.
  const cacheKey=new Request(new URL('/api/releases',request.url).href);
  const hit=await cache?.match(cacheKey);if(hit)return hit;
  try{
    const data={schema:1,checkedAt:new Date().toISOString()};
    await Promise.all(Object.entries(SOURCES).map(async([key,source])=>{
      const response=await fetcher(`https://raw.githubusercontent.com/Considious/${source.repo}/main/${source.path}`,{headers:{'User-Agent':'SLINK-Release-Notice/1.0'},signal:AbortSignal.timeout(6000),cf:{cacheTtl:21600,cacheEverything:true}});
      if(!response.ok)throw Error('Release source unavailable');const body=await response.json();if(!/^\d+(?:\.\d+){1,3}$/.test(body.version))throw Error('Invalid release metadata');data[key]={version:body.version,url:source.url};
    }));
    const response=Response.json(data,{headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=21600','X-Content-Type-Options':'nosniff'}});
    if(cache)ctx.waitUntil(cache.put(cacheKey,response.clone()));return response;
  }catch{const response=Response.json({schema:1,error:'Release information is temporarily unavailable.'},{status:503,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=300'}});if(cache)ctx.waitUntil(cache.put(cacheKey,response.clone()));return response;}
}
