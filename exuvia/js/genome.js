// Motor de reglas: datos → rasgos (features) → genoma visual.
// Dos escalas de tiempo, a propósito:
//   · ESTRUCTURA (lenta): historia de semanas/meses → forma, densidad, simetría.
//   · ESTADO (rápida): el día de hoy → velocidad, pulso, brillo.
// La forma es la memoria; el movimiento es el presente.
// Ninguna regla es "punitiva": un mal día atenúa y aquieta, no deforma ni enferma.
// Un dato ausente no es un dato malo: los rasgos sin datos valen null y las reglas
// se recalculan con los que sí hay.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export const HABITS = [
  { id: 'sugar', label: 'Sin azúcar', kind: 'abstinence' },
  { id: 'alcohol', label: 'No alcohol', kind: 'abstinence' },
  { id: 'smoking', label: 'Sin fumar', kind: 'abstinence' },
];

export const FEATURES = {
  activityLoad: { label: 'Carga de actividad (28 d)', scale: 'estructura' },
  endurance: { label: 'Distancia acumulada (90 d)', scale: 'estructura' },
  consistency: { label: 'Regularidad de la práctica (8 sem.)', scale: 'estructura' },
  abstinence: { label: 'Abstinencia sostenida (90 d)', scale: 'estructura' },
  mindfulness: { label: 'Práctica de meditación (28 d)', scale: 'estructura' },
  exploration: { label: 'Variedad de actividades (60 d)', scale: 'estructura' },
  sleepQuality: { label: 'Calidad de sueño (14 d)', scale: 'estructura' },
  recovery: { label: 'Recuperación de hoy', scale: 'estado' },
  strainToday: { label: 'Esfuerzo de hoy', scale: 'estado' },
  hrvTrend: { label: 'Tendencia HRV (7 d vs 60 d)', scale: 'estado' },
};

// Cada parámetro = min + (max-min) · Σ(peso · feature) / Σ(pesos con dato).
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
  // la recuperación de WHOOP ya se calcula con HRV y sueño: usarla junto a ellos contaría dos veces lo mismo
  pulseAmp: { min: 0.3, max: 1, from: { hrvTrend: 1 }, meaning: 'Amplitud de respiración' },
  glow: { min: 0.35, max: 1, from: { recovery: 0.6, sleepQuality: 0.4 }, meaning: 'Luminosidad' },
  cyan: { min: 0.05, max: 1, from: { mindfulness: 0.5, sleepQuality: 0.5 }, meaning: 'Cian: calma, descanso' },
  blue: { min: 0.05, max: 1, from: { consistency: 0.6, endurance: 0.4 }, meaning: 'Azul: disciplina, fondo' },
  violet: { min: 0.05, max: 1, from: { abstinence: 0.7, hrvTrend: 0.3 }, meaning: 'Violeta: abstinencia sostenida' },
  orange: { min: 0.02, max: 0.7, from: { strainToday: 0.5, exploration: 0.5 }, meaning: 'Naranja: energía, exploración' },
};

// Parámetros que describen la ESTRUCTURA (se usan para decidir una mutación).
export const STRUCTURAL = ['coherence', 'density', 'lobes', 'lobeAmp', 'twist', 'elong', 'skirt', 'filament'];

const didMeditate = (d) => d.mindfulMin >= 5;
const practiced = (d) => didMeditate(d) || d.workouts.length > 0;

export function streak(days, idx, test) {
  let n = 0;
  for (let i = idx; i >= 0 && test(days[i]); i--) n++;
  return n;
}

// Primer día en que se registró cada hábito. Un hábito sólo cuenta desde que existe
// en la historia, y sólo con datos hasta el día evaluado: quien nunca fumó no gana
// densidad por "no fumar", y el pasado no se reescribe con el futuro.
const firstCache = new WeakMap();
function firstOccurrence(days) {
  if (!firstCache.has(days)) {
    const first = {};
    for (const h of HABITS) {
      const i = days.findIndex((d) => d.habits[h.id] === true);
      first[h.id] = i < 0 ? Infinity : i;
    }
    firstCache.set(days, first);
  }
  return firstCache.get(days);
}
export const trackedAt = (days, idx) => HABITS.filter((h) => firstOccurrence(days)[h.id] <= idx);

// Días desde la última vez registrada. Un día sin registro no rompe la racha:
// olvidarse de anotar no es recaer.
export function daysSince(days, idx, id) {
  for (let i = idx; i >= 0; i--) if (days[i].habits[id] === true) return idx - i;
  return idx + 1;
}

export function extractFeatures(days, idx) {
  const win = (n) => days.slice(Math.max(0, idx - n + 1), idx + 1);
  const d = days[idx];
  const w28 = win(28), w90 = win(90), w60 = win(60), w14 = win(14);

  const strains = w28.map((x) => x.strain).filter((x) => x != null);
  const km90 = w90.flatMap((x) => x.workouts).reduce((s, w) => s + (w.km ?? 0), 0);

  // Abstinencia: sobre todo la proporción de días limpios en 90 d (lenta), un poco la
  // racha actual. Una recaída deja marca, pero no borra meses en un día.
  const first = firstOccurrence(days);
  const abstinence = mean(trackedAt(days, idx).map((h) => {
    const from = Math.max(first[h.id], idx - 89);
    const span = days.slice(from, idx + 1);
    const clean = span.filter((x) => x.habits[h.id] !== true).length / span.length;
    const run = clamp01(Math.log1p(daysSince(days, idx, h.id)) / Math.log1p(180));
    return 0.75 * clean + 0.25 * run;
  }));

  // Regularidad: cuántos días por semana hay práctica (entrenamiento o meditación)
  // y cuán estable es ese número entre semanas. Independiente de la abstinencia.
  // Ocho semanas: con cuatro, un ciclo de exceso/abandono de dos meses parece constancia.
  const weeks = [];
  for (let e = idx; e - 6 >= 0 && weeks.length < 8; e -= 7) weeks.push(days.slice(e - 6, e + 1).filter(practiced).length);
  let consistency = null;
  if (weeks.length) {
    const m = mean(weeks);
    const sd = Math.sqrt(mean(weeks.map((x) => (x - m) ** 2)));
    consistency = clamp01(m / 5) * (0.5 + 0.5 * (1 - clamp01(sd / (m + 1))));
  }

  const counts = {};
  for (const w of w60.flatMap((x) => x.workouts)) counts[w.type] = (counts[w.type] ?? 0) + 1;
  const total = Object.values(counts).reduce((s, x) => s + x, 0);
  const entropy = total ? -Object.values(counts).reduce((s, c) => s + (c / total) * Math.log(c / total), 0) : 0;
  const breadth = Math.min(1, total / 30); // sin volumen no hay exploración, aunque haya variedad

  // HRV: sólo comparar valores del mismo método (RMSSD con RMSSD)
  const method = d.hrv?.method;
  const hrvOf = (arr) => arr.filter((x) => x.hrv && x.hrv.method === method).map((x) => x.hrv.value);
  const h7 = mean(hrvOf(win(7))), h60 = hrvOf(w60);
  const hrvTrend = method && h7 && h60.length >= 21 ? clamp01(0.5 + ((h7 - mean(h60)) / mean(h60)) * 2.5) : null;

  // Sueño: el "sleep performance" de WHOOP y las horas de Apple no son la misma medida.
  // Se usa uno solo por ventana: el puntaje de WHOOP si existe, si no la duración.
  const perf = w14.map((x) => x.sleepPerformance).filter((x) => x != null);
  const hours = w14.map((x) => x.sleepHours).filter((x) => x != null);
  const sleepQuality = perf.length >= 4 ? clamp01((mean(perf) - 50) / 45)
    : hours.length >= 4 ? clamp01((mean(hours) - 5) / 3) : null;

  return {
    activityLoad: strains.length >= 7 ? clamp01(mean(strains) / 14) : null,
    endurance: clamp01(Math.log1p(km90) / Math.log1p(450)),
    consistency,
    abstinence,
    mindfulness: clamp01(w28.filter(didMeditate).length / 28),
    exploration: clamp01((entropy / Math.log(5)) * 0.7 + breadth * 0.3),
    sleepQuality,
    recovery: d.recovery != null ? d.recovery / 100 : null,
    strainToday: d.strain != null ? clamp01(d.strain / 21) : null,
    hrvTrend,
  };
}

export function toGenome(features, seedShift) {
  const g = { seedShift };
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
  for (const h of trackedAt(days, idx)) {
    const n = daysSince(days, idx, h.id);
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
