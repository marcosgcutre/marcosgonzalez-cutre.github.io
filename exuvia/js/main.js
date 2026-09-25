import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from './organism.js';
import { simulate, PERSONAS } from './simulator.js';
import { normalize } from './ingest.js';
import { FEATURES, RULES, toGenome, traits, indicators } from './genome.js';
import { CATALOG, DOMAINS, dayValue, byId, trackedAt, daysSince, firstSeen } from './catalog.js';
import { runHistory, progress, MIN_DAYS, NET } from './mutations.js';
import { shareImage, shareVideo, encodeGenome, decodeGenome } from './share.js';
import { detect, toUniforms, signalIds, VARS, DAYS, nodeIndex } from './patterns.js';
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
      Object.assign(c, { enableDamping: true, dampingFactor: 0.06, enablePan: false, minDistance: 4, maxDistance: 12, autoRotate: true, autoRotateSpeed: 0.25 });
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
  watch.camera.position.set(0, 4.2, 6.2); watch.camera.lookAt(0, 0, 0);
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
  // los patrones sólo se inscriben en la forma dentro de ANALYTICS; en el resto la forma va limpia
  // la anatomía de hábitos (miembros + frescura) está siempre; las demás estructuras sólo en ANALYTICS
  const full = toUniforms(currentPatterns());
  const pu = S.view === 'analytics' ? full : { ...emptyPatterns(), traces: full.traces, fresh: full.fresh, stars: full.stars };
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

// Las 6 tarjetas del mockup: las fijadas por el perfil o, si no hay, las más presentes
function cardHabits() {
  const pins = PERSONAS[S.persona].pins;
  const tracked = trackedAt(S.days, S.idx);
  if (pins) return pins.map((id) => byId[id]).filter((h) => tracked.includes(h));
  const sus = tracked.filter((h) => h.domain === 'SUS' && daysSince(S.days, S.idx, h) > 2).slice(0, 2);
  const rest = indicators(S.days, S.idx).filter((x) => byId[x.id].domain !== 'SUS' && x.id !== 'steps').sort((a, b) => b.count - a.count).map((x) => byId[x.id]);
  return [...sus, ...rest].slice(0, 6);
}
function cardFor(h) {
  const e = entry();
  const span = Math.max(e.age, 28);                       // período: la mutación actual (mín. 28 d)
  const color = DOMAINS[h.domain].color;
  if (h.domain === 'SUS') {
    const n = daysSince(S.days, S.idx, h);
    return { label: h.card, value: n ?? '—', unit: 'DÍAS', bar: n == null ? 0 : Math.min(1, n / span), color };
  }
  const win = S.days.slice(Math.max(0, S.idx - span + 1), S.idx + 1);
  const n = win.filter((d) => (dayValue(d, h) ?? 0) >= 0.5).length;
  return { label: h.card, value: n, unit: n < 5 ? (n === 1 ? 'VEZ' : 'VECES') : 'DÍAS', bar: Math.min(1, n / span * 2), color };
}
function renderHome() {
  $('#mutation-age').textContent = entry().age;
  const hs = cardHabits();
  $('#cards').innerHTML = hs.map(cardFor).map((c, i) => `
    <div class="card" data-h="${hs[i].id}" style="--cc:${c.color}">
      <div class="lbl">${c.label}</div>
      <div class="val">${c.value}<small>${c.unit}</small></div>
      <div class="bar"><b style="width:${(c.bar * 100).toFixed(0)}%"></b></div>
    </div>`).join('');
  $('#cards').querySelectorAll('.card').forEach((el) => el.onclick = () => { showLimb(byId[el.dataset.h]); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

// ---------- MUTATIONS ----------
// Qué está cambiando la forma, en términos de hábitos: frecuencia en 28 d al empezar la etapa vs hoy
function drivers() {
  const e = entry(), from = S.idx - e.age;
  const f28 = (idx, h) => S.days.slice(Math.max(0, idx - 27), idx + 1).filter((d) => (dayValue(d, h) ?? 0) >= 0.5).length;
  return trackedAt(S.days, S.idx).filter((h) => h.id !== 'steps')
    .map((h) => ({ h, a: f28(from, h), b: f28(S.idx, h) }))
    .filter((x) => Math.abs(x.b - x.a) >= 4).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a)).slice(0, 3);
}
function renderMutations() {
  const e = entry();
  $('#mutation-name').textContent = `MUTACIÓN ${String(e.stage + 1).padStart(2, '0')} · ${e.age} DÍAS`;
  const pct = Math.round(Math.min(1, e.net / NET) * 100);
  const head = e.age < MIN_DAYS
    ? `Esta galaxia tiene ${e.age} días. Una galaxia necesita al menos ${MIN_DAYS} días antes de poder mudar.`
    : pct >= 100 ? 'Tu galaxia está mudando.' : `Tu galaxia cambió un ${pct}% de lo necesario para mudar.`;
  const d = drivers();
  const list = d.length
    ? `<p>Lo que más la está cambiando desde que empezó esta galaxia:</p><ul>${d.map((x) => `<li style="--dc:${DOMAINS[x.h.domain].color}"><b>${x.h.label}</b> ${x.a} → ${x.b} días de cada 28</li>`).join('')}</ul>`
    : '<p>Tus hábitos están estables desde que empezó esta galaxia.</p>';
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
    $('#skin-info').innerHTML = '<p class="note">Todavía no dejaste ninguna exuvia. Cuando tu galaxia mude, expulsa una nebulosa con su forma anterior y queda acá.</p>';
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
function renderLog(sel = '#log') {
  const box = $(sel);
  if (!box) return;
  const d = S.days[S.idx];
  const ago = S.days.length - 1 - S.idx;
  if (sel === '#log') $('#log-date').textContent = `${ago ? `hace ${ago} días` : 'hoy'} · las sustancias son privadas`;
  box.innerHTML = `<div class="chips">${CATALOG.map((h) => {
    const v = dayValue(d, h), on = (v ?? 0) >= 0.5, detail = h.detail?.(d);
    const dc = DOMAINS[h.domain].color;
    return h.source === 'auto'
      ? `<span class="chip auto ${on ? 'on' : ''}" style="--dc:${dc}" title="${h.label} · automático"><b>${h.label}</b><small>${detail ?? 'automático'}</small></span>`
      : `<button class="chip ${on ? 'on' : ''}" style="--dc:${dc}" data-h="${h.id}"><b>${h.label}</b><small>${on ? 'registrado' : 'tocar'}</small></button>`;
  }).join('')}</div>`;
  box.querySelectorAll('button.chip').forEach((b) => b.onclick = () => {
    const id = b.dataset.h, on = !b.classList.contains('on');
    logHabit(id, on, d.date);
    renderLog(sel);
    if (on) stage.absorb();
    // la forma responde al instante: se enciende la punta de ese miembro
    if (on) { toast(`TU FORMA REGISTRÓ · ${byId[id].label.toUpperCase()}`); showLimb(byId[id]); }
  });
}

// Registrar un hábito manual en un día
function logHabit(id, on, date = S.days[S.idx].date) {
  const m = S.raw.manual.find((x) => x.date === date && x.habit === id);
  if (m) m.value = on; else S.raw.manual.push({ date, habit: id, value: on });
  thumbCache.clear();
  recompute(true);
}

// RITUAL DE ESPORAS: una espora por hábito manual; arrastrarla a la forma = registrarla.
// Todas se absorben igual: no hay esporas buenas ni malas.
function openRitual() {
  const d = S.days[S.idx];
  const pending = CATALOG.filter((h) => h.source === 'manual' && d.habits[h.id] !== true);
  // primero los hábitos que ya seguís, después el resto
  const tracked = new Set(trackedAt(S.days, S.idx).map((h) => h.id));
  pending.sort((a, b) => tracked.has(b.id) - tracked.has(a.id));
  app.classList.add('ritual-on');
  $('#ritual').hidden = false;
  // se espera a que el escenario termine de agrandarse (transición de 0.5 s)
  setTimeout(() => {
    const box = $('.stage-wrap').getBoundingClientRect();
    const cx = box.width / 2, cy = box.height / 2 + 10, R = Math.min(box.width, box.height) * 0.4;
    $('#spores').innerHTML = pending.map((h, i) => {
      const ring = i < 10 ? 0 : 1, n = ring ? pending.length - 10 : Math.min(10, pending.length);
      const k = ring ? i - 10 : i, a = (k / n) * Math.PI * 2 - Math.PI / 2 + ring * 0.3;
      const r = R * (ring ? 0.62 : 1);
      return `<button class="spore" data-h="${h.id}" data-x="${cx + Math.cos(a) * r}" data-y="${cy + Math.sin(a) * r}"
        style="--dc:${DOMAINS[h.domain].color}; left:${cx + Math.cos(a) * r}px; top:${cy + Math.sin(a) * r}px; animation-delay:${(-i * 0.7).toFixed(1)}s">
        <i></i><span>${h.label}</span></button>`;
    }).join('');
    $('#spores').querySelectorAll('.spore').forEach((el) => bindSpore(el, cx, cy, R));
  }, 540);
}
function bindSpore(el, cx, cy, R) {
  let start = null;
  el.addEventListener('pointerdown', (e) => { start = [e.clientX, e.clientY, parseFloat(el.style.left), parseFloat(el.style.top)]; el.setPointerCapture(e.pointerId); el.classList.add('drag'); });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    el.style.left = `${start[2] + e.clientX - start[0]}px`; el.style.top = `${start[3] + e.clientY - start[1]}px`;
  });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const moved = Math.hypot(e.clientX - start[0], e.clientY - start[1]);
    const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
    const near = Math.hypot(x - cx, y - cy) < R * 0.5;
    el.classList.remove('drag'); start = null;
    if (near || moved < 6) absorbSpore(el, cx, cy);
    else { el.style.left = `${el.dataset.x}px`; el.style.top = `${el.dataset.y}px`; }
  });
}
function absorbSpore(el, cx, cy) {
  el.classList.add('absorbing');
  el.style.left = `${cx}px`; el.style.top = `${cy}px`;
  setTimeout(() => {
    const h = byId[el.dataset.h];
    el.remove();
    logHabit(h.id, true);
    stage.absorb();
    showLimb(h);
    toast(`ABSORBIDO · ${h.label.toUpperCase()}`);
  }, 420);
}
function closeRitual() {
  $('#ritual').hidden = true;
  app.classList.remove('ritual-on');
  $('#spores').innerHTML = '';
}
$('#fab').onclick = openRitual;
$('#ritual-done').onclick = closeRitual;

// GÉNESIS: la primera vez, el organismo crece desde tu historia
function genesis() {
  S.idx = 0; S.genesis = true; S.playing = true; lastStage = 0; lastSignals = null;
  $('#genesis').hidden = false;
  refresh(true);
}
function endGenesis() {
  S.genesis = false; S.playing = false;
  S.idx = S.days.length - 1; $('#scrub').value = S.idx;
  $('#genesis').hidden = true;
  $('#btn-play').textContent = '▶';
  try { localStorage.setItem('exuvia.genesis', '1'); } catch { /* sin almacenamiento: se repite, no pasa nada */ }
  refresh();
}
$('#genesis-skip').onclick = endGenesis;
$('#replay-genesis').onclick = () => { go('home'); genesis(); };

// PATRONES en lenguaje llano; cada uno ligado a su estructura en la forma
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const VAR_NAME = (k) => ({ activity: 'tu actividad', sleep: 'tu sueño', hrv: 'tu HRV' }[k] ?? byId[k]?.label.toLowerCase() ?? k);
function signalText(p) {
  const rows = [];
  const w = p.weekly;
  if (w && w.strength > 0.2) {
    const peak = w.profile.indexOf(Math.max(...w.profile)), low = w.profile.indexOf(Math.min(...w.profile));
    rows.push({ k: 1, c: '#b3ffff', t: `Tu día más activo es el ${DAY_NAMES[peak]}; el más tranquilo, el ${DAY_NAMES[low]}.`, s: 'Halo alrededor del núcleo · un lóbulo por día' });
  }
  if (p.cycle) rows.push({ k: 2, c: '#c79bff', t: `Tu actividad sube y baja en ciclos de unas ${Math.round(p.cycle.period / 7)} semanas.`, s: `Chorros polares en espiral · ${p.cycle.turns.toFixed(1)} vueltas = ciclos vistos` });
  for (const c of p.couplings) {
    const after = c.lag ? `los días después de ${VAR_NAME(c.a).replace(/^tu /, '')}` : `cuando sube ${VAR_NAME(c.a)}`;
    const eff = c.b === 'sleep' ? (c.r > 0 ? 'dormís mejor' : 'dormís peor') : c.b === 'hrv' ? (c.r > 0 ? 'tu HRV sube' : 'tu HRV baja') : (c.r > 0 ? `sube ${VAR_NAME(c.b)}` : `baja ${VAR_NAME(c.b)}`);
    rows.push({ k: 3, c: c.r >= 0 ? '#3ff0ff' : '#ff7a2f', t: `${after[0].toUpperCase()}${after.slice(1)}, ${eff}.`, s: `Puente de luz entre planetas · correlación ${c.r >= 0 ? '+' : '−'}${Math.abs(c.r).toFixed(2)} en 60 días (asociación, no causa)` });
  }
  for (const x of p.strata.slice().reverse().slice(0, 3)) {
    const what = x.key === 'activity' ? 'actividad' : x.key === 'sleep' ? 'sueño' : byId[x.key]?.label.toLowerCase();
    rows.push({ k: 10, c: '#cfe9ff', t: `Desde el ${fmt(x.date).toLowerCase()} hay ${x.delta > 0 ? 'más' : 'menos'} ${what}.`, s: 'Anillo en el disco · más adentro = más antiguo' });
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
  if (p.weekly && pu.weekStr > 0.05) A.push({ k: 1, c: '#b3ffff', t: 'SEMANA', v: new THREE.Vector3(0.95, 0.15, 0) });
  if (p.cycle) A.push({ k: 2, c: '#c79bff', t: `CICLO ${Math.round(p.cycle.period / 7)} SEM`, v: new THREE.Vector3(0, 1.5, 0) });
  p.couplings.forEach((c, i) => {
    A.push({ k: 3, c: c.r >= 0 ? '#3ff0ff' : '#ff7a2f', t: `${(byId[c.a]?.label ?? VARS[c.a].label).toUpperCase()} → ${c.b === 'sleep' ? 'SUEÑO' : c.b === 'hrv' ? 'HRV' : VARS[c.b].label}`, dyn: () => nodeVec(c.a).add(nodeVec(c.b)).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.45 + 0.28 * i, 0)) });
  });
  const st = p.strata.at(-1);
  if (st) A.push({ k: 10, c: '#cfe9ff', t: `DESDE ${fmt(st.date)}`, v: new THREE.Vector3(Math.cos(2.4), 0.05, Math.sin(2.4)).multiplyScalar(0.35 + (1.2 + 0.65 * g.skirt - 0.35) * st.pos) });
  p.traces.filter((t) => t.freq >= 0.1).sort((a, b) => b.freq - a.freq).slice(0, S.focus === 5 ? 24 : 4).forEach((t) => {
    const c = CATALOG.findIndex((h) => h.id === t.id);
    A.push({ k: 5, c: DOMAINS[t.domain].color, t: byId[t.id].label.toUpperCase(), small: true, dyn: () => limbTip(c, t.freq) });
  });
  S.anchors = S.focus ? A.filter((a) => a.k === S.focus) : A.filter((a) => !a.small);
  if (S.tap) S.anchors.push(S.tap);
  $('#labels').innerHTML = S.anchors.map((a, i) => `<span class="tag3d ${a.k === -1 ? 'tap' : a.small ? 'sm' : ''}" data-i="${i}" style="--lc:${a.c}">${a.t}</span>`).join('');
  S.labelEls = [...$('#labels').children];
}
// Posición actual del planeta de un hábito: mismas fórmulas que el shader
function limbTip(c, f) {
  const r = 2.0 - 1.15 * f, time = stage.organism.material.uniforms.uTime.value;
  const a = c * 2.39996 + time * 0.22 / Math.pow(r, 1.5);
  return new THREE.Vector3(Math.cos(a) * r, Math.sin(c * 1.7) * 0.12, Math.sin(a) * r);
}
const nodeVec = (k) => {
  const idx = nodeIndex(k);
  if (idx < 0) { const a = -idx * 2.1; return new THREE.Vector3(Math.cos(a) * 0.3, 0.12, Math.sin(a) * 0.3); }
  const t = currentPatterns().traces.find((x) => x.id === CATALOG[idx].id);
  return limbTip(idx, t?.freq ?? 0);
};

// TOCAR PARA LEER: tocás un miembro (o una tarjeta) y dice qué hábito es
let tapTimer = 0;
function showLimb(h) {
  const t = currentPatterns().traces.find((x) => x.id === h.id);
  if (!t) return;
  const n28 = indicators(S.days, S.idx).find((x) => x.id === h.id)?.count ?? 0;
  const since = daysSince(S.days, S.idx, h);
  const when = since === 0 ? 'hoy' : since === 1 ? 'ayer' : since == null ? '—' : `hace ${since} días`;
  const ci = CATALOG.indexOf(h);
  S.tap = { k: -1, c: DOMAINS[h.domain].color, t: `${h.label.toUpperCase()} · ${'★'.repeat(t.stars ?? 0) || '—'} esta semana · ${n28} de 28 días · última: ${when}`, dyn: () => limbTip(ci, t.freq).add(new THREE.Vector3(0, 0.18, 0)) };
  clearTimeout(tapTimer); tapTimer = setTimeout(() => { S.tap = null; renderTapTag(); }, 3200);
  renderTapTag();
}
function renderTapTag() {
  const base = S.view === 'analytics' ? S.anchors.filter((a) => a.k !== -1) : [];
  S.anchors = S.tap ? [...base, S.tap] : base;
  $('#labels').innerHTML = S.anchors.map((a, i) => `<span class="tag3d ${a.k === -1 ? 'tap' : a.small ? 'sm' : ''}" data-i="${i}" style="--lc:${a.c}">${a.t}</span>`).join('');
  S.labelEls = [...$('#labels').children];
}
{
  const cv = $('#stage');
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const ex = stage.organism.genome.expansion;
    let best = null, bd = 48;
    for (const t of currentPatterns().traces) {
      if (t.freq < 0.03) continue;
      const c = CATALOG.findIndex((h) => h.id === t.id);
      for (const k of [1]) {
        const v = limbTip(c, t.freq * k).multiplyScalar(ex).project(stage.camera);
        const d = Math.hypot((v.x * 0.5 + 0.5) * r.width - mx, (-v.y * 0.5 + 0.5) * r.height - my);
        if (d < bd) { bd = d; best = byId[t.id]; }
      }
    }
    if (best) showLimb(best);
  });
}

function clearAnchors() { S.anchors = []; S.labelEls = []; $('#labels').innerHTML = ''; if (S.tap) renderTapTag(); }
const _v = new THREE.Vector3(), _dir = new THREE.Vector3();
function updateLabels() {
  if (!S.labelEls?.length) return;
  const cam = stage.camera, el = stage.renderer.domElement;
  const w = el.clientWidth, h = el.clientHeight, ex = stage.organism.genome.expansion;
  cam.getWorldDirection(_dir);
  S.anchors.forEach((a, i) => {
    const node = S.labelEls[i];
    if (!node) return;
    _v.copy(a.dyn ? a.dyn() : a.v).multiplyScalar(ex);
    const depth = _v.clone().sub(cam.position).dot(_dir) - cam.position.length(); // >0: detrás del centro
    _v.project(cam);
    const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
    const focus = S.focus === 0 || S.focus === a.k || a.k === -1;
    // la etiqueta nunca se sale del marco
    const cx = Math.max(6, Math.min(x, w - node.offsetWidth - 6));
    node.style.transform = `translate(${cx.toFixed(1)}px, ${y.toFixed(1)}px)`;
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
  if (view !== 'home' && !$('#ritual').hidden) closeRitual();
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
  if (lastStage !== null && e.stage > lastStage) {
    toast(`ALGO CAMBIÓ · MUTACIÓN ${String(e.stage + 1).padStart(2, '0')}`);
    // la piel que se deja: se desprende y queda como cáscara al costado
    const skin = S.history.exuvias[e.stage - 1];
    if (skin) stage.shed(skin.genome, (() => { const u = toUniforms(patternsAt(idxOf(skin.end))); return { ...emptyPatterns(), traces: u.traces, stars: u.stars }; })());
  }
  else if (lastSignals && lastStage !== null && e.stage === lastStage) {
    const fresh = ids.find((id) => !lastSignals.has(id));
    if (fresh) { toast(`PATRÓN NUEVO · ${describeSignal(fresh, p)}`); $('#bell-dot').hidden = false; }
  }
  lastStage = e.stage; lastSignals = new Set(ids);
}
function describeSignal(id, p) {
  if (id === 'W') return 'RITMO SEMANAL';
  if (id === 'C') return `CICLO ${p.cycle.period} D`;
  const nm = (k) => (byId[k]?.label ?? { activity: 'actividad', sleep: 'sueño', hrv: 'HRV' }[k] ?? k).toUpperCase();
  if (id[0] === 'K') { const c = p.couplings.find((x) => id === `K${x.a}${x.b}`); return `${nm(c.a)} ↔ ${nm(c.b)}`; }
  const st = p.strata.find((x) => id === `S${x.key}${x.delta > 0 ? '+' : '-'}${Math.round(x.t / 28)}`);
  return `${st.delta > 0 ? 'MÁS' : 'MENOS'} ${nm(st.key)} DESDE ${fmt(st.date)}`;
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
    if (playAcc > (S.genesis ? 0.03 : 0.09)) {
      playAcc = 0;
      if (S.genesis) $('#genesis-text').textContent = `${S.days[S.idx].date} · ${S.history.timeline[S.idx].stage} pieles dejadas`;
      if (S.idx < S.days.length - 1) { S.idx = Math.min(S.days.length - 1, S.idx + (S.genesis ? 2 : 1)); $('#scrub').value = S.idx; announceMutation(); refresh(); }
      else if (S.genesis) endGenesis();
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
  let seen = false;
  try { seen = localStorage.getItem('exuvia.genesis') === '1'; } catch { /* nada */ }
  if (!seen && !qs.has('nogenesis')) genesis();
}
requestAnimationFrame(loop);
window.__exuviaReady = true;
