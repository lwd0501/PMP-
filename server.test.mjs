import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleApi} from './server/api.mjs';
import {emptyState} from './dist/learning.js';
class D1{
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(fs.readFileSync('drizzle/0000_sticky_masque.sql','utf8'));}
  prepare(sql){const db=this.db;let args=[];return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}
}
const request=(path,{user='alice',method='GET',body,origin='https://example.test'}={})=>new Request('https://example.test'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}),...(body?{'content-type':'application/json',origin}:{})},body:body?JSON.stringify(body):undefined});
test('未登录拒绝读写，身份由平台头提供',async()=>{const env={DB:new D1()};assert.equal((await handleApi(request('/api/state',{user:null}),env)).status,401);const me=await (await handleApi(request('/api/me'),env)).json();assert.equal(me.id,'alice');});
test('实际SQLite验证账号隔离与首次保存',async()=>{const env={DB:new D1()},data=emptyState();data.notes.q={text:'alice note',at:1};const put=await handleApi(request('/api/state',{method:'PUT',body:{baseRevision:0,data}}),env);assert.equal(put.status,200);assert.equal((await put.json()).revision,1);const alice=await (await handleApi(request('/api/state'),env)).json();assert.equal(alice.data.notes.q.text,'alice note');const bob=await (await handleApi(request('/api/state',{user:'bob'}),env)).json();assert.equal(bob.revision,0);assert.equal(bob.data,null);});
test('旧版本写入返回409及当前账号数据，不静默覆盖',async()=>{const env={DB:new D1()},data=emptyState();await handleApi(request('/api/state',{method:'PUT',body:{baseRevision:0,data}}),env);const stale=await handleApi(request('/api/state',{method:'PUT',body:{baseRevision:0,data}}),env);assert.equal(stale.status,409);assert.equal((await stale.json()).revision,1);const next=await handleApi(request('/api/state',{method:'PUT',body:{baseRevision:1,data}}),env);assert.equal((await next.json()).revision,2);});
test('两台设备同版本并发写只有一个成功，另一个必须合并重试',async()=>{const env={DB:new D1()},data=emptyState();const responses=await Promise.all([handleApi(request('/api/state',{method:'PUT',body:{baseRevision:0,data}}),env),handleApi(request('/api/state',{method:'PUT',body:{baseRevision:0,data}}),env)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);});
test('跨站写入、错误结构及过大请求被拒绝',async()=>{const env={DB:new D1()};assert.equal((await handleApi(request('/api/state',{method:'PUT',origin:'https://other.test',body:{baseRevision:0,data:emptyState()}}),env)).status,403);assert.equal((await handleApi(request('/api/state',{method:'PUT',body:{baseRevision:0,data:{version:9}}}),env)).status,400);const tooBig=request('/api/state',{method:'PUT',body:{x:'x'.repeat(4*1024*1024+1)}});assert.equal((await handleApi(tooBig,env)).status,413);});
test('健康检查确认迁移已应用，不读取任何用户记录',async()=>{assert.deepEqual(await (await handleApi(request('/api/health',{user:null}),{DB:new D1()})).json(),{ready:true});assert.equal((await handleApi(request('/api/health'),{})).status,503);});
