import { handleApi } from "./api.mjs";
import assets from "pmp:assets";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/"))
      return handleApi(request, { ...env, ctx });
    if (!["GET", "HEAD"].includes(request.method))
      return new Response("Method not allowed", { status: 405 });
    const content = assets[url.pathname];
    if (content === undefined)
      return new Response("Not found", { status: 404 });
    const type = url.pathname.endsWith(".js")
      ? "text/javascript"
      : url.pathname.endsWith(".css")
        ? "text/css"
        : url.pathname.endsWith(".svg")
          ? "image/svg+xml"
          : "text/html";
    return new Response(request.method === "HEAD" ? null : content, {
      headers: {
        "content-type": type + "; charset=utf-8",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
      },
    });
  },
};
