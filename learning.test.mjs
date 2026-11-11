import test from "node:test";
import assert from "node:assert/strict";
import { seedBank } from "./src/questions.js";
import { validateBank } from "./src/core.js";
import {
  DAY,
  emptyState,
  createSession,
  recordAttempt,
  questionStats,
  reviewQueue,
  finishSession,
  mergeStates,
  migrateLegacy,
  validateState,
  diagnostics,
  questionsOf,
} from "./src/learning.js";
import { parseCSV, rowsToQuestions, csvTemplate } from "./src/importers.js";
const q = seedBank[0],
  now = 1700000000000;
function attempt(state, correctAnswer, at, confidence = "sure") {
  const s = createSession(state, [q], { now: at });
  s.answers[q.id] = correctAnswer
    ? q.answer
    : [q.options.findIndex((_, i) => !q.answer.includes(i))];
  recordAttempt(state, s, q, { now: at, confidence });
  finishSession(state, s, at);
  return s;
}
test("未答练习不计错、不进入复习，考试仍按全卷计算", () => {
  const state = emptyState(),
    s = createSession(state, seedBank.slice(0, 3), { now });
  s.answers[q.id] = q.answer;
  const r = finishSession(state, s, now + 1000);
  assert.equal(r.answered, 1);
  assert.equal(r.unanswered, 2);
  assert.equal(r.percent, 100);
  assert.equal(Object.keys(state.events).length, 1);
  assert.equal(reviewQueue(state, seedBank).length, 0);
  const exam = createSession(state, seedBank.slice(0, 3), {
    mode: "exam",
    minutes: 1,
    now,
  });
  exam.answers[q.id] = q.answer;
  const er = finishSession(state, exam, now + 60000);
  assert.equal(er.percent, 33);
  assert.equal(er.unanswered, 2);
  assert.equal(reviewQueue(state, seedBank).length, 0);
});
test("猜对进入复习，首次答对不冒充已经掌握", () => {
  const state = emptyState();
  attempt(state, true, now, "guess");
  assert.equal(questionStats(state, q.id).pending, true);
  assert.equal(questionStats(state, q.id).right, 1);
  assert.equal(
    reviewQueue(state, [q], { now: now + 1000, dueOnly: true }).length,
    0,
  );
  assert.equal(
    reviewQueue(state, [q], { now: now + DAY, dueOnly: true }).length,
    1,
  );
});
test("需要三个到期的可靠复习；同日提前刷不能跳过间隔", () => {
  const state = emptyState();
  attempt(state, false, now);
  attempt(state, true, now + 1000);
  assert.equal(questionStats(state, q.id).stage, 0);
  attempt(state, true, now + DAY);
  assert.equal(questionStats(state, q.id).stage, 1);
  assert.equal(questionStats(state, q.id).pending, true);
  attempt(state, true, now + 4 * DAY);
  assert.equal(questionStats(state, q.id).stage, 2);
  assert.equal(questionStats(state, q.id).pending, true);
  attempt(state, true, now + 11 * DAY);
  assert.equal(questionStats(state, q.id).pending, false);
});
test("再次答错重置复习间隔", () => {
  const state = emptyState();
  attempt(state, false, now);
  attempt(state, true, now + DAY);
  attempt(state, false, now + 2 * DAY);
  const s = questionStats(state, q.id);
  assert.equal(s.stage, 0);
  assert.equal(s.due, now + 3 * DAY);
});
test("同一场同一题重复提交不累计；首答与重复成绩分开", () => {
  const state = emptyState(),
    s = attempt(state, false, now);
  recordAttempt(state, s, q, { now: now + 500 });
  assert.equal(Object.keys(state.events).length, 1);
  attempt(state, true, now + 1000);
  const d = diagnostics(state, [q]);
  assert.equal(d.firstRight, 0);
  assert.equal(d.firstTotal, 1);
  assert.equal(d.right, 1);
  assert.equal(d.attempts, 2);
});
test("打乱后使用原选项下标，单选与多选均正确计分", () => {
  const state = emptyState(),
    multi = seedBank.find((q) => q.answer.length > 1),
    s = createSession(state, [q, multi], { now, randomOptions: true });
  for (const question of [q, multi]) {
    const order = s.optionOrder[question.id];
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      question.options.map((_, i) => i),
    );
    s.answers[question.id] = question.answer.map(
      (original) => order[order.indexOf(original)],
    );
  }
  assert.equal(finishSession(state, s, now + 1000).right, 2);
});
test("合并两台设备的独立答题不丢失、不重复；收藏删除有时间戳", () => {
  const a = emptyState(),
    b = emptyState();
  attempt(a, false, now);
  attempt(b, true, now + DAY);
  a.favorites[q.id] = { value: true, at: 10 };
  b.favorites[q.id] = { value: false, at: 20 };
  const merged = mergeStates(a, b),
    again = mergeStates(merged, b);
  assert.equal(Object.keys(again.events).length, 2);
  assert.equal(questionStats(again, q.id).attempts, 2);
  assert.equal(again.favorites[q.id].value, false);
  assert.deepEqual(mergeStates(a, b), mergeStates(b, a));
});
test("已结束的答题不会被旧设备的未完成快照恢复", () => {
  const a = emptyState(),
    s = createSession(a, [q], { now }),
    b = structuredClone(a);
  s.answers[q.id] = q.answer;
  finishSession(a, s, now + 1000);
  const merged = mergeStates(a, b);
  assert.equal(merged.sessions[s.id].finishedAt, now + 1000);
  assert.equal(Object.keys(merged.history).length, 1);
});
test("旧版收藏、统计、历史和未完成答题迁移；已计分题不重复累计", () => {
  const old = {
    stats: {
      [q.id]: { attempts: 2, right: 1, lastCorrect: true, lastAt: now },
    },
    favorites: [q.id],
    history: [],
    custom: null,
    session: {
      questions: [q],
      answers: { [q.id]: q.answer },
      checked: [q.id],
      flags: [],
      index: 0,
      start: now,
      mode: "practice",
    },
  };
  const state = migrateLegacy(old);
  validateState(state, validateBank);
  const s = Object.values(state.sessions)[0];
  assert.equal(state.favorites[q.id].value, true);
  finishSession(state, s, now + 1000);
  assert.equal(questionStats(state, q.id).attempts, 2);
  assert.equal(questionStats(state, q.id).firstUnknown, true);
});
test("历史答卷保留题目快照，不追溯使用新版选项", () => {
  const state = emptyState(),
    s = createSession(state, [q], { now });
  const snapshot = questionsOf(state, s)[0];
  assert.notEqual(snapshot, q);
  const changed = { ...q, stem: "changed" };
  assert.notEqual(snapshot.stem, changed.stem);
  assert.equal(snapshot.stem, q.stem);
});
test("180题均有有效任务、依据、预估难度和诚实复核状态", () => {
  assert.equal(new Set(seedBank.map((q) => q.taskId)).size, 26);
  assert.equal(
    new Set(seedBank.filter((q) => q.case).map((q) => q.case.id)).size,
    30,
  );
  for (const q of seedBank) {
    assert.ok(q.references.length);
    assert.equal(q.review.independent, false);
    assert.equal(q.review.status, "logic-reviewed");
    assert.ok(q.rationales.every(Boolean));
  }
});
test("CSV模板及带逗号、引号、换行的单元格能够正确读取", () => {
  const qs = rowsToQuestions(parseCSV(csvTemplate()));
  assert.equal(qs.length, 1);
  assert.deepEqual(qs[0].answer, [0]);
  assert.equal(qs[0].taskId, "P2");
  assert.deepEqual(parseCSV('a,b\r\n"x,y","line1\nline2"\r\n"say ""yes""",z'), [
    ["a", "b"],
    ["x,y", "line1\nline2"],
    ['say "yes"', "z"],
  ]);
  assert.throws(() => parseCSV('a,b\n"unfinished'));
});
test("备份拒绝非法快照和越界选项", () => {
  const state = emptyState(),
    s = createSession(state, [q], { now });
  s.answers[q.id] = [999];
  assert.throws(() => validateState(state, validateBank));
});
