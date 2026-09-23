// Normalizador: de payloads heterogéneos a un único resumen diario canónico.
// Aquí viven las decisiones que en producción importan más que el render:
// prioridad de fuentes, deduplicación de entrenamientos y separación de
// métricas que NO son comparables entre sí (HRV RMSSD de WHOOP vs SDNN de Apple).

import { isoDay } from './simulator.js';

const HK_WORKOUT = {
  HKWorkoutActivityTypeRunning: 'running',
  HKWorkoutActivityTypeSurfingSports: 'surf',
  HKWorkoutActivityTypeUnderwaterDiving: 'diving',
  HKWorkoutActivityTypeTraditionalStrengthTraining: 'strength',
};
const WHOOP_SPORT = { running: 'running', surfing: 'surf' };

function blank(date) {
  return {
    date, recovery: null, strain: null, rhr: null, sleepPerformance: null,
    hrv: null,            // { value, method: 'rmssd'|'sdnn', source }
    steps: null, activeKcal: null, mindfulMin: 0,
    workouts: [],         // { type, minutes, km, sources: [] }
    habits: {},           // { alcohol: bool, sugar: bool, smoking: bool }
    sources: new Set(),
  };
}

export function normalize({ whoop, appleHealth, manual }) {
  const days = new Map();
  const get = (d) => { if (!days.has(d)) days.set(d, blank(d)); return days.get(d); };

  // WHOOP: fuente preferida para recuperación, esfuerzo y sueño.
  const cycleDay = new Map();
  for (const c of whoop?.cycles ?? []) {
    if (c.score_state !== 'SCORED') continue;
    const d = isoDay(c.start); cycleDay.set(c.id, d);
    const day = get(d); day.strain = c.score.strain; day.sources.add('whoop');
  }
  for (const r of whoop?.recoveries ?? []) {
    const d = cycleDay.get(r.cycle_id); if (!d || r.score_state !== 'SCORED') continue;
    const day = get(d);
    day.recovery = r.score.recovery_score;
    day.rhr = r.score.resting_heart_rate;
    day.hrv = { value: r.score.hrv_rmssd_milli, method: 'rmssd', source: 'whoop' };
  }
  for (const s of whoop?.sleeps ?? []) {
    if (s.score_state !== 'SCORED') continue;
    get(isoDay(s.end)).sleepPerformance = s.score.sleep_performance_percentage;
  }
  for (const w of whoop?.workouts ?? []) {
    const type = WHOOP_SPORT[w.sport_name] ?? 'other';
    get(isoDay(w.start)).workouts.push({ type, start: Date.parse(w.start), minutes: null, km: w.score.distance_meter ? w.score.distance_meter / 1000 : null, sources: ['whoop'] });
  }

  // Apple Health: pasos, energía, mindfulness, entrenamientos con distancia.
  for (const q of appleHealth?.quantitySamples ?? []) {
    const day = get(q.startDate.slice(0, 10)); day.sources.add('apple');
    if (q.type === 'HKQuantityTypeIdentifierStepCount') day.steps = (day.steps ?? 0) + q.value;
    else if (q.type === 'HKQuantityTypeIdentifierActiveEnergyBurned') day.activeKcal = (day.activeKcal ?? 0) + q.value;
    else if (q.type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' && !day.hrv)
      day.hrv = { value: q.value, method: 'sdnn', source: 'apple' }; // sólo si no hay RMSSD
  }
  for (const c of appleHealth?.categorySamples ?? []) {
    if (c.type === 'HKCategoryTypeIdentifierMindfulSession') get(c.startDate.slice(0, 10)).mindfulMin += c.durationMin;
  }
  for (const w of appleHealth?.workouts ?? []) {
    const type = HK_WORKOUT[w.workoutActivityType] ?? 'other';
    const start = Date.parse(w.startDate);
    const day = get(isoDay(start));
    // deduplicación: mismo tipo y arranque a menos de 20 min → mismo entrenamiento
    const dup = day.workouts.find((x) => x.type === type && Math.abs(x.start - start) < 20 * 60e3);
    const km = w.totalDistance ? w.totalDistance / 1000 : null;
    if (dup) { dup.minutes = w.duration; dup.km = km ?? dup.km; dup.sources.push('apple'); }
    else day.workouts.push({ type, start, minutes: w.duration, km, sources: ['apple'] });
  }

  for (const m of manual ?? []) { const day = get(m.date); day.habits[m.habit] = m.value; day.sources.add('manual'); }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, sources: [...d.sources] }));
}
