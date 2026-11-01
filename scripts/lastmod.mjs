// Daily data workflow step (after update-data.mjs): records the day each page's content last changed in seo/lastmod.json,
// which the deploy build turns into sitemap <lastmod> and RSS dates. A page whose pharmacies didn't change keeps its old date.
// Run it on the untouched source tree (it reads public/index.html as committed, before any build edits it).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { renderPages, contentHash, LASTMOD_FILE, readLastmod } from "./seo-pages.mjs";

const { pages, updated } = await renderPages();
const home = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const hashes = { "/": createHash("sha256").update(home).digest("hex").slice(0, 16) };
for (const p of pages) hashes[p.path] = contentHash(p.html, updated);

const old = await readLastmod(), next = {};
let changed = 0;
for (const [path, h] of Object.entries(hashes)) {
  if (old[path]?.h === h) next[path] = old[path];
  else { next[path] = { h, d: updated }; changed++; }
}
const removed = Object.keys(old).filter(p => !(p in next)).length;
await mkdir(new URL(".", LASTMOD_FILE), { recursive: true });
await writeFile(LASTMOD_FILE, JSON.stringify(next, null, 0).replace(/\},"/g, '},\n"') + "\n");
console.log(`lastmod: ${changed} pages changed on ${updated}, ${Object.keys(next).length - changed} unchanged, ${removed} removed`);
