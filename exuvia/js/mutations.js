// Sistema de mutaciones.
// Una mutación no llega por tiempo ni por puntos solamente. Hacen falta tres cosas:
//   1. madurez: un mínimo de días en la forma actual;
//   2. rastro: suficiente actividad/constancia acumulada desde la última muda;
//   3. cambio real: la estructura actual se alejó de la forma con la que empezó la etapa.
// Si sólo pasa el tiempo, no hay muda. Si hay mucho esfuerzo pero la vida no cambió
// de forma, tampoco. Eso es lo que la separa de un sistema de niveles.

import { extractFeatures, toGenome, structuralDistance, STRUCTURAL, normalizedParam, traits } from './genome.js';

export const MIN_DAYS = 21;
export const DISTANCE = 0.1;
export const traceThreshold = (stage) => 14 + stage * 4;

const NAMES = {
  coherence: 'DISCIPLINE', density: 'CORE', lobes: 'BLOOM', lobeAmp: 'BLOOM',
  twist: 'ASCENT', elong: 'ASCENT', skirt: 'ROOT', filament: 'LATTICE',
};

const seedFor = (userSeed, stage) => ((userSeed % 97) / 97) * 6.28 + stage * 1.37;

function dayScore(day, f) {
  // rastro diario: constancia + actividad; nunca negativo
  const active = Math.min(1, (day.strain ?? 0) / 14);
  return 0.55 * f.consistency + 0.3 * active + 0.15 * (day.mindfulMin >= 5 ? 1 : 0);
}

// Recorre toda la historia y devuelve la línea de tiempo completa.
export function runHistory(days, userSeed) {
  const timeline = [];   // por día: { features, genome, stage, trace }
  const exuvias = [];    // formas abandonadas
  let stage = 0, stageStart = 0, trace = 0, stageGenome = null;

  for (let i = 0; i < days.length; i++) {
    const f = extractFeatures(days, i);
    const g = toGenome(f, seedFor(userSeed, stage));
    if (!stageGenome) stageGenome = g;
    trace += dayScore(days[i], f);
    const age = i - stageStart;
    const dist = structuralDistance(g, stageGenome);

    if (age >= MIN_DAYS && trace >= traceThreshold(stage) && dist >= DISTANCE) {
      // la dirección dominante del cambio nombra la nueva etapa
      let best = 'coherence', bestDelta = -Infinity;
      for (const k of STRUCTURAL) {
        const dlt = Math.abs(normalizedParam(g, k) - normalizedParam(stageGenome, k));
        if (dlt > bestDelta) { bestDelta = dlt; best = k; }
      }
      const prevGenome = timeline[i - 1]?.genome ?? g;
      exuvias.push({
        index: stage + 1,
        name: timeline[i - 1]?.name ?? 'INITIATION',
        start: days[stageStart].date, end: days[i - 1]?.date ?? days[i].date,
        days: age, genome: prevGenome, traits: traits(prevGenome),
      });
      stage += 1; stageStart = i; trace = 0;
      const g2 = toGenome(f, seedFor(userSeed, stage));
      stageGenome = g2;
      timeline.push({ features: f, genome: g2, stage, trace, dist: 0, name: NAMES[best], age: 0, mutatedToday: true });
      continue;
    }
    timeline.push({ features: f, genome: g, stage, trace, dist, name: stage === 0 ? 'INITIATION' : timeline[i - 1]?.name, age, mutatedToday: false });
  }
  return { timeline, exuvias };
}

// Estado de progreso hacia la próxima muda (para mostrarlo sin convertirlo en barra de XP)
export function progress(entry) {
  return {
    maturity: Math.min(1, entry.age / MIN_DAYS),
    trace: Math.min(1, entry.trace / traceThreshold(entry.stage)),
    change: Math.min(1, entry.dist / DISTANCE),
  };
}
