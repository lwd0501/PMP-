import {correct,shuffle} from './core.js';
export const DAY=86400000;
const forbidden=new Set(['__proto__','constructor','prototype']);
const safeKey=k=>typeof k==='string'&&k.length>0&&k.length<240&&!forbidden.has(k);
export const uid=()=>crypto.randomUUID();
export function emptyState(){return {version:2,events:{},legacyStats:{},favorites:{},notes:{},issues:{},sessions:{},history:{},snapshots:{},custom:{value:null,at:0}};}
export function snapshotKey(q){let hash=2166136261;for(const c of JSON.stringify([q.id,q.stem,q.options,q.answer,q.revision||1]))hash=Math.imul(hash^c.charCodeAt(0),16777619);return `${q.id}@${(hash>>>0).toString(16)}`;}
export function questionsOf(state,session){return session.questionKeys.map(k=>state.snapshots[k]).filter(Boolean);}
export function createSession(state,questions,{mode='practice',minutes=0,label='情境练习',randomOptions=true,now=Date.now()}={}){
  const id=uid(),keys=questions.map(q=>{const key=snapshotKey(q);state.snapshots[key]=structuredClone(q);return key;});
  const s={id,mode,label,questionKeys:keys,answers:{},answerAt:{},confidence:{},checked:[],flags:[],times:{},optionOrder:{},index:0,start:now,deadline:mode==='exam'?now+minutes*60000:null,updatedAt:now,finishedAt:null};
  for(const q of questions)s.optionOrder[q.id]=randomOptions?shuffle(q.options.map((_,i)=>i)):q.options.map((_,i)=>i);
  state.sessions[id]=s;return s;
}
export function recordAttempt(state,session,q,{now=Date.now(),confidence='sure',reason=''}={}){
  const answer=session.answers[q.id]||[];
  if(!answer.length||session.legacyChecked?.includes(q.id))return null;
  const id=`${session.id}:${q.id}`;
  if(state.events[id])return state.events[id];
  const event={id,sessionId:session.id,questionId:q.id,questionKey:snapshotKey(q),correct:correct(q,answer),confidence:confidence==='guess'?'guess':'sure',answer:[...answer],at:now,updatedAt:now,durationMs:Math.max(0,Math.round(session.times[q.id]||0)),domain:q.domain,taskId:q.taskId||'',topic:q.topic,approach:q.approach,reason};
  state.events[id]=event;
  if(!session.checked.includes(q.id))session.checked.push(q.id);
  session.updatedAt=now;return event;
}
export function questionStats(state,id,now=Date.now()){
  const legacy=state.legacyStats[id],events=Object.values(state.events).filter(e=>e.questionId===id).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  let attempts=legacy?.attempts||0,right=legacy?.right||0,pending=legacy?.lastCorrect===false,stage=0,due=pending?(legacy.lastAt||now)+DAY:null,lastCorrect=legacy?.lastCorrect,lastAt=legacy?.lastAt||0,lastReviewAt=0;
  for(const e of events){attempts++;right+=Number(e.correct);lastCorrect=e.correct;lastAt=e.at;
    if(!e.correct||e.confidence==='guess'){pending=true;stage=0;due=e.at+DAY;lastReviewAt=e.at;}
    else if(pending&&e.at>=due){stage++;lastReviewAt=e.at;if(stage>=3){pending=false;due=null;}else due=e.at+[1,3,7][stage]*DAY;}
  }
  const first=legacy?.attempts?null:events[0]||null;
  return {attempts,right,pending,stage,due,lastCorrect,lastAt,lastReviewAt,first,firstUnknown:!!legacy?.attempts,durationMs:events.reduce((s,e)=>s+e.durationMs,0),guessed:events.filter(e=>e.confidence==='guess').length};
}
export function reviewQueue(state,bank,{now=Date.now(),dueOnly=false}={}){return bank.filter(q=>{const s=questionStats(state,q.id,now);return s.pending&&(!dueOnly||s.due<=now);}).sort((a,b)=>(questionStats(state,a.id,now).due||0)-(questionStats(state,b.id,now).due||0));}
export function summarizeSession(state,s){
  const qs=questionsOf(state,s),answered=qs.filter(q=>s.answers[q.id]?.length),right=answered.filter(q=>correct(q,s.answers[q.id])).length;
  const denominator=s.mode==='exam'?qs.length:answered.length;
  const domains={};for(const q of qs){const d=domains[q.domain]??={right:0,answered:0,total:0};d.total++;if(s.answers[q.id]?.length){d.answered++;d.right+=Number(correct(q,s.answers[q.id]));}}
  return {id:s.id,label:s.label,mode:s.mode,at:s.finishedAt||Date.now(),total:qs.length,answered:answered.length,unanswered:qs.length-answered.length,right,wrong:answered.length-right,percent:denominator?Math.round(right/denominator*100):null,domains,seconds:Math.round(Object.values(s.times).reduce((a,b)=>a+b,0)/1000),wallSeconds:Math.max(0,Math.floor(((s.deadline?Math.min(s.finishedAt||Date.now(),s.deadline):s.finishedAt||Date.now())-s.start)/1000))};
}
export function finishSession(state,s,now=Date.now()){
  if(s.finishedAt)return state.history[s.id];
  for(const q of questionsOf(state,s))recordAttempt(state,s,q,{now,confidence:s.confidence[q.id]||'sure'});
  s.finishedAt=now;s.updatedAt=now;const summary=summarizeSession(state,s);state.history[s.id]=summary;return summary;
}
export function diagnostics(state,bank){
  const tasks=Object.create(null),domains=Object.create(null),reasons=Object.create(null);let firstRight=0,firstTotal=0,attempts=0,right=0,guessed=0,time=0,firstUnknown=0;
  for(const q of bank){const st=questionStats(state,q.id);attempts+=st.attempts;right+=st.right;guessed+=st.guessed;time+=st.durationMs;if(st.first){firstTotal++;firstRight+=Number(st.first.correct);}if(st.firstUnknown)firstUnknown++;
    for(const [map,key] of [[tasks,q.taskId||q.topic],[domains,q.domain]]){const d=map[key]??={key,questions:0,practiced:0,right:0,attempts:0,firstRight:0,firstTotal:0,pending:0,time:0};d.questions++;d.practiced+=Number(st.attempts>0);d.right+=st.right;d.attempts+=st.attempts;d.pending+=Number(st.pending);d.time+=st.durationMs;if(st.first){d.firstTotal++;d.firstRight+=Number(st.first.correct);}}
  }
  const ids=new Set(bank.map(q=>q.id));for(const e of Object.values(state.events))if(ids.has(e.questionId)&&!e.correct){const r=e.reason||'尚未标记';reasons[r]=(reasons[r]||0)+1;}
  return {tasks,domains,reasons,firstRight,firstTotal,firstUnknown,attempts,right,guessed,time,practiced:bank.filter(q=>questionStats(state,q.id).attempts).length};
}
function latest(a,b){if(!a)return structuredClone(b);if(!b)return structuredClone(a);const ta=a.updatedAt??a.at??0,tb=b.updatedAt??b.at??0;return structuredClone(tb>ta?b:tb<ta?a:JSON.stringify(a)>JSON.stringify(b)?a:b);}
export function mergeStates(a,b){
  if(!a)return structuredClone(b);if(!b)return structuredClone(a);
  const out=emptyState();
  for(const name of ['events','favorites','notes','issues','history']){for(const k of new Set([...Object.keys(a[name]||{}),...Object.keys(b[name]||{})]))if(safeKey(k))out[name][k]=latest(a[name]?.[k],b[name]?.[k]);}
  out.snapshots={...a.snapshots,...b.snapshots};out.custom=latest(a.custom,b.custom);
  for(const k of new Set([...Object.keys(a.legacyStats||{}),...Object.keys(b.legacyStats||{})])){
    if(!safeKey(k))continue;const x=a.legacyStats?.[k],y=b.legacyStats?.[k],v=latest(x&&{...x,at:x.lastAt||0},y&&{...y,at:y.lastAt||0});v.attempts=Math.max(x?.attempts||0,y?.attempts||0);v.right=Math.min(v.attempts,Math.max(x?.right||0,y?.right||0));out.legacyStats[k]=v;
  }
  for(const k of new Set([...Object.keys(a.sessions||{}),...Object.keys(b.sessions||{})])){
    if(!safeKey(k))continue;const x=a.sessions?.[k],y=b.sessions?.[k],s=latest(x,y);
    if(x&&y){s.checked=[...new Set([...x.checked,...y.checked])];s.finishedAt=Math.max(x.finishedAt||0,y.finishedAt||0)||null;
      for(const qid of new Set([...Object.keys(x.answerAt||{}),...Object.keys(y.answerAt||{})])){const win=(y.answerAt?.[qid]||0)>(x.answerAt?.[qid]||0)?y:x;s.answers[qid]=win.answers[qid]||[];s.answerAt[qid]=win.answerAt[qid]||0;s.confidence[qid]=win.confidence[qid]||'sure';s.times[qid]=Math.max(x.times[qid]||0,y.times[qid]||0);}
    }out.sessions[k]=s;
  }
  return out;
}
export function migrateLegacy(old){
  const state=emptyState();if(!old||typeof old!=='object')return state;
  state.legacyStats=structuredClone(old.stats||{});
  for(const id of old.favorites||[])if(safeKey(id))state.favorites[id]={value:true,at:1};
  if(old.custom)state.custom={value:old.custom,at:1};
  for(const h of old.history||[]){if(!h.questions?.length)continue;const s=createSession(state,h.questions,{mode:h.mode==='exam'?'exam':'practice',label:h.label||'旧版练习记录',randomOptions:false,now:h.at-(h.seconds||0)*1000});s.answers=h.answers||{};s.checked=h.questions.filter(q=>s.answers[q.id]?.length).map(q=>q.id);s.finishedAt=h.at;s.updatedAt=h.at;state.history[s.id]={...summarizeSession(state,s),seconds:h.seconds||0};}
  if(old.session?.questions?.length){const o=old.session,s=createSession(state,o.questions,{mode:o.mode==='exam'?'exam':'practice',label:o.label||'旧版未完成练习',randomOptions:false,now:o.start});Object.assign(s,{answers:o.answers||{},checked:o.checked||[],legacyChecked:o.checked||[],flags:o.flags||[],index:o.index||0,deadline:o.deadline||null});}
  return state;
}
export function validateState(value,validateBank){
  if(!value||value.version!==2)throw Error('不是有效的学习备份版本。');
  for(const name of ['events','legacyStats','favorites','notes','issues','sessions','history','snapshots'])if(!value[name]||typeof value[name]!=='object'||Array.isArray(value[name])||Object.keys(value[name]).some(k=>!safeKey(k)))throw Error('学习备份字段不正确：'+name);
  const snapshots=Object.values(value.snapshots);if(snapshots.length>10000)throw Error('题目快照过多。');if(snapshots.length)validateBank(snapshots.map((q,i)=>({...q,id:'snapshot-'+i})));
  if(value.custom?.value)validateBank(value.custom.value);
  if(Object.keys(value.events).length>50000||Object.keys(value.sessions).length>1000)throw Error('备份记录过多，请分批保存。');
  for(const e of Object.values(value.events))if(!safeKey(e.questionId)||!Number.isFinite(e.at)||!Number.isFinite(e.durationMs)||e.durationMs<0||typeof e.correct!=='boolean'||!['sure','guess'].includes(e.confidence)||!Array.isArray(e.answer)||e.answer.some(i=>!Number.isInteger(i)||i<0||i>7))throw Error('答题事件格式不正确。');
  for(const s of Object.values(value.sessions)){
    if(!safeKey(s.id)||!Array.isArray(s.questionKeys)||!s.questionKeys.length||s.questionKeys.some(k=>!value.snapshots[k])||!Number.isInteger(s.index)||s.index<0||s.index>=s.questionKeys.length||!['practice','exam'].includes(s.mode)||!Number.isFinite(s.start)||(s.mode==='exam'&&!Number.isFinite(s.deadline))||!Array.isArray(s.checked)||!Array.isArray(s.flags)||!s.answers||!s.times)throw Error('答题进度格式不正确。');
    for(const q of questionsOf(value,s)){const ans=s.answers[q.id]||[];if(!Array.isArray(ans)||new Set(ans).size!==ans.length||ans.some(i=>!Number.isInteger(i)||i<0||i>=q.options.length))throw Error('备份中包含非法选项。');const order=s.optionOrder?.[q.id];if(order&&(!Array.isArray(order)||new Set(order).size!==q.options.length||order.some(i=>!Number.isInteger(i)||i<0||i>=q.options.length)))throw Error('选项顺序格式不正确。');}
  }
  return value;
}
