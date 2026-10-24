// Local development only: writes fake pharmacies around Seoul so the site can be tried without an API key.
//   node scripts/sample-data.mjs && node scripts/build.mjs && npx serve public
import { mkdir, rm, writeFile } from "node:fs/promises";
const out = new URL("../public/data/", import.meta.url);
await rm(new URL("g/", out), { recursive: true, force: true });
await mkdir(new URL("g/", out), { recursive: true });
const spots = [[37.4827, 126.9416, "봉천"], [37.5530, 126.9190, "서교"], [37.4979, 127.0276, "강남"]];
const byCell = new Map(); let n = 0;
spots.forEach(([lat, lon, nm], si) => {
  for (let k = 0; k < 40; k++) {
    const y = lat + (Math.sin(k * 7 + si) * 0.035), x = lon + (Math.cos(k * 5 + si) * 0.04);
    const kind = k % 4; // 0 weekday day, 1 late, 2 24h-ish, 3 weekend
    const day = "0900-1900", late = "1000-2400", all = "0000-2400";
    const h = kind === 0 ? [day,day,day,day,day,"0900-1300","",""] : kind === 1 ? [late,late,late,late,late,late,late,late] : kind === 2 ? Array(8).fill(all) : [day,day,day,day,day,"0900-1800","1000-1700","1000-1700"];
    const p = { id: `S${si}-${k}`, n: `샘플${nm}${k + 1}약국`, a: `서울 ${nm} 가상로 ${k + 1}`, t: "02-000-" + String(1000 + k), y: +y.toFixed(6), x: +x.toFixed(6), h, np: kind === 1 };
    const key = `${Math.floor(p.y * 10)}_${Math.floor(p.x * 10)}`;
    (byCell.get(key) || byCell.set(key, []).get(key)).push(p); n++;
  }
});
for (const [k, v] of byCell) await writeFile(new URL(`g/${k}.json`, out), JSON.stringify(v));
await writeFile(new URL("meta.json", out), JSON.stringify({ updatedAt: new Date().toISOString(), count: n, sample: true }));
console.log("sample data:", n);
