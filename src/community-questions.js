import { communityOriginal } from "./community-original.js";
import { communityZh } from "./community-zh.js";
export const COMMUNITY_COMMIT = "501eb3426d243e40bec08a08ebd84b413bc076cb";
export const COMMUNITY_LICENSE =
  'MIT License\n\nCopyright (c) 2026 Gustavo Angulo\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n';
const translations = new Map(communityZh.map((q) => [q.sourceId, q]));
const domainNames = { people: "人员", process: "过程", business: "商业环境" },
  prefixes = { people: "P", process: "R", business: "B" },
  approaches = { predictive: "预测", agile: "敏捷", hybrid: "混合" };
const clarifications = {
  "pr3-02": "将原文“价值相同”澄清为综合延迟成本相同，避免WSJF前提不足。",
  "pr8-04": "解析补充快速跟进可能产生返工及额外成本，不承诺零成本。",
  "pr1-10":
    "聚焦预测输入的数据核验，未把数据检查描述为所有AI治理活动的绝对第一步。",
  "bu3-04": "补充记录、影响分析和适当授权处置；不把补记录当作自动补批。",
  "bu4-02": "明确协调责任人员解除障碍，避免把服务型领导理解为亲自包办。",
};
export const communityQuestions = communityOriginal.map((row) => {
  const [
      sourceId,
      task,
      approach,
      difficulty,
      stem,
      options,
      answer,
      explanation,
    ] = row,
    zh = translations.get(sourceId);
  if (!zh) throw Error("缺少译题：" + sourceId);
  const [domain, number] = task.split("-"),
    url = `https://github.com/Sviless/pmp-2026-study-hub/blob/${COMMUNITY_COMMIT}/js/data/questions-${domain}.js`;
  return {
    id: "HUB-" + sourceId.toUpperCase(),
    domain: domainNames[domain],
    taskId: prefixes[domain] + number,
    approach: approaches[approach],
    topic: zh.topic,
    stem: zh.stem,
    options: zh.options,
    answer: Array.isArray(answer) ? answer : [answer],
    rationales: zh.rationales,
    difficulty: difficulty === "hard" ? "较难" : "中等",
    revision: 1,
    provenance: {
      kind: "open-source-adapted",
      author: "Gustavo Angulo",
      title: "PMP 2026 Study Hub",
      sourceId,
      sourceCommit: COMMUNITY_COMMIT,
      sourceUrl: url,
      license: "MIT",
      licenseNotice: COMMUNITY_LICENSE,
      original: { stem, options, answer, explanation, difficulty },
      translation: "AI辅助中文译编；逐项解析含本平台补充",
      clarification: clarifications[sourceId] || "",
      examOccurrenceVerified: false,
    },
    difficultyEvidence: {
      basis: "author-estimate",
      level: difficulty,
      calibrated: false,
      reason: zh.difficultyReason,
    },
    references: [
      {
        title: "开源原题 " + sourceId + " · 固定版本",
        url,
        role: "原题及作者答案，可核对英文；非官方试题",
      },
    ],
    review: {
      note: "已核对译文选项与原题答案，逐项解析为译编补充；未通过独立专家或实考试答校准。",
    },
  };
});
