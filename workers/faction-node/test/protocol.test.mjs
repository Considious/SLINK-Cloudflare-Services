import test from 'node:test';
import assert from 'node:assert/strict';
import {sign,verify,body,readText,messageContent,endpoint,hmac,verifyHmac,b64} from '../protocol.js';
async function keys(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {private:await crypto.subtle.exportKey('jwk',pair.privateKey),public:await crypto.subtle.exportKey('jwk',pair.publicKey)};}
test('tokens bind the audience, issuer, protocol, purpose, time and signing key',async()=>{
  const key=await keys(),other=await keys(),now=Math.floor(Date.now()/1000),claims={iss:'central',aud:'node',kind:'chat_access',protocol:1,iat:now,exp:now+300};
  const options={issuer:'central',aud:'node',kind:'chat_access'};
  const token=await sign(claims,key.private);assert.equal((await verify(token,key.public,options)).aud,'node');
  for(const patch of [{aud:'other'},{iss:'other'},{kind:'node_certificate'},{protocol:2},{iat:now+30,exp:now+300},{iat:now-400,exp:now-1},{exp:now+301}])await assert.rejects(verify(await sign({...claims,...patch},key.private),key.public,options));
  await assert.rejects(verify(token,other.public,options));
  await assert.rejects(verify('invalid',key.public,options));
});
test('JSON requests reject null, arrays and streamed bodies beyond the byte limit',async()=>{
  for(const value of ['null','[]','undefined','"text"'])await assert.rejects(body(new Request('https://test',{method:'POST',body:value})),{code:'INVALID_JSON'});
  await assert.rejects(readText(new Request('https://test',{method:'POST',body:'é'.repeat(10)}),10),{code:'REQUEST_TOO_LARGE'});
  assert.deepEqual(await body(new Request('https://test',{method:'POST',body:'{"ok":true}'})),{ok:true});
});
test('media remains a URL reference and cannot contain executable URLs',()=>{
  assert.throws(()=>messageContent({type:'media',url:'javascript:alert(1)'}));
  assert.throws(()=>messageContent({type:'media',url:'https://name:password@example.test/test.gif'}));
  const content=messageContent({type:'media',url:'https://media.giphy.com/media/test/giphy.gif',html:'<script>bad</script>'});assert.equal('html' in content,false);
});
test('registration endpoints cannot be local, insecure or carry credentials',()=>{
  for(const url of ['http://node.example.test','https://localhost','https://127.0.0.1','https://[::1]','https://node.local','https://node.example.test/path','https://user:pass@node.example.test'])assert.throws(()=>endpoint(url));
  assert.equal(endpoint('https://node.example.test/'),'https://node.example.test');
});
test('link signatures are payload-bound and each link has its own key',async()=>{
  const first=b64(crypto.getRandomValues(new Uint8Array(32))),second=b64(crypto.getRandomValues(new Uint8Array(32))),signature=await hmac(first,'event');
  assert.equal(await verifyHmac(first,'event',signature),true);
  assert.equal(await verifyHmac(second,'event',signature),false);
  assert.equal(await verifyHmac(first,'changed',signature),false);
});
