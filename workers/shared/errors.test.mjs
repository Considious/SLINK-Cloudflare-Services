import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL("./errors.js",import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(source,ctx);
const E=ctx.SLINK_ERRORS;
const cases=[
 ['Quota exceeded','SLINK_RESOURCE_LIMIT'],
 ['Resource::kQuotaBytes quota exceeded','SLINK_STORAGE_FULL'],
 [Object.assign(new Error('The quota has been exceeded.'),{name:'QuotaExceededError'}),'SLINK_STORAGE_FULL'],
 ['QUOTA_BYTES quota exceeded','SLINK_STORAGE_FULL'],
 ['D1 database daily query limit reached','SLINK_SERVER_DAILY_LIMIT'],
 ['R2 daily quota exceeded','SLINK_SERVER_DAILY_LIMIT'],
 ['D1_ERROR: no such table: grants','SLINK_SERVER_SETUP'],
 ['SQLITE_ERROR: no such column: scope','SLINK_SERVER_SETUP'],
 ['No HTTP origin is configured for muggingWorker.','SLINK_SERVICE_CONFIG'],
 ['Weaver daily request limit reached','SLINK_API_DAILY_LIMIT'],
 [{message:'Capacity exhausted',code:'SLINK_TORN_API_LIMIT'},'SLINK_API_MINUTE_LIMIT'],
 ['Weaver per-minute request budget capped','SLINK_API_MINUTE_LIMIT'],
 [{message:'Too many requests',status:429,provider:'weaver'},'SLINK_API_LIMIT'],
 ['Weaver request budget is reserved for a later watch.','SLINK_CHECK_DEFERRED'],
 ['Accept the current terms','SLINK_TERMS_NOT_VERIFIED'],
 ['Session expired','SLINK_SESSION_EXPIRED'],
 ['API not Validated','SLINK_KEY_NOT_VERIFIED'],
 [{message:'permission has not been granted',code:'SLINK_BROWSER_PERMISSION_REQUIRED'},'SLINK_BROWSER_PERMISSION'],
 ['Invalid API key','SLINK_KEY_REJECTED'],
 [{message:'Unauthorized',status:401,provider:'contributionWorker'},'SLINK_ACCESS_DENIED'],
 ['Requires slink.officer.armory scope','SLINK_ACCESS_DENIED'],
 ['incorrect category','SLINK_API_REQUEST_UNSUPPORTED'],
 ['Runtime did not signal readiness within 20 seconds','SLINK_RUNTIME_LOAD'],
 ['fetchruntime','SLINK_RUNTIME_LOAD'],
 ['marketRuntime().catalogItems is not a function','SLINK_COMPONENT_MISMATCH'],
 ["Cannot read properties of undefined (reading 'local')",'SLINK_COMPONENT_MISMATCH'],
 ['Extension context invalidated.','SLINK_EXTENSION_RELOAD'],
 [{message:'HTTP 502',status:502,provider:'ffscouter'},'SLINK_SERVICE_UNAVAILABLE'],
 ['Request timed out','SLINK_REQUEST_TIMEOUT'],
 ['ClientException with SocketConnection refused','SLINK_CONNECTION_FAILED'],
 ['Failed to fetch','SLINK_CONNECTION_FAILED'],
 ['Failed to fetch: blocked by CORS','SLINK_BROWSER_BLOCKED'],
 ['Unexpected token < in JSON','SLINK_INVALID_RESPONSE'],
 ['NotAllowedError: play() failed','SLINK_SOUND_BLOCKED'],
 [{message:'HTTP 404',status:404},'SLINK_ENDPOINT_NOT_FOUND'],
 ['Unknown error','SLINK_UNKNOWN']
];
for(const [input,id]of cases){
 const snapshot=JSON.stringify(input);const d=E.describe(input);
 assert.equal(d.id,id,E.raw(input));assert(d.message.includes('['+id+']'));
 assert.equal(E.message(d.message),d.message,'Messages must not repeatedly wrap themselves');
 assert.equal(JSON.stringify(input),snapshot,'Formatting must not mutate the original error');
}
assert.match(E.message('Resource::kQuotaBytes quota exceeded'),/not an API limit/);
assert.match(E.message({message:'HTTP 429',status:429}),/did not identify/);
assert.doesNotMatch(E.message({message:'Unauthorized',status:401,provider:'contributionWorker'}),/rejected the saved API key/);
assert.match(E.message({message:'HTTP 503',status:503,provider:'ffscouter'}),/FFScouter/);
assert.match(E.message({message:'HTTP 429',status:429,retryAfterMs:61000}),/61 seconds/);
const raw='Request key=secret123 https://api.example/a?key=secret123&token=session123 Authorization: Bearer secret123';
const clean=E.redact(raw);assert(!clean.includes('secret123'));assert(!clean.includes('session123'));
const success={ok:true,data:[1,2],token:'keep-success-token'};
assert.equal(E.response(success,200),success,'Never alter successful bodies');
const failed={ok:false,error:{code:5,error:'Too many requests'},retry_after:60};
const decorated=E.response(failed,429,{provider:'Torn'});
assert.equal(decorated.error.code,5);assert.equal(decorated.retry_after,60);assert.equal(failed.error.error,'Too many requests');
assert.equal(decorated.error_code,'SLINK_API_LIMIT');assert.match(decorated.user_message,/Torn/);
const annotated=E.annotateBody(failed,{provider:'tornApi'});
assert.equal(annotated.error.code,5);assert.equal(annotated.error.error,'Too many requests');assert.match(annotated.error.message,/Torn/);
const errorSecret=E.response({ok:false,error:'Connection failed ?key=secret123'},500);
assert(!JSON.stringify(errorSecret).includes('secret123'));
assert.equal(E.message('Enter a whole number between 1 and 100.'),'Enter a whole number between 1 and 100.');
console.log(cases.length+' error cases passed; redaction, idempotence, provider/retry context and protocol preservation passed.');
