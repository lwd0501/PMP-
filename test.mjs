import test from "node:test";
import assert from "node:assert/strict";
import { seedBank } from "./src/questions.js";
import {
  correct,
  remaining,
  score,
  validateBank,
  shuffle,
} from "./src/core.js";
import { makePapers } from "./src/mainland.js";
test("原创题库结构、数量及分布", () => {
  validateBank(seedBank);
  assert.equal(seedBank.length, 180);
  assert.equal(seedBank.filter((q) => q.answer.length > 1).length, 24);
  assert.deepEqual(
    ["人员", "过程", "商业环境"].map(
      (d) => seedBank.filter((q) => q.domain === d).length,
    ),
    [59, 74, 47],
  );
  assert.equal(new Set(seedBank.map((q) => q.stem)).size, 180);
});
test("多选必须完整匹配，顺序不影响判定", () => {
  const q = seedBank.find((q) => q.answer.length > 1);
  assert.equal(correct(q, [...q.answer].reverse()), true);
  assert.equal(correct(q, q.answer.slice(0, 1)), false);
  assert.equal(correct(q, [0, 1, 2, 3]), false);
  assert.equal(correct(q, []), false);
});
test("整卷未答计错并按领域汇总", () => {
  const answers = Object.fromEntries(
    seedBank.slice(0, 8).map((q) => [q.id, q.answer]),
  );
  const s = score(seedBank, answers);
  assert.equal(s.right, 8);
  assert.equal(s.total, 180);
  assert.equal(s.percent, 4);
  assert.deepEqual(s.domains["人员"], { right: 6, total: 59 });
  assert.equal(score(seedBank, {}).right, 0);
});
test("截止时间跨刷新保持，到期不出现负数", () => {
  const saved = JSON.parse(JSON.stringify({ deadline: 240000 }));
  assert.equal(remaining(saved, 60000), 180);
  assert.equal(remaining(saved, 240001), 0);
});
test("无放回抽题不重复也不修改题库", () => {
  const before = seedBank.map((q) => q.id);
  const sample = shuffle(seedBank);
  assert.equal(new Set(sample.map((q) => q.id)).size, 180);
  assert.deepEqual(
    seedBank.map((q) => q.id),
    before,
  );
});
test("导入拒绝重复ID、非法答案和缺少解析", () => {
  const clone = () => structuredClone(seedBank);
  let x = clone();
  x[1].id = x[0].id;
  assert.throws(() => validateBank(x));
  x = clone();
  x[0].answer = [99];
  assert.throws(() => validateBank(x));
  x = clone();
  x[0].rationales = [];
  assert.throws(() => validateBank(x));
});
test("六组各30题，组间无重复，合计覆盖180题", () => {
  const p = makePapers(seedBank);
  assert.deepEqual(
    p.map((x) => x.questions.length),
    [30, 30, 30, 30, 30, 30],
  );
  assert.equal(
    new Set(p.flatMap((x) => x.questions.map((q) => q.id))).size,
    180,
  );
});
test("历史题目id保留，新题id连续且无冲突", () => {
  assert.deepEqual(
    seedBank.map((q) => q.id),
    Array.from(
      { length: 180 },
      (_, i) => `PMP-${String(i + 1).padStart(3, "0")}`,
    ),
  );
});
test("完整正确作答和多选漏选的整卷计分", () => {
  const answers = Object.fromEntries(seedBank.map((q) => [q.id, q.answer]));
  assert.equal(score(seedBank, answers).right, 180);
  const q = seedBank.find((q) => q.answer.length > 1);
  answers[q.id] = q.answer.slice(1);
  assert.equal(score(seedBank, answers).right, 179);
});
