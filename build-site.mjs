import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
// Build from source every time; generated files are never inputs to the next build.
await fs.mkdir("dist/server", { recursive: true });
const files = (await fs.readdir("src")).filter((file) =>
  /\.(js|css|html|svg)$/.test(file),
);
const assets = {};
for (const file of files) {
  const content = await fs.readFile(path.join("src", file), "utf8");
  assets["/" + file] = content;
  await fs.writeFile(path.join("dist", file), content);
}
assets["/"] = assets["/index.html"];
await build({
  entryPoints: ["server/worker.mjs"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  plugins: [
    {
      name: "pmp-assets",
      setup(plugin) {
        plugin.onResolve({ filter: /^pmp:assets$/ }, () => ({
          path: "assets",
          namespace: "pmp",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "pmp" }, () => ({
          contents: "export default " + JSON.stringify(assets),
          loader: "js",
        }));
      },
    },
  ],
});
await fs.mkdir("dist/.openai", { recursive: true });
await fs.copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await fs.cp("drizzle", "dist/.openai/drizzle", { recursive: true });
console.log(
  "Built Worker, frontend assets and append-only database migrations.",
);
