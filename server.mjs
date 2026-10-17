import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { collect, probe, readData, saveData } from './lib/collector.mjs';
const port = Number(process.env.PORT || 3210), host = process.env.HOST || '127.0.0.1';
let catalog = await readData('catalog', { items: [], sources: [], updatedAt: null });
let probes = await readData('probes', { targets: [] });
let visits = await readData('visits', { daily: {}, total: 0 });
const sessions = new Map(), rate = new Map();
let collecting = false, probing = false, saving = false;
async function refresh() { if (collecting) return; collecting = true; try { catalog = await collect(); } catch(e) { console.error('Collection:', e.message); } finally { collecting = false; } }
async function refreshProbes() { if(probing) return; probing = true; try { probes = await probe(); } catch(e) { console.error('Probe:', e.message); } finally { probing = false; } }
const cleanup = () => { const now = Date.now(); for (const [id, s] of sessions) if (now-s.last > 90000) sessions.delete(id); for (const [ip, r] of rate) if(now-r.start>60000) rate.delete(ip); };
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const staticFiles = new Map([['/', 'index.html'], ['/explore', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css'], ['/favicon.svg', 'favicon.svg']]);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res,200,{ok:true,entries:catalog.items.length,updatedAt:catalog.updatedAt,collecting});
    if (url.pathname === '/api/catalog' && req.method==='GET') return json(res,200,catalog);
    if (url.pathname === '/api/probes' && req.method==='GET') return json(res,200,probes);
    if (url.pathname === '/api/presence') {
      cleanup();
      if(req.method === 'POST') {
        if(req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return json(res,403,{error:'Origin rejected'});
        // Trust only a loopback reverse proxy. Nginx must overwrite this header.
        const peer=req.socket.remoteAddress; const ip=(peer==='127.0.0.1'||peer==='::1'||peer==='::ffff:127.0.0.1') ? req.headers['x-real-ip'] || peer : peer;
        const bucket=rate.get(ip)||{start:Date.now(),count:0}; bucket.count++; rate.set(ip,bucket);
        if(bucket.count>100) return json(res,429,{error:'Too many requests'});
        let body=''; for await(const chunk of req){body+=chunk;if(body.length>256)return json(res,413,{error:'Body too large'});}
        let id; try{id=JSON.parse(body).id;}catch{return json(res,400,{error:'Invalid JSON'});}
        if(typeof id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(id)) return json(res,400,{error:'Invalid visitor ID'});
        const key=createHash('sha256').update(`${ip}:${id}`).digest('hex');
        const day=new Date().toISOString().slice(0,10);
        const daily=visits.daily[day] ||= { visitors:[], views:0 };
        if(!daily.visitors.includes(key)){daily.visitors.push(key);daily.views++;visits.total++;}
        sessions.set(key,{last:Date.now()});
        for(const d of Object.keys(visits.daily)) if(d<new Date(Date.now()-30*86400000).toISOString().slice(0,10)) delete visits.daily[d];
      } else if(req.method!=='GET') return json(res,405,{error:'Method not allowed'});
      return json(res,200,{ online:sessions.size, today:visits.daily[new Date().toISOString().slice(0,10)]?.views||0, total:visits.total, windowSeconds:90 });
    }
    if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Method not allowed'});
    const file=staticFiles.get(url.pathname); if(!file) return json(res,404,{error:'Not found'});
    const content=await readFile(resolve('public',file));
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(file)],'Cache-Control':'no-cache'}); res.end(req.method==='HEAD'?undefined:content);
  } catch(e) { console.error(e.message); if(!res.headersSent) json(res,500,{error:'Internal error'}); else res.end(); }
});
server.listen(port,host,()=>console.log(`Skill Atlas: http://${host}:${port}`));
const refreshTimer=setInterval(refresh,Number(process.env.REFRESH_HOURS||6)*3600000);
const probeTimer=setInterval(refreshProbes,300000);
const persistTimer=setInterval(async()=>{cleanup();if(saving)return;saving=true;try{await saveData('visits',visits);}catch(e){console.error(e.message);}finally{saving=false;}},Number(process.env.PERSIST_INTERVAL_MS||15000));
if(process.env.DISABLE_JOBS !== '1') {
  if(!catalog.updatedAt || Date.now()-Date.parse(catalog.updatedAt)>6*3600000) refresh();
  refreshProbes();
}
for(const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>{clearInterval(refreshTimer);clearInterval(probeTimer);clearInterval(persistTimer);server.close(async()=>{await saveData('visits',visits);process.exit(0);});});
