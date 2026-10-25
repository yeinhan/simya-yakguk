// 우리동네 약국: front end. Data comes from data/g/<cell>.json (see scripts/update-data.mjs);
// places and the map come from Kakao when a JavaScript key is configured (config.js), otherwise a plain drawn map is used.
const CFG = window.APP_CONFIG || {};
const $ = id => document.getElementById(id);
const DAY_LABEL = ["", "월", "화", "수", "목", "금", "토", "일", "공휴일"];
const HOLIDAYS_2026 = ["2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-01","2026-03-02","2026-05-05","2026-05-24","2026-05-25","2026-06-03","2026-06-06","2026-08-15","2026-08-17","2026-09-24","2026-09-25","2026-09-26","2026-10-03","2026-10-05","2026-10-09","2026-12-25"];
const SIDO = ["서울특별시","부산광역시","대구광역시","인천광역시","광주광역시","대전광역시","울산광역시","세종특별자치시","경기도","강원특별자치도","충청북도","충청남도","전북특별자치도","전라남도","경상북도","경상남도","제주특별자치도"];
const RADII = [3, 6, 8]; // km; data cells are 3x3 (about +-9 km), so 8 is the limit

// ---- Time (KST) -----------------------------------------------------------------
function kstParts() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const adv = { date: "", time: "", hol: false, follow: true };
function moment() {
  if (adv.follow) { const k = kstParts(); adv.date = k.date; adv.time = k.time; }
  const [hh, mm] = adv.time.split(":").map(Number), [y, mo, d] = adv.date.split("-").map(Number);
  const day = ((new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7) + 1;
  return { day, holiday: adv.hol || HOLIDAYS_2026.includes(adv.date), min: hh * 60 + mm, label: `${mo}월 ${d}일`, isNow: adv.follow };
}
const toMin = s => +s.slice(0, 2) * 60 + +s.slice(2);
function slot(i, d) { const s = i["dutyTime"+d+"s"], c = i["dutyTime"+d+"c"]; if (!s || !c) return null;
  const o = toMin(s); let e = toMin(c); if (e <= o) e += 1440; return [o, e]; }
const effDay = m => m.holiday ? 8 : m.day;
function status(i, m) {
  const t = slot(i, effDay(m)), y = slot(i, m.day === 1 ? 7 : m.day - 1);
  if (y && y[1] > 1440 && m.min < y[1] - 1440) return { open: true, closesAt: y[1] - 1440 };
  if (t && m.min >= t[0] && m.min < t[1]) return { open: true, closesAt: t[1] };
  if (t && m.min < t[0]) return { open: false, opensAt: t[0] };
  return { open: false };
}
const fmt = min => { if (min === 1440) return "밤 12시"; const t = ((min % 1440) + 1440) % 1440, h = Math.floor(t / 60), mm = t % 60, h12 = h % 12 === 0 ? 12 : h % 12;
  return `${min >= 1440 ? "새벽" : h < 12 ? "오전" : "오후"} ${h12}시${mm ? " " + mm + "분" : ""}`; };
const hhmm = s => { const h = +s.slice(0, 2); return s === "2400" ? "24:00" : h >= 24 ? `익일 ${String(h - 24).padStart(2, "0")}:${s.slice(2)}` : s.slice(0, 2) + ":" + s.slice(2); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function km(a, b) { const R = 6371, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2)); }
const distTxt = d => d < 1 ? Math.round(d * 1000) + "m" : d.toFixed(1) + "km";
const walkTxt = d => Math.max(1, Math.round(d / 0.065)) + "분";

// ---- Data -------------------------------------------------------------------------------
const store = new Map(), cells = new Map();
let meta = { sample: false };
function toItem(p) {
  const it = { id: p.id, dutyName: p.n, dutyAddr: p.a, dutyTel1: p.t, lat: p.y, lon: p.x, nightPublic: !!p.np };
  (p.h || []).forEach((h, i) => { if (h) { const [s, c] = h.split("-"); it["dutyTime" + (i + 1) + "s"] = s; it["dutyTime" + (i + 1) + "c"] = c; } });
  return it;
}
function loadCell(k) {
  if (!cells.has(k)) cells.set(k, fetch(`data/g/${k}.json`).then(r => r.ok ? r.json() : []).catch(() => []).then(list => list.forEach(p => store.set(p.id, toItem(p)))));
  return cells.get(k);
}
function ensureLoaded(lat, lon) {
  const a = Math.floor(lat * 10), b = Math.floor(lon * 10), ps = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) ps.push(loadCell(`${a + dx}_${b + dy}`));
  return Promise.all(ps);
}
fetch("data/meta.json").then(r => r.json()).then(m => { meta = m; renderMeta(); }).catch(() => renderMeta());
function renderMeta() {
  $("sampleNotice").hidden = !meta.sample;
  $("dataDate").textContent = meta.updatedAt && !meta.sample ? `데이터 기준: ${meta.updatedAt.slice(0, 10)} (매일 갱신)` : "";
}

// ---- Kakao (places + map), optional -------------------------------------------------------------
let kakaoOK = false, mapProblem = "";
const kakaoReady = new Promise(resolve => {
  if (!CFG.kakaoJsKey) return resolve(false);
  const s = document.createElement("script");
  s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(CFG.kakaoJsKey)}&libraries=services&autoload=false`;
  s.onload = () => kakao.maps.load(() => { kakaoOK = true; $("mapNote").hidden = true; resolve(true); });
  s.onerror = () => { mapProblem = "카카오 지도를 불러오지 못했어요 (키 종류, 도메인 등록, 카카오맵 사용 설정을 확인해 주세요)"; resolve(false); };
  setTimeout(() => { if (!kakaoOK) { mapProblem = "카카오 지도가 응답하지 않아요 (네트워크나 카카오맵 사용 설정을 확인해 주세요)"; resolve(false); } }, 10000);
  document.head.appendChild(s);
}).then(ok => { if (!ok && !CFG.kakaoJsKey) mapProblem = "지도 키(KAKAO_JS_KEY)가 사이트에 들어 있지 않아요";
  $("mapNote").textContent = ok ? "" : "간이 지도로 표시 중 · " + mapProblem; $("mapNote").hidden = ok;
  if (ok && (view === "results" || view === "detail")) showView(view); return ok; });

const FALLBACK_PLACES = { "봉천동": [37.4827, 126.9416], "신림동": [37.4842, 126.9297], "서교동": [37.5530, 126.9190], "홍대": [37.5563, 126.9236], "강남역": [37.4979, 127.0276], "역삼동": [37.5006, 127.0366] };
async function geocode(q) {
  await Promise.race([kakaoReady, new Promise(r => setTimeout(r, 3000))]);
  if (!kakaoOK) { const k = Object.keys(FALLBACK_PLACES).find(x => q.includes(x)); return k ? { lat: FALLBACK_PLACES[k][0], lon: FALLBACK_PLACES[k][1], label: q } : null; }
  const S = kakao.maps.services;
  return new Promise(res => new S.Geocoder().addressSearch(q, (r, st) => {
    if (st === S.Status.OK && r.length) return res({ lat: +r[0].y, lon: +r[0].x, label: q });
    new S.Places().keywordSearch(q, (r2, st2) => res(st2 === S.Status.OK && r2.length ? { lat: +r2[0].y, lon: +r2[0].x, label: q } : null));
  }));
}

// ---- State --------------------------------------------------------------------------
const filters = new Set(["open"]);
let origin = null, nameQuery = "", notFound = "", selected = null, view = "home", radius = RADII[0], loading = false;

async function setOrigin(o) { origin = o; notFound = ""; nameQuery = ""; selected = null; radius = RADII[0]; loading = true; render(); await ensureLoaded(o.lat, o.lon); loading = false; render(); }
async function runSearch(raw) {
  const q = raw.trim().replace(/\s+/g, " ");
  if (!q) return render();
  loading = true; notFound = ""; render();
  const g = await geocode(q);
  if (g) return setOrigin(g);
  const hits = [...store.values()].filter(i => i.dutyName.includes(q) || i.dutyAddr.includes(q));
  loading = false; selected = null; radius = RADII[0];
  if (hits.length) { nameQuery = q; origin = { lat: hits[0].lat, lon: hits[0].lon, label: `"${q}"` }; } else { notFound = q; }
  render();
}
function compute() {
  const m = moment();
  let rows = [...store.values()].map(i => { const t = slot(i, effDay(m));
    return { i, st: status(i, m), d: origin ? km(origin, i) : 0, all: [1,2,3,4,5,6,7,8].every(d => slot(i, d)),
      late: i.nightPublic || (t && t[1] >= 22 * 60), weekend: !!slot(i, 6) || !!slot(i, 7) || !!slot(i, 8) }; });
  if (!origin) return { m, rows: [] };
  if (nameQuery) rows = rows.filter(r => r.i.dutyName.includes(nameQuery) || r.i.dutyAddr.includes(nameQuery));
  else rows = rows.filter(r => r.d <= radius);
  if (filters.has("open")) rows = rows.filter(r => r.st.open);
  if (filters.has("late")) rows = rows.filter(r => r.late);
  if (filters.has("weekend")) rows = rows.filter(r => r.weekend);
  if (filters.has("always")) rows = rows.filter(r => r.all);
  rows.sort((a, b) => (b.st.open - a.st.open) || (a.d - b.d));
  return { m, rows };
}

// ---- Map: Kakao when available, else a drawn stand-in --------------------------------------------
const maps = {};
function pinSVG(color, size) { return `<svg width="${size}" height="${size * 1.25}" viewBox="0 0 32 40" aria-hidden="true"><path d="M16 39C16 39 3 25 3 15a13 13 0 0 1 26 0c0 10-13 24-13 24z" fill="${color}" stroke="#fff" stroke-width="2.5"/><path d="M16 9v12M10 15h12" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/></svg>`; }
function pinPath(x, y, s) { return `M${x} ${y} c${-0.9*s} ${-1.1*s} ${-1.6*s} ${-2.2*s} ${-1.6*s} ${-3.3*s} a${1.6*s} ${1.6*s} 0 1 1 ${3.2*s} 0 c0 ${1.1*s} ${-0.7*s} ${2.2*s} ${-1.6*s} ${3.3*s}z`; }
function drawMap(id, center, pins, opts = {}) {
  const el = $(id);
  if (kakaoOK) return drawKakao(el, id, center, pins, opts);
  const S = opts.scale || 110;
  const proj = p => ({ x: 200 + (p.lon - center.lon) * 111.32 * Math.cos(center.lat * Math.PI / 180) * S, y: 150 - (p.lat - center.lat) * 110.57 * S });
  let h = `<svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label="약국 위치 (간단 지도)" style="width:100%;height:100%"><rect width="400" height="300" fill="var(--map)"/>
    <rect x="262" y="190" width="120" height="90" rx="18" fill="var(--map-park)"/>
    <path d="M-10 250 C 70 225, 130 265, 210 242 S 330 200, 410 215" fill="none" stroke="var(--map-water)" stroke-width="20"/>
    <path d="M0 120 H400 M170 0 V300" stroke="var(--map-road)" stroke-width="15"/><path d="M0 290 L400 150 M300 0 V190 M60 0 V300 M0 40 H400" stroke="var(--map-road)" stroke-width="7"/>`;
  if (opts.me) { const me = proj(opts.me);
    if (opts.route) { const p = proj(opts.route); h += `<path d="M${me.x} ${me.y} V${p.y} H${p.x}" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 11"/>`; }
    h += `<circle cx="${me.x}" cy="${me.y}" r="22" fill="var(--me)" opacity=".14"/><circle cx="${me.x}" cy="${me.y}" r="8" fill="var(--me)" stroke="#fff" stroke-width="3"/>`; }
  pins.slice(0, 30).forEach(({ i, st, sel }) => { const p = proj(i); if (p.x < 6 || p.x > 394 || p.y < 14 || p.y > 294) return;
    const s = sel ? 6 : 4, col = !st.open ? "var(--off)" : sel ? "var(--accent)" : "#4fb883";
    h += `<g class="pin" tabindex="0" role="button" data-id="${esc(i.id)}" aria-label="${esc(i.dutyName)}"><path d="${pinPath(p.x, p.y, s)}" fill="${col}" stroke="#fff" stroke-width="${sel ? 2.4 : 1.6}"/>
      <path d="M${p.x} ${p.y - 4.3*s}v${1.8*s}M${p.x - 0.9*s} ${p.y - 3.4*s}h${1.8*s}" stroke="#fff" stroke-width="${0.5*s}" stroke-linecap="round"/></g>`; });
  el.innerHTML = h + "</svg>";
}
function drawKakao(el, id, center, pins, opts) {
  const K = kakao.maps, ll = p => new K.LatLng(p.lat, p.lon);
  let m = maps[id];
  if (!m) { el.innerHTML = ""; m = maps[id] = { map: new K.Map(el, { center: ll(center), level: 5 }), ov: [] }; }
  m.ov.forEach(o => o.setMap(null)); m.ov = [];
  m.map.relayout();
  const add = (p, node, z) => { const o = new K.CustomOverlay({ position: ll(p), content: node, yAnchor: 1, zIndex: z || 1 }); o.setMap(m.map); m.ov.push(o); };
  if (opts.me) { const d = document.createElement("div"); d.className = "kme"; d.setAttribute("aria-label", "내 위치"); const o = new K.CustomOverlay({ position: ll(opts.me), content: d, yAnchor: .5 }); o.setMap(m.map); m.ov.push(o); }
  pins.forEach(({ i, st, sel }) => { const d = document.createElement("button"); d.type = "button"; d.className = "kpin"; d.dataset.id = i.id; d.setAttribute("aria-label", i.dutyName);
    d.innerHTML = pinSVG(!st.open ? "#8b9892" : sel ? "#1e9e5e" : "#4fb883", sel ? 40 : 30); add(i, d, sel ? 5 : 1); });
  if (opts.route && opts.me) { const l = new K.Polyline({ path: [ll(opts.me), ll(opts.route)], strokeWeight: 5, strokeColor: "#1e9e5e", strokeOpacity: .9, strokeStyle: "shortdash" }); l.setMap(m.map); m.ov.push(l); }
  if (opts.fit && opts.me) { const b = new K.LatLngBounds(); b.extend(ll(opts.me)); b.extend(ll(opts.fit)); m.map.setBounds(b, 70, 40, 40, 40); }
  else { m.map.setCenter(ll(center)); m.map.setLevel(radius <= 3 ? 5 : radius <= 6 ? 6 : 7); }
}

// ---- Render ------------------------------------------------------------------------------
function showView(v) {
  view = v; ["home", "results", "detail"].forEach(n => $(n).hidden = n !== v); window.scrollTo(0, 0);
  if (v === "home") renderHome(); else if (v === "results") render(); else renderDetail();
}
function renderHome() { const m = moment();
  $("sunText").textContent = m.holiday || m.day >= 6 ? `오늘은 ${m.holiday && m.day < 6 ? "공휴일" : DAY_LABEL[m.day] + "요일"}이에요. 휴일에 여는 약국을 먼저 보여드려요.` : `지금은 ${DAY_LABEL[m.day]}요일 ${fmt(m.min)}이에요. 문 연 약국만 골라 보여드려요.`; }
function render() {
  if (view !== "results") return;
  const { m, rows } = compute();
  $("q").value = nameQuery || notFound || (origin && origin.label !== "내 위치" ? origin.label : "");
  $("when").textContent = `${m.isNow ? "지금" : m.label} ${m.holiday ? "공휴일" : DAY_LABEL[m.day] + "요일"} ${fmt(m.min)}`;
  const center = origin || { lat: 37.5665, lon: 126.978 };
  if (loading) { $("count").textContent = "약국을 찾는 중이에요…"; $("rows").innerHTML = ""; drawMap("map", center, [], { me: origin }); sug(); return; }
  if (notFound) { $("count").textContent = `"${notFound}"을(를) 찾지 못했어요`; $("rows").innerHTML = `<div class="empty">동 이름이나 도로명으로 다시 검색해 보세요.${CFG.kakaoJsKey ? "" : "<br>(지도 키가 아직 없어서 일부 동네만 검색돼요)"}</div>`; drawMap("map", center, [], {}); sug(); return; }
  if (!origin) { $("count").textContent = "어디에서 찾을까요?"; $("rows").innerHTML = `<div class="empty">위에서 동 이름을 검색하거나 "내 위치"를 눌러 주세요.</div>`; drawMap("map", center, [], {}); sug(); return; }
  const open = rows.filter(r => r.st.open).length;
  $("count").innerHTML = `${esc(origin.label)} 근처 <b>${open}곳</b> 영업 중`;
  const wider = !nameQuery && radius < RADII[RADII.length - 1] ? `<button class="btn soft small" type="button" data-wider>더 넓게 보기 (${RADII[RADII.indexOf(radius) + 1]}km)</button>` : "";
  $("rows").innerHTML = (rows.length ? rows.map(r => row(r, m)).join("") : `<div class="empty">${radius}km 안에 조건에 맞는 약국이 없어요.<br>필터를 하나 풀거나 범위를 넓혀 보세요.</div>`) + wider;
  drawMap("map", origin, rows.map(r => ({ i: r.i, st: r.st, sel: r.i.id === selected })), { me: origin });
  sug();
}
function sug() { const s = $("suggest"); s.hidden = false;
  s.innerHTML = `이렇게도 찾아보세요 ` + ["봉천동", "서교동", "강남역", "해운대", "수원역"].map(x => `<button type="button" data-s="${x}">${x}</button>`).join(""); }
function row({ i, st, d, late, all, weekend }, m) {
  let status;
  if (st.open) { const left = st.closesAt - m.min + (st.closesAt < m.min ? 1440 : 0);
    status = left <= 60 ? `<span class="soon">곧 마감 · ${fmt(st.closesAt)}</span>` : `<span class="ok">${fmt(st.closesAt)}까지</span>`; }
  else status = `<span class="off">${st.opensAt != null ? fmt(st.opensAt) + " 열어요" : "오늘 영업 끝"}</span>`;
  const tags = [i.nightPublic && `<span class="tag night">공공심야약국</span>`, !i.nightPublic && late && `<span class="tag night">심야</span>`, all ? `<span class="tag">연중무휴</span>` : weekend && `<span class="tag">주말·공휴일</span>`].filter(Boolean).join("");
  return `<div class="item ${st.open ? "" : "closed"} ${i.id === selected ? "sel" : ""}" data-row="${esc(i.id)}">
    <button class="main" type="button" data-open="${esc(i.id)}"><span class="nm disp">${esc(i.dutyName)}</span>
      <span class="meta">${status} · 걸어서 ${walkTxt(d)} · ${distTxt(d)}</span><span class="tags">${tags}</span></button>
    <button class="call" type="button" data-tel="${esc(i.dutyTel1)}" aria-label="${esc(i.dutyName)}에 전화하기"><svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5l2.2 3-1.4 1.6c.8 1.8 2.3 3.3 4.1 4.1l1.6-1.4 3 2.2-1 2.5C7.6 13.6 2.4 8.4 1.5 3.5z" fill="#fff"/></svg></button></div>`;
}
// Naver Map: the app's walking-route scheme on phones; on the web, a place search (name + 시/구), since map.naver.com has no stable public URL that takes plain coordinates.
const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
function naverLinks(i) {
  const region = i.dutyAddr.split(" ").slice(0, 2).join(" ");
  return { app: `nmap://route/walk?dlat=${i.lat}&dlng=${i.lon}&dname=${encodeURIComponent(i.dutyName)}&appname=${encodeURIComponent(location.hostname || "simya-yakguk")}`,
    web: `https://map.naver.com/p/search/${encodeURIComponent(region + " " + i.dutyName)}` };
}
function openNaver(a) {
  const web = a.href; let left = false;
  const onHide = () => { left = true; }; document.addEventListener("visibilitychange", onHide, { once: true });
  location.href = a.dataset.nmap;
  setTimeout(() => { document.removeEventListener("visibilitychange", onHide); if (!left && document.visibilityState === "visible") location.href = web; }, 1500);
}
function renderDetail() {
  const i = store.get(selected); if (!i) return showView("results");
  const m = moment(), st = status(i, m), d = origin ? km(origin, i) : 0, today = effDay(m);
  drawMap("dmap", i, [{ i, st, sel: true }], { me: origin, route: origin ? i : null, fit: origin ? i : null, scale: Math.min(150, Math.max(60, 95 / Math.max(d, .15))) });
  $("dwalk").hidden = !origin; $("dwalk").innerHTML = `걸어서 <b>${walkTxt(d)}</b> · ${distTxt(d)}`;
  let pill;
  if (st.open) { const left = st.closesAt - m.min + (st.closesAt < m.min ? 1440 : 0);
    pill = `<span class="pillbig ${left <= 60 ? "soon" : ""}">${left <= 60 ? "곧 닫아요" : "지금 열려 있어요"} · ${fmt(st.closesAt)}까지</span>`; }
  else pill = `<span class="pillbig off">${st.opensAt != null ? fmt(st.opensAt) + "에 열어요" : "오늘은 영업이 끝났어요"}</span>`;
  const rowsH = [1,2,3,4,5,6,7,8].map(dd => { const s = i["dutyTime"+dd+"s"], c = i["dutyTime"+dd+"c"];
    return `<tr class="${dd === today ? "today" : ""}"><td>${DAY_LABEL[dd]}${dd === today ? " (오늘)" : ""}</td><td>${s ? hhmm(s) + " – " + hhmm(c) : "휴무"}</td></tr>`; }).join("");
  const nv = naverLinks(i);
  $("sheet").innerHTML = `${pill}<div><h1 class="disp">${esc(i.dutyName)}</h1><div class="addr">${esc(i.dutyAddr)}${i.dutyTel1 ? " · " + esc(i.dutyTel1) : ""}</div></div>
    ${i.dutyTel1 ? `<button class="btn" type="button" data-tel="${esc(i.dutyTel1)}">전화하기</button>` : ""}
    <div class="go"><span class="golabel">길 안내 시작</span><div class="row2">
      <a class="btn soft" href="https://map.kakao.com/link/to/${encodeURIComponent(i.dutyName)},${i.lat},${i.lon}" target="_blank" rel="noopener"><i class="dot kakao" aria-hidden="true"></i>카카오맵</a>
      <a class="btn soft" href="${esc(nv.web)}" data-nmap="${esc(nv.app)}" target="_blank" rel="noopener"><i class="dot naver" aria-hidden="true"></i>네이버지도</a></div></div>
    <div><h2 class="disp">영업시간</h2><table class="hours">${rowsH}</table></div>
    <div class="fine">영업시간은 약국 사정으로 바뀔 수 있어요. 가기 전에 전화로 확인하세요.</div>`;
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }

// ---- Wiring ------------------------------------------------------------------------------
function advHTML(p) { return `<label>시/도<select id="${p}sido"><option value="">선택</option>${SIDO.map(s => `<option>${s}</option>`).join("")}</select></label>
  <label>시/군/구<input id="${p}gu" type="text" placeholder="예: 관악구" autocomplete="off"></label>
  <button class="btn soft small" id="${p}region" type="button">이 지역 보기</button>
  <label>방문 날짜<input id="${p}date" type="date"></label><label>방문 시간<input id="${p}time" type="time"></label>
  <label class="check"><input id="${p}hol" type="checkbox"> 공휴일로 보기</label><button class="btn soft small" id="${p}now" type="button">지금으로</button>`; }
$("adv").innerHTML = advHTML("a"); $("homeAdv").innerHTML = advHTML("h");
function syncAdv() { ["a", "h"].forEach(p => { $(p+"date").value = adv.date; $(p+"time").value = adv.time; $(p+"hol").checked = adv.hol; }); }
const refresh = () => view === "home" ? renderHome() : render();
["a", "h"].forEach(p => {
  $(p+"region").addEventListener("click", () => { const q = `${$(p+"sido").value} ${$(p+"gu").value}`.trim(); if (!q) return toast("시/도나 시/군/구를 입력해 주세요."); showView("results"); runSearch(q); });
  [p+"date", p+"time"].forEach(id => $(id).addEventListener("change", () => { adv.follow = false; adv.date = $(p+"date").value || adv.date; adv.time = $(p+"time").value || adv.time; syncAdv(); refresh(); }));
  $(p+"hol").addEventListener("change", () => { adv.hol = $(p+"hol").checked; syncAdv(); refresh(); });
  $(p+"now").addEventListener("click", () => { adv.follow = true; adv.hol = false; moment(); syncAdv(); refresh(); });
});
function toggle(btn, panel) { btn.addEventListener("click", () => { const o = panel.hidden; panel.hidden = !o; btn.setAttribute("aria-expanded", o); }); }
toggle($("homeAdvToggle"), $("homeAdv")); toggle($("advToggle"), $("adv"));

function setFilters(list) { filters.clear(); list.forEach(x => filters.add(x)); document.querySelectorAll(".chip[data-f]").forEach(c => c.setAttribute("aria-pressed", filters.has(c.dataset.f))); }
function locate(then) {
  if (!navigator.geolocation) { toast("이 브라우저는 위치를 지원하지 않아요. 동 이름으로 찾아보세요."); return then && then(false); }
  navigator.geolocation.getCurrentPosition(p => { showView("results"); setOrigin({ lat: p.coords.latitude, lon: p.coords.longitude, label: "내 위치" }); then && then(true); },
    () => { toast("위치를 쓸 수 없어요. 동 이름으로 찾아보세요."); then && then(false); }, { timeout: 8000 });
}
function go(f) { setFilters(f === "open" ? ["open"] : f === "late" ? ["open", "late"] : [f]); selected = null;
  if (origin) return showView("results");
  locate(ok => { if (!ok) showView("results"); }); }
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));
document.querySelectorAll(".chip[data-f]").forEach(c => c.addEventListener("click", () => { const f = c.dataset.f; filters.has(f) ? filters.delete(f) : filters.add(f); c.setAttribute("aria-pressed", filters.has(f)); selected = null; render(); }));
$("homeForm").addEventListener("submit", e => { e.preventDefault(); const q = $("hq").value.trim(); if (!q) return toast("동 이름이나 주소를 입력해 주세요."); setFilters(["open"]); showView("results"); runSearch(q); });
$("searchForm").addEventListener("submit", e => { e.preventDefault(); $("q").blur(); runSearch($("q").value); });
$("suggest").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) runSearch(b.dataset.s); });
$("hlocate").addEventListener("click", () => { setFilters(["open"]); locate(); });
$("locate").addEventListener("click", () => locate());
$("recenter").addEventListener("click", () => { selected = null; if (origin) setOrigin(origin); });
$("goHome").addEventListener("click", () => showView("home"));
$("backBtn").addEventListener("click", () => showView("results"));
$("helpBtn").addEventListener("click", () => { showView("home"); $("helpSec").scrollIntoView({ behavior: "smooth" }); });
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tel]"); if (t) { const tel = t.dataset.tel;
    navigator.clipboard?.writeText(tel).then(() => toast(`${tel} 번호를 복사했어요`), () => toast(tel)); location.href = "tel:" + tel.replace(/-/g, ""); return; }
  const nm = e.target.closest("[data-nmap]"); if (nm && MOBILE) { e.preventDefault(); openNaver(nm); return; }
  const o = e.target.closest("[data-open]"); if (o) { selected = o.dataset.open; showView("detail"); return; }
  if (e.target.closest("[data-wider]")) { radius = RADII[RADII.indexOf(radius) + 1]; selected = null; render(); return; }
  const pin = e.target.closest(".pin, .kpin"); if (pin) { const id = pin.dataset.id;
    if (view === "results") { if (selected === id) showView("detail"); else { selected = id; render(); document.querySelector(`[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } } }
});
document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("pin")) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); } });
moment(); syncAdv(); showView("home");
setInterval(() => { if (adv.follow) { moment(); syncAdv(); refresh(); } }, 60000);
