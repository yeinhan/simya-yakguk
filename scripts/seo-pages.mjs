// Search-engine pages, built from public/data/g/*.json on every deploy (the data workflow commits daily, which redeploys):
//   /pharmacy/                        all regions
//   /pharmacy/<시도>/                 e.g. /pharmacy/서울/        districts with counts + pharmacies open past midnight
//   /pharmacy/<시도>/<시군구>/        e.g. /pharmacy/서울/관악구/  24-hour, night, Sunday and holiday pharmacies, then every pharmacy by 동
// The old /<시도>/... and /지역/ addresses 301 to these (vercel.json, public/_redirects).
//   /sitemap.xml, /rss.xml, /robots.txt, /404.html
//   Each page's <lastmod> / RSS date is the day its content last changed, from seo/lastmod.json (kept by scripts/lastmod.mjs in the
//   daily data workflow), so search engines can trust it instead of seeing every page "changed" every day.
//   /pharmacy/공휴일/ and /pharmacy/공휴일/<성탄절|신정|설날>/   holiday pages (dates in HOLIDAYS below; add next year's when announced)
//   /about/ (site intro + contact), /privacy/, and /ads.txt when ADSENSE_CLIENT is set; Kakao AdFit slots on region pages and the home page when ADFIT_UNIT is set
// Also fills the site-verification marker in public/index.html from NAVER_SITE_VERIFICATION* / GOOGLE_SITE_VERIFICATION*
// (plus the AdSense script when ADSENSE_CLIENT is set).
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const SITE_NAME = "심야약국";
// The one public address. simya-yakguk.vercel.app and kpharmacy24.com redirect here (vercel.json / Vercel domain settings).
export const SITE_URL = (process.env.SITE_URL || "https://www.kpharmacy24.com").replace(/\/$/, "");
// Google AdSense publisher id (ca-pub-…, public by design). Unset = no ad code and no ads.txt anywhere.
// Default is the site's own AdSense account; ADSENSE_CLIENT overrides it, and ADSENSE_CLIENT=off removes all ad code.
const ADSENSE_ENV = (process.env.ADSENSE_CLIENT ?? "ca-pub-4223097014464348").trim();
const ADSENSE = /^ca-pub-\d+$/.test(ADSENSE_ENV) ? ADSENSE_ENV : "";
const ADSENSE_TAG = ADSENSE ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE}" crossorigin="anonymous"></script>` : "";
// Kakao AdFit ad unit (DAN-…, public by design; size from ADFIT_SIZE, default 320x100). Unset = no ad slots anywhere.
const ADFIT = /^DAN-[A-Za-z0-9]+$/.test((process.env.ADFIT_UNIT || "").trim()) ? process.env.ADFIT_UNIT.trim() : "";
const [ADFIT_W, ADFIT_H] = (/^(\d+)x(\d+)$/.exec((process.env.ADFIT_SIZE || "").trim()) || [, "320", "100"]).slice(1);
export const AD_SLOT = ADFIT ? `<div class="ad" style="margin:28px auto;text-align:center;min-height:${ADFIT_H}px"><ins class="kakao_ad_area" style="display:none" data-ad-unit="${ADFIT}" data-ad-width="${ADFIT_W}" data-ad-height="${ADFIT_H}"></ins><script async src="https://t1.daumcdn.net/kas/static/ba.min.js"></script></div>` : "";
const CONTACT = (process.env.CONTACT_EMAIL || "").trim();
// Preview builds (pull requests, other branches) tell search engines to stay away.
const PREVIEW = process.env.VERCEL_ENV === "preview" || (!!process.env.CF_PAGES && process.env.CF_PAGES_BRANCH !== "main");

const pub = new URL("../public/", import.meta.url);
const SIDO = {
  "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
  "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원특별자치도": "강원", "강원도": "강원", "충청북도": "충북",
  "충청남도": "충남", "전북특별자치도": "전북", "전라북도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남", "제주특별자치도": "제주",
};
const SIDO_ORDER = ["서울", "경기", "인천", "부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
const DAYS = ["월", "화", "수", "목", "금", "토", "일", "공휴일"];
const LATE = 22 * 60;

// ---- Data ---------------------------------------------------------------------------------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toMin = s => +s.slice(0, 2) * 60 + +s.slice(2);
function span(h) { if (!h) return null; const [s, c] = h.split("-"); const o = toMin(s); let e = toMin(c); if (e <= o) e += 1440; return [o, e]; }
const clock = m => { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return h > 24 || (h === 24 && mm !== "00") ? `익일 ${String(h - 24).padStart(2, "0")}:${mm}` : `${String(h).padStart(2, "0")}:${mm}`; };
const range = h => { const t = span(h); return t ? (t[1] - t[0] >= 1440 ? "24시간" : `${clock(t[0])}–${clock(t[1])}`) : "휴무"; };
const BASE = "pharmacy";
const urlPath = (...parts) => "/" + [BASE, ...parts.map(encodeURIComponent)].join("/") + "/";

function place(p) {
  const t = p.a.split(/\s+/), sido = SIDO[t[0]];
  if (!sido) return null;
  const gu = sido === "세종" ? "" : /[시군구]$/.test(t[1] || "") ? t[1] : "";
  if (sido !== "세종" && !gu) return null;
  const sub = gu && /시$/.test(gu) && /구$/.test(t[2] || "") ? t[2] + " " : ""; // 수원시 장안구 -> grouped under 수원시
  const par = (p.a.match(/\(([^()]*)\)\s*$/) || [])[1];
  let dong = par && par.split(",")[0].trim();
  if (!dong || !/[동가리]$/.test(dong)) dong = t.slice(1, 4).find(x => /[읍면]$/.test(x)) || dong || "";
  if (!/[동가리읍면]$/.test(dong)) dong = "기타";
  return { sido, gu, dong: sub + dong };
}
function enrich(p) {
  const spans = p.h.map(span), close = Math.max(0, ...spans.filter(Boolean).map(t => t[1]));
  return { ...p, ...place(p), close, late: close >= LATE, sun: !!p.h[6], hol: !!p.h[7], always: p.h.every(Boolean), full: spans.some(t => t && t[1] - t[0] >= 1440) };
}
async function loadAll() {
  const dir = new URL("data/g/", pub), list = [];
  for (const f of await readdir(dir)) if (f.endsWith(".json")) list.push(...JSON.parse(await readFile(new URL(f, dir), "utf8")));
  return list.filter(p => place(p)).map(enrich).sort((a, b) => a.n.localeCompare(b.n, "ko") || (a.id < b.id ? -1 : a.id > b.id));
}
function hoursSummary(h) {
  const wk = h.slice(0, 5), parts = [];
  if (wk.every(x => x === wk[0])) parts.push(`평일 ${range(wk[0])}`); else wk.forEach((x, i) => parts.push(`${DAYS[i]} ${range(x)}`));
  [5, 6, 7].forEach(i => parts.push(`${DAYS[i]} ${range(h[i])}`));
  return parts.join(" · ");
}

// ---- HTML -----------------------------------------------------------------------------------
const CSS = `:root{--bg:#f5faf7;--surface:#fff;--fg:#22302a;--muted:#56635c;--line:#dcebe2;--accent:#1e9e5e;--accent-ink:#157a48;--accent-btn:#178650;--accent-soft:#e7f6ee;--warn:#a65800;--warn-soft:#fff1dc;--off:#8b9892;--font-display:"Jua","Apple SD Gothic Neo","Malgun Gothic",sans-serif;--font-body:"Gowun Dodum","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#101a15;--surface:#18251e;--fg:#e6f1ea;--muted:#a2b5aa;--line:#2a3d33;--accent:#3fc582;--accent-ink:#6fdca6;--accent-soft:#1b3a2b;--warn:#ffbf7f;--warn-soft:#3d2c1d;--off:#6f8279;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#101a15;--surface:#18251e;--fg:#e6f1ea;--muted:#a2b5aa;--line:#2a3d33;--accent:#3fc582;--accent-ink:#6fdca6;--accent-soft:#1b3a2b;--warn:#ffbf7f;--warn-soft:#3d2c1d;--off:#6f8279;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--fg);font-family:var(--font-body);font-size:16px;line-height:1.6}
a{color:var(--accent-ink)}.wrap{max-width:880px;margin:0 auto;padding:0 18px}.disp,h1,h2,h3{font-family:var(--font-display);font-weight:400}
.bar{border-bottom:1px solid var(--line)}.bar .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-block:10px}
.brand{display:flex;align-items:center;gap:8px;font-size:22px;color:var(--fg);text-decoration:none;font-family:var(--font-display)}
.crumb{font-size:14px;color:var(--muted);margin:18px 0 6px}.crumb a{color:var(--muted)}
h1{font-size:clamp(26px,6vw,36px);line-height:1.3;margin:0 0 8px}h2{font-size:22px;margin:34px 0 10px}h3{font-size:18px;margin:22px 0 8px;color:var(--accent-ink)}
.lead{color:var(--muted);margin:0 0 16px}.cta{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 20px;border-radius:20px;background:var(--accent-btn);color:#fff;font-family:var(--font-display);font-size:17px;text-decoration:none}
.btn.soft{background:var(--accent-soft);color:var(--accent-ink)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:14px 0}.stats div{background:var(--bg);border-radius:18px;padding:12px 14px}.stats b{display:block;font-family:var(--font-display);font-weight:400;font-size:24px;color:var(--accent-ink)}.stats span{font-size:14px;color:var(--muted)}
.mini{list-style:none;padding:0;margin:0;display:grid;gap:6px}.mini li{display:flex;justify-content:space-between;gap:12px;padding:10px 14px;border-radius:14px;background:var(--bg)}.mini li span{color:var(--muted);font-size:14px;text-align:right}
.cards{display:grid;gap:10px}.card{padding:14px 16px;border-radius:18px;background:var(--bg);scroll-margin-top:12px}.card h4{margin:0;font-family:var(--font-display);font-weight:400;font-size:18px}
.card p{margin:2px 0;font-size:14px;color:var(--muted)}.card .hrs{color:var(--fg)}.card .links{display:flex;gap:14px;flex-wrap:wrap;font-size:14px;margin-top:4px}
.tag{display:inline-block;font-size:12.5px;padding:1px 9px;border-radius:10px;background:var(--accent-soft);color:var(--accent-ink);margin-left:6px;vertical-align:2px}.tag.night{background:var(--warn-soft);color:var(--warn)}.tag.off{background:var(--surface);color:var(--off)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;padding:0;list-style:none}.grid a{display:block;padding:10px 14px;border-radius:14px;border:1px solid var(--line);text-decoration:none;color:var(--fg)}.grid small{color:var(--muted)}
.toc{display:flex;gap:6px;flex-wrap:wrap;font-size:14px}.toc a{padding:3px 10px;border-radius:12px;background:var(--bg);text-decoration:none}
.foot{border-top:1px solid var(--line);margin-top:40px;font-size:13px;color:var(--muted)}.foot .wrap{padding-block:18px 28px;display:grid;gap:4px}`;
const LOGO = `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="15" fill="var(--accent)"/><path d="M15 8.5v13M8.5 15h13" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`;
// Marks cards that are open right now (Korean time) and fills the "지금 영업 중" count; holidays are not known here, so weekdays use the weekday hours.
const NOW_JS = `(()=>{const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).map(x=>[x.type,x.value]));
const d=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(p.weekday),m=+p.hour*60+ +p.minute,M=s=>+s.slice(0,2)*60+ +s.slice(2),sp=h=>{if(!h)return null;const[a,b]=h.split("-"),o=M(a);let e=M(b);if(e<=o)e+=1440;return[o,e]};
let n=0;document.querySelectorAll("[data-h]").forEach(c=>{const h=c.dataset.h.split(","),t=sp(h[d]),y=sp(h[(d+6)%7]);const open=(t&&m>=t[0]&&m<t[1])||(y&&y[1]>1440&&m<y[1]-1440);
const s=c.querySelector(".now");if(s){s.className="tag "+(open?"":"off")+" now";s.textContent=open?"지금 영업 중":"지금은 닫힘";}if(open)n++;});
const o=document.getElementById("openNow");if(o)o.textContent=n+"곳";})();`;

function page({ path, title, desc, crumbs, body, ld, hasNow, ad }) {
  const url = SITE_URL + path;
  const bc = { "@type": "BreadcrumbList", itemListElement: crumbs.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: SITE_URL + p })) };
  const graph = { "@context": "https://schema.org", "@graph": [bc, ...(ld || [])] };
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${SITE_NAME}"><meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE_URL}/og.png"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1e9e5e">
<link rel="alternate" type="application/rss+xml" title="${SITE_NAME} 업데이트" href="/rss.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&display=swap" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&display=swap"></noscript>
<style>${CSS}</style>
${ADSENSE_TAG}
<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header class="bar"><div class="wrap"><a class="brand" href="/">${LOGO}${SITE_NAME}</a><a href="/" class="btn soft" style="min-height:42px;font-size:15px">내 주변 찾기</a></div></header>
<main class="wrap">
<nav class="crumb" aria-label="현재 위치">${crumbs.map(([n, p], i) => i === crumbs.length - 1 ? esc(n) : `<a href="${esc(p)}">${esc(n)}</a> › `).join("")}</nav>
${body}
${ad ? AD_SLOT : ""}
</main>
<footer class="foot"><div class="wrap"><b class="disp" style="font-size:16px;color:var(--fg)">${SITE_NAME}</b><span>약국 정보 출처: 국립중앙의료원 전국 약국 정보 (공공데이터포털), 매일 갱신</span><span>운영시간은 약국 사정으로 바뀔 수 있어요. 방문 전에 전화로 확인하세요.</span><span><a href="/pharmacy/">전국 지역별 약국</a> · <a href="${HOL_PATH}">공휴일 약국</a> · <a href="/about/">사이트 소개·문의</a> · <a href="/privacy/">개인정보처리방침</a></span></div></footer>
${hasNow ? `<script>${NOW_JS}</script>` : ""}
</body>
</html>
`;
}

function pharmacyLD(p) {
  const spec = [];
  p.h.slice(0, 7).forEach((h, i) => { const t = span(h); if (t) spec.push({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/" + ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i], opens: clock(t[0]).replace("익일 ", ""), closes: t[1] >= 1440 ? (t[1] === 1440 ? "23:59" : clock(t[1]).replace("익일 ", "")) : clock(t[1]) }); });
  if (p.h[7]) { const t = span(p.h[7]); spec.push({ "@type": "OpeningHoursSpecification", dayOfWeek: "https://schema.org/PublicHolidays", opens: clock(t[0]).replace("익일 ", ""), closes: t[1] >= 1440 ? (t[1] === 1440 ? "23:59" : clock(t[1]).replace("익일 ", "")) : clock(t[1]) }); }
  return { "@type": "Pharmacy", name: p.n, address: { "@type": "PostalAddress", streetAddress: p.a, addressCountry: "KR" }, ...(p.t ? { telephone: p.t } : {}), geo: { "@type": "GeoCoordinates", latitude: p.y, longitude: p.x }, openingHoursSpecification: spec };
}
const anchor = p => "p-" + p.id.replace(/[^A-Za-z0-9_-]/g, "");
function card(p) {
  const q = encodeURIComponent(p.n);
  const tags = [p.full ? `<span class="tag night">24시간</span>` : p.late ? `<span class="tag night">심야 ${clock(p.close)}까지</span>` : "", p.always ? `<span class="tag">연중무휴</span>` : ""].join("");
  return `<article class="card" id="${anchor(p)}" data-h="${p.h.join(",")}"><h4>${esc(p.n)}${tags}<span class="tag off now"></span></h4>
<p>${esc(p.a)}</p><p class="hrs">${esc(hoursSummary(p.h))}</p>
<div class="links">${p.t ? `<a href="tel:${esc(p.t.replace(/[^0-9]/g, ""))}">전화 ${esc(p.t)}</a>` : ""}<a href="https://map.kakao.com/link/map/${q},${p.y},${p.x}" rel="nofollow noopener" target="_blank">카카오맵</a><a href="https://map.naver.com/p/search/${encodeURIComponent(p.n + " " + p.a.split(",")[0])}" rel="nofollow noopener" target="_blank">네이버지도</a></div></article>`;
}
const miniRow = (p, right, href) => `<li><a href="${href || "#" + anchor(p)}">${esc(p.n)}</a><span>${esc(right)}</span></li>`;
const appLink = (q, f) => "/?" + new URLSearchParams({ q, ...(f ? { f } : {}) }).toString();

function districtPage(sido, gu, list, sidoFull, updated) {
  const name = gu || sido, full = `${sido} ${gu}`.trim();
  const late = list.filter(p => p.late).sort((a, b) => b.close - a.close), allDay = list.filter(p => p.full), sun = list.filter(p => p.sun), hol = list.filter(p => p.hol), always = list.filter(p => p.always);
  const byDong = new Map(); list.forEach(p => (byDong.get(p.dong) || byDong.set(p.dong, []).get(p.dong)).push(p));
  const dongs = [...byDong.keys()].sort((a, b) => (a === "기타") - (b === "기타") || a.localeCompare(b, "ko"));
  const path = gu ? urlPath(sido, gu) : urlPath(sido);
  const title = `${full} 응급약국 · 24시 약국 · 심야약국 (${list.length}곳) | ${SITE_NAME}`;
  const desc = `${full} 응급약국, 24시 약국 찾기. 약국 ${list.length}곳 중 24시간 영업 ${allDay.length}곳, 밤 10시 이후 심야약국 ${late.length}곳, 일요일 ${sun.length}곳, 공휴일 ${hol.length}곳. 지금 문 연 약국을 바로 확인하세요.`;
  const q = `${sidoFull} ${gu}`.trim();
  const body = `<h1>${esc(name)} 응급약국 · 24시 약국 · 심야약국</h1>
<p class="lead">급하게 약이 필요할 때 ${esc(full)}에서 문 연 약국을 찾아보세요. 약국 ${list.length}곳의 요일별 영업시간을 모아 24시간, 늦은 밤, 일요일, 공휴일에 여는 약국을 먼저 보여드려요. 응급 상황이면 119에 전화하세요. (데이터 기준 ${updated})</p>
<div class="stats"><div><b id="openNow">-</b><span>지금 영업 중</span></div><div><b>${allDay.length}곳</b><span>24시간 영업</span></div><div><b>${late.length}곳</b><span>밤 10시 이후 영업</span></div><div><b>${sun.length}곳</b><span>일요일 영업</span></div><div><b>${hol.length}곳</b><span>공휴일 영업</span></div></div>
<div class="cta"><a class="btn" href="${esc(appLink(q, "open"))}">지금 문 연 약국 지도로 보기</a><a class="btn soft" href="${esc(appLink(q, "late"))}">심야약국 지도로 보기</a></div>
<h2>${esc(name)} 24시 약국</h2>
${allDay.length ? `<ul class="mini">${allDay.map(p => miniRow(p, `${p.dong} · 24시간`)).join("")}</ul>` : `<p>${esc(name)}에는 24시간 여는 약국 정보가 없어요. 아래 심야약국 중 가장 늦게까지 여는 곳을 확인해 보세요.</p>`}
<h2>${esc(name)} 심야약국 (밤 10시 이후 영업)</h2>
${late.length ? `<ul class="mini">${late.slice(0, 60).map(p => miniRow(p, `${p.dong} · ${p.full ? "24시간" : clock(p.close) + "까지"}`)).join("")}</ul>` : `<p>밤 10시 넘어서까지 여는 약국이 없어요. 가까운 지역도 확인해 보세요.</p>`}
<h2>${esc(name)} 일요일에 여는 약국</h2>
${sun.length ? `<ul class="mini">${sun.slice(0, 80).map(p => miniRow(p, `${p.dong} · 일 ${range(p.h[6])}`)).join("")}</ul>${sun.length > 80 ? `<p class="lead">외 ${sun.length - 80}곳은 아래 동네별 목록에 있어요.</p>` : ""}` : `<p>일요일 영업 정보가 있는 약국이 없어요.</p>`}
<h2 id="hol">${esc(name)} 공휴일에 여는 약국</h2>
${hol.length ? `<ul class="mini">${hol.slice(0, 80).map(p => miniRow(p, `${p.dong} · 공휴일 ${range(p.h[7])}`)).join("")}</ul>${hol.length > 80 ? `<p class="lead">외 ${hol.length - 80}곳은 아래 동네별 목록에 있어요.</p>` : ""}` : `<p>공휴일 영업 정보가 있는 약국이 없어요.</p>`}
${always.length ? `<h2>${esc(name)} 연중무휴 약국</h2><ul class="mini">${always.slice(0, 60).map(p => miniRow(p, p.dong)).join("")}</ul>` : ""}
<h2>동네별 전체 약국</h2>
<nav class="toc" aria-label="동네 바로가기">${dongs.map((d, i) => `<a href="#d${i}">${esc(d)}</a>`).join("")}</nav>
${dongs.map((d, i) => `<h3 id="d${i}">${esc(name)} ${esc(d)} 약국</h3><div class="cards">${byDong.get(d).map(card).join("")}</div>`).join("\n")}`;
  const crumbs = [[SITE_NAME, "/"], ["지역별", urlPath()], [sido, urlPath(sido)], ...(gu ? [[gu, path]] : [])];
  const ld = [{ "@type": "ItemList", name: `${full} 심야약국`, itemListElement: late.slice(0, 30).map((p, i) => ({ "@type": "ListItem", position: i + 1, item: pharmacyLD(p) })) }];
  return { path, title, desc, html: page({ path, title, desc, crumbs, body, ld, hasNow: true, ad: true }) };
}

function sidoPage(sido, sidoFull, gus, list, updated) {
  const path = urlPath(sido), late = list.filter(p => p.close > 1440).sort((a, b) => b.close - a.close);
  const lateN = list.filter(p => p.late).length, sunN = list.filter(p => p.sun).length, holN = list.filter(p => p.hol).length;
  const title = `${sido} 응급약국 · 24시 약국 · 심야약국 찾기 (${list.length}곳) | ${SITE_NAME}`;
  const desc = `${sidoFull} 응급약국, 24시 약국 찾기. 약국 ${list.length}곳 중 24시간 영업 ${list.filter(p => p.full).length}곳, 밤 10시 이후 영업 ${lateN}곳, 일요일 영업 ${sunN}곳, 공휴일 영업 ${holN}곳. 시·군·구별로 늦게까지 여는 약국을 확인하세요.`;
  const body = `<h1>${esc(sido)} 응급약국 · 24시 약국 · 심야약국</h1>
<p class="lead">${esc(sidoFull)} 약국 ${list.length}곳의 영업시간을 시·군·구별로 정리했어요. (데이터 기준 ${updated})</p>
<div class="stats"><div><b>${lateN}곳</b><span>밤 10시 이후 영업</span></div><div><b>${sunN}곳</b><span>일요일 영업</span></div><div><b>${holN}곳</b><span>공휴일 영업</span></div></div>
<div class="cta"><a class="btn" href="/">내 주변 문 연 약국 찾기</a></div>
<h2>시·군·구별 약국</h2>
<ul class="grid">${gus.map(([g, l]) => `<li><a href="${esc(urlPath(sido, g))}">${esc(g)} <small>심야 ${l.filter(p => p.late).length} · 전체 ${l.length}</small></a></li>`).join("")}</ul>
<h2>${esc(sido)}에서 밤 12시 넘어서까지 여는 약국</h2>
${late.length ? `<ul class="mini">${late.slice(0, 80).map(p => miniRow(p, `${p.gu} ${p.dong} · ${p.full ? "24시간" : clock(p.close) + "까지"}`, urlPath(sido, p.gu) + "#" + anchor(p))).join("")}</ul>` : `<p>밤 12시 넘어서까지 여는 약국 정보가 없어요. 시·군·구 페이지에서 밤 10시 이후 약국을 확인해 보세요.</p>`}`;
  return { path, title, desc, html: page({ path, title, desc, crumbs: [[SITE_NAME, "/"], ["지역별", urlPath()], [sido, path]], body, ad: true }) };
}

function indexPage(bySido, updated) {
  const path = urlPath();
  const body = `<h1>전국 지역별 응급약국 · 24시 약국 · 심야약국</h1>
<p class="lead">시·도와 시·군·구를 골라 밤늦게, 일요일, 공휴일에 여는 약국을 확인하세요. (데이터 기준 ${updated})</p>
${SIDO_ORDER.filter(s => bySido.has(s)).map(s => { const { gus, list } = bySido.get(s);
    return `<h2><a href="${esc(urlPath(s))}">${esc(s)}</a> <small style="font-size:15px;color:var(--muted)">${list.length}곳</small></h2>${gus.length ? `<ul class="grid">${gus.map(([g]) => `<li><a href="${esc(urlPath(s, g))}">${esc(g)}</a></li>`).join("")}</ul>` : ""}`; }).join("\n")}`;
  const title = `전국 지역별 응급약국 · 24시 약국 · 심야약국 | ${SITE_NAME}`, desc = "서울, 경기, 부산 등 전국 시·군·구별로 응급약국, 24시 약국, 밤늦게·일요일·공휴일에 문 여는 약국과 영업시간을 확인하세요.";
  return { path, title, desc, html: page({ path, title, desc, crumbs: [[SITE_NAME, "/"], ["지역별", path]], body, ad: true }) };
}

// ---- Holidays -------------------------------------------------------------------------------------
// The data has one "공휴일" schedule per pharmacy (dutyTime8), so every holiday page uses those hours.
// Dates: 2026/2027 월력요항 (우주항공청). Keep each holiday's slug stable so its address keeps its search history; just update the dates.
const HOLIDAYS = [
  { slug: "성탄절", name: "성탄절", alt: "크리스마스", days: ["2026-12-25"], short: "2026년 12월 25일", when: "2026년 12월 25일(금)",
    note: "크리스마스에는 동네 병원과 소아과가 대부분 쉬어서, 아이가 열이 나거나 다쳤을 때 약국부터 찾게 돼요. 금요일이라 주말까지 사흘 연휴가 이어지니, 상비약은 미리 챙겨 두는 게 좋아요. 밤이나 휴일에 아이를 진료하는 달빛어린이병원도 함께 알아 두세요." },
  { slug: "신정", name: "신정", alt: "새해 첫날 1월 1일", days: ["2027-01-01"], short: "2027년 1월 1일", when: "2027년 1월 1일(금)",
    note: "새해 첫날은 연말 모임 뒤 소화제나 숙취해소제, 감기약을 찾는 분이 많은 날이에요. 12월 31일 밤부터 문 닫는 약국이 많으니, 늦게까지 여는 곳을 미리 확인해 두세요." },
  { slug: "설날", name: "설 연휴", alt: "설날 명절", days: ["2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09"], short: "2027년 2월 6일~9일", when: "2027년 2월 6일(토)~9일(화), 9일은 대체공휴일",
    note: "설 연휴에는 고향이나 여행지에서 약국을 찾게 되는 일이 많아요. 내려가기 전에 가는 지역의 공휴일 약국을 아래에서 확인해 두세요. 설 당일(7일 일요일)에는 쉬는 약국이 많으니 전화로 꼭 확인하세요." },
];
const HOL_PATH = urlPath("공휴일");
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const faqLD = qa => ({ "@type": "FAQPage", mainEntity: qa.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });

function holidaySidoBlocks(bySido) {
  return SIDO_ORDER.filter(s => bySido.has(s)).map(s => {
    const { list, gus } = bySido.get(s), hol = list.filter(p => p.hol);
    const latest = hol.map(p => ({ p, t: span(p.h[7]) })).sort((a, b) => b.t[1] - a.t[1] || a.p.n.localeCompare(b.p.n, "ko")).slice(0, 8);
    const where = p => p.gu ? urlPath(s, p.gu) + "#" + anchor(p) : urlPath(s) + "#" + anchor(p);
    const links = gus.length ? `<ul class="grid">${gus.map(([g, l]) => `<li><a href="${esc(urlPath(s, g))}#hol">${esc(g)} <small>공휴일 ${l.filter(p => p.hol).length}곳</small></a></li>`).join("")}</ul>` : `<p><a href="${esc(urlPath(s))}#hol">${esc(s)} 공휴일 약국 전체 보기</a></p>`;
    return `<h2>${esc(s)} 공휴일 약국 <small style="font-size:15px;color:var(--muted)">${hol.length}곳</small></h2>
${latest.length ? `<h3>${esc(s)}에서 공휴일에 늦게까지 여는 곳</h3><ul class="mini">${latest.map(({ p }) => miniRow(p, `${[p.gu, p.dong === "기타" ? "" : p.dong].filter(Boolean).join(" ")} · ${range(p.h[7])}`, where(p))).join("")}</ul>` : ""}
${links}`;
  }).join("\n");
}

function holidayPage(h, bySido, total, updated) {
  const path = urlPath("공휴일", h.slug), past = h.days[h.days.length - 1] < kstToday();
  const title = `${h.name} 문 여는 약국 · ${h.alt} 약국 (${h.short}) | ${SITE_NAME}`;
  const desc = `${h.when} ${h.name}에 문 여는 약국 찾기. 전국 약국 중 공휴일 영업시간이 있는 약국 ${total.toLocaleString("ko-KR")}곳을 시·도, 시·군·구별로 정리했어요. 늦게까지 여는 곳과 지금 문 연 약국을 확인하세요.`;
  const weekend = h.days.some(d => [0, 6].includes(new Date(d + "T12:00:00+09:00").getUTCDay()));
  const qa = [
    [`${h.name}에도 약국이 문을 여나요?`, `네. 공휴일에 문 여는 약국이 지역마다 있어요. 전국 약국 중 ${total.toLocaleString("ko-KR")}곳이 공휴일 영업시간을 등록해 두었어요. 아래에서 시·군·구를 골라 확인하세요.`],
    [`${h.name} 약국 영업시간은 어떻게 확인하나요?`, `약국이 국립중앙의료원에 신고한 공휴일 영업시간을 보여드려요. 명절이나 연휴에는 약국 사정으로 바뀔 수 있으니 가기 전에 전화로 꼭 확인하세요.`],
    [`근처에 문 연 약국이 없으면 어떻게 하나요?`, `편의점에서 해열진통제, 감기약, 소화제, 파스 같은 안전상비의약품을 살 수 있어요. 응급 상황이면 119에 전화하세요.`],
  ];
  const body = `<h1>${esc(h.name)} 문 여는 약국 · ${esc(h.alt)} 약국</h1>
<p class="lead">${esc(h.when)}. ${esc(h.name)}에 문 여는 약국을 지역별로 모았어요. 약국이 신고한 공휴일 영업시간 기준이에요. (데이터 기준 ${updated})</p>
<p>${esc(h.note)}</p>
${past ? `<p class="lead"><b>올해 ${esc(h.name)}은 지났어요.</b> 다음 ${esc(h.name)} 날짜가 정해지면 바로 바꿔 둘게요. 공휴일 영업시간은 다음 공휴일에도 그대로 참고할 수 있어요.</p>` : ""}
${weekend ? `<p>연휴 중 토요일·일요일에는 약국마다 토·일 영업시간과 공휴일 영업시간이 다를 수 있어요. 지역 페이지에서 요일별 시간도 함께 확인하세요.</p>` : ""}
<div class="stats"><div><b>${total.toLocaleString("ko-KR")}곳</b><span>전국 공휴일 영업 약국</span></div><div><b>${h.days.length}일</b><span>${esc(h.name)} 쉬는 날</span></div></div>
<div class="cta"><a class="btn" href="/">내 주변 문 연 약국 지도로 찾기</a><a class="btn soft" href="${HOL_PATH}">다른 공휴일 보기</a></div>
${holidaySidoBlocks(bySido)}
<h2>자주 묻는 질문</h2>
${qa.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("\n")}`;
  const crumbs = [[SITE_NAME, "/"], ["공휴일 약국", HOL_PATH], [h.name, path]];
  return { path, title, desc, html: page({ path, title, desc, crumbs, body, ld: [faqLD(qa)], ad: true }) };
}

function holidayIndexPage(bySido, total, updated) {
  const path = HOL_PATH, today = kstToday();
  const title = `공휴일 약국 · 명절·연휴에 문 여는 약국 찾기 | ${SITE_NAME}`;
  const desc = `공휴일, 명절, 연휴에 문 여는 약국 찾기. 전국 약국 ${total.toLocaleString("ko-KR")}곳의 공휴일 영업시간을 시·도, 시·군·구별로 정리했어요. 성탄절, 신정, 설 연휴 약국도 확인하세요.`;
  const next = HOLIDAYS.filter(h => h.days[h.days.length - 1] >= today);
  const body = `<h1>공휴일 약국 · 명절·연휴에 문 여는 약국</h1>
<p class="lead">빨간 날에 문 여는 약국을 지역별로 모았어요. 전국 약국 중 ${total.toLocaleString("ko-KR")}곳이 공휴일 영업시간을 신고했어요. (데이터 기준 ${updated})</p>
<h2>다가오는 공휴일</h2>
<ul class="mini">${(next.length ? next : HOLIDAYS).map(h => `<li><a href="${esc(urlPath("공휴일", h.slug))}">${esc(h.name)} 문 여는 약국</a><span>${esc(h.when)}</span></li>`).join("")}</ul>
${holidaySidoBlocks(bySido)}`;
  return { path, title, desc, html: page({ path, title, desc, crumbs: [[SITE_NAME, "/"], ["공휴일 약국", path]], body, ad: true }) };
}

function aboutPage(count, updated) {
  const path = "/about/";
  const title = `사이트 소개·문의 | ${SITE_NAME}`, desc = `${SITE_NAME}는 밤늦게, 주말, 공휴일에 문 연 약국을 찾는 무료 사이트예요. 데이터 출처와 갱신 방식, 문의 방법을 안내해요.`;
  const body = `<h1>${SITE_NAME} 소개</h1>
<p class="lead">${SITE_NAME}(${esc(SITE_URL.replace(/^https?:\/\//, ""))})는 밤늦게, 주말, 공휴일에 문 연 약국을 휴대폰에서 빠르게 찾을 수 있게 만든 무료 사이트예요. 회원가입 없이 바로 쓸 수 있어요.</p>
<h2>무엇을 할 수 있나요</h2>
<ul>
<li>내 위치나 동 이름으로 지금 영업 중인 약국을 가까운 순서로 찾기</li>
<li>심야(밤 10시 이후), 24시간, 일요일, 공휴일, 연중무휴 약국만 골라 보기</li>
<li>날짜와 시간을 바꿔서 그때 여는 약국 미리 확인하기</li>
<li>전화 걸기, 카카오맵·네이버지도 길 안내로 바로 연결</li>
<li><a href="/pharmacy/">시·군·구별 약국 목록</a>과 <a href="${HOL_PATH}">공휴일 약국</a> 페이지</li>
</ul>
<h2>약국 정보는 어디서 오나요</h2>
<p>국립중앙의료원이 공공데이터포털에 공개하는 ‘전국 약국 정보’를 매일 새벽 3시에 받아와요. 지금 약국 ${count.toLocaleString("ko-KR")}곳의 요일별·공휴일 영업시간과 위치가 들어 있어요. (데이터 기준 ${updated})</p>
<p>영업시간은 약국이 신고한 정보라서, 약국 사정으로 바뀌었는데 아직 반영되지 않았을 수 있어요. 가기 전에 전화로 확인해 주세요.</p>
<h2>급할 때 도움 받을 곳</h2>
<ul><li>응급 상황: 119</li><li>보건복지상담센터: 129</li><li>약국이 모두 닫았을 때: 24시 편의점의 안전상비의약품(해열진통제, 감기약, 소화제, 파스)</li></ul>
<h2>문의</h2>
<p>${CONTACT ? `잘못된 영업시간 제보, 사이트 문의는 <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>로 보내 주세요.` : "잘못된 영업시간은 해당 약국이나 관할 보건소에 알려 주시면 공공데이터에 반영돼요."}</p>`;
  return { path, title, desc, html: page({ path, title, desc, crumbs: [["홈", "/"], ["사이트 소개", path]], body }) };
}

// ---- Build --------------------------------------------------------------------------------------
function privacyPage() {
  const path = "/privacy/";
  const body = `<h1>개인정보처리방침</h1>
<p>${SITE_NAME}(${esc(SITE_URL.replace(/^https?:\/\//, ""))})은 회원가입이 없고, 이름·전화번호 같은 개인정보를 직접 받거나 저장하지 않아요.</p>
<h2>내 위치</h2>
<p>‘내 주변 찾기’를 누르면 브라우저가 위치 사용을 물어봐요. 허용하면 위치는 휴대폰·PC 안에서 가까운 약국을 고르는 데만 쓰이고, 저장하지 않아요. 주변 약국 목록을 불러올 때 대략적인 지역 단위의 데이터 파일을 요청하게 돼요.</p>
<h2>검색어와 지도</h2>
<p>동 이름·주소 검색과 지도 표시는 카카오 지도 서비스를 이용해요. 검색어와 지도 요청은 카카오로 전달되며 <a href="https://www.kakao.com/policy/privacy" rel="noopener">카카오 개인정보처리방침</a>을 따릅니다.</p>
<h2>접속 기록</h2>
<p>사이트를 전달하는 호스팅 업체(Cloudflare)가 보안과 장애 대응을 위해 IP 주소, 접속 시간, 브라우저 정보 같은 기록을 자동으로 남길 수 있어요.</p>
<h2>광고와 쿠키</h2>
<p>이 사이트는 카카오 애드핏 등 광고 서비스의 광고를 보여줄 수 있어요. 광고 업체는 쿠키나 광고 식별자를 사용해 관심사에 맞는 광고를 보여줄 수 있어요. 자세한 내용은 <a href="https://www.kakao.com/policy/privacy" rel="noopener">카카오 개인정보처리방침</a>${ADSENSE ? `과 <a href="https://policies.google.com/technologies/ads?hl=ko" rel="noopener">Google 광고 정책</a>(맞춤 광고 끄기: <a href="https://adssettings.google.com" rel="noopener">Google 광고 설정</a>)` : ""}에서 볼 수 있고, 브라우저 설정에서 쿠키를 막을 수도 있어요.</p>
<h2>문의</h2>
<p>${CONTACT ? `개인정보 관련 문의: <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>` : "개인정보 관련 문의는 사이트 운영자에게 해 주세요."}</p>
<p>시행일: 2026년 10월 29일</p>`;
  const title = `개인정보처리방침 | ${SITE_NAME}`, desc = `${SITE_NAME}의 개인정보 처리, 위치 정보, 광고 쿠키 안내`;
  return { path, title, desc, html: page({ path, title, desc, crumbs: [["홈", "/"], ["개인정보처리방침", path]], body }) };
}

async function put(path, html) { const dir = new URL("." + decodeURIComponent(path), pub); await mkdir(dir, { recursive: true }); await writeFile(new URL("index.html", dir), html); }

// Every indexable page as { path, title, desc, html }; also used by scripts/lastmod.mjs to see which pages changed.
export async function renderPages() {
  const all = await loadAll();
  const meta = JSON.parse(await readFile(new URL("data/meta.json", pub), "utf8").catch(() => "{}"));
  // Korean date: the 03:00 KST update is still the previous day in UTC.
  const updated = new Date(new Date(meta.updatedAt || Date.now()).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const full = {}; Object.entries(SIDO).forEach(([f, s]) => full[s] ??= f);
  all.forEach(p => { const f = p.a.split(/\s+/)[0]; if (SIDO[f] === p.sido) full[p.sido] = f; });

  const bySido = new Map();
  for (const p of all) { const s = bySido.get(p.sido) || bySido.set(p.sido, { list: [], gu: new Map() }).get(p.sido); s.list.push(p); if (p.gu) (s.gu.get(p.gu) || s.gu.set(p.gu, []).get(p.gu)).push(p); }
  for (const s of bySido.values()) s.gus = [...s.gu].sort((a, b) => a[0].localeCompare(b[0], "ko"));

  const pages = [indexPage(bySido, updated)];
  for (const [s, { list, gus }] of bySido) {
    if (!gus.length) pages.push(districtPage(s, "", list, full[s], updated)); // 세종: one page for the whole city
    else { pages.push(sidoPage(s, full[s], gus, list, updated)); for (const [g, l] of gus) pages.push(districtPage(s, g, l, full[s], updated)); }
  }
  const holTotal = all.filter(p => p.hol).length;
  pages.push(holidayIndexPage(bySido, holTotal, updated), ...HOLIDAYS.map(h => holidayPage(h, bySido, holTotal, updated)));
  pages.push(aboutPage(all.length, updated));
  pages.push(privacyPage()); // AdSense review expects one; also says what the ads' cookies do
  return { pages, updated };
}

// What counts as "the content changed": the page minus its "데이터 기준 <date>" stamp.
export const contentHash = (html, updated) => createHash("sha256").update(html.split(updated).join("")).digest("hex").slice(0, 16);
export const LASTMOD_FILE = new URL("../seo/lastmod.json", import.meta.url);
export const readLastmod = async () => JSON.parse(await readFile(LASTMOD_FILE, "utf8").catch(() => "{}"));

// RFC 822 date for RSS, at 03:00 KST (when the daily data update runs).
const rssDate = d => new Date(d + "T03:00:00+09:00").toUTCString().replace("GMT", "+0000");

export async function buildSeo() {
  const { pages, updated } = await renderPages();
  for (const s of SIDO_ORDER) await rm(new URL(s + "/", pub), { recursive: true, force: true }); // pre-/pharmacy/ output
  await rm(new URL("지역/", pub), { recursive: true, force: true });
  await rm(new URL(BASE + "/", pub), { recursive: true, force: true });
  for (const p of pages) await put(p.path, p.html);

  // Not-found page. Cloudflare Pages serves it with a real 404; without it every unknown address would get the home page.
  const notFound = page({ path: "/404.html", title: `페이지를 찾을 수 없어요 | ${SITE_NAME}`, desc: "주소가 바뀌었거나 없는 페이지예요.", crumbs: [["홈", "/"], ["찾을 수 없음", "/404.html"]],
    body: `<h1>페이지를 찾을 수 없어요</h1><p>주소가 바뀌었거나 없는 페이지예요.</p><p><a class="btn" href="/">내 주변 문 연 약국 찾기</a> <a class="btn soft" href="/pharmacy/">지역별 약국 보기</a></p>` });
  await writeFile(new URL("404.html", pub), notFound.replace(/<link rel="canonical"[^>]*>/, '<meta name="robots" content="noindex">'));

  if (ADSENSE) await writeFile(new URL("ads.txt", pub), `google.com, ${ADSENSE.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`);
  else await rm(new URL("ads.txt", pub), { force: true });

  // Pages the daily workflow hasn't seen yet (new regions, first run) count as changed today.
  const mod = await readLastmod(), lastmod = path => mod[path]?.d || updated;
  const urls = ["/", ...pages.map(p => p.path)];
  await writeFile(new URL("sitemap.xml", pub), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${esc(SITE_URL + u)}</loc><lastmod>${lastmod(u)}</lastmod></url>`).join("\n")}\n</urlset>\n`);

  // RSS of the most recently changed pages (Naver Search Advisor → 요청 → RSS 제출 picks up new/changed pages from it).
  const feed = pages.filter(p => !["/privacy/", "/about/"].includes(p.path)).map(p => ({ ...p, d: lastmod(p.path) }))
    .sort((a, b) => b.d.localeCompare(a.d) || a.path.localeCompare(b.path)).slice(0, 100);
  const item = p => `<item><title>${esc(p.title.replace(/ \| [^|]+$/, ""))}</title><link>${esc(SITE_URL + p.path)}</link><guid isPermaLink="true">${esc(SITE_URL + p.path)}</guid><description>${esc(p.desc)}</description><pubDate>${rssDate(p.d)}</pubDate></item>`;
  await writeFile(new URL("rss.xml", pub), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${SITE_NAME} - 응급약국 · 24시 약국 · 심야약국</title>
<link>${SITE_URL}/</link>
<atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
<description>전국 지역별 응급약국, 24시 약국, 심야·일요일·공휴일 약국 영업시간. 공공데이터로 매일 갱신해요.</description>
<language>ko</language>
<lastBuildDate>${rssDate(feed[0]?.d || updated)}</lastBuildDate>
${feed.map(item).join("\n")}
</channel></rss>
`);
  await writeFile(new URL("robots.txt", pub), PREVIEW ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\nDisallow: /data/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  // Search Console / Search Advisor ownership tags (public values, set as Vercel / Cloudflare Pages environment variables).
  // One tag per registered address: values may be comma-separated, or split over NAVER_SITE_VERIFICATION2, ...3 and so on.
  const env = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b));
  const tags = [["google-site-verification", "GOOGLE_SITE_VERIFICATION"], ["naver-site-verification", "NAVER_SITE_VERIFICATION"]]
    .flatMap(([n, key]) => env.filter(([k]) => k.startsWith(key)).flatMap(([, v]) => v.split(",")).map(s => s.trim()).filter(Boolean)
      .map(s => `<meta name="${n}" content="${esc(s)}">`)).concat(ADSENSE_TAG || []).join("\n");
  const indexUrl = new URL("index.html", pub), index = await readFile(indexUrl, "utf8");
  let out = index.replace(/<!-- site-verification -->[\s\S]*?<!-- \/site-verification -->/, `<!-- site-verification -->${tags ? "\n" + tags + "\n" : ""}<!-- /site-verification -->`);
  out = out.replace(/<!-- ad-slot -->[\s\S]*?<!-- \/ad-slot -->/, `<!-- ad-slot -->${AD_SLOT}<!-- /ad-slot -->`);
  if (PREVIEW) out = out.replace("<!-- /site-verification -->", `<!-- /site-verification -->\n<meta name="robots" content="noindex">`);
  if (out !== index) await writeFile(indexUrl, out);
  console.log(`seo: ${pages.length} region pages, ${urls.length} sitemap urls, ${feed.length} rss items (${SITE_URL})${PREVIEW ? " [preview: noindex]" : ""}`);
}
