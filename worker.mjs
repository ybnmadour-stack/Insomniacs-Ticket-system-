const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function equal(a,b){const x=await digest(a),y=await digest(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
export default {async fetch(request,env){
 const url=new URL(request.url),path=url.pathname,db=env.DB;
 const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(!db)return json({error:'Database is not connected'},503);
 const config=async()=>JSON.parse((await db.prepare('SELECT data FROM config WHERE id=1').first())?.data||'{"date":"","venue":"","price":"","capacity":0}');
 try{
 let body={};if(request.method==='POST'){
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Origin rejected'},403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 const reader=request.body?.getReader();let total=0,raw='';const decoder=new TextDecoder();if(reader)while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>16000){await reader.cancel();return json({error:'Request too large'},413);}raw+=decoder.decode(value,{stream:true});}try{body=JSON.parse(raw||'{}');}catch{return json({error:'Invalid JSON'},400);}}
 const cookie=request.headers.get('Cookie')?.match(/(?:^|; )session=([a-f0-9]+)/)?.[1];
 const session=cookie?await db.prepare('SELECT role FROM sessions WHERE id=? AND expires>?').bind(await hexDigest(cookie),Date.now()).first():null;
 const role=session?.role;
 if(path==='/api/status')return json({role:role||null,setup:false,config:await config(),hostingReady:!!env.ADMIN_PASSWORD&&!!env.STAFF_PASSWORD});
 if(path==='/api/setup')return json({error:'Set organiser and staff passwords in Cloudflare Worker Secrets'},403);
 if(path==='/api/login'&&request.method==='POST'){
 if(!env.ADMIN_PASSWORD||!env.STAFF_PASSWORD)return json({error:'The organiser must configure hosting passwords before sign-in'},503);
 const ip=request.headers.get('CF-Connecting-IP')||'local',ipKey=await hexDigest(ip);const now=Date.now();
 const a=await db.prepare('INSERT INTO attempts(ip,n,time) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET n=CASE WHEN attempts.time<? THEN 1 ELSE attempts.n+1 END,time=CASE WHEN attempts.time<? THEN excluded.time ELSE attempts.time END RETURNING n').bind(ipKey,now,now-900000,now-900000).first();
 if(a.n>10)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
 const secret=body.role==='admin'?env.ADMIN_PASSWORD:body.role==='staff'?env.STAFF_PASSWORD:null;
 if(!secret||typeof body.password!=='string'||!await equal(body.password,secret))return json({error:'Incorrect password'},401);
 const id=random();await db.batch([db.prepare('DELETE FROM attempts WHERE ip=? OR time<?').bind(ipKey,now-900000),db.prepare('DELETE FROM sessions WHERE expires<?').bind(now),db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hexDigest(id),body.role,now+43200000)]);
 return json({ok:true},200,{'Set-Cookie':`session=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`});}
 if(path==='/api/logout'&&request.method==='POST'){if(cookie)await db.prepare('DELETE FROM sessions WHERE id=?').bind(await hexDigest(cookie)).run();return json({ok:true},200,{'Set-Cookie':'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});}
 if(path.startsWith('/api/ticket/')&&request.method==='GET'){const t=await db.prepare('SELECT id,name,paid,used,cancelled FROM tickets WHERE id=?').bind(path.split('/').pop()).first();return t?json({ticket:t,config:await config()}):json({error:'Ticket not found'},404);}
 if(!role)return json({error:'Please sign in'},401);
 if(path==='/api/checkin'&&request.method==='POST'){
 const id=String(body.id||'');const t=await db.prepare('UPDATE tickets SET used=? WHERE id=? AND paid=1 AND cancelled=0 AND used IS NULL RETURNING name,used').bind(new Date().toISOString(),id).first();if(t)return json({ok:true,...t});
 const old=await db.prepare('SELECT name,paid,used,cancelled FROM tickets WHERE id=?').bind(id).first();return json({ok:false,error:!old?'Invalid ticket':old.cancelled?'Ticket cancelled':!old.paid?'Payment not confirmed':'Already used',name:old?.name,used:old?.used},409);}
 if(role!=='admin')return json({error:'Organiser access required'},403);
 if(path==='/api/tickets'&&request.method==='GET')return json((await db.prepare('SELECT * FROM tickets ORDER BY created DESC').all()).results);
 if(path==='/api/tickets'&&request.method==='POST'){
 const name=String(body.name||'').trim();if(!name||name.length>100)return json({error:'Enter a guest name (up to 100 characters)'},400);const id=random();
 const result=await db.prepare(`INSERT INTO tickets(id,name,phone,paid,created) SELECT ?,?,?,?,? WHERE COALESCE((SELECT json_extract(data,'$.capacity') FROM config WHERE id=1),0)=0 OR (SELECT COUNT(*) FROM tickets WHERE cancelled=0)<(SELECT json_extract(data,'$.capacity') FROM config WHERE id=1) RETURNING id`).bind(id,name,String(body.phone||'').slice(0,30),body.paid?1:0,new Date().toISOString()).first();return result?json(result):json({error:'Guest capacity reached'},409);}
 if(path==='/api/update'&&request.method==='POST'){if(!['paid','cancelled'].includes(body.field))return json({error:'Invalid field'},400);await db.prepare(`UPDATE tickets SET ${body.field}=? WHERE id=?`).bind(body.value?1:0,String(body.id)).run();return json({ok:true});}
 if(path==='/api/config'&&request.method==='POST'){const capacity=Number(body.capacity);if(!Number.isInteger(capacity)||capacity<0)return json({error:'Capacity must be a positive whole number or zero'},400);const c={date:String(body.date||'').slice(0,100),venue:String(body.venue||'').slice(0,200),price:String(body.price||'').slice(0,50),capacity};await db.prepare('INSERT OR REPLACE INTO config VALUES(1,?)').bind(JSON.stringify(c)).run();return json({ok:true});}
 return json({error:'Not found'},404);
 }catch(error){console.error('API failure',error.message);return json({error:'Unable to complete request. Please try again.'},500);}
}};
async function hexDigest(s){return Array.from(await digest(s),b=>b.toString(16).padStart(2,'0')).join('');}
