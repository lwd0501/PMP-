export const mainlandProfile = {
  title: "中国大陆 PMP 通用",
  effective: "2026-12-05",
  verified: "2026-11-11",
  officialCount: 180,
  officialMinutes: 240,
  source:
    "https://www.pmichina.org/certification/project-management-pmp/new-exam",
  outline:
    "https://www.pmichina.org/项目管理专业人士(PMP)®认证考试内容大纲-2026年12月PMP®认证考试更新.pdf",
  weights: { 人员: 33, 过程: 41, 商业环境: 26 },
};
// 分组用于练习，不表示对正式试卷的完整题型与难度仿真。
export function makePapers(questions) {
  return Array.from({ length: Math.ceil(questions.length / 30) }, (_, i) => ({
    id: i + 1,
    title: `第${i + 1}组 · ${i < 3 ? "基础情境" : i < 6 ? "案例应用" : "开源译编"}`,
    questions: questions.slice(i * 30, i * 30 + 30),
  }));
}
