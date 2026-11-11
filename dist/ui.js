export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clock=n=>{n=Math.max(0,Math.floor(n||0));return (Math.floor(n/3600)?String(Math.floor(n/3600)).padStart(2,'0')+':':'')+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
export const pct=(a,b)=>b?Math.round(a/b*100):null;
export const percent=(a,b)=>b?`${pct(a,b)}%`:'—';
export const date=t=>t?new Date(t).toLocaleString('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'尚无记录';
export function head(title,sub){return `<div class="page-head"><div><div class="eyebrow">YOUR PMP PRACTICE ROOM</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div></div>`;}
export function download(name,value,type='application/json'){const content=type==='application/json'?JSON.stringify(value,null,2):value,url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
export function caseHTML(q){
  if(!q.case)return '';const c=q.case,v=c.visual;
  let chart='';
  if(v&&Array.isArray(v.labels)&&Array.isArray(v.series)&&v.labels.length&&v.labels.length<=20){
    const W=560,H=210,left=42,top=14,bottom=170,right=530,colors=['#496e52','#c1854c','#7d86a0'],max=Math.max(1,...v.series.flatMap(s=>s.values).filter(Number.isFinite));
    const x=i=>left+i*(right-left)/Math.max(1,v.labels.length-1),y=n=>bottom-(Number(n)||0)/max*(bottom-top);
    let shapes=`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#b8c4b3"/>`;
    for(let i=0;i<=4;i++){const value=max*i/4,yy=y(value);shapes+=`<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="#e1e7dd"/><text x="${left-7}" y="${yy+4}" text-anchor="end">${Math.round(value)}</text>`;}
    v.series.forEach((s,si)=>{const color=colors[si%colors.length];if(v.type==='bar'){const group=(right-left)/v.labels.length,width=group/(v.series.length+1);s.values.forEach((n,i)=>{const xx=left+i*group+si*width+8;shapes+=`<rect x="${xx}" y="${y(n)}" width="${width-4}" height="${bottom-y(n)}" fill="${color}" rx="2"/>`;});}else{shapes+=`<polyline points="${s.values.map((n,i)=>`${x(i)},${y(n)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="3"/>`;s.values.forEach((n,i)=>shapes+=`<circle cx="${x(i)}" cy="${y(n)}" r="3" fill="${color}"/>`);}});
    v.labels.forEach((label,i)=>shapes+=`<text x="${v.type==='bar'?left+(i+.5)*(right-left)/v.labels.length:x(i)}" y="192" text-anchor="middle">${esc(label)}</text>`);
    chart=`<figure class="data-figure"><figcaption>${esc(v.title)} <small>单位：${esc(v.unit)}</small></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(v.title)}">${shapes}</svg><div class="chart-legend">${v.series.map((s,i)=>`<span style="color:${colors[i%colors.length]}">● ${esc(s.label)}</span>`).join('')}</div><details><summary>查看图表数据</summary><div class="table-wrap"><table><thead><tr><th>指标</th>${v.labels.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${v.series.map(s=>`<tr><th>${esc(s.label)}</th>${s.values.map(n=>`<td>${esc(n)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></figure>`;
  }
  return `<section class="case-panel"><div class="eyebrow">共享案例 · ${esc(c.id)}</div><h3>${esc(c.title)}</h3><p>${esc(c.context)}</p>${chart}</section>`;
}
