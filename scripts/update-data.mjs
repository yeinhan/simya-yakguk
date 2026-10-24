// Downloads every pharmacy from the 국립중앙의료원 전국 약국 정보 조회 서비스 (공공데이터포털)
// and writes it as small JSON files grouped by map cell, so the site can load only what is near the visitor.
//
//   DATA_GO_KR_KEY=<인증키> node scripts/update-data.mjs
//
// Output (all under public/data):
//   g/<lat10>_<lon10>.json   pharmacies in a 0.1° x 0.1° cell (about 11 km x 9 km)
//   meta.json                { updatedAt, count, sample }
import { mkdir, rm, writeFile } from "node:fs/promises";

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) { console.error("DATA_GO_KR_KEY is not set"); process.exit(1); }

const BASE = "https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire";
const ROWS = 500;
// Each 시/도 may be spelled the new or the old way in the API, so every spelling is tried.
const SIDO = [
  ["서울특별시"], ["부산광역시"], ["대구광역시"], ["인천광역시"], ["광주광역시"], ["대전광역시"], ["울산광역시"],
  ["세종특별자치시"], ["경기도"], ["강원특별자치도", "강원도"], ["충청북도"], ["충청남도"],
  ["전북특별자치도", "전라북도"], ["전라남도"], ["경상북도"], ["경상남도"], ["제주특별자치도"],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const unxml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function call(params, tries = 4) {
  const url = new URL(BASE);
  url.searchParams.set("serviceKey", KEY); // already URL-safe handling: URLSearchParams encodes it once
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/xml" } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return parse(text);
    } catch (e) {
      if (i === tries) throw e;
      console.warn(`retry ${i} after error: ${e.message}`);
      await sleep(1000 * i);
    }
  }
}

function parse(xml) {
  const code = (xml.match(/<resultCode>(.*?)<\/resultCode>/) || [])[1];
  if (code && code !== "00") throw new Error(`API error ${code}: ${(xml.match(/<resultMsg>(.*?)<\/resultMsg>/) || [])[1]}`);
  if (!code && /<errMsg>|<returnAuthMsg>/.test(xml)) throw new Error(`API error: ${xml.slice(0, 300)}`);
  const total = +((xml.match(/<totalCount>(\d+)<\/totalCount>/) || [])[1] || 0);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const o = {};
    for (const f of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = unxml(f[2].trim());
    return o;
  });
  return { total, items };
}

async function fetchSido(names) {
  for (const name of names) {
    const first = await call({ Q0: name, pageNo: 1, numOfRows: ROWS });
    if (!first.total) { console.warn(`${name}: 0 results`); continue; }
    const all = [...first.items];
    for (let page = 2; all.length < first.total && page <= Math.ceil(first.total / ROWS) + 1; page++) {
      await sleep(250);
      all.push(...(await call({ Q0: name, pageNo: page, numOfRows: ROWS })).items);
    }
    console.log(`${name}: ${all.length}/${first.total}`);
    return all;
  }
  console.error(`!! no data for ${names.join("/")}`);
  return [];
}

// "0900" style times; an empty string means closed that day. Index 0..7 = 월..일, 공휴일.
const hhmm = v => (v && /^\d{3,4}$/.test(String(v).trim()) ? String(v).trim().padStart(4, "0") : "");
function compact(r) {
  const y = parseFloat(r.wgs84Lat), x = parseFloat(r.wgs84Lon);
  if (!(y > 32 && y < 39.5 && x > 123 && x < 133)) return null; // outside Korea or missing
  const h = [1, 2, 3, 4, 5, 6, 7, 8].map(d => { const s = hhmm(r["dutyTime" + d + "s"]), c = hhmm(r["dutyTime" + d + "c"]); return s && c ? `${s}-${c}` : ""; });
  return { id: r.hpid || `${r.dutyName}|${r.dutyAddr}`, n: r.dutyName, a: r.dutyAddr, t: r.dutyTel1 || "", y: +y.toFixed(6), x: +x.toFixed(6), h };
}

const out = new URL("../public/data/", import.meta.url);
const byCell = new Map();
let total = 0, skipped = 0;
for (const names of SIDO) {
  for (const r of await fetchSido(names)) {
    const p = compact(r);
    if (!p) { skipped++; continue; }
    const k = `${Math.floor(p.y * 10)}_${Math.floor(p.x * 10)}`;
    if (!byCell.has(k)) byCell.set(k, new Map());
    byCell.get(k).set(p.id, p);
    total++;
  }
  await sleep(300);
}
if (total < 15000) { console.error(`only ${total} pharmacies; refusing to overwrite the data (expected 20000+)`); process.exit(1); }

await rm(new URL("g/", out), { recursive: true, force: true });
await mkdir(new URL("g/", out), { recursive: true });
for (const [k, m] of byCell) await writeFile(new URL(`g/${k}.json`, out), JSON.stringify([...m.values()]));
await writeFile(new URL("meta.json", out), JSON.stringify({ updatedAt: new Date().toISOString(), count: total, sample: false }));
console.log(`done: ${total} pharmacies in ${byCell.size} cells, ${skipped} skipped (no coordinates)`);
