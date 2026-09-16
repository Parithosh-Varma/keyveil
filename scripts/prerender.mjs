#!/usr/bin/env node
// Prerender the landing SPA to static HTML so crawlers/LLM fetchers see content.
// Usage: node scripts/prerender.mjs <dist-dir>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = process.argv[2] || join(repo, "apps/landing/dist");
const out = join(mkdtempSync(join(tmpdir(), "kv-prerender-")), "prerender.cjs");

execFileSync(
  join(repo, "node_modules/.bin/esbuild"),
  [
    join(repo, "apps/landing/src/prerender.tsx"),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${out}`,
    "--jsx=automatic",
    "--loader:.css=empty",
    "--log-level=error",
  ],
  { stdio: "inherit" }
);
const html = execFileSync("node", [out], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

const file = join(dist, "index.html");
const before = readFileSync(file, "utf8");
if (!before.includes('<div id="root"></div>')) throw new Error("root placeholder missing");
writeFileSync(file, before.replace('<div id="root"></div>', `<div id="root">${html}</div>`));
console.log(`prerendered ${(html.length / 1024).toFixed(1)}KB into ${file}`);
