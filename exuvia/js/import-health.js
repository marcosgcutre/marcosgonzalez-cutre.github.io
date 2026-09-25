// Importador de Apple Health.
// Lee el ZIP que genera la app Salud ("Exportar todos los datos de salud") o el export.xml
// suelto, en streaming y dentro del navegador: el archivo nunca sale del teléfono.
// Devuelve el mismo formato que usa el simulador para Apple Health, así el resto de la app
// (normalizador, rasgos, mutaciones) funciona igual con datos reales.

import { Unzip, UnzipInflate } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js';

const KEEP_DAYS = 365;

// "2024-01-15 07:30:00 -0300" → Date
const parseDate = (s) => new Date(s.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));
const localDay = (s) => s.slice(0, 10); // el día local tal como lo registró el iPhone
const attrs = (s) => {
  const o = {};
  for (const m of s.matchAll(/(\w+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
};

export async function importAppleHealth(file, onProgress) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const steps = new Map(), kcal = new Map(), hrv = new Map();
  const categorySamples = [], workouts = [];
  let current = null; // entrenamiento abierto, para leer sus WorkoutStatistics
  let buf = '', found = false;
  const dec = new TextDecoder();

  const handle = (tag, a) => {
    if (tag === '/Workout') { if (current) workouts.push(current); current = null; return; }
    const start = a.startDate;
    if (!start || localDay(start) < cutoff) return;
    if (tag === 'Record') {
      const v = parseFloat(a.value);
      const d = localDay(start);
      if (a.type === 'HKQuantityTypeIdentifierStepCount') steps.set(d, (steps.get(d) ?? 0) + v);
      else if (a.type === 'HKQuantityTypeIdentifierActiveEnergyBurned') kcal.set(d, (kcal.get(d) ?? 0) + (a.unit === 'kJ' ? v / 4.184 : v));
      else if (a.type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN') { const x = hrv.get(d) ?? [0, 0]; hrv.set(d, [x[0] + v, x[1] + 1]); }
      else if (a.type === 'HKCategoryTypeIdentifierMindfulSession') {
        categorySamples.push({ type: a.type, startDate: d, durationMin: Math.round((parseDate(a.endDate) - parseDate(start)) / 60000) });
      } else if (a.type === 'HKCategoryTypeIdentifierSleepAnalysis' && /Asleep/.test(a.value)) {
        categorySamples.push({ type: a.type, value: 'asleep', startDate: parseDate(start).toISOString(), endDate: parseDate(a.endDate).toISOString() });
      }
    } else if (tag === 'Workout') {
      const dist = a.totalDistance ? parseFloat(a.totalDistance) * (a.totalDistanceUnit === 'mi' ? 1609.34 : a.totalDistanceUnit === 'm' ? 1 : 1000) : null;
      const dur = parseFloat(a.duration) * (a.durationUnit === 'h' ? 60 : a.durationUnit === 's' ? 1 / 60 : 1);
      current = { workoutActivityType: a.workoutActivityType, startDate: parseDate(start).toISOString(), duration: Math.round(dur), totalDistance: dist };
    } else if (tag === 'WorkoutStatistics' && current && /Distance/.test(a.type) && a.sum && current.totalDistance == null) {
      current.totalDistance = parseFloat(a.sum) * (a.unit === 'mi' ? 1609.34 : a.unit === 'm' ? 1 : 1000);
    }
  };

  const feed = (text, final) => {
    buf += text;
    const end = final ? buf.length : buf.lastIndexOf('>') + 1;
    if (end <= 0) return;
    const chunk = buf.slice(0, end);
    buf = buf.slice(end);
    for (const m of chunk.matchAll(/<(Record|Workout|WorkoutStatistics)\s([^>]*)>|<(\/Workout)>/g)) {
      found = true;
      handle(m[1] ?? m[3], m[2] ? attrs(m[2]) : {});
      // <Workout ... /> sin estadísticas adentro: se cierra en la misma etiqueta
      if (m[1] === 'Workout' && m[2].trim().endsWith('/')) handle('/Workout', {});
    }
  };

  const total = file.size;
  let read = 0;
  const reader = file.stream().getReader();

  if (/\.xml$/i.test(file.name)) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.length; onProgress?.(read / total);
      feed(dec.decode(value, { stream: true }), false);
    }
    feed(dec.decode(), true);
  } else {
    let xmlDone;
    const finished = new Promise((r) => (xmlDone = r));
    let sawXml = false;
    const uz = new Unzip();
    uz.register(UnzipInflate);
    uz.onfile = (f) => {
      if (!/(^|\/)export\.xml$/.test(f.name)) return; // se ignoran export_cda.xml, rutas, ECG
      sawXml = true;
      f.ondata = (err, chunk, final) => {
        if (err) throw err;
        feed(dec.decode(chunk, { stream: !final }), final);
        if (final) xmlDone();
      };
      f.start();
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { uz.push(new Uint8Array(0), true); break; }
      read += value.length; onProgress?.(read / total);
      uz.push(value);
      await new Promise((r) => setTimeout(r, 0)); // deja respirar a la interfaz
    }
    if (!sawXml) throw new Error('El ZIP no tiene export.xml. ¿Es la exportación de la app Salud?');
    await finished;
  }
  if (!found) throw new Error('No encontré datos de Salud en el archivo.');

  const quantitySamples = [];
  for (const [d, v] of steps) quantitySamples.push({ type: 'HKQuantityTypeIdentifierStepCount', value: Math.round(v), unit: 'count', startDate: d });
  for (const [d, v] of kcal) quantitySamples.push({ type: 'HKQuantityTypeIdentifierActiveEnergyBurned', value: Math.round(v), unit: 'kcal', startDate: d });
  for (const [d, [s, n]] of hrv) quantitySamples.push({ type: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', value: +(s / n).toFixed(1), unit: 'ms', startDate: d });
  return { whoop: { cycles: [], recoveries: [], sleeps: [], workouts: [] }, appleHealth: { quantitySamples, categorySamples, workouts }, manual: [] };
}
