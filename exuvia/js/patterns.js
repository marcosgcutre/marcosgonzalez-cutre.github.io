// Detector de patrones: estructura real en los datos, no puntajes.
// Cuatro tipos, cada uno se inscribe en el organismo como una estructura propia:
//   RITMO SEMANAL  → anillo orbital de 7 lóbulos (un lóbulo por día de la semana)
//   CICLO          → hélice cuyo número de vueltas es la cantidad de ciclos vistos
//   ACOPLAMIENTOS  → filamentos entre nodos de variables que se mueven juntas
//   ESTRATOS       → capas concéntricas en los días en que un hábito cambió de nivel
// Todo se calcula sólo con datos hasta el día evaluado. Ningún patrón es bueno o malo:
// una rutina que empieza y una que termina producen el mismo tipo de estrato.

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

import { CATALOG, dayValue, trackedAt, trace, daysSince, MAX_TRACES } from './catalog.js';

// Variables: tres fisiológicas + todos los hábitos del catálogo. El ángulo ubica su nodo
// alrededor del cuerpo (los filamentos de acoplamiento unen esos nodos).
export const VARS = {
  activity: { label: 'ACTIVIDAD', angle: 0.0 },
  sleep: { label: 'SUEÑO', angle: 2.09 },
  hrv: { label: 'HRV', angle: 4.19 },
  ...Object.fromEntries(CATALOG.map((h, i) => [h.id, { label: h.code, angle: ((i + 0.5) / CATALOG.length) * Math.PI * 2 }])),
};
export const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// Series diarias. null = sin dato (no se imputa).
function series(days) {
  const method = days.at(-1)?.hrv?.method;
  const S = {
    activity: days.map((d) => d.strain != null ? d.strain / 21
      : Math.min(1, d.workouts.reduce((s, w) => s + (w.minutes ?? 45), 0) / 90)),
    sleep: days.map((d) => d.sleepPerformance != null ? d.sleepPerformance / 100 : d.sleepHours != null ? d.sleepHours / 9 : null),
    hrv: days.map((d) => (d.hrv && d.hrv.method === method ? d.hrv.value : null)),
  };
  for (const h of trackedAt(days, days.length - 1)) S[h.id] = days.map((d) => dayValue(d, h));
  return S;
}

function pearson(a, b) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x != null && y != null);
  if (pairs.length < 20) return null;
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// Ritmo semanal: perfil de actividad por día de la semana en 8 semanas.
function weekly(days, act) {
  const n = Math.min(56, days.length);
  if (n < 28) return null;
  const sums = Array(7).fill(0), counts = Array(7).fill(0);
  for (let i = days.length - n; i < days.length; i++) {
    const dow = (new Date(days[i].date + 'T12:00:00Z').getUTCDay() + 6) % 7; // lunes = 0
    sums[dow] += act[i]; counts[dow]++;
  }
  const prof = sums.map((s, i) => s / Math.max(1, counts[i]));
  const m = mean(prof), max = Math.max(...prof);
  const sd = Math.sqrt(mean(prof.map((x) => (x - m) ** 2)));
  return { profile: prof.map((x) => (max ? x / max : 0)), strength: clamp01(m ? (sd / m) * 1.6 : 0) };
}

// Ciclo largo: autocorrelación de la actividad entre 10 y 75 días (lo semanal va aparte).
function cycle(days, act) {
  // sin tendencia: se resta la media móvil de 28 d, si no toda serie que crece "parece" cíclica
  const raw = act.slice(-150);
  if (raw.length < 60) return null;
  const dows = days.slice(-raw.length).map((d) => new Date(d.date + 'T12:00:00Z').getUTCDay());
  let x = raw.map((v, i) => v - mean(raw.slice(Math.max(0, i - 14), i + 14)));
  // sin ritmo semanal: si no, 56 = 8×7 aparece como "ciclo" en cualquier rutina semanal
  const byDow = Array.from({ length: 7 }, (_, k) => mean(x.filter((_, i) => dows[i] === k)) ?? 0);
  x = x.map((v, i) => v - byDow[dows[i]]);
  const m = mean(x), v = mean(x.map((y) => (y - m) ** 2));
  if (!v) return null;
  let best = null;
  for (let lag = 10; lag <= Math.min(75, Math.floor(x.length / 2)); lag++) {
    let s = 0;
    for (let i = lag; i < x.length; i++) s += (x[i] - m) * (x[i - lag] - m);
    const r = s / ((x.length - lag) * v);
    if (!best || r > best.r) best = { period: lag, r };
  }
  const strength = best ? clamp01((best.r - 0.25) / 0.4) : 0;
  if (strength < 0.1) return null;
  return { period: best.period, strength, turns: x.length / best.period };
}

// Acoplamientos: correlaciones en 60 días. Cada hábito seguido se prueba contra el sueño
// y la HRV del día siguiente; además un par de relaciones entre señales fisiológicas.
function pairs(S) {
  const out = [['sleep', 'hrv', 0], ['activity', 'sleep', 0], ['activity', 'hrv', 1]];
  for (const k of Object.keys(S)) {
    if (k === 'activity' || k === 'sleep' || k === 'hrv') continue;
    if (CATALOG.find((h) => h.id === k)?.domain === 'CUE') continue; // ya están dentro de "actividad"
    out.push([k, 'sleep', 1], [k, 'hrv', 1]);
  }
  return out;
}
function couplings(S) {
  const out = [];
  for (const [a, b, lag] of pairs(S)) {
    if (!S[a] || !S[b]) continue;
    const A = S[a].slice(-60 - lag, S[a].length - lag), B = S[b].slice(-60);
    if (A.length !== B.length) continue;
    if (A.filter((v) => (v ?? 0) > 0).length < 4) continue; // un hábito casi ausente no tiene correlación
    const r = pearson(A, B);
    if (r != null && Math.abs(r) >= 0.2) out.push({ a, b, lag, r });
  }
  // un mismo hábito no ocupa los tres filamentos
  const seen = new Set();
  return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).filter((c) => (seen.has(c.a) ? false : seen.add(c.a))).slice(0, 3);
}

// Estratos: días en que el nivel medio de un hábito cambió (28 d antes vs hasta 28 d después).
function strata(days, S) {
  const found = [];
  const n = days.length;
  for (const k of Object.keys(S).filter((k) => k !== 'hrv' && k !== 'steps')) {
    const x = S[k];
    const scores = [];
    for (let t = 28; t <= n - 14; t++) {
      const before = x.slice(t - 28, t).filter((v) => v != null);
      const after = x.slice(t, Math.min(n, t + 28)).filter((v) => v != null);
      if (before.length < 14 || after.length < 14) { scores.push([0, 0]); continue; }
      // estadístico z de diferencia de medias: el pico cae en el día del cambio, no antes
      const mb = mean(before), ma = mean(after);
      const vb = mean(before.map((v) => (v - mb) ** 2)), va = mean(after.map((v) => (v - ma) ** 2));
      const se = Math.sqrt(vb / before.length + va / after.length) || 1e-6;
      scores.push([(ma - mb) / se, ma - mb]);
    }
    // picos con z ≥ 3.5 y diferencia apreciable, separados por al menos 28 días
    const minDelta = k === 'sleep' ? 0.06 : 0.2;
    const idx = scores.map(([z, d], i) => [Math.abs(z), d, i + 28])
      .filter(([z, d]) => z >= 3.5 && Math.abs(d) >= minDelta).sort((p, q) => q[0] - p[0]);
    const taken = [];
    for (const [z, d, t] of idx) {
      if (taken.some((u) => Math.abs(u - t) < 28)) continue;
      taken.push(t);
      found.push({ key: k, t, date: days[t].date, delta: d, strength: clamp01((z - 3.5) / 6 + 0.35) });
    }
  }
  return found.sort((p, q) => q.strength - p.strength).slice(0, 8).sort((p, q) => p.t - q.t)
    .map((s) => ({ ...s, pos: n > 1 ? s.t / (n - 1) : 1 }));
}

// Patrones con datos hasta idx (inclusive)
export function detect(allDays, idx) {
  const days = allDays.slice(0, idx + 1);
  const S = series(days);
  return {
    traces: trackedAt(days, idx).map((h) => {
      const since = daysSince(days, idx, h);
      // frescura: 1 si fue hoy, ~0.5 ayer, se apaga en pocos días
      // estrellas: días con el hábito en la última semana (0–7), como las esferas del dragón
      const stars = days.slice(Math.max(0, idx - 6), idx + 1).filter((d) => (dayValue(d, h) ?? 0) >= 0.5).length;
      return { id: h.id, code: h.code, domain: h.domain, freq: trace(days, idx, h).freq, fresh: since == null ? 0 : Math.exp(-since / 1.4), stars };
    }),
    weekly: weekly(days, S.activity),
    cycle: cycle(days, S.activity),
    couplings: couplings(S),
    strata: strata(days, S),
  };
}

// Nodo de un acoplamiento en la galaxia: índice del hábito en el catálogo (su planeta),
// o −1/−2/−3 para actividad, sueño y HRV, que viven en el núcleo
export const nodeIndex = (k) => ({ activity: -1, sleep: -2, hrv: -3 }[k] ?? CATALOG.findIndex((h) => h.id === k));

// Forma compacta para el shader (y para el enlace compartido)
export function toUniforms(p) {
  const rings = Array.from({ length: 8 }, (_, i) => {
    const s = p.strata[i];
    return s ? [s.pos, s.strength] : [0, 0];
  });
  const links = Array.from({ length: 3 }, (_, i) => {
    const c = p.couplings[i];
    return c ? [nodeIndex(c.a), nodeIndex(c.b), clamp01(Math.abs(c.r) / 0.6), c.r >= 0 ? 1 : -1] : [0, 0, 0, 1];
  });
  return {
    week: p.weekly?.profile ?? Array(7).fill(0),
    weekStr: p.weekly?.strength ?? 0,
    cycleTurns: p.cycle?.turns ?? 0,
    cycleStr: p.cycle?.strength ?? 0,
    rings, links,
    // una traza por hábito del catálogo (posición fija), frecuencia 28 d; 0 = no seguido
    traces: Array.from({ length: MAX_TRACES }, (_, i) => p.traces.find((t) => t.id === CATALOG[i]?.id)?.freq ?? 0),
    fresh: Array.from({ length: MAX_TRACES }, (_, i) => p.traces.find((t) => t.id === CATALOG[i]?.id)?.fresh ?? 0),
    stars: Array.from({ length: MAX_TRACES }, (_, i) => p.traces.find((t) => t.id === CATALOG[i]?.id)?.stars ?? 0),
  };
}

// Identificadores estables de cada señal, para avisar cuando aparece una nueva
export function signalIds(p) {
  const ids = [];
  if (p.weekly && p.weekly.strength > 0.25) ids.push('W');
  if (p.cycle) ids.push('C'); // el período se refina con más datos: sigue siendo la misma señal
  for (const c of p.couplings) ids.push(`K${c.a}${c.b}`);
  // la fecha de un estrato se ajusta a medida que llegan datos: se identifica por mes aproximado
  for (const s of p.strata) ids.push(`S${s.key}${s.delta > 0 ? '+' : '-'}${Math.round(s.t / 28)}`);
  return ids;
}
