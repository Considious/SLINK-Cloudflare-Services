import {readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {install,CENTRAL} from './setup-lib.mjs';

const root=fileURLToPath(new URL('.',import.meta.url)),require=createRequire(import.meta.url);
let hidden=false;const display=new Writable({write(chunk,encoding,done){if(!hidden)process.stdout.write(chunk,encoding);done();}});
const rl=createInterface({input:process.stdin,output:display,terminal:Boolean(process.stdin.isTTY)});
async function ask(question,secret=false){if(!secret)return rl.question(question);process.stdout.write(question);hidden=true;try{return await rl.question('');}finally{hidden=false;process.stdout.write('\n');}}
async function privateFile(name,value){const path=new URL(name,import.meta.url),temporary=new URL(name+'.tmp',import.meta.url);await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temporary,path);await chmod(path,0o600);}
async function read(){try{return JSON.parse(await readFile(new URL('node-config.json',import.meta.url),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new Error('Cannot read node-config.json. Do not delete it: restore your private configuration backup.');}}
async function wrangler(args,input){const script=require.resolve('wrangler/bin/wrangler.js');return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,...args],{cwd:root,shell:false,windowsHide:true,stdio:[input?'pipe':'inherit','inherit','inherit']});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Cloudflare setup did not complete. Review its message above; your saved node identity has been kept.')));if(input)child.stdin.end(input);});}
async function request(url,payload){const response=await fetch(url,{method:payload?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});const raw=await response.text();if(raw.length>20000)throw new Error('The setup service returned an oversized response.');let data;try{data=JSON.parse(raw);}catch{throw new Error(`The setup service did not return JSON (HTTP ${response.status}). Check the endpoint and retry.`);}if(!response.ok)throw new Error(typeof data.error==='string'?data.error.slice(0,500):`The setup service rejected this request (HTTP ${response.status}).`);return data;}
async function readConfig(){try{return JSON.parse(await readFile(new URL('wrangler.local.json',import.meta.url),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw new Error('Cannot read wrangler.local.json. Keep it and correct the JSON before retrying.');}}
try{await install({ask,read,readConfig,save:value=>privateFile('node-config.json',value),writeConfig:value=>privateFile('wrangler.local.json',value),wrangler,request,output:message=>console.log(message),central:process.env.SLINK_CENTRAL_URL||CENTRAL,upgrade:process.argv.includes('--upgrade')});}catch(e){console.error('Setup stopped:',e.message);process.exitCode=1;}finally{rl.close();}
