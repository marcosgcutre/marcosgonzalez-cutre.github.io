import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from './organism.js';
import { simulate, PERSONAS } from './simulator.js';
import { normalize } from './ingest.js';
import { FEATURES, RULES, toGenome, traits, indicators } from './genome.js';
import { CATALOG, DOMAINS, dayValue } from './catalog.js';
import { runHistory, progress, MIN_DAYS, NET } from './mutations.js';
import { shareImage, shareVideo, encodeGenome, decodeGenome } from './share.js';
import { detect, toUniforms, signalIds, VARS, DAYS } from './patterns.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const qs = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;
const COUNT = +qs.get('n') || (coarse ? 40000 : 80000);

const S = {
  persona: 'marcos', raw: null, days: [], history: null, idx: 0,
  lab: false, labFeatures: null, ghost: null, playing: false, view: 'home',
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
  S.raw = simulate(persona);
  recompute(keepIdx);
}
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
  const pu = toUniforms(currentPatterns());
  stage.organism.setTarget(g, immediate);
  stage.organism.setPatterns(pu, immediate);
  watch?.organism.setTarget(g, immediate);
  watch?.organism.setPatterns(pu, immediate);
  renderHome(); renderScrub();
  buildAnchors(g, pu);
  if (S.view === 'exuvias') renderExuvias();
  if (S.view === 'data') renderData();
  if (S.view === 'lab') renderLab(false);
  if (S.view === 'watch') renderWatch();
  if (S.view === 'share') renderShare();
}

// ---------- vistas ----------
function renderScrub() {
  const ago = S.days.length - 1 - S.idx;
  $('#scrub-label').textContent = ago === 0 ? 'T0' : `T−${ago} D`;
}

function renderHome() {
  const e = entry();
  $('#mutation-name').textContent = `MUTATION ${String(e.stage + 1).padStart(2, '0')} · ${e.name ?? ''}`;
  $('#mutation-age').textContent = e.age;
  const p = progress(e);
  $('#progress').innerHTML = [
    ['LATENCIA', p.maturity, `${Math.min(e.age, MIN_DAYS)}/${MIN_DAYS} D`],
    ['DERIVA', p.change, `${e.net.toFixed(3)}/${NET.toFixed(3)}`],
  ].map(([l, v, r]) => `<div><span>${l}</span><em>${r}</em><i><b style="width:${(v * 100).toFixed(0)}%"></b></i></div>`).join('');
  $('#indicators').innerHTML = traceRows(indicators(S.days, S.idx));
  renderSignals();
  renderLog();
  const t = traits(currentGenome());
  $('#traits').innerHTML = Object.entries(t).map(([k, v]) => `<div>${k}<b>${v.toFixed(2)}</b></div>`).join('');
  renderHud();
}

// HUD de instrumento sobre el organismo
function renderHud() {
  const e = entry(), g = currentGenome();
  const mode = S.ghost ? `EXUVIA ${String(S.ghost.index).padStart(2, '0')}` : S.lab ? 'OVERRIDE' : 'LIVE';
  const ago = S.days.length - 1 - S.idx;
  $('#hud').innerHTML = `
    <span class="tl">${mode}<br>M${String(e.stage + 1).padStart(2, '0')} ${e.name ?? ''}</span>
    <span class="tr">N ${COUNT.toLocaleString('es')}<br>SEED ${g.seedShift.toFixed(3)}</span>
    <span class="bl">${S.days[S.idx].date}<br>T${ago ? `−${ago}` : '0'}</span>
    <span class="br">Δ ${e.net.toFixed(3)}<br>SEÑALES ${signalIds(currentPatterns()).length}</span>`;
}

// Miniaturas de exuvias: un solo renderer reutilizado, resultado cacheado.
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

function renderExuvias() {
  const e = entry();
  const upTo = S.history.exuvias.filter((x) => x.end < S.days[S.idx].date);
  const cur = { index: e.stage + 1, name: e.name, days: e.age, genome: e.genome, current: true, start: S.days[S.idx - e.age]?.date };
  const list = [cur, ...upTo.slice().reverse()];
  $('#exuvia-list').innerHTML = list.map((x, i) => `
    <button class="exuvia ${x.current ? 'current' : ''}" data-i="${i}">
      <img alt="Mutation ${x.index}" src="${thumb(x.genome, `${S.persona}-${x.index}-${x.current ? S.idx : 'x'}`, toUniforms(patternsAt(x.current ? S.idx : idxOf(x.end))))}">
      <div class="lbl">M${String(x.index).padStart(2, '0')} ${x.name ?? ''} ${x.current ? '· ACTIVA' : ''}</div>
      <div class="meta">${x.days} D</div>
      ${x.current ? '' : `<div class="meta">${x.start} → ${x.end}</div>`}
    </button>`).join('') || '<p class="note">SIN MUDAS REGISTRADAS</p>';
  $('#exuvia-list').querySelectorAll('.exuvia').forEach((b) => b.onclick = () => {
    const x = list[+b.dataset.i];
    S.ghost = x.current ? null : x;
    $('#ghost-label').hidden = !S.ghost;
    if (S.ghost) $('#ghost-label').textContent = `EXUVIA M${String(x.index).padStart(2, '0')} ${x.name} · CERRAR ✕`;
    refresh();
  });
}
$('#ghost-label').onclick = () => { S.ghost = null; $('#ghost-label').hidden = true; refresh(); };

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
  $('#log-date').textContent = `${d.date} · ${ago ? `T−${ago}` : 'T0'} · SUSTANCIAS: PRIVADAS`;
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

// SEÑALES: los patrones detectados, cada uno ligado a su estructura en la forma
function renderSignals() {
  const p = currentPatterns();
  const rows = [];
  const w = p.weekly;
  if (w) {
    const peak = w.profile.indexOf(Math.max(...w.profile));
    const spark = w.profile.map((x) => `<i style="height:${(3 + x * 13).toFixed(0)}px"></i>`).join('');
    rows.push([1, '#b3ffff', 'RITMO SEMANAL', `<span class="mini">${spark}</span> PICO ${DAYS[peak]}`, w.strength.toFixed(2), 'anillo orbital · 7 lóbulos']);
  }
  if (p.cycle) rows.push([2, '#c79bff', `CICLO ${p.cycle.period} D`, `${p.cycle.turns.toFixed(1)} vueltas`, p.cycle.strength.toFixed(2), 'doble hélice']);
  for (const c of p.couplings) {
    rows.push([3, c.r >= 0 ? '#3ff0ff' : '#ff7a2f', `${VARS[c.a].label}${c.lag ? ' (T−1)' : ''} → ${VARS[c.b].label}`, c.r >= 0 ? 'mismo sentido' : 'sentido opuesto', `${c.r >= 0 ? '+' : '−'}${Math.abs(c.r).toFixed(2)}`, 'filamento']);
  }
  const strata = p.strata.slice().reverse();
  for (const x of strata.slice(0, 3)) {
    rows.push([10, '#cfe9ff', `ESTRATO ${VARS[x.key].label} ${x.delta > 0 ? '↑' : '↓'}`, x.date, x.strength.toFixed(2), 'capa · radio = fecha']);
  }
  if (strata.length > 3) {
    rows.push([10, '#cfe9ff', `+${strata.length - 3} ESTRATOS`, strata.slice(3).map((x) => `${VARS[x.key].label}${x.delta > 0 ? '↑' : '↓'}`).join(' '), '', 'capas anteriores']);
  }
  const tr = p.traces.filter((t) => t.freq > 0);
  if (tr.length) rows.push([5, '#8fb4d8', `${tr.length} TRAZAS`, tr.slice().sort((a, b) => b.freq - a.freq).slice(0, 4).map((t) => t.code).join(' '), '28 D', 'espectro']);
  $('#signals').innerHTML = rows.length ? rows.map(([k, c, a, b, v, st]) => `
    <button class="sig ${S.focus === k ? 'on' : ''}" data-k="${k}" style="--sc:${c}">
      <b></b><span class="a">${a}</span><span class="b">${b}</span><em>${v}</em><small>${st}</small>
    </button>`).join('') : '<p class="note">SIN SEÑALES TODAVÍA · MÍN. 28 D DE DATOS</p>';
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
    A.push({ k: 1, c: '#b3ffff', t: `SEMANA · PICO ${DAYS[i]}`, v: new THREE.Vector3(Math.cos(ang) * r, 0.1, Math.sin(ang) * r) });
  }
  if (p.cycle) {
    const ang = pu.cycleTurns * TAU;
    A.push({ k: 2, c: '#c79bff', t: `CICLO ${p.cycle.period} D`, v: new THREE.Vector3(Math.cos(ang) * 1.42, 1.55, Math.sin(ang) * 1.42) });
  }
  p.couplings.forEach((c) => {
    const a = LINK_NODE(VARS[c.a].angle), b = LINK_NODE(VARS[c.b].angle);
    const m = a.clone().add(b).multiplyScalar(0.5);
    const ctl = m.clone().add(m.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize().multiplyScalar(0.9));
    const mid = a.clone().multiplyScalar(0.25).add(ctl.clone().multiplyScalar(0.5)).add(b.clone().multiplyScalar(0.25));
    A.push({ k: 3, c: c.r >= 0 ? '#3ff0ff' : '#ff7a2f', t: `${VARS[c.a].label}${c.lag ? '(T−1)' : ''}→${VARS[c.b].label} ${c.r >= 0 ? '+' : '−'}${Math.abs(c.r).toFixed(2)}`, v: mid });
  });
  const st = p.strata.at(-1);
  if (st) {
    const r = 0.3 + 0.7 * st.pos;
    A.push({ k: 10, c: '#cfe9ff', t: `ESTRATO ${st.date.slice(5)} ${VARS[st.key].label}${st.delta > 0 ? '↑' : '↓'}`, v: new THREE.Vector3(Math.cos(2.4) * r, 0.2, Math.sin(2.4) * r) });
  }
  p.traces.filter((t) => t.freq >= 0.1).sort((a, b) => b.freq - a.freq).slice(0, S.focus === 5 ? 24 : 4).forEach((t) => {
    const c = CATALOG.findIndex((h) => h.id === t.id);
    const ang = ((c + 0.5) / 24) * TAU;
    A.push({ k: 5, c: DOMAINS[t.domain].color, t: t.code, small: true, v: new THREE.Vector3(Math.cos(ang) * 1.72, -0.95 + 0.08 + 2.4 * t.freq + 0.07, Math.sin(ang) * 1.72) });
  });
  S.anchors = A;
  $('#labels').innerHTML = A.map((a, i) => `<span class="lbl ${a.small ? 'sm' : ''}" data-i="${i}" style="--lc:${a.c}">${a.t}</span>`).join('');
  S.labelEls = [...$('#labels').children];
}
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
  const formToggle = `<label class="toggle warn"><input type="checkbox" id="share-sus" ${shareSubstanceForm ? 'checked' : ''}> INCLUIR TRAZAS DE SUSTANCIAS EN LA FORMA</label>`;
  if (!ind.length) { $('#share-opts').innerHTML = '<p class="note">EXUVIA / OVERRIDE · SALIDA: SÓLO GEOMETRÍA</p>'; return; }
  $('#share-opts').innerHTML = ind.map((x) => `
    <label class="toggle ${DOMAINS[x.domain].sensitive ? 'warn' : ''}"><input type="checkbox" data-id="${x.id}" ${shareInclude.has(x.id) ? 'checked' : ''}> ${x.code} · ${x.label}</label>`).join('') + formToggle;
  $('#share-opts').querySelectorAll('input[data-id]').forEach((i) => i.onchange = () => {
    if (i.checked) shareInclude.add(i.dataset.id); else shareInclude.delete(i.dataset.id);
  });
  $('#share-sus').onchange = (e) => { shareSubstanceForm = e.target.checked; };
}
// Máscara de privacidad: sin opt-in, las trazas de sustancias se envían en 0
function maskPatterns(pu) {
  if (shareSubstanceForm) return pu;
  return { ...pu, traces: pu.traces.map((x, i) => (CATALOG[i] && DOMAINS[CATALOG[i].domain].sensitive ? 0 : x)) };
}
// Se comparte exactamente lo que está en pantalla: la forma actual, una exuvia o el LAB.
const shareInfo = () => {
  const e = entry();
  const base = { mutantId: String(PERSONAS[S.persona].seed).padStart(6, '0'), seed: 4721, time: performance.now() / 1000, genome: currentGenome(), patterns: maskPatterns(toUniforms(currentPatterns())) };
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
// Pantalla única; lo secundario vive en un panel lateral que se abre encima
function go(view) {
  S.view = view;
  const sheet = $('#sheet');
  sheet.hidden = view === 'home';
  sheet.dataset.view = view;
  document.querySelectorAll('.sheet-nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  if (view === 'lab') renderLab(true);
  refresh();
}
document.querySelectorAll('.sheet-nav button').forEach((b) => (b.onclick = () => go(b.dataset.go)));
$('#btn-share').onclick = () => go('share');
$('#btn-menu').onclick = () => go('exuvias');
$('#sheet-close').onclick = () => go('home');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.view !== 'home') go('home'); });
$('#persona').innerHTML = Object.entries(PERSONAS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
$('#persona').onchange = (e) => { thumbCache.clear(); lastSignals = null; S.labFeatures = null; S.ghost = null; $('#ghost-label').hidden = true; load(e.target.value); };

let lastStage = null;
$('#scrub').oninput = (e) => { S.idx = +e.target.value; S.ghost = null; exitLab(); if (S.view === 'lab') renderLab(true); $('#ghost-label').hidden = true; announceMutation(); refresh(); };
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
    if (fresh) toast(`SEÑAL NUEVA · ${describeSignal(fresh, p)}`);
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
  if (S.playing) { S.ghost = null; $('#ghost-label').hidden = true; exitLab(); }
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
  if (S.view === 'watch' && watch) {
    watchAcc += dt;
    if (watchAcc > 0.05) { watch.render(watchAcc, t); watchAcc = 0; }
  }
  // DPR adaptativo: si el dispositivo no sostiene ~45 fps, bajamos resolución, no partículas
  perf.frames++; perf.acc += dt;
  if (perf.acc > 1) {
    perf.fps = perf.frames / perf.acc; perf.frames = 0; perf.acc = 0;
    perf.slow = perf.fps < 45 ? perf.slow + 1 : 0;
    if (perf.slow >= 2 && stage.maxDpr > 1) { stage.maxDpr = Math.max(1, stage.maxDpr - 0.25); stage.resize(); perf.slow = 0; }
    if (S.view === 'lab') {
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
