import test from 'node:test';
import assert from 'node:assert/strict';
import {setupResponse} from '../setup-response.js';
test('edge failures identify the service, HTTP status and 1042 instead of blaming user JSON',async()=>{
 await assert.rejects(setupResponse(new Response('error code: 1042',{status:404,headers:{'Content-Type':'text/plain'}}),'Test Central registration'),error=>error.code==='SETUP_SERVICE_RESPONSE'&&error.message.includes('Test Central registration returned HTTP 404')&&error.message.includes('1042')&&error.message.includes('global_fetch_strictly_public'));
});
test('HTML and empty service responses are described without exposing response bodies',async()=>{
 await assert.rejects(setupResponse(new Response('<html>private-token-do-not-echo</html>',{status:502,headers:{'Content-Type':'text/html'}}),'Test node ownership proof'),error=>error.message.includes('HTTP 502')&&error.message.includes('HTML error page')&&!error.message.includes('private-token'));
 await assert.rejects(setupResponse(new Response('',{status:503}),'Test Central registration'),/response was empty/);
});
test('valid structured service errors remain available to the setup caller',async()=>{
 assert.deepEqual(await setupResponse(Response.json({ok:false,code:'CHAT_LICENSE_REQUIRED',error:'License missing'},{status:403}),'Central'),{ok:false,code:'CHAT_LICENSE_REQUIRED',error:'License missing'});
});
