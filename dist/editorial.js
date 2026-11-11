export const ECO_URL='https://www.pmichina.org/项目管理专业人士(PMP)®认证考试内容大纲-2026年12月PMP®认证考试更新.pdf';
export const TASKS=[
  ...['共同愿景','冲突管理','团队领导与授权','干系人参与','协调期望','跟踪满意度','知识转移','有效沟通'].map((title,i)=>({id:`P${i+1}`,domain:'人员',number:i+1,title,page:i<6?7:8})),
  ...['整合计划与方法选择','范围与需求','价值交付与收益','资源安排','采购与合同','财务与成本','质量管理','进度规划','状态与度量','收尾与运营移交'].map((title,i)=>({id:`R${i+1}`,domain:'过程',number:i+1,title,page:i<5?9:10})),
  ...['治理与授权','合规与责任','受控变更','障碍与问题','风险管理','组织持续改进','组织变更','外部环境变化'].map((title,i)=>({id:`B${i+1}`,domain:'商业环境',number:i+1,title,page:i<5?11:12}))
];
export const taskById=id=>TASKS.find(t=>t.id===id);
const oldTasks=['P2','B4','P4','P8','B6','P3','P8','P3','P5','P3','B3','B4','R3','R7','R6','R8','R7','R1','R9','R2','R5','B6','R3','B2','B8','B7','B2','R6','R3','B1'];
const people=[1,3,7,3,4,2,8,5,3,3,5,4,3,2,6,1,3,8,3,7,4,1].map(n=>'P'+n);
const process=[2,2,2,1,8,8,8,6,6,8,9,7,7,5,5,4,3,3,10,3,9,9,2,1,9].map(n=>'R'+n);
const business=[1,5,5,5,6,7,3,5,2,8,4,2,5].map(n=>'B'+n);
const mapping=[...oldTasks,...people,...process,...business];
const revisions={
  'PMP-001':{options:['请发起人立刻指定方案，并要求团队服从','分别倾听双方关注点，促成基于共同目标和事实的讨论','安排双方限时辩论，以多数投票作为唯一决策依据','先暂停所有设计工作，等技术负责人书面认定责任']},
  'PMP-003':{options:['安排沟通了解其顾虑、期望和参与障碍','仅向他转发全部既有评审材料，要求月底前反馈','先要求发起人协调其接受既定方案，再询问诉求','继续当前方案，到正式验收前集中开展需求澄清']},
  'PMP-011':{options:['先做一个可交付版本，再补变更记录','记录请求，分析范围、进度、成本等影响，并按既定变更流程处理','仅确认开发工作量，若低于一天就直接实施','为了保护范围基准，先拒绝再让客户重新立项']},
  'PMP-017':{options:['提高最终抽检比例，暂不调整产生缺陷的过程','分析根本原因，实施并验证过程改进','先把全部缺陷责任统一归给检验环节','将历史合格率作为依据，维持原流程直到下一阶段']},
  'PMP-023':{options:['确认所有需求均已交付，然后关闭收益跟踪','认定按时交付就代表收益已经实现','收益衡量指标、采用情况及业务变更落实情况','先增加用户提出的全部功能，之后再分析使用率']}
};
// 选项调整时同步维护解析，旧答卷使用原有快照，不追溯改分。
const replacementReasons={
  'PMP-001':['尚未了解冲突来源，立即请求上级裁定会错过团队协作机会。',null,'投票可以辅助决策，但不能作为替代理解分歧与技术依据的唯一手段。','当前没有安全或纪律事件，先停工追责与问题性质不匹配。'],
  'PMP-003':[null,'材料传递不能替代对其具体诉求和参与障碍的了解。','先推动接受再了解诉求，会削弱参与和信任。','推迟澄清会提高已执行工作返工的风险。'],
  'PMP-011':['先实施再补批可能已经造成未受控的范围变化。',null,'小工作量并不等于没有质量、成本或维护影响。','变更应评估价值和影响，不宜在评估前一概拒绝。'],
  'PMP-017':['提高检验可以发现更多问题，但不能单独消除反复缺陷的根因。',null,'没有原因分析就归责，不能保证改进方向正确。','历史合格率不能否定当前已经发现的重复缺陷。'],
  'PMP-023':['需求交付是必要的过程证据，但不能替代业务收益跟踪。',null,null,'未经诊断就增加功能可能扩大投入，仍不能解决采用障碍。']
};
export function enrichQuestion(original,index){
  const patch=revisions[original.id],q={...original,...patch};
  if(patch)q.rationales=original.rationales.map((r,i)=>replacementReasons[q.id][i]||r);
  const taskId=q.taskId||mapping[index],task=taskById(taskId);
  const references=[{title:'大陆2026年12月ECO · '+(task?task.domain+'任务'+task.number:'相关任务'),url:ECO_URL,page:task?.page,role:'大纲定位；不是官方答案出处'}];
  if(/挣值|完工估算|完工尚需/.test(q.topic))references.push({title:'PMI：Earned Value Management',url:'https://www.pmi.org/blog/earned-value-management',role:'公式与适用假设参考'});
  if(/完成定义|待办事项排序|验收标准/.test(q.topic)&&q.approach==='敏捷')references.push({title:'The Scrum Guide',url:'https://scrumguides.org/scrum-guide.html',role:'Scrum角色、完成定义及产品待办事项参考'});
  if(/冲突/.test(q.topic))references.push({title:'PMI：Resolving team conflict',url:'https://www.pmi.org/learning/library/resolving-team-conflict-project-management-3166',role:'协作解决冲突的背景参考'});
  return {...q,taskId,difficulty:q.difficulty||(/挣值|路径|估算|计算|混合|治理/.test(q.topic)?'进阶':'基础'),revision:patch?2:original.revision||1,references,review:{status:'logic-reviewed',independent:false,at:'2026-11-11',note:'已做结构、分类和答案逻辑复查；预估难度未经统计校准，仍待独立PMP专家复核。'},status:'AI辅助逻辑复查 · 待独立专家复核'};
}
