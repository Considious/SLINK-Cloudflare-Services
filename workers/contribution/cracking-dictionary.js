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
  if(page==='0'&&bucket!=='common'){
    const learned=await env.CRACKING_DICTIONARY.get('crime-dictionaries/cracking/learned/v1/'+length+'/'+bucket+'.json');
    if(learned){
      if(learned.size>8192||object?.size>65536)return reply(503,'Dictionary shard exceeds its delivery limit.');
      const seeded=object?await object.json():{schema:1,words:[],next:null};
      const words=await learned.json();
      headers['Cache-Control']='public, max-age=300';
      return new Response(JSON.stringify({...seeded,learned:words}),{headers});
    }
  }
  if(!object)return reply(404,'Dictionary shard not published.');
  if(object.size>65536)return reply(503,'Dictionary shard exceeds its delivery limit.');
  const etag=object.httpEtag;
  if(etag)headers.ETag=etag;
  headers['Cache-Control']=page==='0'&&bucket!=='common'?'public, max-age=300':'public, max-age=86400, stale-while-revalidate=604800';
  if(etag&&request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers});
  return new Response(object.body,{headers});
}

// Caller authenticates and checks Crimes scope. Only game answers enter the corpus.
export async function contributeCracking(request,env,{session,hasScope,json}){
  const fail=(status,error)=>json({ok:false,error},status);
  if(!env.CRACKING_DICTIONARY||env.CRACKING_CONTRIBUTIONS!=='on')return fail(503,'Cracking contributions are not enabled on this worker.');
  const auth=await session(request,env);
  if(!auth)return fail(401,'Verify SLINK access before sharing Cracking answers.');
  if(!hasScope(auth,'slink.adhd.alerts'))return fail(403,'Crimes access is required.');
  const reader=request.body?.getReader();if(!reader)return fail(400,'Missing Cracking batch.');
  const decoder=new TextDecoder();let raw='',size=0,body;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>2048){await reader.cancel();return fail(413,'Cracking batch is too large.');}raw+=decoder.decode(value,{stream:true});}
    body=JSON.parse(raw+decoder.decode());
  }catch{return fail(400,'Invalid Cracking batch.');}finally{reader.releaseLock();}
  if(body?.schema!==1||Object.keys(body).some(key=>!['schema','answers'].includes(key))||!Array.isArray(body.answers)||!body.answers.length||body.answers.length>20||!body.answers.every(word=>typeof word==='string'&&/^[A-Z0-9_.]{4,10}$/.test(word)))return fail(400,'Invalid Cracking answers.');
  const groups=new Map(),accepted=[];
  for(const word of new Set(body.answers)){
    const key='crime-dictionaries/cracking/learned/v1/'+word.length+'/'+(word[0]==='.'?'dot':word[0])+'.json';
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(word);
  }
  try{
    for(const [key,words] of groups){
      let saved=false;
      for(let retry=0;retry<4&&!saved;retry++){
        const existing=await env.CRACKING_DICTIONARY.get(key);
        const next=new Set(existing?await existing.json():[]);
        const before=next.size,stored=[];
        for(const word of words){if(next.has(word)||next.size<512){next.add(word);stored.push(word);}}
        if(next.size===before){accepted.push(...stored);saved=true;break;}
        const onlyIf=new Headers(existing?{'If-Match':existing.httpEtag}:{'If-None-Match':'*'});
        if(await env.CRACKING_DICTIONARY.put(key,JSON.stringify([...next].sort()),{onlyIf,httpMetadata:{contentType:'application/json'}})){accepted.push(...stored);saved=true;}
      }
    }
  }catch{return fail(503,'Cracking storage is temporarily unavailable.');}
  return json({ok:true,accepted});
}
