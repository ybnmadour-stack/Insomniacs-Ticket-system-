import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
mkdirSync(process.env.DATA_DIR||join(root,'data'),{recursive:true});
const db=new DatabaseSync(join(process.env.DATA_DIR||join(root,'data'),'party.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS config(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT); CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT,paid INTEGER NOT NULL,created TEXT NOT NULL,used TEXT,cancelled INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS users(role TEXT PRIMARY KEY,salt TEXT,hash TEXT);`);
const sessions=new Map(), attempts=new Map();
const token=()=>randomBytes(24).toString('hex');
function password(role,pw){const salt=token(); db.prepare('INSERT OR REPLACE INTO users VALUES(?,?,?)').run(role,salt,scryptSync(pw,salt,64).toString('hex'));}
function check(role,pw){const u=db.prepare('SELECT * FROM users WHERE role=?').get(role);return u&&timingSafeEqual(Buffer.from(u.hash,'hex'),scryptSync(pw,u.salt,64));}
const config=()=>JSON.parse(db.prepare('SELECT data FROM config WHERE id=1').get()?.data||'{"date":"","venue":"","price":"","capacity":0}');
export function redeem(id){return db.prepare("UPDATE tickets SET used=? WHERE id=? AND paid=1 AND cancelled=0 AND used IS NULL RETURNING name,used").get(new Date().toISOString(),id);}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
 const sid=req.headers.cookie?.match(/(?:^|; )session=([a-f0-9]+)/)?.[1]; const session=sessions.get(sid); const role=session&&session.expires>Date.now()?session.role:null;
 let body={};if(req.method==='POST'){if(req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`)return json({error:'Origin rejected'},403);let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)return json({error:'Request too large'},413);}body=JSON.parse(raw||'{}');}
 if(url.pathname==='/api/status')return json({role,setup:!db.prepare('SELECT 1 FROM users LIMIT 1').get(),config:config()});
 if(url.pathname==='/api/setup'&&req.method==='POST'){
 if(db.prepare('SELECT 1 FROM users LIMIT 1').get())return json({error:'Already configured'},409);
 const remote=req.socket.remoteAddress;if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return json({error:'Complete setup on the host computer first'},403);
 if(typeof body.admin!=='string'||typeof body.staff!=='string'||body.admin.length<12||body.staff.length<12||body.admin===body.staff)return json({error:'Use two different passwords, at least 12 characters each'},400);
 db.exec('BEGIN IMMEDIATE');try{password('admin',body.admin);password('staff',body.staff);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return json({ok:true});}
 if(url.pathname==='/api/login'&&req.method==='POST'){
 const ip=req.socket.remoteAddress; const a=attempts.get(ip)||{n:0,time:Date.now()};if(Date.now()-a.time>900000){a.n=0;a.time=Date.now();}if(a.n>=10)return json({error:'Too many attempts. Try again in 15 minutes.'},429);a.n++;attempts.set(ip,a);
 if(!['admin','staff'].includes(body.role)||typeof body.password!=='string'||!check(body.role,body.password))return json({error:'Incorrect password'},401);
 attempts.delete(ip);const id=token();sessions.set(id,{role:body.role,expires:Date.now()+12*3600000});res.setHeader('Set-Cookie',`session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);return json({ok:true});}
 if(url.pathname==='/api/logout'&&req.method==='POST'){sessions.delete(sid);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json({ok:true});}
 if(url.pathname.startsWith('/api/ticket/')){const t=db.prepare('SELECT id,name,paid,used,cancelled FROM tickets WHERE id=?').get(url.pathname.split('/').pop());return t?json({ticket:t,config:config()}):json({error:'Ticket not found'},404);}
 if(url.pathname.startsWith('/api/')){
 if(!role)return json({error:'Please sign in'},401);
 if(url.pathname==='/api/checkin'&&req.method==='POST'){
 const t=redeem(String(body.id));if(t)return json({ok:true,...t});const old=db.prepare('SELECT name,paid,used,cancelled FROM tickets WHERE id=?').get(String(body.id));return json({ok:false,error:!old?'Invalid ticket':old.cancelled?'Ticket cancelled':!old.paid?'Payment not confirmed':'Already used',name:old?.name,used:old?.used},409);}
 if(role!=='admin')return json({error:'Organiser access required'},403);
 if(url.pathname==='/api/tickets'&&req.method==='GET')return json(db.prepare('SELECT * FROM tickets ORDER BY created DESC').all());
 if(url.pathname==='/api/tickets'&&req.method==='POST'){
 const name=String(body.name||'').trim();if(!name||name.length>100)return json({error:'Enter a guest name (up to 100 characters)'},400);
 const c=config();if(c.capacity&&db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE cancelled=0').get().n>=c.capacity)return json({error:'Guest capacity reached'},409);
 const id=token();db.prepare('INSERT INTO tickets(id,name,phone,paid,created) VALUES(?,?,?,?,?)').run(id,name,String(body.phone||'').slice(0,30),body.paid?1:0,new Date().toISOString());return json({id});}
 if(url.pathname==='/api/update'&&req.method==='POST'){if(!['paid','cancelled'].includes(body.field))return json({error:'Invalid field'},400);db.prepare(`UPDATE tickets SET ${body.field}=? WHERE id=?`).run(body.value?1:0,String(body.id));return json({ok:true});}
 if(url.pathname==='/api/config'&&req.method==='POST'){const capacity=Number(body.capacity);if(!Number.isInteger(capacity)||capacity<0)return json({error:'Capacity must be a positive whole number or zero'},400);const c={date:String(body.date||'').slice(0,100),venue:String(body.venue||'').slice(0,200),price:String(body.price||'').slice(0,50),capacity};db.prepare('INSERT OR REPLACE INTO config VALUES(1,?)').run(JSON.stringify(c));return json({ok:true});}
 return json({error:'Not found'},404);}
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/poster.png':'poster.png','/qr.js':'qr.js','/jsqr.js':'jsqr.js'};const file=files[url.pathname];if(!file){res.writeHead(404);return res.end('Not found');}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.end(readFileSync(join(root,'public',file)));
 }catch(e){console.error(e.message);json({error:'Unable to complete request'},500);}
});
if(process.env.NODE_ENV!=='test')server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Bottles Up: http://localhost:'+(process.env.PORT||3000)));
export {server,db};
