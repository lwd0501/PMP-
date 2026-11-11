import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { seedBank } from "./src/questions.js";
import {
  emptyState,
  createSession,
  finishSession,
  mergeStates,
  questionsOf,
  snapshotKey,
  validateState,
  canonical,
  questionStats,
} from "./src/learning.js";
import { validateBank } from "./src/core.js";
import {
  encodeState,
  decodeState,
  contentId,
  CHUNK_MAX,
} from "./src/state-codec.js";
import { CloudSync } from "./src/sync.js";
import { handleApi } from "./server/api.mjs";
const q = seedBank[0],
  now = 1700000000000;
class D1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const file of fs
      .readdirSync("drizzle")
      .filter((x) => x.endsWith(".sql"))
      .sort())
      this.db.exec(fs.readFileSync("drizzle/" + file, "utf8"));
  }
  prepare(sql) {
    let args = [];
    const db = this.db;
    return {
      bind(...v) {
        args = v;
        return this;
      },
      async first() {
        return db.prepare(sql).get(...args) || null;
      },
      async all() {
        return { results: db.prepare(sql).all(...args) };
      },
      async run() {
        return {
          meta: { changes: Number(db.prepare(sql).run(...args).changes) },
        };
      },
    };
  }
}
function client(env, user = "alice", initial = emptyState()) {
  let state = initial;
  const requests = [],
    statuses = [];
  const sync = new CloudSync({
    getState: () => state,
    replaceState: (value) => {
      state = value;
    },
    persist: () => {},
    onStatus: (level, message) => statuses.push({ level, message }),
    fetcher: async (path, options = {}) => {
      requests.push({
        path,
        method: options.method || "GET",
        bytes: options.body ? Buffer.byteLength(options.body) : 0,
      });
      return handleApi(
        new Request("https://example.test" + path, {
          ...options,
          headers: {
            ...options.headers,
            "oai-authenticated-user-id": user,
            origin: "https://example.test",
          },
        }),
        env,
      );
    },
  });
  return {
    sync,
    requests,
    statuses,
    get state() {
      return state;
    },
    set state(value) {
      state = value;
    },
  };
}
function answer(state, questions = [q], time = now) {
  const s = createSession(state, questions, {
    mode: "exam",
    minutes: 240,
    now: time,
  });
  for (const item of questions) {
    s.answers[item.id] = item.answer;
    s.answerAt[item.id] = time + 10;
    s.times[item.id] = 5000;
  }
  finishSession(state, s, time + 1000);
  return s;
}

test("已交卷答案不被另一设备的迟到答案改写，事件、复盘和分数一致", () => {
  const a = emptyState(),
    s = createSession(a, [q], { mode: "exam", minutes: 1, now }),
    b = structuredClone(a);
  s.answers[q.id] = q.answer;
  s.answerAt[q.id] = now + 10;
  finishSession(a, s, now + 100);
  b.sessions[s.id].answers[q.id] = [
    q.options.findIndex((_, i) => !q.answer.includes(i)),
  ];
  b.sessions[s.id].answerAt[q.id] = now + 200;
  b.sessions[s.id].updatedAt = now + 200;
  const merged = mergeStates(a, b);
  assert.deepEqual(merged.sessions[s.id].answers[q.id], q.answer);
  assert.equal(merged.history[s.id].percent, 100);
  assert.equal(merged.events[`${s.id}:${q.id}`].correct, true);
  assert.deepEqual(mergeStates(a, b), mergeStates(b, a));
  validateState(merged, validateBank);
});
test("两个离线完成版本按首次交卷确定统一答卷，重复合并保持稳定", () => {
  const a = emptyState(),
    s = createSession(a, [q], { mode: "exam", minutes: 1, now }),
    b = structuredClone(a);
  s.answers[q.id] = q.answer;
  finishSession(a, s, now + 100);
  b.sessions[s.id].answers[q.id] = [0];
  finishSession(b, b.sessions[s.id], now + 200);
  const merged = mergeStates(a, b);
  assert.equal(merged.history[s.id].percent, 100);
  assert.deepEqual(merged, mergeStates(b, a));
  assert.deepEqual(merged, mergeStates(merged, b));
});
test("仅修改解析、案例和元数据也生成独立快照；属性顺序不改变标识", () => {
  const state = emptyState(),
    s = createSession(state, [q], { now }),
    changed = structuredClone(q);
  changed.rationales[0] = "new explanation";
  const later = createSession(state, [changed], { now: now + 1 });
  assert.notEqual(s.questionKeys[0], later.questionKeys[0]);
  assert.equal(questionsOf(state, s)[0].rationales[0], q.rationales[0]);
  assert.equal(
    snapshotKey(q),
    snapshotKey(Object.fromEntries(Object.entries(q).reverse())),
  );
});
test("旧快照标识继续计分，事件不会引用不存在的新快照", () => {
  const state = emptyState(),
    s = createSession(state, [q], { now }),
    key = s.questionKeys[0];
  state.snapshots["old-key"] = state.snapshots[key];
  delete state.snapshots[key];
  s.questionKeys = ["old-key"];
  s.answers[q.id] = q.answer;
  finishSession(state, s, now + 1);
  assert.equal(state.events[`${s.id}:${q.id}`].questionKey, "old-key");
});
test("分块完整往返保留自定义题库、笔记与历史，摘要确定且可检测篡改", async () => {
  const state = emptyState();
  answer(state);
  state.custom = { at: 1, value: seedBank };
  state.notes[q.id] = { at: 2, text: "note" };
  const encoded = await encodeState(state);
  assert.deepEqual(decodeState(encoded.manifest, encoded.chunks), state);
  assert.deepEqual((await encodeState(state)).manifest, encoded.manifest);
  for (const [id, text] of encoded.chunks)
    assert.equal(await contentId(text), id);
  const bad = new Map(encoded.chunks);
  bad.delete(encoded.manifest.chunks[0].id);
  assert.throws(() => decodeState(encoded.manifest, bad));
});
test("旧版整包记录自动迁移，空轮询不重复上传，改一条笔记只上传变化块", async () => {
  const env = { DB: new D1() },
    legacy = emptyState();
  answer(legacy);
  env.DB.db
    .prepare("INSERT INTO learning_state VALUES (?, ?, ?, ?)")
    .run("alice", 1, JSON.stringify(legacy), now);
  const a = client(env);
  await a.sync.start();
  assert.equal(a.statuses.at(-1).level, "synced");
  assert.equal(Object.keys(a.state.history).length, 1);
  assert.equal(a.sync.revision, 2);
  const before = a.requests.length;
  await a.sync.flush({ refresh: true });
  assert.equal(
    a.requests.slice(before).filter((r) => r.method === "PUT").length,
    0,
  );
  a.state.notes[q.id] = { text: "changed", at: now };
  const offset = a.requests.length;
  await a.sync.flush();
  assert.equal(
    a.requests
      .slice(offset)
      .filter((r) => r.path.includes("/chunks/") && r.method === "PUT").length,
    1,
  );
  a.sync.stop();
});
test("超过4MB的历史通过小分块完成同步，第二设备读回一致", async () => {
  const env = { DB: new D1() },
    state = emptyState();
  for (let i = 0; i < 60; i++) answer(state, seedBank, now + i * 86400000);
  assert.ok(Buffer.byteLength(JSON.stringify(state)) > 4 * 1024 * 1024);
  const a = client(env, "alice", state);
  await a.sync.start();
  assert.equal(a.statuses.at(-1).level, "synced");
  assert.ok(
    a.requests
      .filter((r) => r.method === "PUT")
      .every((r) => r.bytes <= CHUNK_MAX),
  );
  const b = client(env);
  await b.sync.start();
  assert.equal(b.statuses.at(-1).level, "synced");
  assert.equal(Object.keys(b.state.events).length, 10800);
  assert.equal(canonical(a.state), canonical(b.state));
  a.sync.stop();
  b.sync.stop();
});
test("两设备并发同步合并，分块和进度按账号隔离", async () => {
  const env = { DB: new D1() },
    a = client(env),
    b = client(env);
  await a.sync.start();
  await b.sync.start();
  answer(a.state, [seedBank[0]], now);
  answer(b.state, [seedBank[1]], now + 100);
  await Promise.all([a.sync.flush(), b.sync.flush()]);
  await a.sync.flush({ refresh: true });
  assert.equal(Object.keys(a.state.history).length, 2);
  const ref = a.requests.find(
    (r) => r.method === "PUT" && r.path.includes("/chunks/"),
  );
  const bob = client(env, "bob");
  const response = await bob.sync.fetcher(ref.path);
  assert.equal(response.status, 404);
  await bob.sync.start();
  assert.equal(Object.keys(bob.state.events).length, 0);
  for (const c of [a, b, bob]) c.sync.stop();
});
test("上传中断不替换云端目录；重试后保留全部答题记录", async () => {
  const env = { DB: new D1() },
    a = client(env);
  await a.sync.start();
  answer(a.state);
  const original = a.sync.fetcher;
  let fail = true;
  a.sync.fetcher = async (path, options) =>
    fail && path.endsWith("/manifest") && options?.method === "PUT"
      ? new Response("{}", { status: 503 })
      : original(path, options);
  await a.sync.flush();
  assert.equal(a.statuses.at(-1).level, "offline");
  const b = client(env);
  await b.sync.start();
  assert.equal(Object.keys(b.state.events).length, 0);
  fail = false;
  await a.sync.flush({ refresh: true });
  await b.sync.flush({ refresh: true });
  assert.equal(Object.keys(b.state.events).length, 1);
  a.sync.stop();
  b.sync.stop();
});
test("服务端拒绝错误摘要、缺失分块以及旧客户端篡改已完成答卷", async () => {
  const env = { DB: new D1() },
    a = client(env);
  answer(a.state);
  await a.sync.start();
  const path = "/api/state/chunks/" + "0".repeat(64),
    bad = await a.sync.fetcher(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: '{"section":"notes","entries":[["q",{}]]}',
    });
  assert.equal(bad.status, 400);
  const changed = structuredClone(a.state),
    s = Object.values(changed.sessions)[0];
  s.answers[q.id] = [0];
  s.updatedAt = now + 9999;
  const result = await a.sync.fetcher("/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: a.sync.revision, data: changed }),
  });
  assert.equal(result.status, 409);
  a.sync.stop();
});
test("统计索引在新增答题后失效，不把旧缓存当作最新成绩", () => {
  const state = emptyState();
  assert.equal(questionStats(state, q.id).attempts, 0);
  answer(state);
  assert.equal(questionStats(state, q.id).attempts, 1);
});

test("解析中的不同表情字符也生成不同快照", () => {
  const a = { ...q, rationales: ["😀", ...q.rationales.slice(1)] },
    b = { ...q, rationales: ["😁", ...q.rationales.slice(1)] };
  assert.notEqual(snapshotKey(a), snapshotKey(b));
});
test("缺失的分块不能提交为目录，当前云端版本保持不变", async () => {
  const env = { DB: new D1() },
    a = client(env);
  await a.sync.start();
  const before = a.sync.revision,
    encoded = await encodeState(
      Object.assign(emptyState(), {
        notes: { q: { text: "not uploaded", at: 1 } },
      }),
    );
  const result = await a.sync.fetcher("/api/state/manifest", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision: before, manifest: encoded.manifest }),
  });
  assert.equal(result.status, 400);
  const head = await (await a.sync.fetcher("/api/state/manifest")).json();
  assert.equal(head.revision, before);
  a.sync.stop();
});
test("清理过期孤立分块时保留当前目录，其他账号不受影响", async () => {
  const jobs = [],
    env = { DB: new D1(), ctx: { waitUntil: (promise) => jobs.push(promise) } },
    a = client(env);
  a.state.notes.q = { at: 1, text: "old" };
  await a.sync.start();
  await Promise.all(jobs.splice(0));
  const old = [...a.sync.remoteIds];
  env.DB.db.prepare("UPDATE learning_state_chunks SET created_at = 0").run();
  a.state.notes.q = { at: 2, text: "new" };
  await a.sync.flush();
  await Promise.all(jobs);
  for (const id of old)
    assert.equal(
      env.DB.db
        .prepare(
          "SELECT COUNT(*) AS n FROM learning_state_chunks WHERE user_id = ? AND chunk_id = ?",
        )
        .get("alice", id).n,
      0,
    );
  for (const id of a.sync.remoteIds)
    assert.equal(
      env.DB.db
        .prepare(
          "SELECT COUNT(*) AS n FROM learning_state_chunks WHERE user_id = ? AND chunk_id = ?",
        )
        .get("alice", id).n,
      1,
    );
  a.sync.stop();
});
