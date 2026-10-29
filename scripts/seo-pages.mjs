// Search-engine pages, built from public/data/g/*.json on every deploy (the data workflow commits daily, which redeploys):
//   /<시도>/                 e.g. /서울/        districts with counts + pharmacies open past midnight
//   /<시도>/<시군구>/        e.g. /서울/관악구/  night, Sunday and holiday pharmacies, then every pharmacy by 동
//   /sitemap.xml, /robots.txt
// Also fills the site-verification marker in public/index.html from NAVER_SITE_VERIFICATION / GOOGLE_SITE_VERIFICATION.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

export const SITE_NAME = "심야약국";
const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
export const SITE_URL = (process.env.SITE_URL || (prodHost ? "https://" + prodHost : "https://simya-yakguk.vercel.app")).replace(/\/$/, "");
const PREVIEW = process.env.VERCEL_ENV === "preview";

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
const urlPath = (...parts) => "/" + parts.map(encodeURIComponent).join("/") + "/";

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
  return list.filter(p => place(p)).map(enrich).sort((a, b) => a.n.localeCompare(b.n, "ko"));
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

function page({ path, title, desc, crumbs, body, ld, hasNow }) {
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&display=swap" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&display=swap"></noscript>
<style>${CSS}</style>
<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>
</head>
<body>
<header class="bar"><div class="wrap"><a class="brand" href="/">${LOGO}${SITE_NAME}</a><a href="/" class="btn soft" style="min-height:42px;font-size:15px">내 주변 찾기</a></div></header>
<main class="wrap">
<nav class="crumb" aria-label="현재 위치">${crumbs.map(([n, p], i) => i === crumbs.length - 1 ? esc(n) : `<a href="${esc(p)}">${esc(n)}</a> › `).join("")}</nav>
${body}
</main>
<footer class="foot"><div class="wrap"><b class="disp" style="font-size:16px;color:var(--fg)">${SITE_NAME}</b><span>약국 정보 출처: 국립중앙의료원 전국 약국 정보 (공공데이터포털), 매일 갱신</span><span>운영시간은 약국 사정으로 바뀔 수 있어요. 방문 전에 전화로 확인하세요.</span><span><a href="/지역/">전국 지역별 약국</a></span></div></footer>
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
  const late = list.filter(p => p.late).sort((a, b) => b.close - a.close), sun = list.filter(p => p.sun), hol = list.filter(p => p.hol), always = list.filter(p => p.always);
  const byDong = new Map(); list.forEach(p => (byDong.get(p.dong) || byDong.set(p.dong, []).get(p.dong)).push(p));
  const dongs = [...byDong.keys()].sort((a, b) => (a === "기타") - (b === "기타") || a.localeCompare(b, "ko"));
  const path = gu ? urlPath(sido, gu) : urlPath(sido);
  const title = `${full} 심야약국 · 주말 · 공휴일 약국 (${list.length}곳) | ${SITE_NAME}`;
  const desc = `${full} 약국 ${list.length}곳의 영업시간. 밤 10시 넘어서까지 여는 심야약국 ${late.length}곳, 일요일 영업 ${sun.length}곳, 공휴일 영업 ${hol.length}곳. 지금 문 연 약국을 바로 확인하세요.`;
  const q = `${sidoFull} ${gu}`.trim();
  const body = `<h1>${esc(name)} 심야약국 · 주말약국 · 공휴일 약국</h1>
<p class="lead">${esc(full)}에 있는 약국 ${list.length}곳의 요일별 영업시간을 모았어요. 늦은 밤, 일요일, 공휴일에 문 여는 약국을 먼저 보여드려요. (데이터 기준 ${updated})</p>
<div class="stats"><div><b id="openNow">-</b><span>지금 영업 중</span></div><div><b>${late.length}곳</b><span>밤 10시 이후 영업</span></div><div><b>${sun.length}곳</b><span>일요일 영업</span></div><div><b>${hol.length}곳</b><span>공휴일 영업</span></div></div>
<div class="cta"><a class="btn" href="${esc(appLink(q, "open"))}">지금 문 연 약국 지도로 보기</a><a class="btn soft" href="${esc(appLink(q, "late"))}">심야약국 지도로 보기</a></div>
<h2>${esc(name)} 심야약국 (밤 10시 이후 영업)</h2>
${late.length ? `<ul class="mini">${late.slice(0, 60).map(p => miniRow(p, `${p.dong} · ${p.full ? "24시간" : clock(p.close) + "까지"}`)).join("")}</ul>` : `<p>밤 10시 넘어서까지 여는 약국이 없어요. 가까운 지역도 확인해 보세요.</p>`}
<h2>${esc(name)} 일요일에 여는 약국</h2>
${sun.length ? `<ul class="mini">${sun.slice(0, 80).map(p => miniRow(p, `${p.dong} · 일 ${range(p.h[6])}`)).join("")}</ul>${sun.length > 80 ? `<p class="lead">외 ${sun.length - 80}곳은 아래 동네별 목록에 있어요.</p>` : ""}` : `<p>일요일 영업 정보가 있는 약국이 없어요.</p>`}
<h2>${esc(name)} 공휴일에 여는 약국</h2>
${hol.length ? `<ul class="mini">${hol.slice(0, 80).map(p => miniRow(p, `${p.dong} · 공휴일 ${range(p.h[7])}`)).join("")}</ul>${hol.length > 80 ? `<p class="lead">외 ${hol.length - 80}곳은 아래 동네별 목록에 있어요.</p>` : ""}` : `<p>공휴일 영업 정보가 있는 약국이 없어요.</p>`}
${always.length ? `<h2>${esc(name)} 연중무휴 약국</h2><ul class="mini">${always.slice(0, 60).map(p => miniRow(p, p.dong)).join("")}</ul>` : ""}
<h2>동네별 전체 약국</h2>
<nav class="toc" aria-label="동네 바로가기">${dongs.map((d, i) => `<a href="#d${i}">${esc(d)}</a>`).join("")}</nav>
${dongs.map((d, i) => `<h3 id="d${i}">${esc(name)} ${esc(d)} 약국</h3><div class="cards">${byDong.get(d).map(card).join("")}</div>`).join("\n")}`;
  const crumbs = [[SITE_NAME, "/"], ["지역별", urlPath("지역")], [sido, urlPath(sido)], ...(gu ? [[gu, path]] : [])];
  const ld = [{ "@type": "ItemList", name: `${full} 심야약국`, itemListElement: late.slice(0, 30).map((p, i) => ({ "@type": "ListItem", position: i + 1, item: pharmacyLD(p) })) }];
  return { path, html: page({ path, title, desc, crumbs, body, ld, hasNow: true }) };
}

function sidoPage(sido, sidoFull, gus, list, updated) {
  const path = urlPath(sido), late = list.filter(p => p.close > 1440).sort((a, b) => b.close - a.close);
  const lateN = list.filter(p => p.late).length, sunN = list.filter(p => p.sun).length, holN = list.filter(p => p.hol).length;
  const title = `${sido} 심야약국 · 주말 · 공휴일 약국 찾기 (${list.length}곳) | ${SITE_NAME}`;
  const desc = `${sidoFull} 약국 ${list.length}곳 중 밤 10시 이후 영업 ${lateN}곳, 일요일 영업 ${sunN}곳, 공휴일 영업 ${holN}곳. 시·군·구별로 늦게까지 여는 약국을 확인하세요.`;
  const body = `<h1>${esc(sido)} 심야약국 · 주말약국 · 공휴일 약국</h1>
<p class="lead">${esc(sidoFull)} 약국 ${list.length}곳의 영업시간을 시·군·구별로 정리했어요. (데이터 기준 ${updated})</p>
<div class="stats"><div><b>${lateN}곳</b><span>밤 10시 이후 영업</span></div><div><b>${sunN}곳</b><span>일요일 영업</span></div><div><b>${holN}곳</b><span>공휴일 영업</span></div></div>
<div class="cta"><a class="btn" href="/">내 주변 문 연 약국 찾기</a></div>
<h2>시·군·구별 약국</h2>
<ul class="grid">${gus.map(([g, l]) => `<li><a href="${esc(urlPath(sido, g))}">${esc(g)} <small>심야 ${l.filter(p => p.late).length} · 전체 ${l.length}</small></a></li>`).join("")}</ul>
<h2>${esc(sido)}에서 밤 12시 넘어서까지 여는 약국</h2>
${late.length ? `<ul class="mini">${late.slice(0, 80).map(p => miniRow(p, `${p.gu} ${p.dong} · ${p.full ? "24시간" : clock(p.close) + "까지"}`, urlPath(sido, p.gu) + "#" + anchor(p))).join("")}</ul>` : `<p>밤 12시 넘어서까지 여는 약국 정보가 없어요. 시·군·구 페이지에서 밤 10시 이후 약국을 확인해 보세요.</p>`}`;
  return { path, html: page({ path, title, desc, crumbs: [[SITE_NAME, "/"], ["지역별", urlPath("지역")], [sido, path]], body }) };
}

function indexPage(bySido, updated) {
  const path = urlPath("지역");
  const body = `<h1>전국 지역별 심야약국 · 주말약국</h1>
<p class="lead">시·도와 시·군·구를 골라 밤늦게, 일요일, 공휴일에 여는 약국을 확인하세요. (데이터 기준 ${updated})</p>
${SIDO_ORDER.filter(s => bySido.has(s)).map(s => { const { gus, list } = bySido.get(s);
    return `<h2><a href="${esc(urlPath(s))}">${esc(s)}</a> <small style="font-size:15px;color:var(--muted)">${list.length}곳</small></h2>${gus.length ? `<ul class="grid">${gus.map(([g]) => `<li><a href="${esc(urlPath(s, g))}">${esc(g)}</a></li>`).join("")}</ul>` : ""}`; }).join("\n")}`;
  return { path, html: page({ path, title: `전국 지역별 심야약국 · 주말 · 공휴일 약국 | ${SITE_NAME}`, desc: "서울, 경기, 부산 등 전국 시·군·구별로 밤늦게, 일요일, 공휴일에 문 여는 약국과 영업시간을 확인하세요.", crumbs: [[SITE_NAME, "/"], ["지역별", path]], body }) };
}

// ---- Build --------------------------------------------------------------------------------------
async function put(path, html) { const dir = new URL("." + decodeURIComponent(path), pub); await mkdir(dir, { recursive: true }); await writeFile(new URL("index.html", dir), html); }

export async function buildSeo() {
  const all = await loadAll();
  const meta = JSON.parse(await readFile(new URL("data/meta.json", pub), "utf8").catch(() => "{}"));
  const updated = (meta.updatedAt || new Date().toISOString()).slice(0, 10);
  const full = {}; Object.entries(SIDO).forEach(([f, s]) => full[s] ??= f);
  all.forEach(p => { const f = p.a.split(/\s+/)[0]; if (SIDO[f] === p.sido) full[p.sido] = f; });

  const bySido = new Map();
  for (const p of all) { const s = bySido.get(p.sido) || bySido.set(p.sido, { list: [], gu: new Map() }).get(p.sido); s.list.push(p); if (p.gu) (s.gu.get(p.gu) || s.gu.set(p.gu, []).get(p.gu)).push(p); }
  for (const s of bySido.values()) s.gus = [...s.gu].sort((a, b) => a[0].localeCompare(b[0], "ko"));

  for (const s of SIDO_ORDER) await rm(new URL(s + "/", pub), { recursive: true, force: true });
  await rm(new URL("지역/", pub), { recursive: true, force: true });
  const pages = [indexPage(bySido, updated)];
  for (const [s, { list, gus }] of bySido) {
    if (!gus.length) pages.push(districtPage(s, "", list, full[s], updated)); // 세종: one page for the whole city
    else { pages.push(sidoPage(s, full[s], gus, list, updated)); for (const [g, l] of gus) pages.push(districtPage(s, g, l, full[s], updated)); }
  }
  for (const p of pages) await put(p.path, p.html);

  const urls = ["/", ...pages.map(p => p.path)];
  await writeFile(new URL("sitemap.xml", pub), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${esc(SITE_URL + u)}</loc><lastmod>${updated}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(new URL("robots.txt", pub), PREVIEW ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\nDisallow: /data/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  // Search Console / Search Advisor ownership tags (public values, set as Vercel environment variables).
  const tags = [["google-site-verification", process.env.GOOGLE_SITE_VERIFICATION], ["naver-site-verification", process.env.NAVER_SITE_VERIFICATION]]
    .filter(([, v]) => v).map(([n, v]) => `<meta name="${n}" content="${esc(v.trim())}">`).join("\n");
  const indexUrl = new URL("index.html", pub), index = await readFile(indexUrl, "utf8");
  let out = index.replace(/<!-- site-verification -->[\s\S]*?<!-- \/site-verification -->/, `<!-- site-verification -->${tags ? "\n" + tags + "\n" : ""}<!-- /site-verification -->`);
  if (PREVIEW) out = out.replace("<!-- /site-verification -->", `<!-- /site-verification -->\n<meta name="robots" content="noindex">`);
  if (out !== index) await writeFile(indexUrl, out);
  console.log(`seo: ${pages.length} region pages, ${urls.length} sitemap urls (${SITE_URL})${PREVIEW ? " [preview: noindex]" : ""}`);
}
