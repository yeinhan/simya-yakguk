// Vercel build step: writes public/config.js from environment variables (the Kakao JavaScript key is public by design;
// it is restricted by the registered site domain in the Kakao developer console).
import { writeFile } from "node:fs/promises";
const cfg = { kakaoJsKey: process.env.KAKAO_JS_KEY || "" };
await writeFile(new URL("../public/config.js", import.meta.url), `window.APP_CONFIG = ${JSON.stringify(cfg)};\n`);
console.log(cfg.kakaoJsKey ? "config.js written with Kakao key" : "config.js written WITHOUT Kakao key (fallback map)");

// Region pages, sitemap.xml and robots.txt for search engines (see scripts/seo-pages.mjs).
const { buildSeo } = await import("./seo-pages.mjs");
await buildSeo();
