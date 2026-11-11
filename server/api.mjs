import { validateState, mergeStates, canonical } from "../src/learning.js";
import { validateBank } from "../src/core.js";
import {
  CHUNK_FORMAT,
  CHUNK_MAX,
  byteSize,
  contentId,
  parseChunk,
  validateManifest,
  decodeState,
} from "../src/state-codec.js";
const LEGACY_MAX = 4 * 1024 * 1024;
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      vary: "Cookie",
    },
  });
async function readText(request, max) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw Object.assign(Error("backup_too_large"), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(Error("empty_body"), { status: 400 });
  const decoder = new TextDecoder(),
    parts = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      await reader.cancel();
      throw Object.assign(Error("backup_too_large"), { status: 413 });
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}
async function assemble(DB, id, manifest) {
  validateManifest(manifest);
  const chunks = new Map();
  for (let at = 0; at < manifest.chunks.length; at += 80) {
    const refs = manifest.chunks.slice(at, at + 80);
    const rows = await DB.prepare(
      `SELECT chunk_id, body FROM learning_state_chunks WHERE user_id = ? AND chunk_id IN (${refs.map(() => "?").join(",")})`,
    )
      .bind(id, ...refs.map((c) => c.id))
      .all();
    for (const row of rows.results) chunks.set(row.chunk_id, row.body);
  }
  for (const c of manifest.chunks)
    if (!chunks.has(c.id) || byteSize(chunks.get(c.id)) !== c.bytes)
      throw Object.assign(Error("missing_chunk"), { status: 400 });
  const data = decodeState(manifest, chunks);
  validateState(data, validateBank);
  return data;
}
// Reject stale clients that would modify an already completed paper, even with a current CAS revision.
function preservesCompleted(current, incoming) {
  const merged = mergeStates(current, incoming);
  for (const [key, s] of Object.entries(current.sessions)) {
    if (!s.finishedAt) continue;
    const next = incoming.sessions[key];
    if (
      !next ||
      canonical(next) !== canonical(merged.sessions[key]) ||
      canonical(incoming.history[key]) !== canonical(merged.history[key])
    )
      return false;
    for (const q of s.questionKeys)
      if (canonical(incoming.snapshots[q]) !== canonical(merged.snapshots[q]))
        return false;
  }
  return true;
}
export async function handleApi(request, env) {
  const url = new URL(request.url),
    id = request.headers.get("oai-authenticated-user-id");
  if (url.pathname === "/api/health") {
    if (!env.DB)
      return json({ ready: false, reason: "storage_unavailable" }, 503);
    try {
      await env.DB.prepare(
        "SELECT revision FROM learning_state LIMIT 1",
      ).first();
      await env.DB.prepare(
        "SELECT chunk_id FROM learning_state_chunks LIMIT 1",
      ).first();
      return json({ ready: true });
    } catch {
      return json({ ready: false, reason: "schema_unavailable" }, 503);
    }
  }
  if (!id) return json({ error: "authentication_required" }, 401);
  if (url.pathname === "/api/me")
    return request.method === "GET"
      ? json({
          id,
          email: request.headers.get("oai-authenticated-user-email") || "",
        })
      : json({ error: "method_not_allowed" }, 405);
  const chunkMatch = url.pathname.match(
      /^\/api\/state\/chunks\/([a-f0-9]{64})$/,
    ),
    manifestRoute = url.pathname === "/api/state/manifest";
  if (url.pathname !== "/api/state" && !manifestRoute && !chunkMatch)
    return json({ error: "not_found" }, 404);
  if (!env.DB) return json({ error: "storage_unavailable" }, 503);
  const DB = env.DB;
  async function head() {
    const row = await DB.prepare(
      "SELECT revision, body, updated_at FROM learning_state WHERE user_id = ?",
    )
      .bind(id)
      .first();
    return row
      ? {
          revision: row.revision,
          body: JSON.parse(row.body),
          updatedAt: row.updated_at,
        }
      : { revision: 0, body: null, updatedAt: null };
  }
  const dataOf = async (h) =>
    h.body?.format === CHUNK_FORMAT ? assemble(DB, id, h.body) : h.body;
  const describe = (h) => ({
    revision: h.revision,
    manifest: h.body?.format === CHUNK_FORMAT ? h.body : null,
    legacy: !!h.body && h.body.format !== CHUNK_FORMAT,
    updatedAt: h.updatedAt,
  });
  try {
    if (request.method === "GET") {
      if (chunkMatch) {
        const row = await DB.prepare(
          "SELECT body FROM learning_state_chunks WHERE user_id = ? AND chunk_id = ?",
        )
          .bind(id, chunkMatch[1])
          .first();
        return row
          ? new Response(row.body, {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "private, no-store",
              },
            })
          : json({ error: "not_found" }, 404);
      }
      const h = await head();
      return manifestRoute
        ? json(describe(h))
        : json({
            revision: h.revision,
            data: await dataOf(h),
            updatedAt: h.updatedAt,
          });
    }
    if (request.method !== "PUT")
      return json({ error: "method_not_allowed" }, 405);
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== url.origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return json({ error: "origin_not_allowed" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return json({ error: "json_required" }, 415);
    const text = await readText(
      request,
      chunkMatch ? CHUNK_MAX : manifestRoute ? 256 * 1024 : LEGACY_MAX,
    );
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (chunkMatch) {
      try {
        parseChunk(text);
      } catch {
        return json({ error: "invalid_chunk" }, 400);
      }
      if ((await contentId(text)) !== chunkMatch[1])
        return json({ error: "chunk_hash_mismatch" }, 400);
      await DB.prepare(
        "INSERT OR IGNORE INTO learning_state_chunks (user_id, chunk_id, body, created_at) VALUES (?, ?, ?, ?)",
      )
        .bind(id, chunkMatch[1], text, Date.now())
        .run();
      return json({ saved: true });
    }
    if (
      !body ||
      !Number.isSafeInteger(body.baseRevision) ||
      body.baseRevision < 0
    )
      return json({ error: "invalid_revision" }, 400);
    const current = await head();
    const conflict = async () => {
      const h = await head();
      return manifestRoute
        ? json({ error: "revision_conflict", ...describe(h) }, 409)
        : json(
            {
              error: "revision_conflict",
              revision: h.revision,
              data: await dataOf(h),
            },
            409,
          );
    };
    if (current.revision !== body.baseRevision) return conflict();
    let data;
    try {
      data = manifestRoute
        ? await assemble(DB, id, body.manifest)
        : validateState(body.data, validateBank);
    } catch (e) {
      return json(
        { error: "invalid_state", message: e.message },
        e.status || 400,
      );
    }
    if (current.body && !preservesCompleted(await dataOf(current), data))
      return conflict();
    const encoded = JSON.stringify(manifestRoute ? body.manifest : data),
      now = Date.now();
    let change;
    if (body.baseRevision === 0)
      change = await DB.prepare(
        "INSERT OR IGNORE INTO learning_state (user_id, revision, body, updated_at) VALUES (?, 1, ?, ?)",
      )
        .bind(id, encoded, now)
        .run();
    else
      change = await DB.prepare(
        "UPDATE learning_state SET revision = revision + 1, body = ?, updated_at = ? WHERE user_id = ? AND revision = ?",
      )
        .bind(encoded, now, id, body.baseRevision)
        .run();
    if (!change.meta?.changes) return conflict();
    // Keep a day's grace for readers and uploads in flight. Referenced chunks are never removed.
    if (manifestRoute)
      env.ctx?.waitUntil(
        DB.prepare(
          "DELETE FROM learning_state_chunks WHERE user_id = ? AND created_at < ? AND chunk_id NOT IN (SELECT json_extract(value, '$.id') FROM json_each((SELECT body FROM learning_state WHERE user_id = ?), '$.chunks'))",
        )
          .bind(id, now - 86400000, id)
          .run(),
      );
    return json({ revision: body.baseRevision + 1, updatedAt: now });
  } catch (e) {
    return json(
      { error: e.status ? e.message : "storage_error" },
      e.status || 503,
    );
  }
}
