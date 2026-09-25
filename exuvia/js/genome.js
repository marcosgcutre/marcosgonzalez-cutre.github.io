// Motor de reglas: datos → rasgos (features) → genoma visual.
// Dos escalas de tiempo, a propósito:
//   · ESTRUCTURA (lenta): historia de semanas/meses → forma, densidad, simetría.
//   · ESTADO (rápida): el día de hoy → velocidad, pulso, brillo.
// La forma es la memoria; el movimiento es el presente.
// No hay formas mejores ni peores. Cada rasgo mueve la forma entre dos extremos
// igual de completos (ordenada ↔ turbulenta, compacta ↔ dispersa, lenta ↔ rápida);
// ningún dato quita materia ni brillo. Tomar o no tomar alcohol es un dato más:
// cambia la forma, no la califica.
// Un dato ausente no es un dato malo: los rasgos sin datos valen null y las reglas
// se recalculan con los que sí hay.

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

import { firstSeen, trackedAt, daysSince, trace } from './catalog.js';

export const FEATURES = {
  activityLoad: { label: 'Carga de actividad (28 d)', scale: 'estructura' },
  endurance: { label: 'Distancia acumulada (90 d)', scale: 'estructura' },
  consistency: { label: 'Regularidad de la práctica (8 sem.)', scale: 'estructura' },
  consumption: { label: 'Frecuencia de consumo (90 d)', scale: 'estructura' },
  mindfulness: { label: 'Práctica de meditación (28 d)', scale: 'estructura' },
  exploration: { label: 'Variedad de actividades (60 d)', scale: 'estructura' },
  sleepQuality: { label: 'Calidad de sueño (14 d)', scale: 'estructura' },
  recovery: { label: 'Recuperación de hoy', scale: 'estado' },
  strainToday: { label: 'Esfuerzo de hoy', scale: 'estado' },
  hrvTrend: { label: 'Tendencia HRV (7 d vs 60 d)', scale: 'estado' },
};

// Brillo fijo: la luminosidad no depende de ningún dato.
export const GLOW = 0.85;

// Cada parámetro = min + (max-min) · Σ(peso · feature) / Σ(pesos con dato).
export const RULES = {
  expansion: { min: 0.9, max: 1.1, from: { endurance: 0.4, activityLoad: 0.3, exploration: 0.3 }, meaning: 'Tamaño de la galaxia (rango corto: más grande no es más)' },
  coherence: { min: 0, max: 1, from: { consistency: 0.5, sleepQuality: 0.25, mindfulness: 0.25 }, meaning: 'Brazos ordenados ↔ turbulentos' },
  density: { min: 0, max: 1, from: { consumption: 0.5, consistency: 0.3, sleepQuality: 0.2 }, meaning: 'Núcleo difuso ↔ compacto (misma materia)' },
  flow: { min: 0.15, max: 1.1, from: { strainToday: 0.45, activityLoad: 0.35, recovery: 0.2 }, meaning: 'Lenta ↔ rápida' },
  lobes: { min: 1, max: 6, from: { exploration: 0.7, activityLoad: 0.3 }, meaning: 'Cantidad de brazos espirales' },
  lobeAmp: { min: 0.1, max: 1, from: { exploration: 0.5, endurance: 0.5 }, meaning: 'Barra central' },
  twist: { min: 0, max: 1.2, from: { endurance: 0.5, consistency: 0.5 }, meaning: 'Enrollamiento de los brazos' },
  elong: { min: 0, max: 1, from: { mindfulness: 0.5, sleepQuality: 0.5 }, meaning: 'Grosor del disco' },
  skirt: { min: 0.1, max: 1, from: { exploration: 0.6, endurance: 0.4 }, meaning: 'Extensión del disco' },
  filament: { min: 0, max: 1, from: { consistency: 0.6, consumption: 0.4 }, meaning: 'Brazos difusos ↔ nítidos' },
  pulse: { min: 0.12, max: 0.45, from: { strainToday: 0.6, activityLoad: 0.4 }, meaning: 'Frecuencia de respiración visual (Hz)' },
  // la recuperación de WHOOP ya se calcula con HRV y sueño: nunca comparten regla
  pulseAmp: { min: 0.3, max: 1, from: { hrvTrend: 1 }, meaning: 'Amplitud de respiración' },
  cyan: { min: 0.05, max: 1, from: { mindfulness: 0.5, sleepQuality: 0.5 }, meaning: 'Cian' },
  blue: { min: 0.05, max: 1, from: { consistency: 0.6, endurance: 0.4 }, meaning: 'Azul' },
  violet: { min: 0.05, max: 1, from: { consumption: 0.6, hrvTrend: 0.4 }, meaning: 'Violeta' },
  orange: { min: 0.02, max: 0.7, from: { strainToday: 0.5, exploration: 0.5 }, meaning: 'Naranja' },
};

// Parámetros que describen la ESTRUCTURA (se usan para decidir una mutación).
export const STRUCTURAL = ['coherence', 'density', 'lobes', 'lobeAmp', 'twist', 'elong', 'skirt', 'filament'];

const didMeditate = (d) => d.mindfulMin >= 5 || d.habits.breathwork === true;
const practiced = (d) => didMeditate(d) || d.workouts.length > 0;

export function extractFeatures(days, idx) {
  const win = (n) => days.slice(Math.max(0, idx - n + 1), idx + 1);
  const d = days[idx];
  const w28 = win(28), w90 = win(90), w60 = win(60), w14 = win(14);

  const strains = w28.map((x) => x.strain).filter((x) => x != null);
  // sumas escaladas al largo real de la ventana: con 30 días de historia no se "tiene menos"
  const km90 = w90.flatMap((x) => x.workouts).reduce((s, w) => s + (w.km ?? 0), 0) * (90 / w90.length);

  // Consumo: proporción de días con el hábito en los últimos 90 d (desde que existe).
  // Es un dato, no una nota: más o menos consumo mueve la forma hacia un lado u otro.
  // Sustancias seguidas: alcohol, tabaco, cannabis, cocaína, cafeína, azúcar, ultraprocesados.
  const first = firstSeen(days);
  const consumption = mean(trackedAt(days, idx).filter((h) => h.domain === 'SUS').map((h) => {
    const span = days.slice(Math.max(first[h.id], idx - 89), idx + 1);
    return span.filter((x) => x.habits[h.id] === true).length / span.length;
  }));

  // Regularidad: cuántos días por semana hay práctica (entrenamiento o meditación)
  // y cuán estable es ese número entre semanas. Independiente del consumo.
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
  const breadth = Math.min(1, (total * (60 / w60.length)) / 30); // sin volumen no hay exploración, aunque haya variedad

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
    consumption,
    mindfulness: clamp01(w28.filter(didMeditate).length / 28),
    exploration: clamp01((entropy / Math.log(5)) * 0.7 + breadth * 0.3),
    sleepQuality,
    recovery: d.recovery != null ? d.recovery / 100 : null,
    strainToday: d.strain != null ? clamp01(d.strain / 21) : null,
    hrvTrend,
  };
}

export function toGenome(features, seedShift) {
  const g = { seedShift, glow: GLOW };
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

// Lecturas de la forma: ejes geométricos, 0.00–1.00, sin adjetivos.
export function traits(g) {
  const n = (k) => clamp01(normalizedParam(g, k));
  return {
    'ENTROPÍA': 1 - n('coherence'),
    'DISPERSIÓN': 1 - n('density'),
    'TORSIÓN': n('twist'),
    'ELONGACIÓN': n('elong'),
    'VELOCIDAD': n('flow'),
  };
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
