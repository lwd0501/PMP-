import fs from "node:fs/promises";
import path from "node:path";
import { seedBank } from "./src/questions.js";
import { validateBank } from "./src/core.js";
import { build } from "esbuild";
validateBank(seedBank);
const directory = path.resolve("artifacts");
await fs.mkdir(directory, { recursive: true });
let html = await fs.readFile("src/index.html", "utf8");
const css = await fs.readFile("src/style.css", "utf8");
const bundled = await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
});
let js = bundled.outputFiles[0].text;
js = js.replace(/<\/script/gi, "<\\/script");
html = html
  .replace(
    /<link\s+rel="stylesheet"\s+href="style\.css"\s*\/?>/,
    () => `<style>${css}</style>`,
  )
  .replace(
    '<script type="module" src="app.js"></script>',
    () => `<script>(()=>{\n${js}\n})();</script>`,
  );
if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/.test(html))
  throw Error("离线文件仍包含外部脚本或样式，请检查模板。");
const htmlFile = path.join(directory, "PMP-上海广东-学习平台.html");
const bankFile = path.join(
  directory,
  `PMP-上海广东-${seedBank.length}题题库.json`,
);
await fs.writeFile(htmlFile, html);
await fs.writeFile(bankFile, JSON.stringify(seedBank, null, 2));
console.log(
  JSON.stringify({
    html: htmlFile,
    bank: bankFile,
    questions: seedBank.length,
  }),
);
