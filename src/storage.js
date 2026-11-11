// Keep large histories out of localStorage. Old browser records migrate on the first successful write.
export class BrowserStore {
  constructor() {
    this.db = null;
  }
  async open() {
    if (!globalThis.indexedDB) return;
    try {
      this.db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("pmp-room", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("states");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(Error("本机记录存储被其他窗口阻塞"));
      });
      this.db.onversionchange = () => {
        this.db.close();
        this.db = null;
      };
    } catch {
      this.db = null;
    }
  }
  async read(key) {
    if (this.db) {
      const value = await new Promise((resolve, reject) => {
        const tx = this.db.transaction("states", "readonly"),
          request = tx.objectStore("states").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (value !== undefined) return value;
    }
    return JSON.parse(localStorage.getItem(key) || "null");
  }
  save(key, state) {
    if (!this.db) {
      localStorage.setItem(key, JSON.stringify(state));
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("states", "readwrite");
      tx.objectStore("states").put(state, key);
      tx.oncomplete = () => {
        try {
          localStorage.removeItem(key);
        } catch {}
        resolve();
      };
      tx.onabort = () => reject(tx.error || Error("本机记录保存失败"));
      tx.onerror = () => reject(tx.error);
    });
  }
}
