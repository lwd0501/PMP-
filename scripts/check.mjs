import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function check(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const name = directory + "/" + file.name;
    if (file.isDirectory()) await check(name);
    else if (/\.(m?js)$/.test(file.name)) {
      const result = spawnSync(process.execPath, ["--check", name], {
        stdio: "inherit",
      });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const directory of ["src", "server", "scripts"]) await check(directory);
console.log("Source syntax checks passed.");
