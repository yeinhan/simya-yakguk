// Build step (Vercel or Cloudflare Pages): writes public/config.js from environment variables (the Kakao JavaScript key is public by design;
// it is restricted by the registered site domain in the Kakao developer console).
import { writeFile } from "node:fs/promises";
const cfg = { kakaoJsKey: process.env.KAKAO_JS_KEY || "" };
await writeFile(new URL("../public/config.js", import.meta.url), `window.APP_CONFIG = ${JSON.stringify(cfg)};\n`);
console.log(cfg.kakaoJsKey ? "config.js written with Kakao key" : "config.js written WITHOUT Kakao key (fallback map)");

// Region pages, sitemap.xml and robots.txt for search engines (see scripts/seo-pages.mjs).
const { buildSeo } = await import("./seo-pages.mjs");
await buildSeo();

// Speed for the home page (on the host only, so local runs leave index.html untouched):
// config inlined (one request fewer), app.js versioned by content hash so vercel.json / _headers can cache it for a year,
// and the inline CSS squeezed.
if (process.env.VERCEL || process.env.CF_PAGES) {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const pub = new URL("../public/", import.meta.url), indexUrl = new URL("index.html", pub);
  const app = await readFile(new URL("app.js", pub));
  const v = createHash("sha256").update(app).digest("hex").slice(0, 10);
  let html = await readFile(indexUrl, "utf8");
  const swap = (from, to) => { if (!html.includes(from)) throw new Error(`build: "${from}" not found in index.html`); html = html.replace(from, to); };
  swap('<script src="config.js" defer></script>', `<script>window.APP_CONFIG = ${JSON.stringify(cfg).replace(/</g, "\\u003c")};</script>`);
  swap('<script src="app.js" defer></script>', `<script src="app.js?v=${v}" defer></script>`);
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => "<style>" + css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};,])\s*/g, "$1").replace(/;}/g, "}").trim() + "</style>");
  await writeFile(indexUrl, html);
  console.log(`index.html: config inlined, app.js?v=${v}, CSS minified`);
}
