import {validateBank} from './core.js';
const LIMIT=12*1024*1024;
export function parseCSV(text){
  const rows=[];let row=[],cell='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||!cell)quoted=!quoted;else cell+=c;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw Error('CSV引号未闭合。');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function rowsToQuestions(rows){
  if(rows.length<2)throw Error('文件需要表头和至少一道题。');
  const headers=rows[0].map(x=>String(x||'').trim()),prefix='IMPORT-'+crypto.randomUUID().slice(0,8);
  const value=(row,...names)=>{for(const name of names){const i=headers.indexOf(name);if(i>=0&&String(row[i]??'').trim())return String(row[i]).trim();}return '';};
  const questions=rows.slice(1).filter(r=>r.some(x=>String(x).trim())).map((r,index)=>{
    const options=[];for(let i=0;i<8;i++){const o=value(r,'选项'+String.fromCharCode(65+i),'选项'+(i+1),String.fromCharCode(65+i));if(o)options.push(o);else if(i>=2)break;else throw Error(`第${index+2}行缺少选项。`);}
    const answerText=value(r,'答案','正确答案','answer').toUpperCase();
    const tokens=answerText.match(/[A-H]|\d+/g)||[];
    const answer=tokens.map(x=>/^[A-H]$/.test(x)?x.charCodeAt(0)-65:Number(x)-1);
    const rawDomain=value(r,'领域','domain','题型分类'),domain=({'业务环境':'商业环境','People':'人员','Process':'过程','Business Environment':'商业环境'})[rawDomain]||rawDomain;
    const rawApproach=value(r,'方法','交付方法','approach'),approach=({'predictive':'预测','agile':'敏捷','hybrid':'混合'})[rawApproach]||rawApproach;
    const general=value(r,'解析','explanation'),url=value(r,'依据链接','来源链接');
    return {id:value(r,'题号','id')||`${prefix}-${index+1}`,domain,approach,taskId:value(r,'任务编号','taskId'),topic:value(r,'知识点','考点','topic')||'待补知识点',stem:value(r,'题目','题目内容','题干','stem'),options,answer,rationales:options.map((_,i)=>value(r,'解析'+String.fromCharCode(65+i))||general||'未提供逐项解析，请补充并复核。'),difficulty:value(r,'难度')||'未标定',references:url?[{title:value(r,'依据名称')||'导入者提供的依据',url,role:'未核验来源'}]:[],review:{status:'unreviewed',independent:false,note:'导入题目，来源、答案及难度均待核验。'},revision:1,status:'导入题目 · 待核验'};
  });
  return validateBank(questions);
}
function xml(text){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('Excel内部XML格式不正确。');return doc;}
async function unzip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('不是有效的.xlsx文件；不支持加密文件或旧版.xls。');
  const entries=view.getUint16(end+10,true),offset=view.getUint32(end+16,true);if(entries>2000)throw Error('Excel文件过于复杂。');
  let p=offset,total=0;const files={};
  for(let i=0;i<entries;i++){
    if(p+46>bytes.length||view.getUint32(p,true)!==0x02014b50)throw Error('Excel压缩目录不正确。');
    const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),compressed=view.getUint32(p+20,true),size=view.getUint32(p+24,true),nameLength=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
    const name=new TextDecoder().decode(bytes.slice(p+46,p+46+nameLength));p+=46+nameLength+extra+comment;
    if(flags&1)throw Error('不支持加密Excel文件。');
    if(!/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet[^/]*\.xml)$/.test(name))continue;
    total+=size;if(total>LIMIT||size>LIMIT/2)throw Error('Excel解压后内容过大。');
    if(local+30>bytes.length||view.getUint32(local,true)!==0x04034b50)throw Error('Excel压缩项不正确。');
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);if(start+compressed>bytes.length)throw Error('Excel数据不完整。');
    let raw=bytes.slice(start,start+compressed);
    if(method===8){
      const reader=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let used=0;
      for(;;){const {value,done}=await reader.read();if(done)break;used+=value.length;if(used>Math.min(LIMIT/2,size+1024)){await reader.cancel();throw Error('Excel解压长度超限。');}chunks.push(value);}raw=new Uint8Array(used);let at=0;for(const chunk of chunks){raw.set(chunk,at);at+=chunk.length;}
    }else if(method!==0)throw Error('不支持此Excel压缩方式。');
    files[name]=new TextDecoder().decode(raw);
  }
  return files;
}
export async function parseXLSX(buffer){
  const files=await unzip(new Uint8Array(buffer));let target=Object.keys(files).filter(k=>k.startsWith('xl/worksheets/')).sort()[0];
  if(files['xl/workbook.xml']&&files['xl/_rels/workbook.xml.rels']){const sheet=xml(files['xl/workbook.xml']).getElementsByTagName('sheet')[0],rid=sheet?.getAttribute('r:id'),rel=[...xml(files['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===rid),t=rel?.getAttribute('Target');if(t){const normalized=t.startsWith('/')?t.slice(1):'xl/'+t.replace(/^\.\//,'');if(files[normalized])target=normalized;}}
  if(!target||!files[target])throw Error('Excel中找不到可读取的第一个工作表。');
  const shared=files['xl/sharedStrings.xml']?[...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const rows=[...xml(files[target]).getElementsByTagName('row')].slice(0,5002).map(row=>{const cells=[];for(const c of row.getElementsByTagName('c')){const column=(c.getAttribute('r')||'').match(/^[A-Z]+/)?.[0];if(!column)continue;let index=0;for(const ch of column)index=index*26+ch.charCodeAt(0)-64;index--;if(index>99)continue;const t=c.getAttribute('t'),v=c.getElementsByTagName('v')[0]?.textContent||'';cells[index]=t==='s'?shared[Number(v)]||'':t==='inlineStr'?[...c.getElementsByTagName('t')].map(t=>t.textContent).join(''):v;}return Array.from({length:cells.length},(_,i)=>cells[i]||'');}).filter(r=>r.some(x=>x.trim()));
  return rowsToQuestions(rows);
}
export async function readQuestionFile(file){if(file.size>LIMIT)throw Error('请使用12MB以内的文件。');if(/\.xlsx$/i.test(file.name))return parseXLSX(await file.arrayBuffer());if(/\.csv$/i.test(file.name))return rowsToQuestions(parseCSV(await file.text()));if(/\.json$/i.test(file.name))return validateBank(JSON.parse(await file.text()));throw Error('支持.json、.csv和.xlsx；扫描PDF需要先转成题库表格并核对。');}
export function csvTemplate(){return '\uFEFF'+[['题号','领域','方法','任务编号','知识点','难度','题目','选项A','选项B','选项C','选项D','答案','解析A','解析B','解析C','解析D','依据链接'],['MY-001','人员','混合','P2','冲突管理','基础','两位成员对方案意见不一致，首先应怎么做？','倾听双方关注点并协作澄清','直接按职位决定','等到结项再处理','只检查汇报格式','A','理解分歧来源才能选择适当措施。','职位不能替代事实与协作。','延迟处理可能扩大影响。','格式不是分歧根因。','https://www.pmichina.org/certification/project-management-pmp/new-exam']].map(row=>row.map(cell=>'"'+String(cell).replace(/"/g,'""')+'"').join(',')).join('\r\n');}
