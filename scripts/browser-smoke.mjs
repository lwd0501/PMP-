import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "pmp-browser-"));
const children = [],
  errors = [],
  requests = [];
let socket,
  counter = 0;
const pending = new Map();
const timeout = setTimeout(() => {
  console.error("Browser test timed out");
  for (const child of children) child.kill();
  process.exitCode = 1;
  socket?.close();
}, 120000);
function launch(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}
function waitOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = "";
    const listen = (data) => {
      output += data;
      const match = output.match(pattern);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    };
    const exit = () => {
      cleanup();
      reject(Error(output || "Preview process exited"));
    };
    const cleanup = () => {
      child.stdout.off("data", listen);
      child.stderr.off("data", listen);
      child.off("exit", exit);
      child.off("error", fail);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    child.stdout.on("data", listen);
    child.stderr.on("data", listen);
    child.once("exit", exit);
    child.once("error", fail);
  });
}
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++counter;
    pending.set(id, { resolve, reject });
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
}
try {
  const preview = launch(process.execPath, ["scripts/preview.mjs"], {
    PMP_PREVIEW_PORT: "0",
    PMP_PREVIEW_BUILT: "1",
  });
  const origin = await waitOutput(
    preview,
    /Local: (http:\/\/127\.0\.0\.1:\d+)\//,
  );
  assert.equal((await fetch(origin)).status, 200);
  const chrome = launch(
    process.env.PMP_CHROME_BIN || "/usr/bin/google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--no-first-run",
      "--disable-sync",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "about:blank",
    ],
  );
  const endpoint = await waitOutput(
    chrome,
    /DevTools listening on (ws:\/\/[^\s]+)/,
  );
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      message.error
        ? item?.reject(Error(JSON.stringify(message.error)))
        : item?.resolve(message.result);
    }
    if (message.method === "Network.requestWillBeSent")
      requests.push({
        sessionId: message.sessionId,
        url: message.params.request.url,
      });
    if (message.method === "Runtime.exceptionThrown")
      errors.push(
        message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      );
  });
  async function page(user, width = 1440, legacy = !!user) {
    const context = await send("Target.createBrowserContext"),
      target = await send("Target.createTarget", {
        url: "about:blank",
        browserContextId: context.browserContextId,
      }),
      { sessionId } = await send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
    for (const method of ["Runtime.enable", "Page.enable", "Network.enable"])
      await send(method, {}, sessionId);
    await send(
      "Network.setCookie",
      { name: "qa_user", value: user || "anonymous", url: origin + "/" },
      sessionId,
    );
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 950, deviceScaleFactor: 1, mobile: width < 600 },
      sessionId,
    );
    const evaluate = async (expression) => {
      const result = await send(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (result.exceptionDetails)
        throw Error(
          result.exceptionDetails.exception?.description ||
            "Browser evaluation failed",
        );
      return result.result.value;
    };
    const wait = async (expression) => {
      for (let i = 0; i < 160; i++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      throw Error(
        "Timeout: " +
          expression +
          "; " +
          (await evaluate("document.body.innerText.slice(-500)")),
      );
    };
    const click = (selector) =>
      evaluate(
        "document.querySelector(" + JSON.stringify(selector) + ").click()",
      );
    const state = () =>
      evaluate(
        `new Promise((resolve,reject)=>{const r=indexedDB.open('pmp-room',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('states','readonly'),q=tx.objectStore('states').get(${JSON.stringify("pmp-room-v2:" + (legacy ? user : "offline"))});q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=()=>reject(q.error);};})`,
      );
    const navigate = async (url) => {
      if (legacy && url.startsWith(origin + "/")) {
        const target = new URL(url);
        target.searchParams.set("legacy", "1");
        url = target.href;
      }
      await send("Page.navigate", { url }, sessionId);
      await wait("document.querySelector('.hero')!==null");
    };
    await navigate(origin + "/");
    await wait(
      legacy
        ? "document.querySelector('#sync-status').textContent.includes('已同步')"
        : "document.querySelector('#sync-status').textContent.includes('免登录')",
    );
    return { sessionId, evaluate, wait, click, state, navigate };
  }
  const guest = await page(null, 390, false);
  await guest.click('[data-paper="1"]');
  await guest.wait("document.querySelector('[name=answer]')!==null");
  let guestState = await guest.state();
  const guestSession = Object.values(guestState.sessions)[0],
    guestQuestion = guestState.snapshots[guestSession.questionKeys[0]];
  await guest.click(`[name=answer][value="${guestQuestion.answer[0]}"]`);
  await guest.click('[data-action="check"]');
  await guest.wait("document.querySelector('.rationale')!==null");
  await guest.navigate(origin + "/");
  guestState = await guest.state();
  assert.equal(Object.keys(guestState.events).length, 1);
  assert.equal(
    requests.filter(
      (r) =>
        r.sessionId === guest.sessionId &&
        new URL(r.url).pathname.startsWith("/api/"),
    ).length,
    0,
  );
  await guest.evaluate(
    `(async()=>{const {BrowserStore}=await import('/storage.js');const {emptyState}=await import('/learning.js');const store=new BrowserStore();await store.open();const old=emptyState();old.notes['PMP-001']={text:'old local note',at:1};await store.save('pmp-room-v2:previous-user',old);})()`,
  );
  await guest.click('[data-page="sync"]');
  await guest.click('[data-action="find-local-profiles"]');
  await guest.wait("document.querySelector('[data-local-profile]')!==null");
  await guest.click("[data-local-profile]");
  await guest.click("#dialog-ok");
  await guest.wait("document.body.innerText.includes('旧记录已合并')");
  guestState = await guest.state();
  assert.equal(guestState.notes["PMP-001"].text, "old local note");
  assert.equal(Object.keys(guestState.events).length, 1);
  assert.equal(
    await guest.evaluate(
      `(async()=>{const {BrowserStore}=await import('/storage.js');const store=new BrowserStore();await store.open();return (await store.read('pmp-room-v2:previous-user')).notes['PMP-001'].text;})()`,
    ),
    "old local note",
  );
  assert.equal(
    requests.filter(
      (r) =>
        r.sessionId === guest.sessionId &&
        new URL(r.url).pathname.startsWith("/api/"),
    ).length,
    0,
  );
  const privateAccess = await guest.evaluate(
    "(async()=>({me:(await fetch('/api/me')).status,state:(await fetch('/api/state')).status}))()",
  );
  assert.deepEqual(privateAccess, { me: 401, state: 401 });
  assert.equal(
    await guest.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  console.log(
    "PASS anonymous study and refresh without identity requests, local record recovery, private API protection",
  );
  const signedGuest = await page("qa-one", 390, false);
  assert.equal(
    requests.filter(
      (r) =>
        r.sessionId === signedGuest.sessionId &&
        new URL(r.url).pathname.startsWith("/api/"),
    ).length,
    0,
  );
  console.log(
    "PASS normal entry stays login-free even when a legacy account cookie exists",
  );
  const desktop = await page("qa-one");
  assert.equal(
    await desktop.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await desktop.click('[data-paper="1"]');
  await desktop.wait("document.querySelector('[name=answer]')!==null");
  let data = await desktop.state(),
    sid = await desktop.evaluate(
      "localStorage.getItem('pmp-room-v2:qa-one:active')",
    ),
    s = data.sessions[sid],
    q = data.snapshots[s.questionKeys[0]];
  await desktop.click(`[name=answer][value="${q.answer[0]}"]`);
  await desktop.click('[data-action="check"]');
  await desktop.wait("document.querySelector('.rationale')!==null");
  await desktop.click('[data-action="finish"]');
  await desktop.click("#dialog-ok");
  await desktop.wait("document.querySelector('.score-number')!==null");
  await desktop.click('[data-page="sync"]');
  await desktop.click('[data-action="sync-now"]');
  await desktop.wait(
    "document.querySelector('#sync-status').textContent.includes('已同步')",
  );
  const mobile = await page("qa-one", 390);
  data = await mobile.state();
  assert.equal(Object.keys(data.events).length, 1);
  assert.equal(data.history[sid].percent, 100);
  assert.equal(
    await mobile.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  const other = await page("qa-other", 390);
  assert.equal(Object.keys((await other.state()).events).length, 0);
  console.log("PASS desktop/mobile answer, sync and account isolation");
  await mobile.click('[data-page="library"]');
  assert.equal(
    await mobile.evaluate(
      "document.body.innerText.includes('2022至今的公开模拟资料')",
    ),
    true,
  );
  assert.equal(
    await mobile.evaluate(
      "document.body.innerText.includes('与正式考试接近到什么程度')",
    ),
    true,
  );
  assert.equal(
    await mobile.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await mobile.click('[data-page="catalog"]');
  await mobile.evaluate(
    "document.querySelector('#source').value='open-source-adapted';document.querySelector('#source').dispatchEvent(new Event('change',{bubbles:true}))",
  );
  assert.equal(
    await mobile.evaluate(
      "document.querySelector('#catalog-count').innerText.includes('匹配60题')",
    ),
    true,
  );
  await mobile.click('[data-page="home"]');
  await mobile.click('[data-action="community-drill"]');
  await mobile.wait("document.querySelector('[name=answer]')!==null");
  const communityState = await mobile.state(),
    communityId = await mobile.evaluate(
      "localStorage.getItem('pmp-room-v2:qa-one:active')",
    ),
    communitySession = communityState.sessions[communityId],
    communityQuestion =
      communityState.snapshots[communitySession.questionKeys[0]];
  assert.equal(communitySession.questionKeys.length, 60);
  assert.equal(communityQuestion.provenance.kind, "open-source-adapted");
  for (const index of communityQuestion.answer)
    await mobile.click(`[name=answer][value="${index}"]`);
  await mobile.click('[data-action="check"]');
  await mobile.wait("document.querySelector('.quality-details')!==null");
  await mobile.evaluate("document.querySelector('.quality-details').open=true");
  assert.equal(
    await mobile.evaluate(
      "document.querySelector('.quality-details').innerText.includes('开源题中文译编')",
    ),
    true,
  );
  assert.equal(
    await mobile.evaluate(
      "document.querySelector('.quality-details').textContent.includes('Two months into a product build')",
    ),
    true,
  );
  assert.equal(
    await mobile.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  console.log(
    "PASS historical resource links, fidelity disclosure, source filter and Chinese question attribution",
  );

  await desktop.click('[data-page="home"]');
  await desktop.click('[data-action="full"]');
  await desktop.wait("document.querySelector('#timer')!==null");
  sid = await desktop.evaluate(
    "localStorage.getItem('pmp-room-v2:qa-one:active')",
  );
  await desktop.navigate(origin + "/");
  await desktop.wait(`document.querySelector('[data-resume="${sid}"]')!==null`);
  await desktop.click(`[data-resume="${sid}"]`);
  assert.equal(
    await desktop.evaluate("document.querySelector('#timer')!==null"),
    true,
  );
  console.log("PASS IndexedDB save and refresh resume");
  // A record larger than localStorage's usual quota survives closing and reopening IndexedDB.
  const large = await desktop.evaluate(
    `(async()=>{const {BrowserStore}=await import('/storage.js');const store=new BrowserStore();await store.open();const value={marker:'large',text:'x'.repeat(6*1024*1024)};await store.save('qa-large',value);const next=new BrowserStore();await next.open();const read=await next.read('qa-large');return {marker:read.marker,length:read.text.length};})()`,
  );
  assert.equal(large.length, 6 * 1024 * 1024);
  const migration = await desktop.evaluate(
    `(async()=>{const {BrowserStore}=await import('/storage.js');localStorage.setItem('qa-legacy',JSON.stringify({marker:'legacy'}));const store=new BrowserStore();await store.open();const read=await store.read('qa-legacy');await store.save('qa-legacy',read);return {marker:(await store.read('qa-legacy')).marker,legacy:localStorage.getItem('qa-legacy')};})()`,
  );
  assert.equal(migration.marker, "legacy");
  assert.equal(migration.legacy, null);
  console.log("PASS 6MB local history and legacy localStorage migration");
  await other.click('[data-page="home"]');
  await other.click('[data-paper="1"]');
  await other.wait("document.querySelector('[data-action=favorite]')!==null");
  await other.click('[data-action="favorite"]');
  await other.click('[data-page="sync"]');
  await other.click('[data-action="sync-now"]');
  await other.wait(
    "document.querySelector('#sync-status').textContent.includes('已同步')",
  );
  await other.click('[data-action="copy-to-guest"]');
  await other.click("#dialog-ok");
  await other.wait(
    "document.querySelector('.hero')!==null&&document.querySelector('#sync-status').textContent.includes('免登录')",
  );
  const copied = await other.evaluate(
    `(async()=>{const {BrowserStore}=await import('/storage.js');const store=new BrowserStore();await store.open();return {guest:(await store.read('pmp-room-v2:offline')).favorites['PMP-001'].value,original:(await store.read('pmp-room-v2:qa-other')).favorites['PMP-001'].value,legacy:new URL(location.href).searchParams.has('legacy')};})()`,
  );
  assert.deepEqual(copied, { guest: true, original: true, legacy: false });
  console.log(
    "PASS optional old-account recovery copies records to login-free mode without deleting originals",
  );

  await mobile.navigate(
    pathToFileURL(path.join(root, "artifacts/PMP-上海广东-学习平台.html")).href,
  );
  await mobile.click('[data-paper="1"]');
  assert.equal(
    await mobile.evaluate("document.querySelector('.question')!==null"),
    true,
  );
  assert.equal(
    await mobile.evaluate(
      "document.querySelectorAll('script[src],link[rel=stylesheet]').length",
    ),
    0,
  );
  assert.equal(
    await mobile.evaluate("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  console.log("PASS standalone offline HTML on mobile");
  assert.deepEqual(errors, []);
  console.log("PASS no uncaught browser exceptions");
} finally {
  clearTimeout(timeout);
  if (socket?.readyState === WebSocket.OPEN) {
    await Promise.race([
      send("Browser.close").catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
  socket?.close();
  for (const child of children) child.kill();
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve)),
    ),
  );
  await fs
    .rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    })
    .catch(() => {});
}
