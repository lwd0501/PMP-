// 仅用于本机QA。平台身份在此被测试账号替代，此文件不打入生产Worker。
import http from 'node:http';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {handleApi} from '../server/api.mjs';
const db=new DatabaseSync(':memory:');db.exec(await fs.readFile(new URL('../drizzle/0000_sticky_masque.sql',import.meta.url),'utf8'));
const DB={prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:47831');
    if(url.pathname.startsWith('/api/')){
      const headers=new Headers(req.headers),qa=(req.headers.cookie||'').match(/(?:^|;\s*)qa_user=([a-z0-9-]+)/)?.[1]||'qa-a';
      headers.set('oai-authenticated-user-id',qa);headers.set('oai-authenticated-user-email',qa+'@example.test');
      const body=['GET','HEAD'].includes(req.method)?undefined:await new Response((await import('node:stream')).Readable.toWeb(req)).text();
      const response=await handleApi(new Request(url,{method:req.method,headers,body}),{DB});
      res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(relative.includes('..')||!/^[-a-zA-Z0-9_.]+$/.test(relative)){res.writeHead(404);return res.end();}
    const content=await fs.readFile(new URL('../dist/'+relative,import.meta.url));res.writeHead(200,{'content-type':relative.endsWith('.js')?'text/javascript; charset=utf-8':relative.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(47831,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:47831/'));
