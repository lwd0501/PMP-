import { shuffle } from "./core.js";
export function examComposition(questions) {
  const domains = Object.fromEntries(
    ["人员", "过程", "商业环境"].map((d) => [
      d,
      questions.filter((q) => q.domain === d).length,
    ]),
  );
  const approaches = Object.fromEntries(
    ["预测", "敏捷", "混合"].map((a) => [
      a,
      questions.filter((q) => q.approach === a).length,
    ]),
  );
  return { total: questions.length, domains, approaches };
}
export function assembleExam(bank, count) {
  const targets =
    count === 180
      ? { 人员: 59, 过程: 74, 商业环境: 47 }
      : { 人员: Math.round(count * 0.33), 过程: Math.round(count * 0.41) };
  targets["商业环境"] ??= count - targets["人员"] - targets["过程"];
  const groups = Object.entries(targets).map(([domain, n]) => ({
    domain,
    n,
    predictive: shuffle(
      bank.filter((q) => q.domain === domain && q.approach === "预测"),
    ),
    adaptive: shuffle(
      bank.filter((q) => q.domain === domain && q.approach !== "预测"),
    ),
  }));
  const wanted = Math.round(count * 0.4),
    warnings = [];
  let selected = [];
  if (groups.every((g) => g.predictive.length + g.adaptive.length >= g.n)) {
    for (const g of groups) {
      g.min = Math.max(0, g.n - g.adaptive.length);
      g.max = Math.min(g.n, g.predictive.length);
      g.take = g.min;
    }
    const minimum = groups.reduce((s, g) => s + g.min, 0),
      maximum = groups.reduce((s, g) => s + g.max, 0),
      achievable = Math.min(maximum, Math.max(minimum, wanted));
    let left = achievable - minimum;
    while (left) {
      for (const g of shuffle(groups))
        if (left && g.take < g.max) {
          g.take++;
          left--;
        }
    }
    for (const g of groups)
      selected.push(
        ...g.predictive.slice(0, g.take),
        ...g.adaptive.slice(0, g.n - g.take),
      );
    if (achievable !== wanted)
      warnings.push(
        "题池交付方法分布不足，已保留领域比例；本卷预测型数量与40%目标存在差异。",
      );
  } else {
    for (const g of groups)
      selected.push(...shuffle([...g.predictive, ...g.adaptive]).slice(0, g.n));
    const used = new Set(selected.map((q) => q.id));
    selected.push(
      ...shuffle(bank.filter((q) => !used.has(q.id))).slice(
        0,
        Math.max(0, count - selected.length),
      ),
    );
    warnings.push("当前题池无法满足标准领域比例，请按本卷实际构成解读成绩。");
  }
  const cases = new Map(),
    singles = [];
  for (const q of selected) {
    if (q.case) {
      if (!cases.has(q.case.id)) cases.set(q.case.id, []);
      cases.get(q.case.id).push(q);
    } else singles.push(q);
  }
  selected = [...shuffle([...cases.values()]).flat(), ...shuffle(singles)];
  return {
    questions: selected,
    targets,
    warnings,
    actual: examComposition(selected),
  };
}
