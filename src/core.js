export function correct(q, a = []) {
  return (
    a.length === q.answer.length &&
    [...a]
      .sort((x, y) => x - y)
      .every((v, i) => v === [...q.answer].sort((x, y) => x - y)[i])
  );
}
export function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function remaining(session, now = Date.now()) {
  return Math.max(0, Math.ceil((session.deadline - now) / 1000));
}
export function validateBank(v) {
  if (!Array.isArray(v) || !v.length || v.length > 5000)
    throw new Error("题库需要包含1至5000道题的JSON数组。");
  const ids = new Set();
  for (const q of v) {
    if (
      !q ||
      typeof q.id !== "string" ||
      !q.id ||
      q.id.length > 120 ||
      ["__proto__", "constructor", "prototype"].includes(q.id) ||
      ids.has(q.id)
    )
      throw Error("每道题需要唯一且不超过120字符的id。");
    ids.add(q.id);
    if (
      !["人员", "过程", "商业环境"].includes(q.domain) ||
      !["预测", "敏捷", "混合"].includes(q.approach)
    )
      throw Error("领域或方法字段不正确。");
    if (
      !["topic", "stem"].every(
        (k) => typeof q[k] === "string" && q[k].trim() && q[k].length < 30000,
      )
    )
      throw Error("缺少考点或题干，或内容过长。");
    if (
      !Array.isArray(q.options) ||
      q.options.length < 2 ||
      q.options.length > 8 ||
      q.options.some(
        (x) => typeof x !== "string" || !x.trim() || x.length > 6000,
      )
    )
      throw Error("选项须为2至8个非空字符串。");
    if (
      !Array.isArray(q.answer) ||
      !q.answer.length ||
      new Set(q.answer).size !== q.answer.length ||
      q.answer.some(
        (x) => !Number.isInteger(x) || x < 0 || x >= q.options.length,
      )
    )
      throw Error("answer需要合法、不重复的选项下标，从0开始。");
    if (
      !Array.isArray(q.rationales) ||
      q.rationales.length !== q.options.length ||
      q.rationales.some(
        (x) => typeof x !== "string" || !x.trim() || x.length > 20000,
      )
    )
      throw Error("每个选项都需要对应解析。");
    if (q.taskId && !/^(P[1-8]|R(?:[1-9]|10)|B[1-8])$/.test(q.taskId))
      throw Error("任务编号应为P1至P8、R1至R10或B1至B8。");
    if (
      q.references &&
      (!Array.isArray(q.references) ||
        q.references.length > 12 ||
        q.references.some(
          (r) => !r || typeof r.url !== "string" || !/^https:\/\//.test(r.url),
        ))
    )
      throw Error("依据链接须为https网址。");
    if (q.case) {
      const c = q.case;
      if (
        typeof c.id !== "string" ||
        typeof c.title !== "string" ||
        typeof c.context !== "string" ||
        c.context.length > 30000
      )
        throw Error("案例背景格式不正确。");
      if (c.visual) {
        const a = c.visual;
        if (
          !["line", "bar"].includes(a.type) ||
          !Array.isArray(a.labels) ||
          a.labels.length < 1 ||
          a.labels.length > 20 ||
          !Array.isArray(a.series) ||
          a.series.length > 8 ||
          a.series.some(
            (s) =>
              typeof s.label !== "string" ||
              !Array.isArray(s.values) ||
              s.values.length !== a.labels.length ||
              s.values.some((n) => !Number.isFinite(n) || n < 0 || n > 1e12),
          )
        )
          throw Error("图表数据格式不正确。");
      }
    }
  }
  return v;
}
export function score(questions, answers) {
  const domains = {};
  let total = 0;
  for (const q of questions) {
    const ok = correct(q, answers[q.id] || []);
    total += Number(ok);
    const d = (domains[q.domain] ??= { right: 0, total: 0 });
    d.total++;
    d.right += Number(ok);
  }
  return {
    right: total,
    total: questions.length,
    percent: questions.length
      ? Math.round((total / questions.length) * 100)
      : 0,
    domains,
  };
}
