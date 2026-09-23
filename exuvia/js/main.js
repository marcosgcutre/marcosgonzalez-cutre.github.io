import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from './organism.js';
import { simulate, PERSONAS } from './simulator.js';
import { normalize } from './ingest.js';
import { FEATURES, RULES, toGenome, traits, indicators, HABITS } from './genome.js';
import { runHistory, progress } from './mutations.js';
import { shareImage, shareVideo, encodeGenome, decodeGenome } from './share.js';

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
const currentFeatures = () => (S.lab && S.labFeatures ? S.labFeatures : entry().features);
const currentGenome = () => (S.ghost ? S.ghost.genome : toGenome(currentFeatures(), entry().genome.seedShift));

function refresh(immediate = false) {
  const g = currentGenome();
  stage.organism.setTarget(g, immediate);
  watch?.organism.setTarget(g, immediate);
  renderHome(); renderScrub();
  if (S.view === 'exuvias') renderExuvias();
  if (S.view === 'data') renderData();
  if (S.view === 'lab') renderLab(false);
  if (S.view === 'watch') renderWatch();
  if (S.view === 'share') renderShare();
}

// ---------- vistas ----------
function renderScrub() {
  const ago = S.days.length - 1 - S.idx;
  $('#scrub-label').textContent = ago === 0 ? 'HOY' : `HACE ${ago} D`;
}

function renderHome() {
  const e = entry();
  $('#mutation-name').textContent = `MUTATION ${String(e.stage + 1).padStart(2, '0')} · ${e.name ?? ''}`;
  $('#mutation-age').textContent = e.age;
  const p = progress(e);
  $('#progress').innerHTML = [['MADUREZ', p.maturity], ['CAMBIO', p.change]]
    .map(([l, v]) => `<div>${l}<i><b style="width:${(v * 100).toFixed(0)}%"></b></i></div>`).join('');
  $('#indicators').innerHTML = indicators(S.days, S.idx).slice(0, 6).map((x) => `
    <div class="cell"><div class="lbl">${x.label}</div>
      <div class="val">${x.value}<small>${x.unit}</small></div></div>`).join('');
  const t = traits(currentGenome());
  $('#traits').innerHTML = Object.entries(t).map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
}

// Miniaturas de exuvias: un solo renderer reutilizado, resultado cacheado.
const thumbCache = new Map();
let thumbStage = null;
function thumb(genome, key) {
  if (thumbCache.has(key)) return thumbCache.get(key);
  if (!thumbStage) {
    const c = document.createElement('canvas'); c.width = c.height = 320;
    thumbStage = new Stage(c, { count: 24000, maxDpr: 1, seed: 4721, preserve: true });
    thumbStage.renderer.setPixelRatio(1); thumbStage.renderer.setSize(320, 320, false);
    thumbStage.organism.material.uniforms.uPixelRatio.value = 320 / 700;
  }
  thumbStage.organism.setTarget(genome, true);
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
      <img alt="Forma ${x.index}" src="${thumb(x.genome, `${S.persona}-${x.index}-${x.current ? S.idx : 'x'}`)}">
      <div class="lbl">MUTATION ${String(x.index).padStart(2, '0')} ${x.current ? '· ACTUAL' : ''}</div>
      <div class="meta">${x.name ?? ''} · ${x.days} días</div>
      ${x.current ? '' : `<div class="meta">${x.start} → ${x.end}</div>`}
    </button>`).join('') || '<p class="note">Todavía no hubo mudas.</p>';
  $('#exuvia-list').querySelectorAll('.exuvia').forEach((b) => b.onclick = () => {
    const x = list[+b.dataset.i];
    S.ghost = x.current ? null : x;
    $('#ghost-label').hidden = !S.ghost;
    if (S.ghost) $('#ghost-label').textContent = `EXUVIA ${String(x.index).padStart(2, '0')} · ${x.name} · VOLVER ✕`;
    refresh();
  });
}
$('#ghost-label').onclick = () => { S.ghost = null; $('#ghost-label').hidden = true; refresh(); };

function renderData() {
  const d = S.days[S.idx];
  const has = (s) => d.sources.includes(s);
  $('#sources').innerHTML = [
    ['WHOOP', has('whoop') ? 'SIMULADO' : '—', has('whoop')], ['APPLE HEALTH', has('apple') ? 'SIMULADO' : '—', has('apple')],
    ['OURA', 'NO CONECTADO', false], ['GARMIN', 'NO CONECTADO', false],
  ].map(([n, s, on]) => `<div class="src ${on ? '' : 'off'}">${n}<div class="st">${s}</div></div>`).join('');

  $('#manual').innerHTML = HABITS.map((h) => `
    <label><input type="checkbox" data-h="${h.id}" ${d.habits[h.id] ? 'checked' : ''}> ${{ sugar: 'Comí azúcar', alcohol: 'Tomé alcohol', smoking: 'Fumé' }[h.id]}</label>`).join('');
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
      <div class="track"><b style="width:${((f[k] ?? 0) * 100).toFixed(0)}%"></b></div><span>${f[k] == null ? 'sin dato' : (f[k] * 100).toFixed(0)}</span></div>`).join('');
}

const labFrom = (f) => Object.fromEntries(Object.keys(FEATURES).map((k) => [k, f[k] ?? 0.5]));
function exitLab() { S.lab = false; S.labFeatures = null; $('#lab-on').checked = false; }

function renderLab(rebuild = true) {
  if (!S.labFeatures) S.labFeatures = labFrom(entry().features);
  if (rebuild || !$('#lab-sliders').children.length) {
    $('#lab-sliders').innerHTML = Object.entries(FEATURES).map(([k, m]) => `
      <label>${m.label}<input type="range" min="0" max="1" step="0.01" data-f="${k}" value="${S.labFeatures[k]}"><span>${Math.round(S.labFeatures[k] * 100)}</span></label>`).join('');
    $('#lab-sliders').querySelectorAll('input').forEach((i) => i.oninput = () => {
      S.labFeatures[i.dataset.f] = +i.value;
      i.nextElementSibling.textContent = Math.round(i.value * 100);
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
  $('#watch-note').textContent = `Vista previa en navegador con ${watch.organism.points.geometry.attributes.aSeed.count.toLocaleString('es')} partículas a 20 fps (el teléfono usa ${COUNT.toLocaleString('es')}). En watchOS real la estrategia recomendada es otra: ver docs/ARQUITECTURA.md.`;
}

// ---------- compartir ----------
const shareInclude = new Set();
function renderShare() {
  const ind = shareInfo().indicators;
  if (!ind.length) { $('#share-opts').innerHTML = '<p class="note">Estás viendo una exuvia o el LAB: se comparte sólo la forma.</p>'; return; }
  $('#share-opts').innerHTML = ind.map((x) => `
    <label class="toggle"><input type="checkbox" data-id="${x.id}" ${shareInclude.has(x.id) ? 'checked' : ''}> ${x.label}</label>`).join('');
  $('#share-opts').querySelectorAll('input').forEach((i) => i.onchange = () => {
    if (i.checked) shareInclude.add(i.dataset.id); else shareInclude.delete(i.dataset.id);
  });
}
// Se comparte exactamente lo que está en pantalla: la forma actual, una exuvia o el LAB.
const shareInfo = () => {
  const e = entry();
  const base = { mutantId: String(PERSONAS[S.persona].seed).padStart(6, '0'), seed: 4721, time: performance.now() / 1000, genome: currentGenome() };
  if (S.ghost) return { ...base, stage: S.ghost.index - 1, name: `${S.ghost.name} · EXUVIA`, age: S.ghost.days, ageLabel: 'DÍAS QUE DURÓ ESTA FORMA', indicators: [] };
  if (S.lab) return { ...base, stage: e.stage, name: 'LAB', age: e.age, indicators: [] };
  return { ...base, stage: e.stage, name: e.name ?? '', age: e.age, indicators: indicators(S.days, S.idx) };
};
const status = (t) => ($('#share-status').textContent = t);
const busy = (on) => document.querySelectorAll('.actions .btn').forEach((b) => (b.disabled = on));
$('#share-img').onclick = async () => {
  busy(true); status('Renderizando 1080×1350…');
  try { const r = await shareImage(shareInfo().genome, shareInfo(), { include: shareInclude }); status(r === 'shared' ? 'Compartido.' : r === 'cancelled' ? '' : 'Imagen descargada.'); }
  catch (e) { status(e.message); } finally { busy(false); }
};
$('#share-vid').onclick = async () => {
  busy(true);
  try {
    const r = await shareVideo(shareInfo().genome, shareInfo(), { include: shareInclude }, 4, (p) => status(`Grabando ${Math.round(p * 100)}%`));
    status(r === 'shared' ? 'Compartido.' : r === 'cancelled' ? '' : 'Animación descargada.');
  } catch (e) { status(e.message); } finally { busy(false); }
};
$('#share-link').onclick = async () => {
  const i = shareInfo();
  const url = encodeGenome(i.genome, { stage: i.stage, name: i.name, mutantId: i.mutantId });
  try { await navigator.clipboard.writeText(url); status('Enlace copiado. Sólo contiene la forma, no tus datos.'); }
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
$('#persona').onchange = (e) => { thumbCache.clear(); S.labFeatures = null; S.ghost = null; $('#ghost-label').hidden = true; load(e.target.value); };

let lastStage = null;
$('#scrub').oninput = (e) => { S.idx = +e.target.value; S.ghost = null; exitLab(); if (S.view === 'lab') renderLab(true); $('#ghost-label').hidden = true; announceMutation(); refresh(); };
function announceMutation() {
  const e = entry();
  if (lastStage !== null && e.stage > lastStage) {
    const t = $('#toast');
    t.textContent = `NUEVA MUTATION · ${e.name}`;
    t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600);
  }
  lastStage = e.stage;
}
$('#btn-play').onclick = () => {
  S.playing = !S.playing;
  $('#btn-play').textContent = S.playing ? '❚❚' : '▶';
  if (S.playing) { S.ghost = null; $('#ghost-label').hidden = true; exitLab(); }
  if (S.playing && S.idx >= S.days.length - 1) { S.idx = 0; lastStage = 0; }
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
  stage.resize();
} else {
  load('marcos');
  lastStage = entry().stage;
}
requestAnimationFrame(loop);
window.__exuviaReady = true;
