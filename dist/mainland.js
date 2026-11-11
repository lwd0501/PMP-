export const mainlandProfile={
  title:'中国大陆 PMP · 上海 / 广东通用',
  effective:'2026-12-05',
  verified:'2026-11-11',
  officialCount:180,
  officialMinutes:240,
  source:'https://www.pmichina.org/certification/project-management-pmp/new-exam',
  outline:'https://www.pmichina.org/项目管理专业人士(PMP)®认证考试内容大纲-2026年12月PMP®认证考试更新.pdf',
  weights:{'人员':33,'过程':41,'商业环境':26}
};
// 分组用于练习，不表示对正式试卷的完整题型与难度仿真。
export function makePapers(questions){
  const pools=Object.fromEntries(['人员','过程','商业环境'].map(d=>[d,questions.filter(q=>q.domain===d)]));
  return [0,1,2].map(i=>{
    const picked=[...pools['人员'].slice(i*10,i*10+10),...pools['过程'].slice(i*12,i===2?37:i*12+12),...pools['商业环境'].slice(i*8,i===2?23:i*8+8)];
    // 领域轮换，避免把整组题连续堆在同一个领域。
    const queues=['人员','过程','商业环境'].map(d=>picked.filter(q=>q.domain===d)),mixed=[];
    while(queues.some(q=>q.length))for(const q of queues)if(q.length)mixed.push(q.shift());
    return {id:i+1,title:`第${i+1}组 · 综合情境练习`,questions:mixed};
  });
}
