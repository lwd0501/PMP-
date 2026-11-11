import fs from 'node:fs/promises';
import path from 'node:path';
import {seedBank} from './dist/questions.js';
import {validateBank} from './dist/core.js';
validateBank(seedBank);
const directory=path.resolve('artifacts');
await fs.mkdir(directory,{recursive:true});
let html=await fs.readFile('dist/index.html','utf8');
const css=await fs.readFile('dist/style.css','utf8');
let js='';
for(const file of ['extra-questions.js','questions.js','core.js','mainland.js','app.js']){
  let source=await fs.readFile('dist/'+file,'utf8');
  source=source.replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
  // 普通脚本中的顶层名字用 IIFE 隔离，同时支持 file:// 直接打开。
  js+=`\n// ${file}\n${source}\n`;
}
js=js.replace(/<\/script/gi,'<\\/script');
html=html.replace('<link rel="stylesheet" href="style.css">',`<style>${css}</style>`).replace('<script type="module" src="app.js"></script>',()=>`<script>(()=>{\n${js}\n})();</script>`);
const htmlFile=path.join(directory,'PMP-上海广东-90题直接刷题.html');
const bankFile=path.join(directory,'PMP-上海广东-90题题库.json');
await fs.writeFile(htmlFile,html);
await fs.writeFile(bankFile,JSON.stringify(seedBank,null,2));
console.log(JSON.stringify({html:htmlFile,bank:bankFile,questions:seedBank.length}));
