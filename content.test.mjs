import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { seedBank } from "./src/questions.js";
import { communityOriginal } from "./src/community-original.js";
import { assembleExam, examComposition } from "./src/exams.js";
import { sourceKind, practiceResources } from "./src/resources.js";
import { validateBank } from "./src/core.js";
const translated = seedBank.filter(
  (q) => sourceKind(q) === "open-source-adapted",
);
test("60道译题保留原题编号、答案、完整英文与MIT署名，不声称真题或统计难度", () => {
  assert.equal(translated.length, 60);
  assert.equal(new Set(translated.map((q) => q.taskId)).size, 26);
  for (const q of translated) {
    const p = q.provenance,
      original = communityOriginal.find((row) => row[0] === p.sourceId);
    assert.ok(original);
    assert.equal(p.original.stem, original[4]);
    assert.deepEqual(p.original.options, original[5]);
    assert.deepEqual(
      q.answer,
      Array.isArray(original[6]) ? original[6] : [original[6]],
    );
    assert.equal(q.options.length, original[5].length);
    assert.equal(p.examOccurrenceVerified, false);
    assert.equal(q.difficultyEvidence.calibrated, false);
    assert.ok(p.licenseNotice.includes("Copyright (c) 2026 Gustavo Angulo"));
    assert.ok(p.sourceUrl.includes(p.sourceCommit));
    assert.ok(q.references.some((r) => r.url === p.sourceUrl));
  }
  assert.ok(
    fs.readFileSync("THIRD_PARTY_NOTICES.md", "utf8").includes("MIT License"),
  );
});
test("有歧义的原候选未纳入，补充前提保留改写说明，公式答案可复算", () => {
  assert.ok(
    !translated.some((q) =>
      ["pr2-04", "pr1-04"].includes(q.provenance.sourceId),
    ),
  );
  const wsjf = translated.find((q) => q.provenance.sourceId === "pr3-02");
  assert.ok(wsjf.stem.includes("延迟成本相同"));
  assert.ok(wsjf.provenance.clarification);
  const pert = translated.find((q) => q.provenance.sourceId === "pr1-08");
  assert.equal(pert.options[pert.answer[0]], (4 + 4 * 7 + 16) / 6 + "天");
  const channels = translated.find((q) => q.provenance.sourceId === "pe8-02");
  assert.equal(
    parseInt(channels.options[channels.answer[0]]),
    (9 * 8) / 2 - (6 * 5) / 2,
  );
});
test("标准180题及90题组卷同时满足领域与预测方法比例，无重复且不修改题池", () => {
  const before = seedBank.map((q) => q.id);
  for (let i = 0; i < 20; i++) {
    const full = assembleExam(seedBank, 180);
    assert.deepEqual(full.actual.domains, { 人员: 59, 过程: 74, 商业环境: 47 });
    assert.equal(full.actual.approaches["预测"], 72);
    assert.equal(new Set(full.questions.map((q) => q.id)).size, 180);
    assert.deepEqual(full.warnings, []);
    const half = assembleExam(seedBank, 90);
    assert.equal(half.actual.approaches["预测"], 36);
    assert.equal(half.questions.length, 90);
  }
  assert.deepEqual(
    seedBank.map((q) => q.id),
    before,
  );
});
test("题池不足时显示比例偏差，不伪装标准试卷", () => {
  const bank = seedBank.filter((q) => q.approach !== "预测"),
    paper = assembleExam(bank, 90);
  assert.ok(paper.warnings.length);
  assert.equal(paper.actual.approaches["预测"], 0);
  assert.equal(examComposition(paper.questions).total, paper.questions.length);
});
test("保留历史180题ID，内置来源分类完整，引用资源与真题出现声明区分", () => {
  assert.equal(
    seedBank.filter((q) => sourceKind(q) === "original-practice").length,
    180,
  );
  for (const q of seedBank) {
    assert.equal(q.provenance.examOccurrenceVerified, false);
    assert.ok(q.difficultyEvidence);
    assert.ok(q.rationales.every(Boolean));
  }
  assert.ok(practiceResources.some((r) => r.period.includes("2022–2025")));
  assert.ok(
    practiceResources.some(
      (r) => r.id === "prepcast" && r.period.includes("2026-08-06"),
    ),
  );
  validateBank(seedBank);
});

test("题库导入拒绝会破坏原题展示的来源和难度结构", () => {
  let bad = structuredClone(translated);
  bad[0].provenance.original.options = "invalid";
  assert.throws(() => validateBank(bad));
  bad = structuredClone(translated);
  bad[0].provenance.original.answer = 99;
  assert.throws(() => validateBank(bad));
  bad = structuredClone(translated);
  bad[0].difficultyEvidence.reason = {};
  assert.throws(() => validateBank(bad));
});
