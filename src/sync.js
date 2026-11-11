import { mergeStates, validateState, canonical } from "./learning.js";
import { validateBank } from "./core.js";
import {
  encodeState,
  decodeState,
  validateManifest,
  contentId,
} from "./state-codec.js";

async function transfer(items, run) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

export class CloudSync {
  constructor({
    getState,
    replaceState,
    persist,
    onStatus,
    onRemote,
    fetcher = (...args) => fetch(...args),
  }) {
    Object.assign(this, {
      getState,
      replaceState,
      persist,
      onStatus,
      onRemote,
      fetcher,
    });
    this.revision = 0;
    this.busy = false;
    this.dirty = false;
    this.ready = false;
    this.timer = null;
    this.cache = new Map();
    this.remoteIds = new Set();
    this.remoteCanonical = null;
  }
  async response(path, options = {}) {
    return this.fetcher(path, {
      ...options,
      signal: AbortSignal.timeout(20000),
    });
  }
  async pull() {
    const response = await this.response("/api/state/manifest", {
      cache: "no-store",
    });
    if (!response.ok)
      throw Error(
        response.status === 401
          ? "请登录后同步"
          : "云端暂时不可用，本机记录已保留",
      );
    const remote = await response.json();
    let data = null;
    if (remote.legacy) {
      const legacy = await this.response("/api/state", { cache: "no-store" });
      if (!legacy.ok) throw Error("旧记录暂时无法读取，本机记录已保留");
      const payload = await legacy.json();
      remote.revision = payload.revision;
      data = payload.data;
      this.remoteIds.clear();
    } else if (remote.manifest) {
      validateManifest(remote.manifest);
      this.remoteIds = new Set(remote.manifest.chunks.map((c) => c.id));
      await transfer(
        remote.manifest.chunks.filter((c) => !this.cache.has(c.id)),
        async (c) => {
          const result = await this.response("/api/state/chunks/" + c.id, {
            cache: "no-store",
          });
          if (!result.ok) throw Error("云端记录读取未完成，请稍后重试");
          const text = await result.text();
          if ((await contentId(text)) !== c.id) throw Error("云端记录校验失败");
          this.cache.set(c.id, text);
        },
      );
      data = decodeState(remote.manifest, this.cache);
    } else this.remoteIds.clear();
    if (data) validateState(data, validateBank);
    const previous = canonical(this.getState());
    this.remoteCanonical = data && !remote.legacy ? canonical(data) : null;
    if (data) this.replaceState(mergeStates(this.getState(), data));
    this.revision = remote.revision;
    this.persist();
    if (canonical(this.getState()) !== previous) this.onRemote?.();
    return remote;
  }
  async start() {
    await this.flush({ refresh: true });
  }
  changed() {
    this.dirty = true;
    if (!this.busy) this.onStatus("pending", "本机已保存，待同步");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 900);
  }
  async flush({ refresh = false } = {}) {
    clearTimeout(this.timer);
    if (this.busy) {
      this.dirty = true;
      return;
    }
    this.busy = true;
    this.onStatus("syncing", refresh ? "正在检查云端更新" : "正在同步");
    try {
      if (!this.ready || refresh) {
        await this.pull();
        this.ready = true;
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        this.dirty = false;
        const snapshot = structuredClone(this.getState()),
          serialized = canonical(snapshot);
        if (serialized === this.remoteCanonical) {
          this.onStatus("synced", "已同步 · 记录无变化");
          return;
        }
        const encoded = await encodeState(snapshot);
        await transfer(
          encoded.manifest.chunks.filter((c) => !this.remoteIds.has(c.id)),
          async (ref) => {
            const result = await this.response("/api/state/chunks/" + ref.id, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: encoded.chunks.get(ref.id),
            });
            if (!result.ok)
              throw Error(
                result.status === 401
                  ? "请登录后同步"
                  : "记录分块上传未完成，本机记录已保留",
              );
            this.cache.set(ref.id, encoded.chunks.get(ref.id));
          },
        );
        const response = await this.response("/api/state/manifest", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseRevision: this.revision,
            manifest: encoded.manifest,
          }),
        });
        const payload = await response.json();
        if (response.status === 409) {
          await this.pull();
          continue;
        }
        if (!response.ok)
          throw Error(
            response.status === 413
              ? "学习记录过大，请先导出归档；本机记录仍在"
              : response.status === 401
                ? "请登录后同步"
                : "同步暂未成功，本机记录已保留",
          );
        this.revision = payload.revision;
        this.remoteCanonical = serialized;
        this.remoteIds = new Set(encoded.manifest.chunks.map((c) => c.id));
        this.cache = new Map(encoded.chunks);
        if (this.dirty || canonical(this.getState()) !== serialized) continue;
        this.onStatus(
          "synced",
          "已同步 " +
            new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            }),
        );
        return;
      }
      this.dirty = true;
      this.onStatus("pending", "另一设备也在更新，稍后自动合并");
      this.timer = setTimeout(() => this.flush({ refresh: true }), 3500);
    } catch (e) {
      this.dirty = true;
      this.onStatus(
        "offline",
        e instanceof TypeError ? "网络暂不可用，本机记录已保留" : e.message,
      );
      this.timer = setTimeout(() => this.flush({ refresh: true }), 15000);
    } finally {
      this.busy = false;
    }
  }
  stop() {
    clearTimeout(this.timer);
  }
}
