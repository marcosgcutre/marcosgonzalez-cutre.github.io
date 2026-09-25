// Motor de reglas: datos → rasgos (features) → genoma visual.
// No hay formas mejores ni peores: cada señal mueve la forma entre dos extremos.
// Un dato ausente no es un dato malo: los rasgos sin datos valen null y las reglas
// se recalculan con los que sí hay.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

import { trackedAt, daysSince, trace } from './catalog.js';

// Versión elemental: cuatro señales que el teléfono o el reloj registran solos.
// Nada que anotar. Cada señal mueve una sola cualidad visible del organismo:
//   PASOS          → TAMAÑO      (cuánto espacio ocupa)
//   SUEÑO          → CALMA       (ordenado ↔ turbulento)
//   ENTRENAMIENTO  → MOVIMIENTO  (lento ↔ rápido)
//   RECUPERACIÓN   → RESPIRACIÓN (amplitud del pulso; sólo con HRV de un reloj)
// El resto de la forma (lóbulos, torsión, base) es identidad: sale de la semilla de la
// etapa y sólo cambia cuando el organismo muda.
export const FEATURES = {
  steps: { label: 'Pasos (promedio 14 d)' },
  sleep: { label: 'Sueño (promedio 14 d)' },
  training: { label: 'Entrenamiento (minutos 14 d)' },
  recovery: { label: 'Recuperación (HRV 7 d vs 60 d)' },
};

// Brillo fijo: la luminosidad no depende de ningún dato.
export const GLOW = 0.85;

// Cada parámetro = min + (max-min) · Σ(peso · feature) / Σ(pesos con dato).
export const RULES = {
  expansion: { min: 0.8, max: 1.2, from: { steps: 1 }, meaning: 'Tamaño' },
  coherence: { min: 0, max: 1, from: { sleep: 1 }, meaning: 'Calma: turbulenta ↔ ordenada' },
  flow: { min: 0.15, max: 1.1, from: { training: 1 }, meaning: 'Movimiento: lento ↔ rápido' },
  pulse: { min: 0.12, max: 0.45, from: { training: 1 }, meaning: 'Frecuencia de respiración visual (Hz)' },
  pulseAmp: { min: 0.3, max: 1, from: { recovery: 1 }, meaning: 'Respiración: amplitud' },
  cyan: { min: 0.05, max: 1, from: { sleep: 1 }, meaning: 'Cian' },
  blue: { min: 0.05, max: 1, from: { steps: 1 }, meaning: 'Azul' },
  orange: { min: 0.02, max: 0.7, from: { training: 1 }, meaning: 'Naranja' },
  violet: { min: 0.05, max: 1, from: { recovery: 1 }, meaning: 'Violeta' },
};

// Lo que decide una mutación: las cuatro cualidades que mueven los datos.
export const STRUCTURAL = ['expansion', 'coherence', 'flow', 'pulseAmp'];

// Identidad de la etapa: sale de la semilla y sólo cambia cuando el organismo muda.
export const IDENTITY = {
  density: [0.3, 0.8], lobes: [1, 6], lobeAmp: [0.2, 0.9], twist: [0, 1.2],
  elong: [0, 1], skirt: [0.1, 0.9], filament: [0.2, 0.8],
};
export function identityFrom(seedShift) {
  const h = (k) => { const x = Math.sin(seedShift * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const g = {};
  Object.entries(IDENTITY).forEach(([k, [a, b]], i) => { g[k] = a + (b - a) * h(i + 1); });
  g.lobes = Math.round(g.lobes);
  return g;
}

const win = (days, idx, n) => days.slice(Math.max(0, idx - n + 1), idx + 1);
const avgOf = (arr, key, min = 3) => { const v = arr.map((x) => x[key]).filter((x) => x != null && x > 0); return v.length >= min ? mean(v) : null; };
const minutes = (arr) => arr.flatMap((x) => x.workouts).reduce((s, w) => s + (w.minutes ?? 45), 0);
const hasData = (arr) => arr.some((x) => x.steps != null || x.sleepHours != null || x.sleepPerformance != null || x.workouts.length);

export function extractFeatures(days, idx) {
  const w14 = win(days, idx, 14);
  const steps = avgOf(w14, 'steps', 4);
  const perf = avgOf(w14, 'sleepPerformance', 4), hours = avgOf(w14, 'sleepHours', 4);
  // WHOOP puntúa el sueño; Apple da horas. Se usa uno solo, nunca mezclados.
  const sleep = perf != null ? clamp01((perf - 50) / 45) : hours != null ? clamp01((hours - 5) / 4) : null;
  // sumas escaladas al largo real de la ventana: con 5 días de historia no se "entrena menos"
  const training = hasData(w14) ? clamp01((minutes(w14) * (14 / w14.length)) / 900) : null;

  // HRV: sólo comparar valores del mismo método (RMSSD con RMSSD, SDNN con SDNN)
  const method = days[idx].hrv?.method ?? w14.findLast((x) => x.hrv)?.hrv.method;
  const hrvOf = (arr) => arr.filter((x) => x.hrv && x.hrv.method === method).map((x) => x.hrv.value);
  const h7 = mean(hrvOf(win(days, idx, 7))), h60 = hrvOf(win(days, idx, 60));
  const recovery = method && h7 && h60.length >= 21 ? clamp01(0.5 + ((h7 - mean(h60)) / mean(h60)) * 1.5) : null;

  return { steps: steps != null ? clamp01(steps / 16000) : null, sleep, training, recovery };
}

export function toGenome(features, seedShift) {
  const g = { seedShift, glow: GLOW, ...identityFrom(seedShift) };
  for (const [k, r] of Object.entries(RULES)) {
    let s = 0, wsum = 0;
    for (const [f, w] of Object.entries(r.from)) {
      if (features[f] == null) continue;
      s += w * features[f]; wsum += w;
    }
    g[k] = r.min + (r.max - r.min) * (wsum ? clamp01(s / wsum) : 0.5);
  }
  return g;
}

export function normalizedParam(g, k) {
  const r = RULES[k]; return (g[k] - r.min) / (r.max - r.min);
}

export function structuralDistance(a, b) {
  return mean(STRUCTURAL.map((k) => Math.abs(normalizedParam(a, k) - normalizedParam(b, k))));
}

// Lecturas de la forma, 0.00–1.00
export function traits(g) {
  const n = (k) => clamp01(normalizedParam(g, k));
  return { 'TAMAÑO': n('expansion'), 'CALMA': n('coherence'), 'MOVIMIENTO': n('flow'), 'RESPIRACIÓN': n('pulseAmp') };
}

// Las cuatro señales: esta semana (7 d) contra la anterior.
export const SIGNALS = [
  { id: 'steps', label: 'PASOS', drives: 'TAMAÑO', color: '#4d8dff' },
  { id: 'sleep', label: 'SUEÑO', drives: 'CALMA', color: '#3ff0ff' },
  { id: 'training', label: 'ENTRENAMIENTO', drives: 'MOVIMIENTO', color: '#ff7a2f' },
  { id: 'recovery', label: 'RECUPERACIÓN', drives: 'RESPIRACIÓN', color: '#a77bff' },
];
export function weekly(days, idx) {
  const a = win(days, idx, 7), b = idx >= 7 ? win(days, idx - 7, 7) : [];
  const usePerf = avgOf(a, 'sleepPerformance') != null;
  const method = days[idx].hrv?.method ?? a.findLast((x) => x.hrv)?.hrv.method;
  const hrv = (arr) => mean(arr.filter((x) => x.hrv && x.hrv.method === method).map((x) => x.hrv.value));
  const val = {
    steps: (arr) => avgOf(arr, 'steps'),
    sleep: (arr) => avgOf(arr, usePerf ? 'sleepPerformance' : 'sleepHours'),
    training: (arr) => (hasData(arr) ? minutes(arr) : null),
    recovery: (arr) => (method ? hrv(arr) : null),
  };
  const fmt = {
    steps: (v) => ({ value: Math.round(v).toLocaleString('es-AR'), unit: '/DÍA' }),
    sleep: (v) => (usePerf ? { value: Math.round(v), unit: '%' } : { value: `${Math.floor(v)}h${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, unit: '/NOCHE' }),
    training: (v) => ({ value: Math.round(v), unit: 'MIN' }),
    recovery: (v) => ({ value: Math.round(v), unit: 'MS' }),
  };
  return SIGNALS.map((s) => {
    const now = val[s.id](a), prev = b.length ? val[s.id](b) : null;
    if (now == null) return { ...s, now: null };
    return { ...s, now, prev, ...fmt[s.id](now), delta: prev ? (now - prev) / prev : null, usePerf };
  });
}

// Frase de la semana: los dos cambios más grandes, en palabras
export function weekSentence(ws) {
  const parts = ws.filter((s) => s.now != null && s.prev != null && s.delta != null && Math.abs(s.delta) >= 0.05)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 2).map((s) => {
      const up = s.delta > 0;
      if (s.id === 'sleep' && !s.usePerf) return `dormiste ${Math.round(Math.abs(s.now - s.prev) * 60)} min ${up ? 'más' : 'menos'} por noche`;
      if (s.id === 'steps') return `caminaste ${Math.round(Math.abs(s.delta) * 100)}% ${up ? 'más' : 'menos'}`;
      if (s.id === 'training') return `entrenaste ${Math.round(Math.abs(s.now - s.prev))} min ${up ? 'más' : 'menos'}`;
      if (s.id === 'recovery') return `tu HRV ${up ? 'subió' : 'bajó'} ${Math.round(Math.abs(s.delta) * 100)}%`;
      return `tu sueño ${up ? 'subió' : 'bajó'} ${Math.round(Math.abs(s.delta) * 100)}%`;
    });
  if (!ws.some((s) => s.prev != null)) return 'Todavía no hay una semana anterior para comparar.';
  if (!parts.length) return 'Esta semana fue muy parecida a la anterior.';
  const t = parts.join(' y ');
  return `Esta semana ${t}.`;
}

// Trazas para HOME y LOG: cada hábito seguido, con su tira de 28 días
export function indicators(days, idx) {
  return trackedAt(days, idx).map((h) => {
    const t = trace(days, idx, h);
    const since = daysSince(days, idx, h);
    return {
      id: h.id, code: h.code, label: h.label, domain: h.domain,
      freq: t.freq, vals: t.vals, count: t.vals.filter((v) => (v ?? 0) >= 0.5).length,
      since, value: since == null ? '—' : `T−${since}`, unit: 'D',
    };
  });
}
