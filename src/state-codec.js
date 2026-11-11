import { emptyState, canonical } from "./learning.js";

export const CHUNK_FORMAT = "pmp-state-chunks-v1";
export const CHUNK_TARGET = 64 * 1024;
export const CHUNK_MAX = 1024 * 1024;
export const STATE_MAX = 32 * 1024 * 1024;
export const SECTIONS = [
  "events",
  "legacyStats",
  "favorites",
  "notes",
  "issues",
  "sessions",
  "history",
  "snapshots",
];
const encoder = new TextEncoder();
export const byteSize = (text) => encoder.encode(text).byteLength;
export async function contentId(text) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(text)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.format !== CHUNK_FORMAT ||
    manifest.version !== 2 ||
    !manifest.custom ||
    typeof manifest.custom.hasValue !== "boolean" ||
    !Number.isFinite(manifest.custom.at) ||
    !Array.isArray(manifest.chunks) ||
    manifest.chunks.length > 2048
  )
    throw Error("分块备份目录格式不正确。");
  const ids = new Set();
  let bytes = 0;
  for (const c of manifest.chunks) {
    if (
      !c ||
      !/^[a-f0-9]{64}$/.test(c.id) ||
      ids.has(c.id) ||
      !Number.isInteger(c.bytes) ||
      c.bytes < 1 ||
      c.bytes > CHUNK_MAX
    )
      throw Error("分块标识或大小不正确。");
    ids.add(c.id);
    bytes += c.bytes;
  }
  if (bytes > STATE_MAX) throw Error("学习记录超过32MB，请先导出并归档。");
  return manifest;
}
export function parseChunk(text) {
  const chunk = JSON.parse(text);
  if (
    !chunk ||
    ![...SECTIONS, "customQuestions"].includes(chunk.section) ||
    !Array.isArray(chunk.entries) ||
    !chunk.entries.length ||
    chunk.entries.some(
      (e) =>
        !Array.isArray(e) ||
        e.length !== 2 ||
        typeof e[0] !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(e[0]),
    )
  )
    throw Error("学习记录分块格式不正确。");
  return chunk;
}
export async function encodeState(state) {
  const chunks = new Map(),
    manifest = {
      format: CHUNK_FORMAT,
      version: 2,
      custom: {
        at: state.custom?.at || 0,
        hasValue: Array.isArray(state.custom?.value),
      },
      chunks: [],
    };
  async function append(section, entries) {
    if (!entries.length) return;
    const text = canonical({ section, entries }),
      bytes = byteSize(text);
    if (bytes > CHUNK_MAX) throw Error("单条学习记录过大，请先导出备份。");
    const id = await contentId(text);
    chunks.set(id, text);
    manifest.chunks.push({ id, bytes });
  }
  for (const section of [...SECTIONS, "customQuestions"]) {
    const source =
      section === "customQuestions"
        ? (state.custom?.value || []).map((q, i) => [String(i), q])
        : Object.entries(state[section]).sort(([a], [b]) => a.localeCompare(b));
    let entries = [],
      size = 0;
    for (const entry of source) {
      const bytes = byteSize(canonical(entry));
      if (entries.length && size + bytes > CHUNK_TARGET) {
        await append(section, entries);
        entries = [];
        size = 0;
      }
      entries.push(entry);
      size += bytes;
    }
    await append(section, entries);
  }
  validateManifest(manifest);
  return { manifest, chunks };
}
export function decodeState(manifest, chunks) {
  validateManifest(manifest);
  const state = emptyState(),
    questions = new Map();
  state.custom = {
    at: manifest.custom.at,
    value: manifest.custom.hasValue ? [] : null,
  };
  for (const ref of manifest.chunks) {
    const text = chunks.get(ref.id);
    if (typeof text !== "string" || byteSize(text) !== ref.bytes)
      throw Error("学习记录分块缺失或长度不符。");
    const { section, entries } = parseChunk(text),
      target =
        section === "customQuestions"
          ? questions
          : new Map(Object.entries(state[section]));
    for (const [key, value] of entries) {
      if (target.has(key)) throw Error("学习记录分块包含重复标识。");
      target.set(key, value);
    }
    if (section !== "customQuestions")
      state[section] = Object.fromEntries(target);
  }
  if (questions.size) {
    if (!manifest.custom.hasValue) throw Error("自定义题库目录不匹配。");
    for (let i = 0; i < questions.size; i++) {
      if (!questions.has(String(i))) throw Error("自定义题库顺序不完整。");
      state.custom.value.push(questions.get(String(i)));
    }
  }
  return state;
}
