export const REVIEWED_AT = "2026-11-11";
export const sourceKind = (q) => q.provenance?.kind || "unverified";
export const sourceLabel = (q) =>
  ({
    "original-practice": "本平台原创练习",
    "open-source-adapted": "开源题中文译编",
    "user-import": "个人导入 · 来源待核对",
    unverified: "旧记录或导入题 · 来源待核对",
  })[sourceKind(q)] || "来源待核对";
export const practiceResources = [
  {
    id: "pmi-samples",
    title: "PMI 官网公开样题",
    period: "当前公开示例",
    count: "3道样题",
    language: "英文",
    url: "https://www.pmi.org/certifications/project-management-pmp",
    kind: "官方公开",
    note: "页面 Sample Exam Questions 提供题目与正确答案，未公布逐题难度；本平台未复制题目。",
  },
  {
    id: "lehmann-legacy",
    title: "Oliver Lehmann 历史版模拟题",
    period: "2021版，供2022–2025备考资料研究",
    count: "100题在线；另有180题PDF入口",
    language: "英文",
    url: "https://oliverlehmann.com/free/free-pmp-practice-questions/",
    kind: "作者公开模拟",
    note: "原站明确区分2021–2025版和2026版。这是历史模拟资料，不是逐年真题；与新版可能存在题目重叠，不合并宣称题量。",
  },
  {
    id: "lehmann-2026",
    title: "Oliver Lehmann 2026版模拟题",
    period: "2026新版；大陆生效时间需按PMI中国",
    count: "180题，3组各60题",
    language: "英文",
    url: "https://oliverlehmann.com/free/pmp-practice-questions-2026/",
    kind: "作者公开模拟",
    note: "原站提供计时、解析和PDF入口。未找到逐题统计难度，不把作者模拟题视为实际考试题。",
  },
  {
    id: "prepcast",
    title: "PrepCast 公开模拟题",
    period: "原页标注2026-08-06更新",
    count: "120道公开题",
    language: "英文",
    url: "https://www.project-management-prepcast.com/pmp-practice-exam-questions-sample-test",
    kind: "作者公开模拟",
    note: "原站提供案例题、选项和解析；页面宣称按2026大纲更新。历史推荐链接已被新版覆盖，不能据链接年龄把现有题标为2022题。",
  },
  {
    id: "study-hub",
    title: "PMP 2026 Study Hub 原题库",
    period: "2026大纲，固定源码版本",
    count: "原库278题；本平台精选译编60题",
    language: "英文；精选题已译编为中文",
    url: "https://github.com/Sviless/pmp-2026-study-hub",
    kind: "MIT开源模拟",
    note: "原作者声明是原创练习，非实际考试内容。保留作者、原题ID、英文、答案、许可证和作者预估难度。",
  },
  {
    id: "study-hall",
    title: "PMI Study Hall 官方练习",
    period: "以购买时适用版本为准",
    count: "订阅产品，未读取完整题库",
    language: "原生英文",
    url: "https://www.pmi.org/shop/tb/p-/digital-product/pmp-pmi-study-hall-plus-subscription/dp081",
    kind: "官方付费",
    note: "仅核实公开产品介绍。没有抓取付费题或逐题难度，也未把付费题导入本平台。",
  },
];
export const examVersions = [
  {
    label: "历史资料：2021版ECO",
    period: "用于研究2022–2025期间的备考资料",
    weights: "人员42% / 过程50% / 商业环境8%",
    url: "https://www.pmi.org/-/media/pmi/documents/public/pdf/certifications/project-management-professional-exam-outline",
    note: "历史资料对比依据；不代表按年份取得了官方真卷。",
  },
  {
    label: "当前平台：中国大陆2026年12月ECO",
    period: "2026-12-05起",
    weights: "人员33% / 过程41% / 商业环境26%",
    url: "https://www.pmichina.org/certification/project-management-pmp/new-exam",
    note: "当前内置题及标准训练卷按此编排；海外2026年7月切换日期不套用到大陆。",
  },
];
export const fidelityChecks = [
  [
    "考点与版本",
    "可核对",
    "26个新版任务；每题可查看任务定位。2022–2025资料单独标为历史参考。",
  ],
  [
    "题型与阅读",
    "部分覆盖",
    "支持单选、多选、共享案例和图表；未完整复刻正式试卷所有交互题型和阅读负担。",
  ],
  [
    "组卷比例",
    "可检查",
    "标准180题训练按59/74/47配置领域，目标约40%预测、60%敏捷及混合；题池不足时显示偏差。",
  ],
  [
    "答案与解析",
    "可追溯，仍需复核",
    "开源译题保留原题答案和英文，存在补充前提时明示；大纲链接不等于官方答案背书。",
  ],
  [
    "难度与区分度",
    "尚未校准",
    "作者标签与本平台预估分开显示；没有实考试题参数，无法给出与实考差距的可靠百分比。",
  ],
  [
    "成绩解释",
    "仅供训练",
    "首次正确率和重复作答分开；所有训练题均计分，成绩不直接换算通过率。",
  ],
];
