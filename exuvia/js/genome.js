// Motor de reglas: datos → rasgos (features) → genoma visual.
// Dos escalas de tiempo, a propósito:
//   · ESTRUCTURA (lenta): historia de semanas/meses → forma, densidad, simetría.
//   · ESTADO (rápida): el día de hoy → velocidad, pulso, brillo.
// La forma es la memoria; el movimiento es el presente.
// Ninguna regla es "punitiva": un mal día atenúa y aquieta, no deforma ni enferma.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export const HABITS = [
  { id: 'sugar', label: 'Sin azúcar', kind: 'abstinence' },
  { id: 'alcohol', label: 'No alcohol', kind: 'abstinence' },
  { id: 'smoking', label: 'Sin fumar', kind: 'abstinence' },
  { id: 'meditation', label: 'Meditación', kind: 'practice' },
];

export const FEATURES = {
  activityLoad: { label: 'Carga de actividad (28 d)', scale: 'estructura' },
  endurance: { label: 'Distancia acumulada (90 d)', scale: 'estructura' },
  consistency: { label: 'Constancia de hábitos (28 d)', scale: 'estructura' },
  abstinence: { label: 'Rachas de abstinencia', scale: 'estructura' },
  mindfulness: { label: 'Práctica de meditación (28 d)', scale: 'estructura' },
  exploration: { label: 'Variedad de actividades (60 d)', scale: 'estructura' },
  sleepQuality: { label: 'Calidad de sueño (14 d)', scale: 'estructura' },
  recovery: { label: 'Recuperación de hoy', scale: 'estado' },
  strainToday: { label: 'Esfuerzo de hoy', scale: 'estado' },
  hrvTrend: { label: 'Tendencia HRV (7 d vs 60 d)', scale: 'estado' },
};

// Cada parámetro = min + (max-min) · Σ(peso · feature). Pesos suman 1.
export const RULES = {
  expansion: { min: 0.8, max: 1.2, from: { endurance: 0.35, activityLoad: 0.25, exploration: 0.2, recovery: 0.2 }, meaning: 'Espacio que ocupa' },
  coherence: { min: 0, max: 1, from: { consistency: 0.4, sleepQuality: 0.3, mindfulness: 0.3 }, meaning: 'Orden frente a ruido' },
  density: { min: 0.1, max: 1, from: { abstinence: 0.5, consistency: 0.3, sleepQuality: 0.2 }, meaning: 'Materia visible, compacidad' },
  flow: { min: 0.15, max: 1.1, from: { strainToday: 0.45, activityLoad: 0.35, hrvTrend: 0.2 }, meaning: 'Velocidad del movimiento' },
  lobes: { min: 1, max: 6, from: { exploration: 0.7, activityLoad: 0.3 }, meaning: 'Complejidad de la silueta' },
  lobeAmp: { min: 0.1, max: 1, from: { exploration: 0.5, endurance: 0.5 }, meaning: 'Profundidad de los pliegues' },
  twist: { min: 0, max: 1.2, from: { endurance: 0.5, consistency: 0.5 }, meaning: 'Torsión sobre el eje' },
  elong: { min: 0, max: 1, from: { mindfulness: 0.5, sleepQuality: 0.5 }, meaning: 'Verticalidad' },
  skirt: { min: 0.1, max: 1, from: { exploration: 0.6, endurance: 0.4 }, meaning: 'Base, arraigo al terreno' },
  filament: { min: 0, max: 1, from: { consistency: 0.6, abstinence: 0.4 }, meaning: 'Estructura en filamentos' },
  pulse: { min: 0.12, max: 0.45, from: { strainToday: 0.6, activityLoad: 0.4 }, meaning: 'Frecuencia de respiración visual (Hz)' },
  pulseAmp: { min: 0.3, max: 1, from: { recovery: 0.5, hrvTrend: 0.5 }, meaning: 'Amplitud de respiración' },
  glow: { min: 0.35, max: 1, from: { recovery: 0.6, sleepQuality: 0.4 }, meaning: 'Luminosidad' },
  cyan: { min: 0.05, max: 1, from: { mindfulness: 0.5, sleepQuality: 0.5 }, meaning: 'Cian: calma, descanso' },
  blue: { min: 0.05, max: 1, from: { consistency: 0.6, endurance: 0.4 }, meaning: 'Azul: disciplina, fondo' },
  violet: { min: 0.05, max: 1, from: { abstinence: 0.7, hrvTrend: 0.3 }, meaning: 'Violeta: abstinencia sostenida' },
  orange: { min: 0.02, max: 0.7, from: { strainToday: 0.5, exploration: 0.5 }, meaning: 'Naranja: energía, exploración' },
};

// Parámetros que describen la ESTRUCTURA (se usan para decidir una mutación).
export const STRUCTURAL = ['coherence', 'density', 'lobes', 'lobeAmp', 'twist', 'elong', 'skirt', 'filament'];

export function streak(days, idx, test) {
  let n = 0;
  for (let i = idx; i >= 0 && test(days[i]); i--) n++;
  return n;
}

const didMeditate = (d) => d.mindfulMin >= 5;

// Sustituto de la configuración del usuario (qué hábitos eligió seguir).
// Una abstinencia sólo cuenta si el hábito existió alguna vez en la historia:
// quien nunca fumó no gana densidad por "no fumar".
const trackedCache = new WeakMap();
export function trackedAbstinence(days) {
  if (!trackedCache.has(days)) {
    trackedCache.set(days, HABITS.filter((h) => h.kind === 'abstinence' && days.some((d) => d.habits[h.id] === true)));
  }
  return trackedCache.get(days);
}

// features del día idx usando sólo datos hasta idx (nunca el futuro)
export function extractFeatures(days, idx) {
  const win = (n) => days.slice(Math.max(0, idx - n + 1), idx + 1);
  const d = days[idx];
  const w28 = win(28), w90 = win(90), w60 = win(60), w14 = win(14);

  const strainMean = mean(w28.map((x) => x.strain ?? 0)) ?? 0;
  const km90 = w90.flatMap((x) => x.workouts).reduce((s, w) => s + (w.km ?? 0), 0);

  const abst = trackedAbstinence(days);
  const abstinence = mean(abst.map((h) => clamp01(Math.log1p(streak(days, idx, (x) => x.habits[h.id] === false)) / Math.log1p(180))));
  const adherence = (x) => mean([...abst.map((h) => (x.habits[h.id] === false ? 1 : 0)), didMeditate(x) ? 1 : 0]);

  const counts = {};
  for (const w of w60.flatMap((x) => x.workouts)) counts[w.type] = (counts[w.type] ?? 0) + 1;
  const total = Object.values(counts).reduce((s, x) => s + x, 0);
  const entropy = total ? -Object.values(counts).reduce((s, c) => s + (c / total) * Math.log(c / total), 0) : 0;
  const breadth = Math.min(1, total / 30); // sin volumen no hay exploración, aunque haya variedad

  // HRV: sólo comparar valores del mismo método (RMSSD con RMSSD)
  const method = d.hrv?.method;
  const hrvOf = (arr) => arr.filter((x) => x.hrv && x.hrv.method === method).map((x) => x.hrv.value);
  const h7 = mean(hrvOf(win(7))), h60 = mean(hrvOf(w60));
  const hrvTrend = h7 && h60 ? clamp01(0.5 + ((h7 - h60) / h60) * 2.5) : 0.5;

  return {
    activityLoad: clamp01(strainMean / 14),
    endurance: clamp01(Math.log1p(km90) / Math.log1p(450)),
    consistency: clamp01(mean(w28.map(adherence)) ?? 0),
    abstinence: abstinence ?? 0,
    mindfulness: clamp01(w28.filter(didMeditate).length / 28),
    exploration: clamp01((entropy / Math.log(5)) * 0.7 + breadth * 0.3),
    sleepQuality: clamp01(((mean(w14.map((x) => x.sleepPerformance).filter((x) => x != null)) ?? 70) - 50) / 45),
    recovery: d.recovery != null ? d.recovery / 100 : 0.6,
    strainToday: clamp01((d.strain ?? 8) / 21),
    hrvTrend,
  };
}

export function toGenome(features, seedShift) {
  const g = { seedShift };
  for (const [k, r] of Object.entries(RULES)) {
    let s = 0;
    for (const [f, w] of Object.entries(r.from)) s += w * (features[f] ?? 0);
    g[k] = r.min + (r.max - r.min) * clamp01(s);
  }
  return g;
}

export function normalizedParam(g, k) {
  const r = RULES[k]; return (g[k] - r.min) / (r.max - r.min);
}

export function structuralDistance(a, b) {
  return mean(STRUCTURAL.map((k) => Math.abs(normalizedParam(a, k) - normalizedParam(b, k))));
}

export function traits(g) {
  const n = (k) => normalizedParam(g, k);
  const pct = (x) => Math.round(clamp01(x) * 100);
  return {
    ESTABLE: pct(n('coherence')),
    EXPANSIVO: pct(n('expansion') * 0.6 + n('lobeAmp') * 0.4),
    'CAÓTICO': pct((1 - n('coherence')) * 0.6 + n('flow') * 0.4),
    DENSO: pct(n('density')),
    'LÚCIDO': pct(n('elong') * 0.5 + n('glow') * 0.5),
  };
}

// Indicadores legibles para HOME
export function indicators(days, idx) {
  const out = [];
  for (const h of trackedAbstinence(days)) {
    const n = streak(days, idx, (x) => x.habits[h.id] === false);
    if (n >= 3) out.push({ id: h.id, label: h.label, value: n, unit: 'días', progress: Math.min(1, n / 180) });
  }
  const med = streak(days, idx, didMeditate);
  const med28 = days.slice(Math.max(0, idx - 27), idx + 1).filter(didMeditate).length;
  if (med28) out.push({ id: 'meditation', label: 'Meditación', value: med, unit: 'días seguidos', progress: med28 / 28 });
  const w90 = days.slice(Math.max(0, idx - 89), idx + 1).flatMap((x) => x.workouts);
  const km = w90.filter((w) => w.type === 'running').reduce((s, w) => s + (w.km ?? 0), 0);
  if (km) out.push({ id: 'running', label: 'Running · 90 d', value: Math.round(km), unit: 'km', progress: Math.min(1, km / 450) });
  const surf = w90.filter((w) => w.type === 'surf').length;
  if (surf) out.push({ id: 'surf', label: 'Surf · 90 d', value: surf, unit: 'sesiones', progress: Math.min(1, surf / 40) });
  const dive = w90.filter((w) => w.type === 'diving').length;
  if (dive) out.push({ id: 'diving', label: 'Buceo · 90 d', value: dive, unit: dive === 1 ? 'vez' : 'veces', progress: Math.min(1, dive / 10) });
  return out;
}
