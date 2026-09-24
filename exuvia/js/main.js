import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from './organism.js';
import { simulate, PERSONAS } from './simulator.js';
import { normalize } from './ingest.js';
import { FEATURES, RULES, toGenome, traits, indicators, HABITS } from './genome.js';
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
  if (S.view === 'patterns') renderPatterns();
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
  $('#indicators').innerHTML = indicators(S.days, S.idx).slice(0, 6).map((x) => `
    <div class="cell"><div class="lbl">${x.label}</div>
      <div class="val">${x.value}<small>${x.unit}</small></div></div>`).join('');
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

function renderData() {
  const d = S.days[S.idx];
  const has = (s) => d.sources.includes(s);
  $('#sources').innerHTML = [
    ['WHOOP', has('whoop') ? 'SIM' : '—', has('whoop')], ['APPLE HEALTH', has('apple') ? 'SIM' : '—', has('apple')],
    ['OURA', 'OFFLINE', false], ['GARMIN', 'OFFLINE', false],
  ].map(([n, s, on]) => `<div class="src ${on ? '' : 'off'}">${n}<div class="st">${s}</div></div>`).join('');

  $('#manual').innerHTML = HABITS.map((h) => `
    <label><input type="checkbox" data-h="${h.id}" ${d.habits[h.id] ? 'checked' : ''}> ${h.label}</label>`).join('');
  $('#manual').querySelectorAll('input').forEach((i) => i.onchange = () => {
    const m = S.raw.manual.find((x) => x.date === d.date && x.habit === i.dataset.h);
    if (m) m.value = i.checked; else S.raw.manual.push({ date: d.date, habit: i.dataset.h, value: i.checked });
    thumbCache.clear();
    recompute(true);
  });

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
function renderShare() {
  const ind = shareInfo().indicators;
  if (!ind.length) { $('#share-opts').innerHTML = '<p class="note">EXUVIA / OVERRIDE · SALIDA: SÓLO GEOMETRÍA</p>'; return; }
  $('#share-opts').innerHTML = ind.map((x) => `
    <label class="toggle"><input type="checkbox" data-id="${x.id}" ${shareInclude.has(x.id) ? 'checked' : ''}> ${x.label}</label>`).join('');
  $('#share-opts').querySelectorAll('input').forEach((i) => i.onchange = () => {
    if (i.checked) shareInclude.add(i.dataset.id); else shareInclude.delete(i.dataset.id);
  });
}
// Se comparte exactamente lo que está en pantalla: la forma actual, una exuvia o el LAB.
const shareInfo = () => {
  const e = entry();
  const base = { mutantId: String(PERSONAS[S.persona].seed).padStart(6, '0'), seed: 4721, time: performance.now() / 1000, genome: currentGenome(), patterns: toUniforms(currentPatterns()) };
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
function go(view) {
  S.view = view;
  app.dataset.view = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  if (view === 'lab') renderLab(true);
  refresh();
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => go(b.dataset.go)));
$('#btn-share').onclick = () => go('share');
$('#btn-persona').onclick = () => go('data');
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

// ---------- vista PATRONES ----------
function renderPatterns() {
  const p = currentPatterns();
  const w = p.weekly;
  const bars = w ? w.profile.map((x, i) => `<div class="wk"><i style="height:${(8 + x * 52).toFixed(0)}px"></i><span>${DAYS[i]}</span></div>`).join('') : '';
  $('#pat-week').innerHTML = w
    ? `<div class="wk-row">${bars}</div><div class="read">AMPLITUD <em>${w.strength.toFixed(2)}</em></div>`
    : '<p class="note">DATOS INSUFICIENTES · MÍN. 28 D</p>';
  $('#pat-cycle').innerHTML = p.cycle
    ? `<div class="read">PERÍODO <em>${p.cycle.period} D</em></div><div class="read">INTENSIDAD <em>${p.cycle.strength.toFixed(2)}</em></div><div class="read">VUELTAS DE HÉLICE <em>${p.cycle.turns.toFixed(1)}</em></div>`
    : '<p class="note">SIN PERIODICIDAD DETECTADA · 10–75 D</p>';
  $('#pat-links').innerHTML = p.couplings.length
    ? p.couplings.map((c) => `<div class="read">${VARS[c.a].label}${c.lag ? ' (T−1)' : ''} ↔ ${VARS[c.b].label} <em class="${c.r >= 0 ? 'pos' : 'neg'}">${c.r >= 0 ? '+' : '−'}${Math.abs(c.r).toFixed(2)}</em></div>`).join('')
    : '<p class="note">SIN ACOPLAMIENTOS · |r| < 0.20</p>';
  $('#pat-strata').innerHTML = p.strata.length
    ? p.strata.map((x) => `<div class="read">${x.date} · ${VARS[x.key].label} ${x.delta > 0 ? '↑' : '↓'} <em>${x.strength.toFixed(2)}</em></div>`).join('')
    : '<p class="note">SIN CAMBIOS DE NIVEL DETECTADOS</p>';
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
