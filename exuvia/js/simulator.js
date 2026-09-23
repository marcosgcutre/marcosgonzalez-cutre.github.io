// Simulación de fuentes de datos, antes de integrar APIs reales.
// Genera payloads con la FORMA aproximada de cada fuente (WHOOP API v2,
// muestras de HealthKit, registro manual) para que el resto del sistema
// trabaje exactamente como trabajará con datos reales: adaptador → normalizador.
// Los nombres de campo de WHOOP siguen la documentación pública v2 tal como la
// conocemos; deben contrastarse contra el OpenAPI oficial al integrar.

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

// Cada persona describe conductas por día relativo a "hoy" (0 = hoy, 240 = hace 240 días).
// p(ago) devuelve probabilidades; los cambios de hábito tienen fecha.
export const PERSONAS = {
  marcos: {
    label: 'Referencia (imagen)',
    seed: 4721,
    days: 240,
    behave: (ago) => ({
      alcohol: ago > 67 ? 0.3 : 0,
      sugar: ago > 123 ? 0.7 : 0,
      smoking: 0,
      meditation: ago <= 51 ? 0.92 : 0.05,
      run: ago <= 150 ? 0.4 : 0.08,
      runKm: [5, 11],
      surf: ago <= 120 ? 0.22 : 0.02,
      diving: ago <= 90 ? 0.035 : 0,
      strength: 0.15,
    }),
  },
  appleOnly: {
    label: 'Sólo Apple Watch (sin WHOOP)',
    seed: 3310,
    days: 240,
    sources: ['apple', 'manual'],
    behave: (ago) => PERSONAS.marcos.behave(ago),
  },
  starter: {
    label: 'Empieza desde cero',
    seed: 1337,
    days: 240,
    behave: (ago) => ({
      alcohol: ago > 40 ? 0.45 : 0.08,
      sugar: 0.8 - (ago < 60 ? 0.5 : 0),
      smoking: ago > 30 ? 0.9 : 0,
      meditation: ago < 20 ? 0.5 : 0,
      run: ago < 90 ? 0.18 + (90 - ago) / 400 : 0.02,
      runKm: [2, 5],
      surf: 0, diving: 0,
      strength: ago < 60 ? 0.2 : 0.02,
    }),
  },
  steady: {
    label: 'Vida estable, sin cambios',
    seed: 2718,
    days: 240,
    behave: () => ({
      alcohol: 0.25, sugar: 0.4, smoking: 0,
      meditation: 0, run: 0.35, runKm: [6, 9],
      surf: 0, diving: 0, strength: 0.15,
    }),
  },
  chaotic: {
    label: 'Atleta irregular',
    seed: 9001,
    days: 240,
    behave: (ago) => {
      const wave = Math.sin(ago / 9) > 0; // bloques de exceso y abandono
      return {
        alcohol: wave ? 0.05 : 0.5,
        sugar: 0.5, smoking: 0,
        meditation: 0.03,
        run: wave ? 0.75 : 0.05, runKm: [8, 22],
        surf: wave ? 0.1 : 0, diving: 0.01,
        strength: wave ? 0.5 : 0,
      };
    },
  },
};

// Devuelve { whoop, appleHealth, manual } como llegarían de cada fuente.
export function simulate(personaKey, { today = Date.now() } = {}) {
  const P = PERSONAS[personaKey];
  const rnd = mulberry32(P.seed);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 0.5;
  const start = Math.floor(today / DAY) * DAY - P.days * DAY;

  const whoop = { cycles: [], recoveries: [], sleeps: [], workouts: [] };
  const appleHealth = { quantitySamples: [], categorySamples: [], workouts: [] };
  const manual = [];

  let fitness = 0.2;      // estado latente, no observable directamente
  let abstEffect = 0;     // efecto fisiológico acumulado de no consumir (suposición de la simulación)
  let prevAlcohol = false, prevStrain = 8;
  let hrvBase = 48, rhrBase = 62;

  for (let i = 0; i <= P.days; i++) {
    const ago = P.days - i;
    const t0 = start + i * DAY;
    const date = isoDay(t0);
    const b = P.behave(ago);
    const did = {
      alcohol: rnd() < b.alcohol, sugar: rnd() < b.sugar, smoking: rnd() < b.smoking,
      meditation: rnd() < b.meditation, run: rnd() < b.run, surf: rnd() < b.surf,
      diving: rnd() < b.diving, strength: rnd() < b.strength,
    };
    const km = did.run ? +(b.runKm[0] + rnd() * (b.runKm[1] - b.runKm[0])).toFixed(1) : 0;

    // registro manual: lo que ningún wearable sabe. Las ocurrencias se anotan;
    // los días "limpios" sólo a veces se confirman — hay días sin registro.
    for (const habit of ['alcohol', 'sugar', 'smoking']) {
      const confirm = rnd() < 0.6;
      if (did[habit]) manual.push({ date, habit, value: true });
      else if (confirm) manual.push({ date, habit, value: false });
    }

    // fisiología latente
    const load = (did.run ? 5 + km * 0.55 : 0) + (did.surf ? 9 : 0) + (did.diving ? 5 : 0) + (did.strength ? 6 : 0);
    fitness += (Math.min(load, 16) / 16 - fitness) * 0.03;
    abstEffect += ((did.alcohol ? 0 : 0.6) + (did.smoking ? 0 : 0.4) - abstEffect) * 0.02;
    const hrvTrue = hrvBase + 14 * fitness + 8 * abstEffect;
    const hrv = Math.max(15, hrvTrue * (1 - (prevAlcohol ? 0.18 : 0) - (prevStrain > 15 ? 0.07 : 0)) * (1 + gauss() * 0.07));
    const rhr = rhrBase - 7 * fitness + (prevAlcohol ? 4 : 0) + gauss() * 1.5;
    const sleepPerf = Math.max(35, Math.min(100, 76 + (did.meditation ? 7 : 0) - (prevAlcohol ? 14 : 0) + gauss() * 7));
    const sleepHours = +(5.8 + sleepPerf / 100 * 2.4 + gauss() * 0.3).toFixed(2);
    const recovery = Math.round(Math.max(1, Math.min(99,
      55 + (hrv - hrvTrue) / hrvTrue * 120 + (sleepPerf - 78) * 0.7 - (rhr - (rhrBase - 7 * fitness)) * 2.5)));
    const steps = Math.round(4200 + rnd() * 3500 + km * 1300 + (did.surf ? 1500 : 0));
    const strain = +(21 * (1 - Math.exp(-(load + steps / 3000 + 3) / 13))).toFixed(1);

    // ---- WHOOP v2 (forma aproximada) ----
    const cycleId = 90000 + i;
    whoop.cycles.push({
      id: cycleId, start: new Date(t0 + 7 * 3600e3).toISOString(), end: new Date(t0 + 31 * 3600e3).toISOString(),
      score_state: 'SCORED',
      score: { strain, kilojoule: Math.round(8000 + load * 450), average_heart_rate: Math.round(rhr + 14), max_heart_rate: Math.round(150 + load * 2) },
    });
    whoop.recoveries.push({
      cycle_id: cycleId, score_state: 'SCORED',
      score: { recovery_score: recovery, resting_heart_rate: Math.round(rhr), hrv_rmssd_milli: +hrv.toFixed(1) },
    });
    whoop.sleeps.push({
      start: new Date(t0 - 1 * 3600e3).toISOString(), end: new Date(t0 + sleepHours * 3600e3).toISOString(),
      score_state: 'SCORED', score: { sleep_performance_percentage: Math.round(sleepPerf) },
    });
    const wStart = new Date(t0 + 8 * 3600e3).toISOString();
    if (did.run) whoop.workouts.push({ start: wStart, sport_name: 'running', score: { strain: +(5 + km * 0.4).toFixed(1), distance_meter: Math.round(km * 1000 * (1 + gauss() * 0.03)) } });
    if (did.surf) whoop.workouts.push({ start: new Date(t0 + 10 * 3600e3).toISOString(), sport_name: 'surfing', score: { strain: 11.2, distance_meter: null } });

    // ---- Apple Health (forma de HKSample serializada por una app iOS) ----
    appleHealth.quantitySamples.push({ type: 'HKQuantityTypeIdentifierStepCount', value: steps, unit: 'count', startDate: date });
    // SDNN simulado como fracción de RMSSD sólo para tener un valor; en la realidad
    // no hay conversión válida entre ambos y el sistema nunca los mezcla.
    appleHealth.quantitySamples.push({ type: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', value: +(hrv * 0.82).toFixed(1), unit: 'ms', startDate: date });
    appleHealth.quantitySamples.push({ type: 'HKQuantityTypeIdentifierActiveEnergyBurned', value: Math.round(250 + load * 38), unit: 'kcal', startDate: date });
    // Apple Watch registra sueño por fases; aquí un solo bloque "asleepCore" por noche
    appleHealth.categorySamples.push({ type: 'HKCategoryTypeIdentifierSleepAnalysis', value: 'asleepCore', startDate: new Date(t0 - 1 * 3600e3).toISOString(), endDate: new Date(t0 + (sleepHours - 1) * 3600e3).toISOString() });
    if (did.meditation) appleHealth.categorySamples.push({ type: 'HKCategoryTypeIdentifierMindfulSession', startDate: date, durationMin: 8 + Math.round(rnd() * 15) });
    if (did.run) appleHealth.workouts.push({ workoutActivityType: 'HKWorkoutActivityTypeRunning', startDate: wStart, duration: Math.round(km * 5.8), totalDistance: km * 1000 });
    if (did.surf) appleHealth.workouts.push({ workoutActivityType: 'HKWorkoutActivityTypeSurfingSports', startDate: new Date(t0 + 10 * 3600e3 + 120e3).toISOString(), duration: 95, totalDistance: null });
    if (did.diving) appleHealth.workouts.push({ workoutActivityType: 'HKWorkoutActivityTypeUnderwaterDiving', startDate: new Date(t0 + 11 * 3600e3).toISOString(), duration: 50, totalDistance: null });
    if (did.strength) appleHealth.workouts.push({ workoutActivityType: 'HKWorkoutActivityTypeTraditionalStrengthTraining', startDate: new Date(t0 + 18 * 3600e3).toISOString(), duration: 45, totalDistance: null });

    prevAlcohol = did.alcohol; prevStrain = strain;
  }
  const src = P.sources ?? ['whoop', 'apple', 'manual'];
  if (!src.includes('whoop')) for (const k of Object.keys(whoop)) whoop[k] = [];
  return { whoop, appleHealth, manual, meta: { persona: personaKey, start: isoDay(start), days: P.days } };
}
