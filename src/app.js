import {
  sourceKind,
  sourceLabel,
  practiceResources,
  examVersions,
  fidelityChecks,
  REVIEWED_AT,
} from "./resources.js";
import { assembleExam, examComposition } from "./exams.js";
import { BrowserStore } from "./storage.js";
import { seedBank } from "./questions.js";
import { correct, shuffle, remaining, validateBank } from "./core.js";
import { mainlandProfile, makePapers } from "./mainland.js";
import { TASKS, taskById } from "./editorial.js";
import {
  emptyState,
  migrateLegacy,
  mergeStates,
  validateState,
  createSession,
  questionsOf,
  recordAttempt,
  finishSession,
  questionStats,
  reviewQueue,
  diagnostics,
} from "./learning.js";
import { CloudSync } from "./sync.js";
import { readQuestionFile, csvTemplate } from "./importers.js";
import { esc, clock, percent, date, head, download, caseHTML } from "./ui.js";

const app = document.querySelector("#app"),
  labels = {
    home: "学习概览",
    practice: "情境练习",
    exam: "模拟训练",
    wrong: "间隔复习",
    favorites: "我的收藏",
    diagnostics: "考点诊断",
    history: "学习记录",
    library: "题库与资料",
    catalog: "题库检索",
    sync: "账号与同步",
    quiz: "正在答题",
    result: "本次复盘",
    import: "导入预览",
  };
let state = emptyState(),
  bank = seedBank,
  storageKey = "pmp-room-v2:offline",
  activeId = null,
  resultId = null,
  page = "home",
  cloud = null,
  user = null,
  storageOK = true,
  syncStatus = "本机保存",
  syncLevel = "local",
  toastTimer,
  segment = null,
  pendingImport = null,
  catalogPage = 0;
const localStore = new BrowserStore();
const legacyKey = "pmp-room-v1",
  activeKey = () => storageKey + ":active";
const active = () => state.sessions[activeId] || null;
const currentQuestions = () => (active() ? questionsOf(state, active()) : []);
const currentQuestion = () => currentQuestions()[active()?.index || 0];
const refreshBank = () => {
  bank = state.custom?.value || seedBank;
};
const taskOptions = () =>
  TASKS.map(
    (t) =>
      `<option value="${t.id}">${t.domain} · ${t.number} ${esc(t.title)}</option>`,
  ).join("");
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 5000);
}
function persist() {
  try {
    if (activeId) localStorage.setItem(activeKey(), activeId);
    else localStorage.removeItem(activeKey());
  } catch {}
  try {
    localStore
      .save(storageKey, state)
      .then(() => {
        storageOK = true;
      })
      .catch(() => {
        storageOK = false;
        toast("本机保存失败，请先导出学习备份。云端连接正常时仍会尝试同步。");
      });
  } catch {
    storageOK = false;
    toast("本机保存空间不足，请先导出学习备份。");
  }
}
function save() {
  persist();
  cloud?.changed();
  updateStatus();
}
function updateStatus() {
  const el = document.querySelector("#sync-status");
  if (el) {
    el.textContent = syncStatus;
    el.dataset.level = syncLevel;
  }
  const count = reviewQueue(state, bank).length;
  document.querySelector("#wrong-count").textContent = count;
}
function ask(title, message, action) {
  const d = document.querySelector("#confirm-dialog");
  document.querySelector("#dialog-title").textContent = title;
  document.querySelector("#dialog-text").textContent = message;
  d.onclose = () => {
    if (d.returnValue === "ok") action();
  };
  d.showModal();
}
function settleTime() {
  if (!segment) return;
  const s = state.sessions[segment.sessionId];
  if (s && !s.finishedAt) {
    s.times[segment.questionId] =
      (s.times[segment.questionId] || 0) +
      Math.max(0, performance.now() - segment.start);
    s.updatedAt = Date.now();
  }
  segment = null;
}
function beginTime() {
  const s = active(),
    q = currentQuestion();
  segment =
    page === "quiz" &&
    s &&
    !s.finishedAt &&
    q &&
    !s.checked.includes(q.id) &&
    !document.hidden
      ? { sessionId: s.id, questionId: q.id, start: performance.now() }
      : null;
}
function go(next) {
  settleTime();
  if (active()) save();
  page = next;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
  if (location.protocol !== "file:")
    window.history.replaceState(null, "", "#" + next);
}
function begin(
  mode,
  questions,
  { minutes = 0, label = "情境练习", randomOptions = true } = {},
) {
  if (!questions.length) return toast("当前筛选没有可用题目。");
  if (
    mode === "exam" &&
    (!Number.isFinite(minutes) || minutes < 1 || minutes > 300)
  )
    return toast("请输入1至300分钟的作答时间。");
  settleTime();
  const session = createSession(state, questions, {
    mode,
    minutes,
    label,
    randomOptions,
  });
  activeId = session.id;
  save();
  go("quiz");
}
function inExamTime() {
  const s = active();
  if (s?.mode === "exam" && remaining(s) === 0) {
    finishCurrent(true);
    return false;
  }
  return !!s && !s.finishedAt;
}
function finishCurrent(timedOut = false) {
  const s = active();
  if (!s || s.finishedAt) return;
  settleTime();
  finishSession(state, s, timedOut && s.deadline ? s.deadline : Date.now());
  resultId = s.id;
  save();
  page = "result";
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
  if (timedOut)
    toast("作答时间已到，已自动交卷。未答题单独记录，不进入错题复习。");
}
function submitAnswer() {
  if (!inExamTime()) return;
  const s = active(),
    q = currentQuestion();
  if (s.checked.includes(q.id)) return;
  if (!s.answers[q.id]?.length) return toast("请先选择答案。");
  settleTime();
  recordAttempt(state, s, q, { confidence: s.confidence[q.id] || "sure" });
  save();
  render();
  document
    .querySelector(".rationale")
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function sampleFresh(count) {
  const fresh = shuffle(
      bank.filter((q) => !questionStats(state, q.id).attempts),
    ),
    old = shuffle(bank.filter((q) => questionStats(state, q.id).attempts));
  return [...fresh, ...old].slice(0, count);
}
function sampleExam(count) {
  const result = assembleExam(bank, count);
  if (result.warnings.length) toast(result.warnings.join(" "));
  return result.questions;
}

function empty(title, text, action = "practice") {
  return (
    head(title, text) +
    `<section class="panel empty"><div class="mode-icon">✓</div><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions" style="justify-content:center"><button class="primary" data-page="${action}">去练习 →</button></div></section>`
  );
}
function metric(label, value, note) {
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-number">${value}</div><p class="metric-note">${note}</p></div>`;
}
function homeView() {
  const d = diagnostics(state, bank),
    due = reviewQueue(state, bank, { dueOnly: true }),
    pending = reviewQueue(state, bank),
    sessions = Object.values(state.sessions)
      .filter((s) => !s.finishedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 2);
  return (
    head(
      "让每一次练习，都留下进步。",
      `中国大陆 PMP 通用 · ${bank.length}道题 · 案例、图表与间隔复习`,
    ) +
    sessions
      .map(
        (s) =>
          `<div class="resume"><span>${esc(s.label)} · 已选择 ${Object.values(s.answers).filter((a) => a.length).length}/${s.questionKeys.length}题${s.deadline ? " · 剩余 " + clock(remaining(s)) : ""}</span><button class="primary" data-resume="${s.id}">继续答题 →</button></div>`,
      )
      .join("") +
    `<section class="hero"><div><div class="eyebrow">LEARN. RETRIEVE. UNDERSTAND.</div><h2>看懂每个决定，<br>把知识真正用起来。</h2><p>先练未做题，再复习到期的薄弱点。首次成绩与重复练习分开统计，帮助你看到真实的学习进展。</p><div class="actions"><button class="primary" data-action="quick">开始10题热身 ↗</button><button class="outline-light" data-action="review-due">今日复习 ${due.length}题</button><button class="outline-light" data-action="community-drill">新增开源译编60题</button></div></div><div class="hero-art" aria-hidden="true"><div class="orbit"><span>✓</span><i>✦</i></div></div></section>
    <section class="stats">${metric("题库题目", bank.length, "含" + bank.filter((q) => q.case).length + "道案例题")}${metric("已练题目", d.practiced, "本次版本与历史记录均保留")}${metric("首次作答正确率", percent(d.firstRight, d.firstTotal), d.firstTotal ? d.firstTotal + "道有完整首次记录" : "从新版开始记录；旧记录不推测")}${metric("今日到期复习", due.length, pending.length + "道待巩固 · 答对一次不立即移出")}</section>
    <div class="section-title"><h2>选择练习强度</h2><span>原创练习与开源题中文译编</span></div><section class="mode-grid">
    <button class="mode-card" data-action="full"><span class="mode-icon">◷</span><h3>180题全程训练</h3><p>240分钟，案例成组展示，交卷后统一复盘。</p><div class="card-bottom"><span>当前题库${bank.length >= 180 ? "可以组卷" : "不足180题"}</span><b>↗</b></div></button>
    <button class="mode-card" data-action="half"><span class="mode-icon">▤</span><h3>90题半程训练</h3><p>120分钟，适应长时间阅读与判断的节奏。</p><div class="card-bottom"><span>范围内无重复抽题</span><b>↗</b></div></button>
    <button class="mode-card" data-page="diagnostics"><span class="mode-icon">↗</span><h3>按薄弱考点练习</h3><p>查看具体任务、首次正确率、用时与错因。</p><div class="card-bottom"><span>覆盖26个大纲任务</span><b>↗</b></div></button></section>
    <div class="section-title"><h2>分组练习</h2><button class="text-button" data-page="catalog">检索全部题目 →</button></div><div class="paper-grid">${makePapers(
      bank,
    )
      .map(
        (p) =>
          `<button class="paper-button" data-paper="${p.id}"><span>${String(p.id).padStart(2, "0")}</span><strong>${esc(p.title)}</strong><small>${p.questions.length}题 · 不限时 · 逐题解析 ↗</small></button>`,
      )
      .join("")}</div>
    <div class="lower-grid"><section><div class="section-title"><h2>三个领域的学习情况</h2></div><div class="panel">${[
      "人员",
      "过程",
      "商业环境",
    ]
      .map((name) => d.domains[name])
      .filter(Boolean)
      .map(
        (v) =>
          `<div class="domain-row"><div class="domain-top"><span>${esc(v.key)}</span><span class="subtle">已练 ${v.practiced}/${v.questions} · 首次 ${percent(v.firstRight, v.firstTotal)}</span></div><div class="bar"><span style="width:${v.questions ? (v.practiced / v.questions) * 100 : 0}%"></span></div></div>`,
      )
      .join("")}</div></section>
    <section><div class="section-title"><h2>题库质量与使用范围</h2></div><div class="panel"><h3>有依据、有版本，保留复核边界</h3><p class="tip">每题可查看任务定位、预估难度、依据和修订版本。本轮已检查结构和答案逻辑，尚无独立PMP专家签审。</p><div class="note">训练卷全部题目计分。它不等同于正式考试的预试题计分、题目难度校准或完整考务流程。</div><button class="text-button" data-page="library">查看题库说明 →</button></div></section></div>`
  );
}
function sourcePool(mode) {
  if (mode === "wrong") return reviewQueue(state, bank);
  if (mode === "favorites")
    return bank.filter((q) => state.favorites[q.id]?.value);
  return bank;
}
function filterQuestions(source, values) {
  return source.filter(
    (q) =>
      (!values.domain || q.domain === values.domain) &&
      (!values.approach || q.approach === values.approach) &&
      (!values.task || q.taskId === values.task) &&
      (!values.difficulty || q.difficulty === values.difficulty) &&
      (!values.source || sourceKind(q) === values.source) &&
      (!values.type ||
        (values.type === "case"
          ? !!q.case
          : values.type === "multiple"
            ? q.answer.length > 1
            : q.answer.length === 1)) &&
      (!values.status ||
        (values.status === "new"
          ? !questionStats(state, q.id).attempts
          : values.status === "pending"
            ? questionStats(state, q.id).pending
            : values.status === "reported"
              ? !!state.issues[q.id]?.text
              : true)) &&
      (!values.search ||
        [q.id, q.topic, q.stem, q.case?.context]
          .join(" ")
          .toLowerCase()
          .includes(values.search.toLowerCase())),
  );
}
function filtersHTML() {
  return `<label class="field">领域<select id="domain"><option value="">全部领域</option>${["人员", "过程", "商业环境"].map((x) => `<option>${x}</option>`).join("")}</select></label><label class="field">交付方法<select id="approach"><option value="">全部方法</option><option>预测</option><option>敏捷</option><option>混合</option></select></label><label class="field">大纲任务<select id="task"><option value="">全部任务</option>${taskOptions()}</select></label><label class="field">预估难度<select id="difficulty"><option value="">全部难度</option><option>基础</option><option>进阶</option><option>中等</option><option>较难</option><option>未标定</option></select></label><label class="field">题目来源<select id="source"><option value="">全部来源</option><option value="original-practice">本平台原创</option><option value="open-source-adapted">开源题中文译编</option><option value="user-import">个人导入</option><option value="unverified">旧记录或未提供来源</option></select></label><label class="field">题型<select id="type"><option value="">全部题型</option><option value="single">单选</option><option value="multiple">多选</option><option value="case">案例题</option></select></label><label class="field">学习状态<select id="status"><option value="">全部状态</option><option value="new">尚未作答</option><option value="pending">待间隔巩固</option><option value="reported">自己标疑的题</option></select></label><label class="field search-field">题号或关键词<input id="search" type="search" placeholder="例如：风险、PMP-060、知识转移"></label>`;
}
function filterValues() {
  return Object.fromEntries(
    [
      "domain",
      "approach",
      "task",
      "difficulty",
      "source",
      "type",
      "status",
      "search",
    ].map((k) => [k, document.querySelector("#" + k)?.value || ""]),
  );
}
function setupView(mode) {
  const qs = sourcePool(mode),
    exam = mode === "exam";
  if (!qs.length)
    return empty(
      mode === "wrong" ? "暂时没有待巩固题目" : "还没有收藏",
      mode === "wrong"
        ? "答错或标记“不确定”的题会进入间隔复习。"
        : "答题时点击收藏，之后可以在这里单独练习。",
    );
  const due = reviewQueue(state, bank, { dueOnly: true }).length;
  return (
    head(
      labels[mode],
      exam
        ? "完整训练和自定义训练均不会重复抽取同一道题。"
        : mode === "wrong"
          ? `共${qs.length}题待巩固，今天到期${due}题。提前练习不会跳过间隔掌握要求。`
          : "选择知识点，先理解再记忆。",
    ) +
    `<section class="panel"><form id="setup-form" data-mode="${mode}"><div class="form-grid">${filtersHTML()}<label class="field">抽取题数<input id="count" type="number" min="1" max="${qs.length}" value="${Math.min(exam ? 90 : 10, qs.length)}" required></label>${exam ? '<label class="field">作答时间（分钟）<input id="minutes" type="number" min="1" max="300" value="120" required></label>' : '<label class="field">题目顺序<select id="order"><option value="new">未做题优先</option><option value="random">随机顺序</option><option value="ordered">题库顺序</option></select></label>'}</div><label class="check-field"><input id="shuffle-options" type="checkbox" checked> 打乱选项顺序，避免记住答案位置</label><p id="pool-count" class="tip">当前可用${qs.length}题。</p><div class="note">${exam ? "180题/240分钟为全程训练，90题/120分钟为半程训练。本平台所有训练题均计分；按大陆大纲训练，不复刻正式考试全部考务规则。" : "练习中未答题单独记录，不计入错题或已答正确率。标记“不确定”的题，即使答对，也会安排复习。"}</div><div class="actions"><button class="primary" type="submit">${exam ? "开始计时训练" : "开始练习"} →</button>${mode === "wrong" ? '<button class="secondary" type="button" data-action="review-due">只练今天到期题</button>' : ""}</div></form></section>`
  );
}
function qualityHTML(q) {
  const t = taskById(q.taskId),
    p = q.provenance,
    e = q.difficultyEvidence;
  return `<details class="quality-details"><summary>来源、依据与难度 · ${esc(q.taskId || "未定位")} · v${esc(q.revision || 1)}</summary><p>${esc(sourceLabel(q))} · ${t ? `${esc(t.domain)} · ${esc(t.title)}` : "任务待核对"}</p><p>预估难度：${esc(q.difficulty || "未标定")} · ${e?.basis === "author-estimate" ? "原作者标签，未经统计校准" : "编排预估，未经统计校准"}</p><p>${esc(e?.reason || "暂无可核查的难度依据。")}</p><p>${esc(q.review?.note || "来源与答案待核验。")}</p><p class="tip">没有核实本题在某年正式考试中出现；不能由题目标签推断命中率。</p>${p?.sourceId ? `<p>原题编号：${esc(p.sourceId)}${p.sourceCommit ? " · 源码版本 " + esc(p.sourceCommit.slice(0, 12)) : ""}</p>` : ""}${p?.clarification ? `<div class="note">译编说明：${esc(p.clarification)}</div>` : ""}${(q.references || []).map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || "参考依据")}${r.page ? " · 第" + r.page + "页" : ""} ↗</a><small>${esc(r.role || "导入者提供，待核验")}</small>`).join("")}${p?.original ? `<details><summary>核对英文原题与作者解析</summary><p>${esc(p.original.stem)}</p>${p.original.options.map((text, i) => `<p>${String.fromCharCode(65 + i)}. ${esc(text)}</p>`).join("")}<p>原作者难度：${esc(p.original.difficulty)}（预估）</p><p>原答案（按原文次序）：${(Array.isArray(p.original.answer) ? p.original.answer : [p.original.answer]).map((i) => String.fromCharCode(65 + i)).join("、")}</p><p>${esc(p.original.explanation)}</p><p class="tip">${esc(p.translation)}</p></details><details><summary>授权与署名 · ${esc(p.license)}</summary><pre style="white-space:pre-wrap">${esc(p.licenseNotice)}</pre></details>` : ""}</details>`;
}

function rationaleHTML(
  q,
  answers,
  order = q.options.map((_, i) => i),
  confidence = "sure",
) {
  const ok = correct(q, answers),
    letter = (i) => String.fromCharCode(65 + order.indexOf(i));
  return `<div class="rationale"><h3>${ok ? (confidence === "guess" ? "✓ 答对了，仍需巩固" : "✓ 回答正确") : "↻ 再理解一次"} <span class="subtle">本次正确答案 ${q.answer.map(letter).join("、")}</span></h3>${order.map((i) => `<p><strong>${letter(i)} · ${q.answer.includes(i) ? "正确选项" : "其他选项"}</strong><br>${esc(q.options[i])}<br>${esc(q.rationales[i])}</p>`).join("")}${qualityHTML(q)}</div>`;
}
function quizView() {
  const s = active();
  if (!s) return empty("没有未完成答题", "从首页选择一组题开始。", "home");
  if (s.finishedAt) {
    resultId = s.id;
    page = "result";
    return resultView();
  }
  const qs = questionsOf(state, s),
    q = qs[s.index],
    answers = s.answers[q.id] || [],
    checked = s.checked.includes(q.id),
    order = s.optionOrder[q.id] || q.options.map((_, i) => i),
    fav = state.favorites[q.id]?.value,
    event = state.events[`${s.id}:${q.id}`];
  return `<div class="quiz-header"><div><div class="eyebrow">${s.mode === "exam" ? "TIMED PRACTICE" : "SCENARIO PRACTICE"}</div><h2>${esc(s.label)} <span class="subtle">${s.index + 1}/${qs.length}</span></h2></div><div class="actions" style="margin:0">${s.deadline ? `<span class="timer" id="timer">${clock(remaining(s))}</span>` : ""}<button class="secondary" data-page="home">保存并返回</button></div></div><div class="quiz-layout"><section class="panel question-panel">${caseHTML(q)}<div class="chips"><span class="chip">${esc(q.domain)}</span><span class="chip">${esc(q.approach)}</span><span class="chip">${q.answer.length > 1 ? "多选 · 选择" + q.answer.length + "项" : "单选"}</span><span class="chip">${esc(q.topic)}</span><span class="chip">${esc(q.taskId || "未定位")} · ${esc(q.difficulty || "未标定")}</span></div><h1 class="question">${esc(q.stem)}</h1><div class="options">${order.map((i, position) => `<label class="option ${checked ? (q.answer.includes(i) ? "good" : answers.includes(i) ? "bad" : "") : ""}"><input type="${q.answer.length > 1 ? "checkbox" : "radio"}" name="answer" value="${i}" data-position="${position}" ${answers.includes(i) ? "checked" : ""} ${checked ? "disabled" : ""}><b>${String.fromCharCode(65 + position)}</b><span>${esc(q.options[i])}</span></label>`).join("")}</div>
    <fieldset class="confidence"><legend>这次选择的把握程度</legend><label><input type="radio" name="confidence" value="sure" ${(s.confidence[q.id] || "sure") === "sure" ? "checked" : ""} ${checked ? "disabled" : ""}> 有把握</label><label><input type="radio" name="confidence" value="guess" ${s.confidence[q.id] === "guess" ? "checked" : ""} ${checked ? "disabled" : ""}> 不确定 / 猜测</label></fieldset>
    ${checked ? rationaleHTML(q, answers, order, s.confidence[q.id]) : ""}
    ${checked && !event?.correct ? `<label class="field reason-field">这次主要错因<select id="error-reason"><option value="">先不标记</option>${["知识点不清", "审题遗漏", "方法混淆", "计算错误", "凭印象猜测", "其他"].map((x) => `<option ${event?.reason === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>` : ""}
    <div class="actions quiz-actions"><button class="secondary" data-action="prev" ${s.index === 0 ? "disabled" : ""}>← 上一题</button>${s.mode !== "exam" && !checked ? '<button class="primary" data-action="check">提交答案</button>' : ""}<button class="${s.mode === "exam" ? "primary" : "secondary"}" data-action="next" ${s.index === qs.length - 1 ? "disabled" : ""}>下一题 →</button><button class="secondary" data-action="favorite">${fav ? "★ 已收藏" : "☆ 收藏"}</button><button class="secondary" data-action="flag">${s.flags.includes(q.id) ? "⚑ 已标记" : "⚐ 标记"}</button></div>
    <details class="personal-notes"><summary>我的笔记与题目纠错</summary><label class="field">学习笔记<textarea id="question-note" rows="3" maxlength="6000" placeholder="写下容易混淆的条件、判断顺序或公式假设。">${esc(state.notes[q.id]?.text || "")}</textarea></label><button class="secondary" data-action="save-note">保存笔记</button><label class="field">标疑 / 纠错<textarea id="question-issue" rows="2" maxlength="3000" placeholder="例如：选项存在歧义、依据需要补充。只保存在自己的学习记录。">${esc(state.issues[q.id]?.text || "")}</textarea></label><button class="secondary" data-action="save-issue">保存标疑</button></details></section>
    <aside class="quiz-side"><div class="panel"><h3>答题导航</h3><div class="progress-line"><span style="width:${(Object.values(s.answers).filter((a) => a.length).length / qs.length) * 100}%"></span></div><div class="number-grid">${qs.map((x, i) => `<button class="num ${i === s.index ? "current" : ""} ${s.answers[x.id]?.length ? "answered" : ""} ${s.flags.includes(x.id) ? "flagged" : ""}" aria-label="第${i + 1}题" data-index="${i}">${i + 1}</button>`).join("")}</div><p class="legend">浅绿：已选择答案 · 圆点：已标记<br>${s.deadline ? "退出或刷新不会暂停计时。" : "未答题不计入错题。"}<br>快捷键：1–8选项，Enter提交，←/→换题，F标记。</p><button class="primary" style="width:100%" data-action="finish">${s.mode === "exam" ? "交卷并复盘" : "结束本组练习"}</button></div></aside></div>
    <div class="mobile-quiz-controls"><button data-action="prev" ${s.index === 0 ? "disabled" : ""}>← 上一题</button><button class="${s.mode !== "exam" && !checked ? "mobile-submit" : ""}" data-action="${s.mode !== "exam" && !checked ? "check" : s.mode === "exam" ? "finish" : "show-nav"}">${s.mode !== "exam" && !checked ? "提交答案" : s.mode === "exam" ? "交卷" : `${s.index + 1}/${qs.length} · 题号`}</button><button data-action="next" ${s.index === qs.length - 1 ? "disabled" : ""}>下一题 →</button></div>`;
}
function resultView() {
  const s = state.sessions[resultId],
    r = state.history[resultId];
  if (!r || !s)
    return empty("暂无可复盘记录", "完成一场练习后可在这里查看结果。");
  const qs = questionsOf(state, s);
  return (
    head(
      "看懂错因，比记住位置更重要。",
      "未答、答错与猜对单独显示；首次作答成绩可到考点诊断查看。",
    ) +
    `<section class="panel score-card"><span class="chip">${esc(r.label)}</span><div class="score-number">${r.percent === null ? "—" : r.percent}<small>${r.percent === null ? "" : "%"}</small></div><p>已答 ${r.answered}/${r.total} · 正确 ${r.right} · 答错 ${r.wrong} · 未答 ${r.unanswered}</p><p class="tip">${r.mode === "exam" ? "模拟训练以全卷题数为分母，未答影响本次分数，但不会进入错题复习。" : "练习正确率只统计已答题，未答题不计错。"} 训练成绩不代表官方通过概率。</p><p class="tip">有效作答用时 ${clock(r.seconds)}${r.mode === "exam" ? " · 本次经过时间 " + clock(r.wallSeconds) : ""}</p><div class="result-grid">${Object.entries(
      r.domains,
    )
      .map(
        ([name, v]) =>
          `<div class="result-mini">${esc(name)}<strong>${v.right}/${r.mode === "exam" ? v.total : v.answered}</strong><small>未答${v.total - v.answered}</small></div>`,
      )
      .join(
        "",
      )}</div>${s.mode === "exam" ? `<p class="tip">本卷实际构成：预测${examComposition(qs).approaches["预测"]}题，敏捷${examComposition(qs).approaches["敏捷"]}题，混合${examComposition(qs).approaches["混合"]}题。难度未经实考参数校准。</p>` : ""}<div class="actions" style="justify-content:center"><button class="primary" data-action="retry-result">重练本次错题 / 猜测题</button><button class="secondary" data-page="diagnostics">查看考点诊断</button></div></section><div class="section-title"><h2>逐题复盘</h2><label class="field">显示<select id="review-filter"><option value="all">全部</option><option value="wrong">答错</option><option value="unanswered">未答</option><option value="guess">不确定 / 猜测</option></select></label></div><div id="review-list">${reviewList(qs, s, "all")}</div>`
  );
}
function reviewList(qs, s, filter) {
  return (
    qs
      .filter((q) => {
        const a = s.answers[q.id] || [];
        return (
          filter === "all" ||
          (filter === "wrong" && a.length && !correct(q, a)) ||
          (filter === "unanswered" && !a.length) ||
          (filter === "guess" && s.confidence[q.id] === "guess")
        );
      })
      .map((q) => {
        const a = s.answers[q.id] || [],
          order = s.optionOrder[q.id] || q.options.map((_, i) => i);
        return `<details class="review-item"><summary>${a.length ? (correct(q, a) ? "✓" : "↻") : "○"} ${esc(q.id)} · ${esc(q.stem)}</summary>${caseHTML(q)}<p>你的答案：${a.map((i) => String.fromCharCode(65 + order.indexOf(i))).join("、") || "未作答"}${s.confidence[q.id] === "guess" ? " · 不确定 / 猜测" : ""}</p>${rationaleHTML(q, a, order, s.confidence[q.id])}<button class="secondary" data-practice-id="${esc(q.id)}">再练这题</button></details>`;
      })
      .join("") || '<div class="panel empty">当前分类没有题目。</div>'
  );
}
function diagnosticsView() {
  const d = diagnostics(state, bank),
    tasks = TASKS.map((t) => ({
      ...t,
      ...(d.tasks[t.id] || {
        questions: 0,
        practiced: 0,
        firstTotal: 0,
        firstRight: 0,
        attempts: 0,
        right: 0,
        pending: 0,
        time: 0,
      }),
    })),
    weak = tasks
      .filter((t) => t.firstTotal && t.firstRight / t.firstTotal < 0.75)
      .sort((a, b) => a.firstRight / a.firstTotal - b.firstRight / b.firstTotal)
      .slice(0, 4);
  return (
    head(
      "找到下一步，应该练什么。",
      "首次作答、重复练习、信心和用时分开统计；样本少时，结果只用于定位复习方向。",
    ) +
    `<section class="stats">${metric("首次正确率", percent(d.firstRight, d.firstTotal), d.firstTotal + "道有完整首次记录")}${metric("全部作答正确率", percent(d.right, d.attempts), d.attempts + "次作答，包含重复")}${metric("不确定作答", d.guessed, "即使答对也安排复习")}${metric("平均有效作答时间", d.attempts ? clock(d.time / 1000 / Math.max(1, Object.values(state.events).filter((e) => bank.some((q) => q.id === e.questionId)).length)) : "—", "只统计新版记录的前台作答时间")}</section>
    ${d.firstUnknown ? `<div class="note">保留了${d.firstUnknown}道题的旧版统计。旧数据没有可靠的首次作答和单题用时信息，因此不会推测补填。</div>` : ""}
    <div class="section-title"><h2>建议优先复习</h2></div><section class="panel">${weak.length ? weak.map((t) => `<div class="history-row"><div><strong>${t.id} · ${esc(t.title)}</strong><small>首次 ${t.firstRight}/${t.firstTotal} · 待巩固${t.pending}题</small></div><button class="secondary" data-task-drill="${t.id}">练这个考点 →</button></div>`).join("") : '<p class="tip">继续完成新题后，这里会根据首次表现给出具体考点建议。当前不把“尚未作答”当作薄弱结论。</p>'}</section>
    <div class="section-title"><h2>26个大纲任务</h2><span>难度标签为预估，未做正式统计校准</span></div><section class="panel table-wrap"><table class="diagnostic-table"><thead><tr><th>领域 / 任务</th><th>已练</th><th>首次正确</th><th>全部作答</th><th>待巩固</th><th>练习</th></tr></thead><tbody>${tasks.map((t) => `<tr><td><strong>${t.id} ${esc(t.title)}</strong><small>${t.domain}</small></td><td>${t.practiced}/${t.questions}</td><td>${t.firstTotal ? t.firstRight + "/" + t.firstTotal : "—"}</td><td>${percent(t.right, t.attempts)}</td><td>${t.pending}</td><td><button class="text-button" data-task-drill="${t.id}" ${!t.questions ? "disabled" : ""}>开始 →</button></td></tr>`).join("")}</tbody></table></section><div class="section-title"><h2>自己标记的错因</h2></div><section class="panel">${
      Object.entries(d.reasons)
        .map(
          ([reason, count]) =>
            `<div class="history-row"><span>${esc(reason)}</span><strong>${count}次</strong></div>`,
        )
        .join("") ||
      '<p class="tip">答错后选择主要错因，即可区分知识、审题、方法和计算问题。</p>'
    }</section>`
  );
}
function historyView() {
  const rows = Object.values(state.history).sort((a, b) => b.at - a.at);
  return (
    head(
      "保留每一次学习的来路。",
      "记录可按账号同步；过去的答卷使用当时的题目快照，不因后来修订追溯改分。",
    ) +
    `<section class="panel">${rows.map((r) => `<div class="history-row"><div><strong>${esc(r.label)} · ${r.answered}/${r.total}题</strong><small>${date(r.at)} · 答错${r.wrong} · 未答${r.unanswered} · ${clock(r.seconds)}</small></div><div class="actions" style="margin:0"><span class="history-percent">${r.percent === null ? "—" : r.percent + "%"}</span><button class="secondary" data-history="${r.id}">复盘</button></div></div>`).join("") || '<div class="empty"><h2>记录从下一次练习开始</h2><p>完成或结束练习后会生成记录。</p></div>'}</section>`
  );
}
function catalogView() {
  return (
    head(
      "按知识点，找到需要的题。",
      "可检索题干、案例、任务、难度、题型和学习状态。",
    ) +
    `<section class="panel"><div class="form-grid" id="catalog-filters">${filtersHTML()}</div><p id="catalog-count" class="tip"></p><div id="catalog-list"></div></section>`
  );
}
function updateCatalog() {
  const qs = filterQuestions(bank, filterValues()),
    size = 20,
    totalPages = Math.max(1, Math.ceil(qs.length / size));
  catalogPage = Math.max(0, Math.min(catalogPage, totalPages - 1));
  document.querySelector("#catalog-count").textContent =
    `匹配${qs.length}题 · 第${catalogPage + 1}/${totalPages}页`;
  document.querySelector("#catalog-list").innerHTML =
    qs
      .slice(catalogPage * size, (catalogPage + 1) * size)
      .map(
        (q) =>
          `<div class="catalog-item"><div class="chips"><span class="chip">${esc(q.id)}</span><span class="chip">${esc(q.taskId || "未定位")}</span><span class="chip">${esc(q.difficulty || "未标定")}</span>${q.case ? '<span class="chip">案例</span>' : ""}${state.issues[q.id]?.text ? '<span class="chip reported">已标疑</span>' : ""}</div><h3>${esc(q.stem)}</h3><p class="tip">${esc(q.topic)} · ${esc(q.domain)} · ${esc(q.approach)} · ${questionStats(state, q.id).attempts ? "已练" : "未做"}</p>${qualityHTML(q)}<button class="secondary" data-practice-id="${esc(q.id)}">练这道题 →</button></div>`,
      )
      .join("") +
    `<div class="actions"><button class="secondary" data-action="catalog-prev" ${catalogPage === 0 ? "disabled" : ""}>上一页</button><button class="secondary" data-action="catalog-next" ${catalogPage === totalPages - 1 ? "disabled" : ""}>下一页</button></div>`;
}
function libraryView() {
  const reviewed = bank.filter(
      (q) => q.review?.status === "logic-reviewed",
    ).length,
    mapped = bank.filter((q) => q.taskId).length,
    issues = Object.entries(state.issues).filter(([, v]) => v.text);
  const sourcesPanel = `<div class="section-title"><h2>2022至今的公开模拟资料</h2><span>核对日期 ${REVIEWED_AT}</span></div><section class="panel"><p class="tip">下列为原站练习入口，外部题量不计入内置${seedBank.length}题。英文原站可使用浏览器翻译；各站账号与记录不与本平台互通。</p>${practiceResources.map((r) => `<div class="catalog-item"><div class="chips"><span class="chip">${esc(r.kind)}</span><span class="chip">${esc(r.language)}</span></div><a class="source-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)} ↗</a><p>${esc(r.count)} · ${esc(r.period)}</p><p class="tip">${esc(r.note)}</p></div>`).join("")}</section>`;
  const fidelityPanel = `<div class="section-title"><h2>与正式考试接近到什么程度？</h2></div><section class="panel table-wrap"><p class="tip">目前没有可复核的实考试题参数及群体首答数据，暂不能给出“相似度90%”或通过率。</p><table class="diagnostic-table"><thead><tr><th>维度</th><th>当前结论</th><th>依据与差距</th></tr></thead><tbody>${fidelityChecks.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></section><div class="section-title"><h2>考试版本对照</h2></div><section class="panel">${examVersions.map((v) => `<div class="catalog-item"><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.label)} ↗</a><p>${esc(v.period)} · ${esc(v.weights)}</p><p class="tip">${esc(v.note)}</p></div>`).join("")}</section>`;
  return (
    head(
      "题库有版本，复核有边界。",
      "优先核对依据、假设和选项逻辑，遇到歧义可以标疑留存。",
    ) +
    `<section class="panel"><h2>当前题库 · ${bank.length}题</h2><div class="result-grid"><div class="result-mini">有任务定位<strong>${mapped}/${bank.length}</strong></div><div class="result-mini">已做AI逻辑复查<strong>${reviewed}/${bank.length}</strong></div><div class="result-mini">独立专家签审<strong>尚未完成</strong></div></div><p class="tip">内置240题：原有180道原创练习（含30个案例），新增60道MIT开源题中文译编。每道译题可核对原文、答案、作者难度及译编说明。没有将它们标为历年正式真题。</p><div class="note">大纲链接用于知识点定位，不是PMI对本题答案的背书。基础 / 进阶为预估难度；训练正确率不等于正式考试通过率。</div><div class="actions"><button class="primary" data-page="catalog">检索题库</button><button class="secondary" data-action="export-bank">导出JSON题库</button>${state.custom?.value ? '<button class="secondary" data-action="reset-bank">恢复内置240题</button>' : ""}</div></section>
    ${fidelityPanel}${sourcesPanel}
    <div class="section-title"><h2>导入自己的题库</h2></div><section class="panel"><p class="tip">支持JSON、CSV和Excel .xlsx。先下载表格模板，用Excel编辑后保存为.xlsx即可导入；先预览检查，再选择追加或替换。扫描PDF请先转成表格并逐题核对。</p><div class="actions"><button class="primary" data-action="import-bank">选择题库文件</button><button class="secondary" data-action="template">下载表格模板</button></div></section>
    <div class="section-title"><h2>学习记录与备份</h2></div><section class="panel"><p class="tip">包含答题记录、间隔复习、收藏、笔记、标疑和未完成进度。备份导入会合并记录，不重复累计同一答题事件。</p><div class="actions"><button class="secondary" data-action="export-backup">导出学习备份</button><button class="secondary" data-action="import-backup">合并学习备份</button><button class="secondary" data-page="sync">账号与同步 →</button></div></section>
    <div class="section-title"><h2>我的题目标疑</h2><span>${issues.length}项</span></div><section class="panel">${issues.map(([id, v]) => `<div class="catalog-item"><h3>${esc(id)}</h3><p class="tip">${esc(v.text)}</p><small>${date(v.at)}</small><div class="actions"><button class="secondary" data-practice-id="${esc(id)}">查看题目</button><button class="secondary" data-clear-issue="${esc(id)}">清除标疑</button></div></div>`).join("") || '<p class="tip">答题时可在“我的笔记与题目纠错”留下问题。这些内容仅保存到自己的账号，不会自动发送给他人。</p>'}</section>
    <div class="section-title"><h2>官方依据</h2></div><section class="panel"><a class="source-link" href="${mainlandProfile.source}" target="_blank" rel="noopener">PMI中国：大陆新版考试说明 ↗<small>2026年12月5日起启用新版，180题、240分钟。考务以报名通知及准考信为准。</small></a><a class="source-link" href="${mainlandProfile.outline}" target="_blank" rel="noopener">中国大陆适用的2026年12月ECO ↗<small>本平台任务定位与领域编排依据，核对日期2026-11-11。</small></a><a class="source-link" href="https://scrumguides.org/scrum-guide.html" target="_blank" rel="noopener">The Scrum Guide ↗<small>Scrum角色、产品待办事项与完成定义等背景参考。</small></a><a class="source-link" href="https://www.pmi.org/blog/earned-value-management" target="_blank" rel="noopener">PMI：挣值指标与公式 ↗<small>计算时需要同时确认公式适用的假设。</small></a></section>`
  );
}
function syncView() {
  return (
    head(
      "手机和电脑，接着学。",
      "使用同一账号同步个人学习数据；本机记录保留，离线时可继续练习。",
    ) +
    `<section class="panel"><div class="chips"><span class="chip">${esc(syncStatus)}</span></div><h2 style="margin-top:20px">${user ? esc(user.email || "已登录账号") : "当前为本机模式"}</h2><p class="tip">${user ? "答题事件、间隔复习、收藏、笔记和进度按当前账号保存。两台设备更新会先合并，再同步；同一场答题按题目合并选择，已结束状态不会被旧进度恢复。" : "本地HTML文件无需登录。若希望跨设备继续学习，请打开在线版并使用相同邮箱登录。"}</p><div class="actions">${cloud ? '<button class="primary" data-action="sync-now">立即同步并检查另一设备更新</button>' : ""}<button class="secondary" data-action="export-backup">导出备份</button><button class="secondary" data-action="import-backup">合并备份</button></div><div class="note">清理浏览器数据前建议确认已同步或导出备份。两台设备请避免同时继续同一场限时训练；正式训练计时不会因切换设备暂停。</div></section>`
  );
}
function importView() {
  const p = pendingImport;
  if (!p)
    return empty("尚未选择文件", "从题库与资料选择要导入的题库。", "library");
  return (
    head("先检查，再纳入题库。", `${p.name} · 共${p.questions.length}题`) +
    `<section class="panel"><p class="tip">未定位任务：${p.questions.filter((q) => !q.taskId).length}题；无依据链接：${p.questions.filter((q) => !q.references?.length).length}题。导入数据仅通过格式检查，不表示内容已经核验。</p><div class="note">追加要求题号不与当前题库重复。替换只更换当前题库，历史答卷、笔记及答题事件保留；相同题号会关联旧学习记录。</div><div class="actions"><button class="primary" data-action="import-append">追加到当前题库</button><button class="secondary" data-action="import-replace">替换当前题库</button><button class="secondary" data-page="library">取消</button></div>${p.questions
      .slice(0, 8)
      .map(
        (q) =>
          `<div class="catalog-item"><span class="chip">${esc(q.id)}</span><h3>${esc(q.stem)}</h3><p class="tip">${esc(q.domain)} · ${esc(q.approach)} · ${q.answer.length > 1 ? "多选" : "单选"} · ${q.options.length}个选项</p></div>`,
      )
      .join(
        "",
      )}<p class="tip">预览前8题，导入时会纳入全部${p.questions.length}题。</p></section>`
  );
}
function render() {
  settleTime();
  document.body.classList.toggle("in-quiz", page === "quiz");
  refreshBank();
  document.querySelector("#page-label").textContent =
    labels[page] || labels.home;
  document
    .querySelectorAll("nav button")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  app.innerHTML = (
    {
      home: homeView,
      quiz: quizView,
      result: resultView,
      diagnostics: diagnosticsView,
      history: historyView,
      library: libraryView,
      catalog: catalogView,
      sync: syncView,
      import: importView,
    }[page] || (() => setupView(page))
  )();
  if (!storageOK)
    app.insertAdjacentHTML(
      "afterbegin",
      '<p class="warning" role="alert">本机记录未能成功保存，请导出学习备份并检查云端同步状态。</p>',
    );
  if (page === "catalog") updateCatalog();
  updateStatus();
  beginTime();
}
function selectedPool() {
  return filterQuestions(
    sourcePool(document.querySelector("#setup-form")?.dataset.mode || page),
    filterValues(),
  );
}
function updateSetup() {
  const qs = selectedPool(),
    input = document.querySelector("#count");
  if (!input) return;
  input.max = Math.max(1, qs.length);
  input.value = Math.min(Number(input.value) || 1, Math.max(1, qs.length));
  document.querySelector("#pool-count").textContent =
    `当前筛选可用${qs.length}题；同场不重复。`;
  document.querySelector("#setup-form [type=submit]").disabled = !qs.length;
}
function eventForCurrent() {
  return state.events[`${activeId}:${currentQuestion()?.id}`];
}

document.addEventListener("submit", (e) => {
  if (e.target.id !== "setup-form") return;
  e.preventDefault();
  let qs = selectedPool();
  const n = Number(document.querySelector("#count").value),
    mode = e.target.dataset.mode === "exam" ? "exam" : "practice";
  if (!Number.isInteger(n) || n < 1 || n > qs.length)
    return toast("题数超过当前可用范围。");
  const order = document.querySelector("#order")?.value;
  if (order === "new")
    qs = [
      ...shuffle(qs.filter((q) => !questionStats(state, q.id).attempts)),
      ...shuffle(qs.filter((q) => questionStats(state, q.id).attempts)),
    ];
  else if (order !== "ordered") qs = shuffle(qs);
  begin(mode, qs.slice(0, n), {
    minutes: Number(document.querySelector("#minutes")?.value || 0),
    label: labels[e.target.dataset.mode],
    randomOptions: document.querySelector("#shuffle-options").checked,
  });
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.name === "answer" || el.name === "confidence") {
    if (!inExamTime()) return;
    const s = active(),
      q = currentQuestion();
    if (s.checked.includes(q.id)) return;
    if (el.name === "answer") {
      s.answers[q.id] = [
        ...document.querySelectorAll("[name=answer]:checked"),
      ].map((x) => Number(x.value));
      s.answerAt[q.id] = Date.now();
    } else s.confidence[q.id] = el.value;
    s.answerAt[q.id] = Date.now();
    s.updatedAt = Date.now();
    save();
    const num = document.querySelector(`[data-index="${s.index}"]`);
    num?.classList.toggle("answered", !!s.answers[q.id]?.length);
  } else if (el.id === "error-reason") {
    const ev = eventForCurrent();
    if (ev) {
      ev.reason = el.value;
      ev.updatedAt = Date.now();
      save();
    }
  } else if (el.id === "review-filter") {
    const s = state.sessions[resultId];
    document.querySelector("#review-list").innerHTML = reviewList(
      questionsOf(state, s),
      s,
      el.value,
    );
  } else if (document.querySelector("#setup-form")) updateSetup();
  else if (page === "catalog") {
    catalogPage = 0;
    updateCatalog();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    if (page === "catalog") {
      catalogPage = 0;
      updateCatalog();
    } else updateSetup();
  }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  if (b.dataset.page) return go(b.dataset.page);
  if (b.dataset.resume) {
    activeId = b.dataset.resume;
    save();
    return go("quiz");
  }
  if (b.dataset.history) {
    resultId = b.dataset.history;
    return go("result");
  }
  if (b.dataset.paper) {
    const p = makePapers(bank).find((p) => p.id === Number(b.dataset.paper));
    if (p) return begin("practice", p.questions, { label: p.title });
  }
  if (b.dataset.taskDrill) {
    const qs = bank.filter((q) => q.taskId === b.dataset.taskDrill);
    return begin("practice", shuffle(qs), {
      label: taskById(b.dataset.taskDrill)?.title || "考点练习",
    });
  }
  if (b.dataset.practiceId) {
    const q =
      bank.find((q) => q.id === b.dataset.practiceId) ||
      Object.values(state.snapshots).find((q) => q.id === b.dataset.practiceId);
    if (q) return begin("practice", [q], { label: "单题巩固" });
  }
  if (b.dataset.clearIssue) {
    state.issues[b.dataset.clearIssue] = { text: "", at: Date.now() };
    save();
    return render();
  }
  if (b.dataset.index !== undefined) {
    if (!inExamTime()) return;
    settleTime();
    active().index = Number(b.dataset.index);
    active().updatedAt = Date.now();
    save();
    return go("quiz");
  }
  const action = b.dataset.action;
  if (!action) return;
  if (action === "community-drill") {
    const pack = seedBank.filter(
      (q) => sourceKind(q) === "open-source-adapted",
    );
    if (state.custom?.value) {
      const ids = new Set(bank.map((q) => q.id)),
        missing = pack.filter((q) => !ids.has(q.id));
      if (bank.length + missing.length > 5000)
        return toast("当前题库已接近5000题，请先分库保存后再追加。");
      state.custom = { value: [...bank, ...missing], at: Date.now() };
      refreshBank();
    }
    return begin(
      "practice",
      pack.map((q) => bank.find((current) => current.id === q.id) || q),
      { label: "60题 · 开源情境译编" },
    );
  }
  if (action === "quick")
    return begin("practice", sampleFresh(10), { label: "10题热身" });
  if (action === "full" || action === "half") {
    const n = action === "full" ? 180 : 90;
    if (bank.length < n) return toast(`当前题库不足${n}题，可使用自定义训练。`);
    return begin("exam", sampleExam(n), {
      minutes: action === "full" ? 240 : 120,
      label: n + "题 · " + (action === "full" ? "全程" : "半程") + "训练",
    });
  }
  if (action === "review-due") {
    const due = reviewQueue(state, bank, { dueOnly: true });
    if (!due.length)
      return toast("今天没有到期题目；待巩固题可到间隔复习提前练习。");
    return begin("practice", due, { label: "今日到期复习" });
  }
  if (action === "retry-result") {
    const s = state.sessions[resultId],
      qs = questionsOf(state, s).filter(
        (q) =>
          s.answers[q.id]?.length &&
          (!correct(q, s.answers[q.id]) || s.confidence[q.id] === "guess"),
      );
    return qs.length
      ? begin("practice", qs, { label: "本次错题与猜测题" })
      : toast("本次没有答错或标记猜测的题目。");
  }
  if (action === "catalog-prev" || action === "catalog-next") {
    catalogPage += action === "catalog-next" ? 1 : -1;
    return updateCatalog();
  }
  if (action === "export-bank") return download("PMP-当前题库.json", bank);
  if (action === "export-backup") {
    settleTime();
    save();
    download("PMP-学习备份.json", {
      format: "pmp-room-backup-v2",
      createdAt: Date.now(),
      state,
    });
    beginTime();
    return;
  }
  if (action === "template")
    return download(
      "PMP-题库导入模板.csv",
      csvTemplate(),
      "text/csv;charset=utf-8",
    );
  if (action === "import-bank" || action === "import-backup") {
    const input = document.querySelector("#file-input");
    input.dataset.purpose = action;
    input.accept = action === "import-bank" ? ".json,.csv,.xlsx" : ".json";
    input.value = "";
    input.click();
    return;
  }
  if (action === "import-append" || action === "import-replace") {
    if (!pendingImport) return;
    const incoming = pendingImport.questions;
    if (action === "import-append") {
      const existing = new Set(bank.map((q) => q.id)),
        duplicates = incoming.filter((q) => existing.has(q.id));
      if (duplicates.length)
        return toast(
          "题号重复：" +
            duplicates
              .slice(0, 4)
              .map((q) => q.id)
              .join("、") +
            "。请修改题号或选择替换。",
        );
      if (bank.length + incoming.length > 5000)
        return toast("合并后超过5000题，请分批使用。");
    }
    const commit = () => {
      state.custom = {
        value: action === "import-append" ? [...bank, ...incoming] : incoming,
        at: Date.now(),
      };
      pendingImport = null;
      save();
      go("library");
      toast("题库已更新，历史记录保留。");
    };
    return action === "import-replace"
      ? ask(
          "替换当前题库？",
          "当前题库会更换为导入题目，历史答卷和学习记录保留。",
          commit,
        )
      : commit();
  }
  if (action === "reset-bank")
    return ask(
      "恢复内置240题？",
      "当前题库将切换为内置题库，历史记录、收藏和笔记保留。",
      () => {
        state.custom = { value: null, at: Date.now() };
        save();
        go("library");
      },
    );
  if (action === "sync-now") return cloud?.flush({ refresh: true });
  if (action === "show-nav") {
    document
      .querySelector(".quiz-side")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const s = active(),
    q = currentQuestion();
  if (!s || !q) return;
  if (action === "prev" || action === "next") {
    if (!inExamTime()) return;
    settleTime();
    s.index = Math.min(
      s.questionKeys.length - 1,
      Math.max(0, s.index + (action === "next" ? 1 : -1)),
    );
    s.updatedAt = Date.now();
    save();
    return go("quiz");
  }
  if (action === "check") return submitAnswer();
  if (action === "favorite") {
    state.favorites[q.id] = {
      value: !state.favorites[q.id]?.value,
      at: Date.now(),
    };
    save();
    return render();
  }
  if (action === "flag") {
    s.flags = s.flags.includes(q.id)
      ? s.flags.filter((id) => id !== q.id)
      : [...s.flags, q.id];
    s.updatedAt = Date.now();
    save();
    return render();
  }
  if (action === "save-note") {
    state.notes[q.id] = {
      text: document.querySelector("#question-note").value.trim(),
      at: Date.now(),
    };
    save();
    return toast("笔记已保存。");
  }
  if (action === "save-issue") {
    state.issues[q.id] = {
      text: document.querySelector("#question-issue").value.trim(),
      at: Date.now(),
    };
    save();
    return toast("标疑已保存到自己的学习记录。");
  }
  if (action === "finish") {
    settleTime();
    const n = questionsOf(state, s).filter(
      (q) => !s.answers[q.id]?.length,
    ).length;
    return ask(
      s.mode === "exam" ? "确认交卷？" : "结束本组练习？",
      n
        ? `还有${n}题未答。${s.mode === "exam" ? "未答会影响本次训练分数，" : "未答不计错，"}不会进入错题复习。`
        : "结束后可查看全部解析和分项结果。",
      () => finishCurrent(),
    );
  }
});
document.querySelector("#file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (e.target.dataset.purpose === "import-bank") {
      pendingImport = {
        name: file.name,
        questions: await readQuestionFile(file),
      };
      return go("import");
    }
    if (file.size > 32 * 1024 * 1024) throw Error("请使用32MB以内的备份文件。");
    const value = JSON.parse(await file.text());
    let incoming;
    if (value.format === "pmp-room-backup-v2")
      incoming = validateState(value.state, validateBank);
    else if (value.format === "pmp-room-backup-v1") {
      if (value.bank) validateBank(value.bank);
      incoming = migrateLegacy(value.data);
      validateState(incoming, validateBank);
    } else throw Error("不是支持的学习备份。");
    ask(
      "合并学习备份？",
      "合并答题事件、收藏、笔记和进度；相同事件不会重复累计。",
      () => {
        settleTime();
        state = mergeStates(state, incoming);
        save();
        go("home");
        toast("学习备份已合并。");
      },
    );
  } catch (error) {
    toast("导入失败：" + error.message);
  }
});
document.addEventListener("keydown", (e) => {
  if (
    page !== "quiz" ||
    e.altKey ||
    e.ctrlKey ||
    e.metaKey ||
    document.querySelector("#confirm-dialog").open ||
    e.target.closest(
      "textarea,select,input[type=search],input[type=text],input[type=number]",
    )
  )
    return;
  const key = e.key;
  if (/^[1-8]$/.test(key)) {
    const el = document.querySelector(
      `[name=answer][data-position="${Number(key) - 1}"]`,
    );
    if (el && !el.disabled) {
      e.preventDefault();
      el.click();
    }
  }
  if (key === "Enter" && active()?.mode !== "exam") {
    e.preventDefault();
    submitAnswer();
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    e.preventDefault();
    document
      .querySelector(`[data-action="${key === "ArrowLeft" ? "prev" : "next"}"]`)
      ?.click();
  }
  if (key.toLowerCase() === "f") {
    e.preventDefault();
    document.querySelector("[data-action=flag]")?.click();
  }
});
document.addEventListener("visibilitychange", () => {
  settleTime();
  persist();
  if (!document.hidden) {
    beginTime();
    cloud?.flush({ refresh: true });
  }
});
window.addEventListener("pagehide", () => {
  settleTime();
  persist();
});
window.addEventListener("online", () => cloud?.flush({ refresh: true }));
document.querySelector(".brand").addEventListener("click", (e) => {
  e.preventDefault();
  go("home");
});
setInterval(() => {
  const s = active(),
    el = document.querySelector("#timer");
  if (s?.mode === "exam" && !s.finishedAt && el) {
    const n = remaining(s);
    el.textContent = clock(n);
    el.classList.toggle("urgent", n < 300);
  }
  for (const session of Object.values(state.sessions)) {
    if (
      session.mode === "exam" &&
      !session.finishedAt &&
      remaining(session) === 0
    ) {
      if (session.id === activeId) {
        const d = document.querySelector("#confirm-dialog");
        if (d.open) {
          d.onclose = null;
          d.close();
        }
        finishCurrent(true);
      } else {
        finishSession(state, session, session.deadline);
        save();
      }
    }
  }
}, 1000);
setInterval(() => {
  if (segment) {
    settleTime();
    persist();
    beginTime();
  }
}, 10000);
setInterval(() => {
  if (
    cloud &&
    !document.hidden &&
    !document.querySelector("#confirm-dialog").open
  )
    cloud.flush({ refresh: true });
}, 45000);

async function boot() {
  app.innerHTML = '<div class="panel empty">正在读取学习记录…</div>';
  if (location.protocol !== "file:") {
    try {
      const response = await fetch("/api/me", {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (response.ok) user = await response.json();
    } catch {}
  }
  storageKey = "pmp-room-v2:" + (user?.id || "offline");
  await localStore.open();
  try {
    const saved = await localStore.read(storageKey);
    if (saved) state = validateState(saved, validateBank);
    else {
      const old = JSON.parse(localStorage.getItem(legacyKey) || "null"),
        owner = localStorage.getItem("pmp-room-v1-migrated-owner");
      if (old && (!owner || owner === (user?.id || "offline"))) {
        state = migrateLegacy(old);
        validateState(state, validateBank);
        localStorage.setItem(
          "pmp-room-v1-migrated-owner",
          user?.id || "offline",
        );
      }
    }
    activeId = localStorage.getItem(activeKey());
    if (activeId && !state.sessions[activeId]) activeId = null;
  } catch {
    storageOK = false;
    toast("部分本机记录无法读取，原始记录未被删除；可以从备份恢复。");
  }
  refreshBank();
  render();
  if (user) {
    cloud = new CloudSync({
      getState: () => state,
      replaceState: (value) => {
        const index = active()?.index;
        settleTime();
        state = mergeStates(state, value);
        if (
          page === "quiz" &&
          active() &&
          !active().finishedAt &&
          Number.isInteger(index)
        )
          active().index = index;
        refreshBank();
      },
      persist,
      onStatus: (level, message) => {
        syncLevel = level;
        syncStatus = message;
        updateStatus();
      },
      onRemote: () => {
        if (page === "quiz") {
          const s = active();
          if (s?.finishedAt) {
            resultId = s.id;
            page = "result";
            render();
          } else if (!document.activeElement?.closest("textarea")) render();
          else beginTime();
        } else if (
          [
            "home",
            "diagnostics",
            "history",
            "library",
            "sync",
            "result",
          ].includes(page) &&
          !document.querySelector("#confirm-dialog").open
        )
          render();
      },
    });
    cloud.start();
  } else {
    syncStatus =
      location.protocol === "file:"
        ? "免登录 · 本机保存"
        : "本机保存 · 云同步未连接";
    updateStatus();
  }
  const hash = location.hash.slice(1);
  if (hash === "start") {
    const unfinished = Object.values(state.sessions)
      .filter((s) => !s.finishedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (unfinished) {
      activeId = unfinished.id;
      go("quiz");
    } else begin("practice", sampleFresh(10), { label: "10题热身" });
  } else if (labels[hash] && !["quiz", "result", "import"].includes(hash))
    go(hash);
}
validateBank(seedBank);
boot();
