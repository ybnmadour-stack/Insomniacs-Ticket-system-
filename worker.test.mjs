import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './worker.mjs';
const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./migrations/0001.sql',import.meta.url),'utf8'));
function prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return sqlite.prepare(sql).get(...values)||null;},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){return sqlite.prepare(sql).run(...values);}};}
const env={DB:{prepare,async batch(stmts){sqlite.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}},ADMIN_PASSWORD:'test-admin-password',STAFF_PASSWORD:'test-staff-password',ASSETS:{fetch:()=>new Response('asset')}};
async function call(path,body,cookie){return worker.fetch(new Request('https://party.test/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:'https://party.test'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined}),env);}
async function login(role){const r=await call('login',{role,password:env[role==='admin'?'ADMIN_PASSWORD':'STAFF_PASSWORD']});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
test('cloud routes enforce roles, persist sessions and redeem exactly once',async()=>{
 assert.equal((await call('tickets')).status,401);const admin=await login('admin'),staff=await login('staff');assert.equal((await call('tickets',undefined,staff)).status,403);
 const created=await (await call('tickets',{name:'Cloud guest',phone:'private',paid:true},admin)).json();assert.match(created.id,/^[a-f0-9]{48}$/);
 const pub=await (await call('ticket/'+created.id)).json();assert.equal(pub.ticket.phone,undefined);
 const responses=await Promise.all(Array.from({length:10},()=>call('checkin',{id:created.id},staff)));assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,9);
 const unpaid=await (await call('tickets',{name:'Unpaid',paid:false},admin)).json();assert.equal((await call('checkin',{id:unpaid.id},staff)).status,409);
 const cancelled=await (await call('tickets',{name:'Cancelled',paid:true},admin)).json();await call('update',{id:cancelled.id,field:'cancelled',value:true},admin);assert.equal((await call('checkin',{id:cancelled.id},staff)).status,409);
 await call('config',{capacity:2},admin);assert.equal((await call('tickets',{name:'Over capacity'},admin)).status,409);
 await call('logout',{},staff);assert.equal((await call('checkin',{id:created.id},staff)).status,401);
});
test('public setup disabled, cross-site writes rejected and login throttled',async()=>{
 assert.equal((await call('setup',{})).status,403);
 assert.equal((await worker.fetch(new Request('https://party.test/api/login',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'}),env)).status,403);
 for(let i=0;i<10;i++)assert.equal((await call('login',{role:'admin',password:'wrong'})).status,401);
 assert.equal((await call('login',{role:'admin',password:'wrong'})).status,429);
});
after(()=>sqlite.close());
