import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from './organism.js';
import { simulate, PERSONAS } from './simulator.js';
import { normalize } from './ingest.js';
import { importAppleHealth } from './import-health.js';
import { FEATURES, RULES, SIGNALS, toGenome, indicators, weekly, weekSentence } from './genome.js';
import { CATALOG, DOMAINS, dayValue, byId, trackedAt, daysSince, firstSeen } from './catalog.js';
import { runHistory, progress, MIN_DAYS, NET } from './mutations.js';
import { shareImage, shareVideo, encodeGenome, decodeGenome } from './share.js';
import { detect, toUniforms, signalIds, VARS, DAYS } from './patterns.js';
import { emptyPatterns } from './organism.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const qs = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;
const COUNT = +qs.get('n') || (coarse ? 40000 : 80000);

const S = {
  persona: 'marcos', raw: null, days: [], history: null, idx: 0,
  lab: false, labFeatures: null, ghost: null, playing: false, view: 'home',
  skin: 0,         // piel anterior seleccionada en EXUVIA
  focus: 0,        // estructura aislada: 0 ninguna, 1 semana, 2 ciclo, 3 acoplamientos, 5 trazas, 10 estratos
  anchors: [],     // etiquetas ancladas a las estructuras (se proyectan cada frame)
};

// ---------- escena principal ----------
let stage;
try {
  stage = new Stage($('#stage'), {
    count: COUNT, maxDpr: coarse ? 1.75 : 2, seed: 4721,
    controls: (cam, el) => {
      const c = new OrbitControls(cam, el);
      Object.assign(c, { enableDamping: true, dampingFactor: 0.06, enablePan: false, minDistance: 3, maxDistance: 9, autoRotate: true, autoRotateSpeed: 0.35 });
      return c;
    },
  });
} catch (e) {
  document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif;color:#9ab">Este navegador no ofrece WebGL. EXUVIA necesita WebGL para dibujar el organismo.</p>';
  throw e;
}
new ResizeObserver(() => stage.resize()).observe($('#stage'));

// ---------- reloj: mismo motor, 1/16 de las partículas, 20 fps ----------
let watch = null;
function ensureWatch() {
  if (watch) return;
  const c = $('#watch-canvas');
  watch = new Stage(c, { count: 2500, maxDpr: 2, seed: 4721, fov: 34 });
  watch.camera.position.set(0, 0.3, 7);
  watch.organism.material.uniforms.uPointSize.value = 24;
}

// ---------- datos ----------
function load(persona, keepIdx = false) {
  S.persona = persona;
  S.raw = persona === 'mine' ? S.mine : simulate(persona);
  recompute(keepIdx);
}

// IMPORTAR DESDE APPLE HEALTH: tus datos reales reemplazan a la simulación
$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const st = (t) => ($('#import-status').textContent = t);
  try {
    st('Leyendo… 0%');
    S.mine = await importAppleHealth(file, (p) => st(`Leyendo… ${Math.round(p * 100)}%`));
    const n = S.mine.appleHealth.quantitySamples.length + S.mine.appleHealth.workouts.length;
    PERSONAS.mine = { label: 'Mis datos (Apple Health)', seed: 7 + (n % 9000), days: 365 };
    if (!$('#persona option[value="mine"]')) $('#persona').insertAdjacentHTML('afterbegin', '<option value="mine">Mis datos (Apple Health)</option>');
    $('#persona').value = 'mine';
    thumbCache.clear(); lastSignals = null; S.ghost = null;
    load('mine');
    st(`Listo: ${S.days.length} días, ${S.mine.appleHealth.workouts.length} entrenamientos. Tu organismo ya es tuyo.`);
    go('home');
  } catch (err) {
    st(`No pude leer el archivo: ${err.message}`);
  }
  e.target.value = '';
};
function recompute(keepIdx = true) {
  patCache.clear();
  S.days = normalize(S.raw);
  S.history = runHistory(S.days, PERSONAS[S.persona].seed);
  const last = S.days.length - 1;
  S.idx = keepIdx ? Math.min(S.idx, last) : last;
  $('#scrub').max = last;
  $('#scrub').value = S.idx;
  $('#mutant-id').textContent = `MUTANT ${String(PERSONAS[S.persona].seed).padStart(6, '0')}`;
  refresh(true);
}

const entry = () => S.history.timeline[S.idx];

// Patrones: detectados con datos hasta el día visto (o hasta el final de la exuvia vista)
const patCache = new Map();
function patternsAt(idx) {
  const key = `${S.persona}|${idx}`;
  if (!patCache.has(key)) patCache.set(key, detect(S.days, idx));
  return patCache.get(key);
}
const idxOf = (date) => Math.max(0, S.days.findIndex((d) => d.date === date));
const currentPatterns = () => patternsAt(S.ghost ? idxOf(S.ghost.end) : S.idx);
const currentFeatures = () => (S.lab && S.labFeatures ? S.labFeatures : entry().features);
const currentGenome = () => (S.ghost ? S.ghost.genome : toGenome(currentFeatures(), entry().genome.seedShift));

function refresh(immediate = false) {
  const g = currentGenome();
  // los patrones sólo se inscriben en la forma dentro de ANALYTICS; en el resto la forma va limpia
  const pu = S.view === 'analytics' ? toUniforms(currentPatterns()) : emptyPatterns();
  stage.organism.setTarget(g, immediate);
  stage.organism.setPatterns(pu, immediate);
  watch?.organism.setTarget(g, immediate);
  renderHome();
  if (S.view === 'analytics') { renderSignals(); renderLog(); $('#indicators').innerHTML = traceRows(indicators(S.days, S.idx)); buildAnchors(g, pu); }
  else clearAnchors();
  if (S.view === 'mutations') { renderScrub(); renderMutations(); }
  if (S.view === 'exuvia') renderSkins();
  if (S.view === 'profile') { renderData(); renderShare(); renderWatch(); renderLab(false); }
}

// ---------- HOME ----------
const HOY = () => S.days.length - 1 - S.idx;
function renderScrub() {
  $('#scrub-label').textContent = HOY() === 0 ? 'HOY' : `HACE ${HOY()} D`;
}

// Cuatro señales automáticas: esta semana contra la anterior, y qué cualidad mueve cada una
function renderHome() {
  $('#mutation-age').textContent = entry().age;
  const ws = weekly(S.days, S.idx);
  $('#cards').innerHTML = ws.filter((c) => c.now != null).map((c) => {
    const d = c.delta == null ? '' : `${c.delta >= 0 ? '+' : '−'}${Math.round(Math.abs(c.delta) * 100)}%`;
    const f = entry().features[c.id];
    return `
    <div class="card" style="--cc:${c.color}">
      <div class="lbl">${c.label}</div>
      <div class="val">${c.value}<small>${c.unit}</small></div>
      <div class="delta">${d ? `${d} vs semana anterior` : 'sin semana anterior'}</div>
      <div class="bar"><b style="width:${((f ?? 0) * 100).toFixed(0)}%"></b></div>
      <div class="drives">→ ${c.drives}</div>
    </div>`;
  }).join('') || '<p class="note">Sin datos todavía.</p>';
  $('#week-line').textContent = weekSentence(ws);
}

// ---------- MUTATIONS ----------
// Qué está cambiando la forma: cada señal (promedio 14 d) al empezar la etapa vs hoy
function drivers() {
  const e = entry(), from = S.history.timeline[S.idx - e.age].features;
  return SIGNALS.map((sig) => ({ sig, a: from[sig.id], b: e.features[sig.id] }))
    .filter((x) => x.a != null && x.b != null && Math.abs(x.b - x.a) >= 0.08)
    .sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a));
}
function renderMutations() {
  const e = entry();
  $('#mutation-name').textContent = `MUTACIÓN ${String(e.stage + 1).padStart(2, '0')} · ${e.age} DÍAS`;
  const pct = Math.round(Math.min(1, e.net / NET) * 100);
  const head = e.age < MIN_DAYS
    ? `Esta forma tiene ${e.age} días. Una forma necesita al menos ${MIN_DAYS} días antes de poder mudar.`
    : pct >= 100 ? 'Tu forma está mudando.' : `Tu forma cambió un ${pct}% de lo necesario para mudar.`;
  const d = drivers();
  const list = d.length
    ? `<p>Lo que más la está cambiando desde que empezó esta forma:</p><ul>${d.map((x) => `<li style="--dc:${x.sig.color}"><b>${x.sig.label}</b> ${x.b > x.a ? 'subió' : 'bajó'} → ${x.sig.drives.toLowerCase()} ${x.b > x.a ? 'mayor' : 'menor'}</li>`).join('')}</ul>`
    : '<p>Tus señales están estables desde que empezó esta forma.</p>';
  $('#mutation-status').innerHTML = `<p class="lead">${head}</p><div class="meter"><b style="width:${pct}%"></b></div>${list}`;
  renderHistory();
}

// Miniaturas de exuvias// Miniaturas de exuvias: un solo renderer reutilizado, resultado cacheado.
const thumbCache = new Map();
let thumbStage = null;
function thumb(genome, key, pu) {
  if (thumbCache.has(key)) return thumbCache.get(key);
  if (!thumbStage) {
    const c = document.createElement('canvas'); c.width = c.height = 320;
    thumbStage = new Stage(c, { count: 24000, maxDpr: 1, seed: 4721, preserve: true });
    thumbStage.renderer.setPixelRatio(1); thumbStage.renderer.setSize(320, 320, false);
    thumbStage.organism.material.uniforms.uPixelRatio.value = 320 / 700;
  }
  thumbStage.organism.setTarget(genome, true);
  thumbStage.organism.setPatterns(pu, true);
  thumbStage.render(0, 12);
  const url = thumbStage.renderer.domElement.toDataURL('image/png');
  thumbCache.set(key, url);
  return url;
}

const pastSkins = () => S.history.exuvias.filter((x) => x.end < S.days[S.idx].date);
const skinThumb = (x) => thumb(x.genome, `${S.persona}-${x.index}`, emptyPatterns());
function renderHistory() {
  const e = entry();
  const cur = { index: e.stage + 1, days: e.age, genome: currentGenome(), current: true };
  const list = [cur, ...pastSkins().slice().reverse()];
  $('#history').innerHTML = list.map((x) => `
    <button class="hist ${x.current ? 'current' : ''}" data-i="${x.index}">
      <img alt="" src="${x.current ? thumb(x.genome, `${S.persona}-cur-${S.idx}`, emptyPatterns()) : skinThumb(x)}">
      <div class="lbl">MUTATION ${String(x.index).padStart(2, '0')}</div>
      <div class="meta">${x.current ? 'ACTUAL · ' : ''}${x.days} DÍAS</div>
    </button>`).join('');
  $('#history').querySelectorAll('.hist:not(.current)').forEach((b) => b.onclick = () => {
    S.skin = pastSkins().findIndex((x) => x.index === +b.dataset.i);
    go('exuvia');
  });
}
const fmt = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('es', { day: 'numeric', month: 'short' }).toUpperCase();
function renderSkins() {
  const skins = pastSkins();
  if (!skins.length) {
    S.ghost = null;
    $('#skin-info').innerHTML = '<p class="note">Todavía no dejaste ninguna piel atrás. Cuando tu forma mude, la anterior queda acá.</p>';
    $('#skin-dots').innerHTML = '';
    return;
  }
  S.skin = Math.max(0, Math.min(S.skin, skins.length - 1));
  const x = skins[S.skin];
  S.ghost = x;
  stage.organism.setTarget(x.genome);
  $('#skin-info').innerHTML = `<div class="eyebrow">EXUVIA ${String(x.index).padStart(2, '0')}</div><div class="big">${x.days}</div><div class="eyebrow dim">DÍAS · ${fmt(x.start)} – ${fmt(x.end)}</div>`;
  $('#skin-dots').innerHTML = skins.map((_, i) => `<i class="${i === S.skin ? 'on' : ''}"></i>`).join('');
}
$('#skin-prev').onclick = () => { S.skin--; renderSkins(); };
$('#skin-next').onclick = () => { S.skin++; renderSkins(); };

// Una fila por hábito seguido: código, tira de 28 días, conteo y último registro
function traceRows(list) {
  if (!list.length) return '<p class="note">SIN HÁBITOS SEGUIDOS · REGISTRAR EN LOG</p>';
  const order = Object.keys(DOMAINS);
  return list.slice().sort((a, b) => order.indexOf(a.domain) - order.indexOf(b.domain)).map((x) => `
    <div class="trace" style="--dc:${DOMAINS[x.domain].color}">
      <b>${x.code}</b><span class="nm">${x.label}</span>
      <span class="strip">${x.vals.map((v) => `<i class="${v == null ? 'na' : v >= 0.5 ? 'on' : v > 0 ? 'mid' : ''}"></i>`).join('')}</span>
      <em>${x.count}/28</em><em>${x.value}</em>
    </div>`).join('');
}

// HOY: registro del día seleccionado. Lo manual se toca; lo automático viene del wearable.
function renderLog() {
  const d = S.days[S.idx];
  const ago = S.days.length - 1 - S.idx;
  $('#log-date').textContent = `${ago ? `hace ${ago} días` : 'hoy'} · las sustancias son privadas`;
  $('#log').innerHTML = `<div class="chips">${CATALOG.map((h) => {
    const v = dayValue(d, h), on = (v ?? 0) >= 0.5, detail = h.detail?.(d);
    const dc = DOMAINS[h.domain].color;
    return h.source === 'auto'
      ? `<span class="chip auto ${on ? 'on' : ''}" style="--dc:${dc}" title="${h.label} · automático"><b>${h.code}</b><small>${detail ?? 'AUTO'}</small></span>`
      : `<button class="chip ${on ? 'on' : ''}" style="--dc:${dc}" data-h="${h.id}" title="${h.label}"><b>${h.code}</b><small>${h.label}</small></button>`;
  }).join('')}</div>`;
  $('#log').querySelectorAll('button.chip').forEach((b) => b.onclick = () => {
    const id = b.dataset.h, on = !b.classList.contains('on');
    const m = S.raw.manual.find((x) => x.date === d.date && x.habit === id);
    if (m) m.value = on; else S.raw.manual.push({ date: d.date, habit: id, value: on });
    thumbCache.clear();
    recompute(true);
  });
}

// PATRONES en lenguaje llano; cada uno ligado a su estructura en la forma
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const VAR_NAME = (k) => ({ activity: 'tu actividad', sleep: 'tu sueño', hrv: 'tu HRV' }[k] ?? byId[k]?.label.toLowerCase() ?? k);
function signalText(p) {
  const rows = [];
  const w = p.weekly;
  if (w && w.strength > 0.2) {
    const peak = w.profile.indexOf(Math.max(...w.profile)), low = w.profile.indexOf(Math.min(...w.profile));
    rows.push({ k: 1, c: '#b3ffff', t: `Tu día más activo es el ${DAY_NAMES[peak]}; el más tranquilo, el ${DAY_NAMES[low]}.`, s: 'Anillo alrededor de tu forma · un lóbulo por día' });
  }
  if (p.cycle) rows.push({ k: 2, c: '#c79bff', t: `Tu actividad sube y baja en ciclos de unas ${Math.round(p.cycle.period / 7)} semanas.`, s: `Hélice · ${p.cycle.turns.toFixed(1)} vueltas = ciclos vistos` });
  for (const c of p.couplings) {
    const after = c.lag ? `los días después de ${VAR_NAME(c.a).replace(/^tu /, '')}` : `cuando sube ${VAR_NAME(c.a)}`;
    const eff = c.b === 'sleep' ? (c.r > 0 ? 'dormís mejor' : 'dormís peor') : c.b === 'hrv' ? (c.r > 0 ? 'tu HRV sube' : 'tu HRV baja') : (c.r > 0 ? `sube ${VAR_NAME(c.b)}` : `baja ${VAR_NAME(c.b)}`);
    rows.push({ k: 3, c: c.r >= 0 ? '#3ff0ff' : '#ff7a2f', t: `${after[0].toUpperCase()}${after.slice(1)}, ${eff}.`, s: `Filamento · correlación ${c.r >= 0 ? '+' : '−'}${Math.abs(c.r).toFixed(2)} en 60 días (asociación, no causa)` });
  }
  for (const x of p.strata.slice().reverse().slice(0, 3)) {
    const what = x.key === 'activity' ? 'actividad' : x.key === 'sleep' ? 'sueño' : byId[x.key]?.label.toLowerCase();
    rows.push({ k: 10, c: '#cfe9ff', t: `Desde el ${fmt(x.date).toLowerCase()} hay ${x.delta > 0 ? 'más' : 'menos'} ${what}.`, s: 'Capa dentro de tu forma · más adentro = más antiguo' });
  }
  return rows;
}
function renderSignals() {
  const rows = signalText(currentPatterns());
  $('#signals').innerHTML = rows.length ? rows.map((r) => `
    <button class="sig ${S.focus === r.k ? 'on' : ''}" data-k="${r.k}" style="--sc:${r.c}">
      <b></b><span class="a">${r.t}</span><small>${r.s}</small>
    </button>`).join('') : '<p class="note">Todavía no hay patrones. Hacen falta al menos 4 semanas de datos.</p>';
  $('#signals').querySelectorAll('.sig').forEach((b) => b.onclick = () => {
    const k = +b.dataset.k;
    S.focus = S.focus === k ? 0 : k;
    stage.organism.material.uniforms.uFocus.value = S.focus;
    renderSignals();
    buildAnchors(currentGenome(), toUniforms(currentPatterns()));
  });
}

// ETIQUETAS: puntos de anclaje en coordenadas del shader (antes de la expansión)
const LINK_NODE = (a) => new THREE.Vector3(Math.cos(a) * 0.95, 0.35 + 0.45 * Math.sin(a * 2), Math.sin(a) * 0.95);
function buildAnchors(g, pu) {
  const p = currentPatterns(), A = [];
  const TAU = Math.PI * 2;
  if (p.weekly && pu.weekStr > 0.05) {
    const i = p.weekly.profile.indexOf(Math.max(...p.weekly.profile));
    const ang = ((i + 0.5) / 7) * TAU, r = 1.3 + 0.42 + 0.06;
    A.push({ k: 1, c: '#b3ffff', t: `SEMANA`, v: new THREE.Vector3(Math.cos(ang) * r, 0.1, Math.sin(ang) * r) });
  }
  if (p.cycle) {
    const ang = pu.cycleTurns * TAU;
    A.push({ k: 2, c: '#c79bff', t: `CICLO ${Math.round(p.cycle.period / 7)} SEM`, v: new THREE.Vector3(Math.cos(ang) * 1.42, 1.55, Math.sin(ang) * 1.42) });
  }
  p.couplings.forEach((c) => {
    const a = LINK_NODE(VARS[c.a].angle), b = LINK_NODE(VARS[c.b].angle);
    const m = a.clone().add(b).multiplyScalar(0.5);
    const ctl = m.clone().add(m.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize().multiplyScalar(0.9));
    const mid = a.clone().multiplyScalar(0.25).add(ctl.clone().multiplyScalar(0.5)).add(b.clone().multiplyScalar(0.25));
    A.push({ k: 3, c: c.r >= 0 ? '#3ff0ff' : '#ff7a2f', t: `${(byId[c.a]?.label ?? VARS[c.a].label).toUpperCase()} → ${c.b === 'sleep' ? 'SUEÑO' : c.b === 'hrv' ? 'HRV' : VARS[c.b].label}`, v: mid });
  });
  const st = p.strata.at(-1);
  if (st) {
    const r = 0.3 + 0.7 * st.pos;
    A.push({ k: 10, c: '#cfe9ff', t: `DESDE ${fmt(st.date)}`, v: new THREE.Vector3(Math.cos(2.4) * r, 0.2, Math.sin(2.4) * r) });
  }
  p.traces.filter((t) => t.freq >= 0.1).sort((a, b) => b.freq - a.freq).slice(0, S.focus === 5 ? 24 : 4).forEach((t) => {
    const c = CATALOG.findIndex((h) => h.id === t.id);
    const ang = ((c + 0.5) / 24) * TAU;
    A.push({ k: 5, c: DOMAINS[t.domain].color, t: t.code, small: true, v: new THREE.Vector3(Math.cos(ang) * 1.72, -0.95 + 0.08 + 2.4 * t.freq + 0.07, Math.sin(ang) * 1.72) });
  });
  S.anchors = S.focus ? A.filter((a) => a.k === S.focus) : A.filter((a) => !a.small);
  $('#labels').innerHTML = S.anchors.map((a, i) => `<span class="tag3d ${a.small ? 'sm' : ''}" data-i="${i}" style="--lc:${a.c}">${a.t}</span>`).join('');
  S.labelEls = [...$('#labels').children];
}
function clearAnchors() { S.anchors = []; S.labelEls = []; $('#labels').innerHTML = ''; }
const _v = new THREE.Vector3(), _dir = new THREE.Vector3();
function updateLabels() {
  if (!S.labelEls?.length) return;
  const cam = stage.camera, el = stage.renderer.domElement;
  const w = el.clientWidth, h = el.clientHeight, ex = stage.organism.genome.expansion;
  cam.getWorldDirection(_dir);
  S.anchors.forEach((a, i) => {
    const node = S.labelEls[i];
    _v.copy(a.v).multiplyScalar(ex);
    const depth = _v.clone().sub(cam.position).dot(_dir) - cam.position.length(); // >0: detrás del centro
    _v.project(cam);
    const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    const focus = S.focus === 0 || S.focus === a.k;
    node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    node.style.opacity = !focus ? 0.12 : depth > 0 ? 0.35 : 1;
  });
}
function renderData() {
  const d = S.days[S.idx];
  const has = (s) => d.sources.includes(s);
  $('#sources').innerHTML = [
    ['WHOOP', has('whoop') ? 'SIM' : '—', has('whoop')], ['APPLE HEALTH', has('apple') ? 'SIM' : '—', has('apple')],
    ['OURA', 'OFFLINE', false], ['GARMIN', 'OFFLINE', false],
  ].map(([n, s, on]) => `<div class="src ${on ? '' : 'off'}">${n}<div class="st">${s}</div></div>`).join('');

  const w = d.workouts.map((x) => `${x.type}${x.km ? ` ${x.km.toFixed(1)} km` : ''} [${x.sources.join('+')}]`).join(', ') || '—';
  const rows = [
    ['Fecha', d.date], ['Recuperación', d.recovery != null ? `${d.recovery}%` : '—'], ['Esfuerzo', d.strain ?? '—'],
    ['HRV', d.hrv ? `${d.hrv.value} ms (${d.hrv.method.toUpperCase()}, ${d.hrv.source})` : '—'],
    ['FC reposo', d.rhr ?? '—'], ['Sueño', d.sleepPerformance != null ? `${d.sleepPerformance}%` : '—'],
    ['Pasos', d.steps ?? '—'], ['Mindfulness', `${d.mindfulMin} min`], ['Entrenamientos', w],
  ];
  $('#canonical').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#features').innerHTML = featureBars(entry().features);

  const date = d.date;
  const pick = (arr, f) => arr.filter((x) => f(x).startsWith(date));
  const cyc = S.raw.whoop.cycles.find((c) => c.start.startsWith(date));
  $('#raw').textContent = JSON.stringify({
    whoop: {
      cycle: cyc, recovery: S.raw.whoop.recoveries.find((r) => r.cycle_id === cyc?.id),
      sleep: pick(S.raw.whoop.sleeps, (x) => x.end), workouts: pick(S.raw.whoop.workouts, (x) => x.start),
    },
    appleHealth: {
      quantitySamples: pick(S.raw.appleHealth.quantitySamples, (x) => x.startDate),
      categorySamples: pick(S.raw.appleHealth.categorySamples, (x) => x.startDate),
      workouts: pick(S.raw.appleHealth.workouts, (x) => x.startDate),
    },
    manual: S.raw.manual.filter((m) => m.date === date),
  }, null, 2);
}

function featureBars(f) {
  return Object.entries(FEATURES).map(([k, m]) => `
    <div class="row"><span>${m.label} <span class="tag ${m.scale}">${m.scale}</span></span>
      <div class="track"><b style="width:${((f[k] ?? 0) * 100).toFixed(0)}%"></b></div><span>${f[k] == null ? 'N/D' : f[k].toFixed(2)}</span></div>`).join('');
}

const labFrom = (f) => Object.fromEntries(Object.keys(FEATURES).map((k) => [k, f[k] ?? 0.5]));
function exitLab() { S.lab = false; S.labFeatures = null; $('#lab-on').checked = false; }

function renderLab(rebuild = true) {
  if (!S.labFeatures) S.labFeatures = labFrom(entry().features);
  if (rebuild || !$('#lab-sliders').children.length) {
    $('#lab-sliders').innerHTML = Object.entries(FEATURES).map(([k, m]) => `
      <label>${m.label}<input type="range" min="0" max="1" step="0.01" data-f="${k}" value="${S.labFeatures[k]}"><span>${S.labFeatures[k].toFixed(2)}</span></label>`).join('');
    $('#lab-sliders').querySelectorAll('input').forEach((i) => i.oninput = () => {
      S.labFeatures[i.dataset.f] = +i.value;
      i.nextElementSibling.textContent = (+i.value).toFixed(2);
      if (!S.lab) { S.lab = true; $('#lab-on').checked = true; }
      refresh();
    });
    $('#rules').innerHTML = Object.entries(RULES).map(([k, r]) => `
      <div class="r"><b>${k}</b> <span>· ${r.meaning} · ${r.min}–${r.max}</span><br>
      <span>= ${Object.entries(r.from).map(([f, w]) => `<em>${w}</em> × ${FEATURES[f].label.toLowerCase()}`).join(' + ')}</span></div>`).join('');
  }
  $('#lab-on').checked = S.lab;
}
$('#lab-on').onchange = (e) => {
  S.lab = e.target.checked;
  if (S.lab) S.labFeatures = S.labFeatures ?? labFrom(entry().features);
  refresh();
};

function renderWatch() {
  ensureWatch();
  watch.organism.setTarget(currentGenome(), true);
  watch.organism.setPatterns(toUniforms(currentPatterns()), true);
  const e = entry();
  $('#watch-days').textContent = `${e.age} D`;
  $('#comp-days').textContent = e.age;
  // complicación: anillo de puntos, sin 3D — el 3D no se sostiene en una complicación
  const g = currentGenome(), n = 36;
  let dots = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 40 + Math.sin(a * Math.round(g.lobes) + g.seedShift) * 4 * g.lobeAmp;
    const col = i / n < g.orange / (g.cyan + g.blue + g.violet + g.orange) ? '#ff7a2f' : i % 3 ? '#3ff0ff' : '#8a4dff';
    dots += `<circle cx="${50 + Math.cos(a) * r}" cy="${50 + Math.sin(a) * r}" r="${1 + g.density}" fill="${col}"/>`;
  }
  $('#complication').innerHTML = dots;
  $('#watch-note').textContent = `PREVIEW · N ${watch.organism.points.geometry.attributes.aSeed.count.toLocaleString('es')} · 20 FPS · TELÉFONO N ${COUNT.toLocaleString('es')} · watchOS: ver docs/ARQUITECTURA.md §8`;
}

// ---------- compartir ----------
const shareInclude = new Set();
let shareSubstanceForm = false; // las trazas de sustancias no viajan en la forma compartida salvo que se active
function renderShare() {
  const ind = shareInfo().indicators;
  const formToggle = '';
  if (!ind.length) { $('#share-opts').innerHTML = '<p class="note">EXUVIA / OVERRIDE · SALIDA: SÓLO GEOMETRÍA</p>'; return; }
  $('#share-opts').innerHTML = ind.map((x) => `
    <label class="toggle ${DOMAINS[x.domain].sensitive ? 'warn' : ''}"><input type="checkbox" data-id="${x.id}" ${shareInclude.has(x.id) ? 'checked' : ''}> ${x.label}${DOMAINS[x.domain].sensitive ? ' · privado' : ''}</label>`).join('') + formToggle;
  $('#share-opts').querySelectorAll('input[data-id]').forEach((i) => i.onchange = () => {
    if (i.checked) shareInclude.add(i.dataset.id); else shareInclude.delete(i.dataset.id);
  });
}
// Máscara de privacidad: sin opt-in, las trazas de sustancias se envían en 0
function maskPatterns(pu) {
  if (shareSubstanceForm) return pu;
  return { ...pu, traces: pu.traces.map((x, i) => (CATALOG[i] && DOMAINS[CATALOG[i].domain].sensitive ? 0 : x)) };
}
// Se comparte exactamente lo que está en pantalla: la forma actual, una exuvia o el LAB.
const shareInfo = () => {
  const e = entry();
  const base = { mutantId: String(PERSONAS[S.persona].seed).padStart(6, '0'), seed: 4721, time: performance.now() / 1000, genome: currentGenome(), patterns: emptyPatterns() }; // se comparte la forma limpia, como en HOME
  if (S.ghost) return { ...base, stage: S.ghost.index - 1, name: `${S.ghost.name} · EXUVIA`, age: S.ghost.days, ageLabel: 'DURACIÓN · DÍAS', indicators: [] };
  if (S.lab) return { ...base, stage: e.stage, name: 'OVERRIDE', age: e.age, indicators: [] };
  return { ...base, stage: e.stage, name: e.name ?? '', age: e.age, indicators: indicators(S.days, S.idx) };
};
const status = (t) => ($('#share-status').textContent = t);
const busy = (on) => document.querySelectorAll('.actions .btn').forEach((b) => (b.disabled = on));
$('#share-img').onclick = async () => {
  busy(true); status('RENDER 1080×1350…');
  try { const r = await shareImage(shareInfo().genome, shareInfo(), { include: shareInclude }); status(r === 'shared' ? 'TRANSMITIDO' : r === 'cancelled' ? '' : 'PNG EXPORTADO'); }
  catch (e) { status(e.message); } finally { busy(false); }
};
$('#share-vid').onclick = async () => {
  busy(true);
  try {
    const r = await shareVideo(shareInfo().genome, shareInfo(), { include: shareInclude }, 4, (p) => status(`REC ${Math.round(p * 100)}%`));
    status(r === 'shared' ? 'TRANSMITIDO' : r === 'cancelled' ? '' : 'VIDEO EXPORTADO');
  } catch (e) { status(e.message); } finally { busy(false); }
};
$('#share-link').onclick = async () => {
  const i = shareInfo();
  const url = encodeGenome(i.genome, { stage: i.stage, name: i.name, mutantId: i.mutantId }, i.patterns);
  try { await navigator.clipboard.writeText(url); status('ENLACE COPIADO · CONTIENE SÓLO GEOMETRÍA'); }
  catch { status(url); }
};

// ---------- navegación ----------
// Navegación por la barra inferior, como el mockup
function go(view) {
  if (S.view === 'exuvia' && view !== 'exuvia') { S.ghost = null; }
  S.view = view;
  app.dataset.view = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  if (view !== 'analytics') { S.focus = 0; stage.organism.material.uniforms.uFocus.value = 0; }
  if (view === 'analytics') $('#bell-dot').hidden = true;
  if (view === 'profile') { ensureWatch(); renderLab(true); }
  refresh();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => go(b.dataset.go)));
$('#btn-bell').onclick = () => go('analytics');
$('#btn-menu').onclick = () => go('profile');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.view !== 'home') go('home'); });
$('#persona').innerHTML = Object.entries(PERSONAS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('#persona').onchange = (e) => { thumbCache.clear(); lastSignals = null; S.labFeatures = null; S.ghost = null; S.skin = 0; load(e.target.value); };

let lastStage = null;
$('#scrub').oninput = (e) => { S.idx = +e.target.value; S.ghost = null; exitLab(); announceMutation(); refresh(); };
let lastSignals = null, toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function announceMutation() {
  const e = entry();
  const p = patternsAt(S.idx), ids = signalIds(p);
  if (lastStage !== null && e.stage > lastStage) toast(`MUDA · M${String(e.stage + 1).padStart(2, '0')} ${e.name}`);
  else if (lastSignals && lastStage !== null && e.stage === lastStage) {
    const fresh = ids.find((id) => !lastSignals.has(id));
    if (fresh) { toast(`PATRÓN NUEVO · ${describeSignal(fresh, p)}`); $('#bell-dot').hidden = false; }
  }
  lastStage = e.stage; lastSignals = new Set(ids);
}
function describeSignal(id, p) {
  if (id === 'W') return 'RITMO SEMANAL';
  if (id === 'C') return `CICLO ${p.cycle.period} D`;
  if (id[0] === 'K') { const c = p.couplings.find((x) => id === `K${x.a}${x.b}`); return `${VARS[c.a].label} ↔ ${VARS[c.b].label}`; }
  const st = p.strata.find((x) => id === `S${x.key}${x.delta > 0 ? '+' : '-'}${Math.round(x.t / 28)}`);
  return `ESTRATO · ${VARS[st.key].label} ${st.delta > 0 ? '↑' : '↓'}`;
}

$('#btn-play').onclick = () => {
  S.playing = !S.playing;
  $('#btn-play').textContent = S.playing ? '❚❚' : '▶';
  if (S.playing) { S.ghost = null; exitLab(); }
  if (S.playing && S.idx >= S.days.length - 1) { S.idx = 0; lastStage = 0; lastSignals = null; }
};

// ---------- bucle ----------
const perf = { frames: 0, acc: 0, fps: 60, slow: 0 };
let last = performance.now(), playAcc = 0, watchAcc = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000;
  if (S.playing) {
    playAcc += dt;
    if (playAcc > 0.09) {
      playAcc = 0;
      if (S.idx < S.days.length - 1) { S.idx++; $('#scrub').value = S.idx; announceMutation(); refresh(); }
      else { S.playing = false; $('#btn-play').textContent = '▶'; }
    }
  }
  stage.render(dt, t);
  updateLabels();
  if (S.view === 'profile' && watch) {
    watchAcc += dt;
    if (watchAcc > 0.05) { watch.render(watchAcc, t); watchAcc = 0; }
  }
  // DPR adaptativo: si el dispositivo no sostiene ~45 fps, bajamos resolución, no partículas
  perf.frames++; perf.acc += dt;
  if (perf.acc > 1) {
    perf.fps = perf.frames / perf.acc; perf.frames = 0; perf.acc = 0;
    perf.slow = perf.fps < 45 ? perf.slow + 1 : 0;
    if (perf.slow >= 2 && stage.maxDpr > 1) { stage.maxDpr = Math.max(1, stage.maxDpr - 0.25); stage.resize(); perf.slow = 0; }
    if (S.view === 'profile') {
      $('#perf').innerHTML = [['Partículas', COUNT.toLocaleString('es')], ['FPS', perf.fps.toFixed(0)],
        ['Pixel ratio', stage.renderer.getPixelRatio().toFixed(2)], ['Dispositivo', coarse ? 'táctil' : 'escritorio']]
        .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    }
  }
  requestAnimationFrame(loop);
}

// ---------- arranque ----------
const shared = decodeGenome(location.hash);
if (shared) {
  app.classList.add('visitor');
  $('#mutant-id').textContent = `MUTANT ${shared.mutantId} · MUTATION ${String(shared.stage + 1).padStart(2, '0')} ${shared.name}`;
  stage.organism.setTarget(shared.genome, true);
  if (shared.patterns) stage.organism.setPatterns(shared.patterns, true);
  stage.resize();
} else {
  load('marcos');
  lastStage = entry().stage;
}
requestAnimationFrame(loop);
window.__exuviaReady = true;
