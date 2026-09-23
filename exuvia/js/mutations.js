// Sistema de mutaciones.
// Una muda no es un premio. Ocurre cuando la forma cambió lo suficiente, en cualquier
// dirección: empezar a correr, dejar de correr, tomar, dejar de tomar, lesionarse,
// mudarse de ciudad. Hacen falta dos cosas:
//   1. madurez: un mínimo de días en la forma actual;
//   2. cambio: la estructura se alejó de la forma con la que empezó la etapa.
// Una vida estable no muda y no por eso es peor: simplemente no cambió de piel.
// Un patrón irregular pero repetido (dos meses de exceso, dos de abandono) tampoco:
// la irregularidad sostenida ya es su forma. Muda cuando el patrón cambia.

import { extractFeatures, toGenome, structuralDistance, STRUCTURAL, normalizedParam, traits } from './genome.js';

export const WARMUP = 28;  // las ventanas de 28–90 días necesitan datos antes de que la forma signifique algo
export const MIN_DAYS = 21;
export const NET = 0.1;    // distancia estructural media desde el inicio de la etapa

// Nombre de la etapa según el parámetro que más cambió y en qué dirección.
// Nombres provisorios: son una decisión de autor, no del sistema.
const NAMES = {
  coherence: ['DISCIPLINE', 'FLUX'], density: ['CORE', 'DRIFT'], lobes: ['BLOOM', 'FOLD'],
  lobeAmp: ['BLOOM', 'FOLD'], twist: ['SPIRAL', 'UNWIND'], elong: ['ASCENT', 'REST'],
  skirt: ['ROOT', 'LIFT'], filament: ['LATTICE', 'MIST'],
};

const seedFor = (userSeed, stage) => ((userSeed % 97) / 97) * 6.28 + stage * 1.37;

export function runHistory(days, userSeed) {
  const timeline = [];   // por día: { features, genome, stage, age, net, name }
  const exuvias = [];    // formas abandonadas
  let stage = 0, stageStart = 0, stageGenome = null;

  for (let i = 0; i < days.length; i++) {
    const f = extractFeatures(days, i);
    const g = toGenome(f, seedFor(userSeed, stage));
    // durante el arranque la primera forma se va definiendo; se fija al terminarlo
    if (i <= WARMUP) stageGenome = g;

    const age = i - stageStart;
    const net = structuralDistance(g, stageGenome);

    if (i > WARMUP && age >= MIN_DAYS && net >= NET) {
      // la dirección dominante del cambio nombra la nueva etapa
      let best = 'coherence', bestDelta = 0;
      for (const k of STRUCTURAL) {
        const dlt = normalizedParam(g, k) - normalizedParam(stageGenome, k);
        if (Math.abs(dlt) > Math.abs(bestDelta)) { bestDelta = dlt; best = k; }
      }
      const prevGenome = timeline[i - 1]?.genome ?? g;
      exuvias.push({
        index: stage + 1,
        name: timeline[i - 1]?.name ?? 'INITIATION',
        start: days[stageStart].date, end: days[i - 1]?.date ?? days[i].date,
        days: age, genome: prevGenome, traits: traits(prevGenome),
      });
      stage += 1; stageStart = i;
      const g2 = toGenome(f, seedFor(userSeed, stage));
      stageGenome = g2;
      timeline.push({ features: f, genome: g2, stage, age: 0, net: 0, name: NAMES[best][bestDelta >= 0 ? 0 : 1], mutatedToday: true });
      continue;
    }
    timeline.push({ features: f, genome: g, stage, age, net, name: stage === 0 ? 'INITIATION' : timeline[i - 1]?.name, mutatedToday: false });
  }
  return { timeline, exuvias };
}

// Estado hacia la próxima muda: madurez y cambio
export function progress(entry) {
  return {
    maturity: Math.min(1, entry.age / MIN_DAYS),
    change: Math.min(1, entry.net / NET),
  };
}
