import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// Real SQLite plus injected clock/network/storage failures. This does not claim
// to emulate Cloudflare eviction; the separate workerd tests cover its runtime.
let clock=1800000000000;
globalThis.__slinkFaultClock=()=>clock;
globalThis.__slinkFaultFetch=async()=>Response.json({ok:false},{status:503});
const classes=new Map();
export async function loadClass(file,name){
 if(!classes.has(file))classes.set(file,(async()=>{
  const result=await build({entryPoints:[fileURLToPath(new URL('../'+file,import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',define:{'Date.now':'globalThis.__slinkFaultClock',fetch:'globalThis.__slinkFaultFetch'},plugins:[{name:'local-durable-object-base',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'base',namespace:'local-test'}));b.onLoad({filter:/.*/,namespace:'local-test'},()=>({contents:'export class DurableObject { constructor(ctx,env) {} }'}));}}]});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 })());
 return (await classes.get(file))[name];
}
export function harness(t){
 clock=1800000000000;globalThis.__slinkFaultFetch=async()=>Response.json({ok:false},{status:503});
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE _kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)');let alarm=null,queue=Promise.resolve(),putFault=null,syncFailures=0;
 const sockets=[],tasks=[],configured=new Map();
 const sql={exec(query,...params){const statement=db.prepare(query);if(statement.columns().length)return statement.all(...params);statement.run(...params);return [];}};
 const storage={sql,async get(key){const row=db.prepare('SELECT value FROM _kv WHERE key=?').get(key);return row?JSON.parse(row.value):undefined;},async put(key,value){const fault=putFault;putFault=null;if(fault==='before')throw Error('Injected storage failure');db.prepare('INSERT INTO _kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));if(fault==='after')throw Error('Injected lost acknowledgement');},async getAlarm(){return alarm;},async setAlarm(value){alarm=value;},async deleteAlarm(){alarm=null;},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const ctx={storage,getWebSockets:()=>sockets.filter(s=>!s.closed),waitUntil(promise){tasks.push(promise);},blockConcurrencyWhile(fn){const next=queue.then(fn);queue=next.catch(()=>{});return next;}};
 const env={SLINK_NODE_ID:'node-a',SLINK_FACTION_ID:'10',RETENTION_DAYS:'1',MAX_ROOM_MESSAGES:'100',ROOMS:{idFromName:id=>id,get:id=>({async configure(config){if(syncFailures>0){syncFailures--;throw Error('Injected room propagation failure');}configured.set(id,structuredClone(config));}})}};
 function socket(uid=2){let attachment={user_id:uid,user_name:'User '+uid,faction_id:10,exp:Math.floor(clock/1000)+86400};const ws={sent:[],closed:false,deserializeAttachment:()=>structuredClone(attachment),serializeAttachment:value=>{attachment=structuredClone(value);},send:raw=>ws.sent.push(JSON.parse(raw)),close(code){ws.closed=true;ws.code=code;}};sockets.push(ws);return ws;}
 t.after(async()=>{await Promise.allSettled(tasks);db.close();});
 return {db,ctx,env,sql,socket,configured,get now(){return clock;},set now(value){clock=value;},get alarm(){return alarm;},set putFault(value){putFault=value;},set syncFailures(value){syncFailures=value;},set fetch(value){globalThis.__slinkFaultFetch=value;},async settle(){await Promise.allSettled(tasks);}};
}
export const config={room_id:'general',name:'General',faction_id:10,visibility:'faction',leaders:[1],members:[],links:[],revision:1,archived:false};
export const certificate={node_id:'node-a',faction_id:10,leader_id:1};
export const leader={user_id:1,user_name:'Leader',faction_id:10};
