import {validateState} from '../dist/learning.js';
import {validateBank} from '../dist/core.js';
const MAX=4*1024*1024;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','vary':'Cookie'}});
export async function handleApi(request,env){
  const url=new URL(request.url),id=request.headers.get('oai-authenticated-user-id');
  if(url.pathname==='/api/health'){
    if(!env.DB)return json({ready:false,reason:'storage_unavailable'},503);
    try{await env.DB.prepare('SELECT revision FROM learning_state LIMIT 1').first();return json({ready:true});}catch{return json({ready:false,reason:'schema_unavailable'},503);}
  }
  if(!id)return json({error:'authentication_required'},401);
  if(url.pathname==='/api/me')return request.method==='GET'?json({id,email:request.headers.get('oai-authenticated-user-email')||''}):json({error:'method_not_allowed'},405);
  if(url.pathname!=='/api/state')return json({error:'not_found'},404);
  if(!env.DB)return json({error:'storage_unavailable'},503);
  async function read(){const row=await env.DB.prepare('SELECT revision, body, updated_at FROM learning_state WHERE user_id = ?').bind(id).first();return row?{revision:row.revision,data:JSON.parse(row.body),updatedAt:row.updated_at}:{revision:0,data:null,updatedAt:null};}
  try{
    if(request.method==='GET')return json(await read());
    if(request.method!=='PUT')return json({error:'method_not_allowed'},405);
    const origin=request.headers.get('origin');
    if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'origin_not_allowed'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'json_required'},415);
    if(Number(request.headers.get('content-length')||0)>MAX)return json({error:'backup_too_large'},413);
    const reader=request.body?.getReader();if(!reader)return json({error:'empty_body'},400);
    const decoder=new TextDecoder(),parts=[];let bytes=0;
    for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX){await reader.cancel();return json({error:'backup_too_large'},413);}parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());
    let body;try{body=JSON.parse(parts.join(''));}catch{return json({error:'invalid_json'},400);}
    if(!Number.isSafeInteger(body.baseRevision)||body.baseRevision<0)return json({error:'invalid_revision'},400);
    try{validateState(body.data,validateBank);}catch(e){return json({error:'invalid_state',message:e.message},400);}
    const encoded=JSON.stringify(body.data),now=Date.now();let change;
    if(body.baseRevision===0)change=await env.DB.prepare('INSERT OR IGNORE INTO learning_state (user_id, revision, body, updated_at) VALUES (?, 1, ?, ?)').bind(id,encoded,now).run();
    else change=await env.DB.prepare('UPDATE learning_state SET revision = revision + 1, body = ?, updated_at = ? WHERE user_id = ? AND revision = ?').bind(encoded,now,id,body.baseRevision).run();
    if(!change.meta?.changes)return json({error:'revision_conflict',...await read()},409);
    return json({revision:body.baseRevision+1,updatedAt:now});
  }catch{return json({error:'storage_error'},503);}
}
