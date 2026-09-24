// Catálogo de hábitos. Cada hábito tiene un código de 3 letras, un dominio y una fuente:
//   manual → se registra en el LOG (nadie más lo sabe)
//   auto   → lo aporta un wearable (entrenamientos, mindfulness, pasos)
// Cada hábito seguido deja una TRAZA propia en el organismo: una barra del espectro que
// rodea al cuerpo, con altura = frecuencia en 28 días y color = dominio.
// Ningún hábito es bueno ni malo; el dominio sólo agrupa y da color.

export const DOMAINS = {
  SUS: { label: 'SUSTANCIAS', color: '#ff7a2f', idx: 0, sensitive: true },
  CUE: { label: 'CUERPO', color: '#3ff0ff', idx: 1 },
  MEN: { label: 'MENTE', color: '#8a4dff', idx: 2 },
  REC: { label: 'RECUPERACIÓN', color: '#2f6bff', idx: 3 },
  NUT: { label: 'NUTRICIÓN', color: '#e8f6ff', idx: 4 },
};

const run = (d) => d.workouts.filter((w) => w.type === 'running');
const has = (type) => (d) => (d.workouts.some((w) => w.type === type) ? 1 : 0);

export const CATALOG = [
  // sustancias
  { id: 'alcohol', code: 'ALC', label: 'Alcohol', domain: 'SUS', source: 'manual' },
  { id: 'smoking', code: 'TAB', label: 'Tabaco', domain: 'SUS', source: 'manual' },
  { id: 'cannabis', code: 'THC', label: 'Cannabis', domain: 'SUS', source: 'manual' },
  { id: 'cocaine', code: 'COC', label: 'Cocaína', domain: 'SUS', source: 'manual' },
  { id: 'caffeine', code: 'CAF', label: 'Cafeína', domain: 'SUS', source: 'manual' },
  { id: 'sugar', code: 'AZU', label: 'Azúcar', domain: 'SUS', source: 'manual' },
  { id: 'ultra', code: 'UPF', label: 'Ultraprocesados', domain: 'SUS', source: 'manual' },
  // cuerpo
  { id: 'running', code: 'CAR', label: 'Correr', domain: 'CUE', source: 'auto', read: (d) => (run(d).length ? 1 : 0), detail: (d) => { const km = run(d).reduce((s, w) => s + (w.km ?? 0), 0); return km ? `${km.toFixed(1)} KM` : null; } },
  { id: 'strength', code: 'FUE', label: 'Fuerza', domain: 'CUE', source: 'auto', read: has('strength') },
  { id: 'surf', code: 'SRF', label: 'Surf', domain: 'CUE', source: 'auto', read: has('surf') },
  { id: 'diving', code: 'DIV', label: 'Buceo', domain: 'CUE', source: 'auto', read: has('diving') },
  { id: 'yoga', code: 'YOG', label: 'Yoga / movilidad', domain: 'CUE', source: 'auto', read: has('yoga') },
  { id: 'steps', code: 'PAS', label: 'Pasos', domain: 'CUE', source: 'auto', read: (d) => (d.steps == null ? null : Math.min(1, d.steps / 12000)), detail: (d) => (d.steps != null ? `${(d.steps / 1000).toFixed(1)}K` : null) },
  // mente
  { id: 'meditation', code: 'MED', label: 'Meditación', domain: 'MEN', source: 'auto', read: (d) => (d.mindfulMin >= 5 ? 1 : 0), detail: (d) => (d.mindfulMin ? `${d.mindfulMin} MIN` : null) },
  { id: 'breathwork', code: 'RES', label: 'Respiración', domain: 'MEN', source: 'manual' },
  { id: 'reading', code: 'LEC', label: 'Lectura', domain: 'MEN', source: 'manual' },
  { id: 'screens', code: 'PAN', label: 'Pantallas +4 h', domain: 'MEN', source: 'manual' },
  // recuperación
  { id: 'cold', code: 'FRI', label: 'Frío', domain: 'REC', source: 'manual' },
  { id: 'sauna', code: 'SAU', label: 'Sauna', domain: 'REC', source: 'manual' },
  // nutrición
  { id: 'fasting', code: 'AYU', label: 'Ayuno', domain: 'NUT', source: 'manual' },
];
export const MAX_TRACES = 24; // tamaño del arreglo en el shader

export const byId = Object.fromEntries(CATALOG.map((h) => [h.id, h]));
export const SUBSTANCES = CATALOG.filter((h) => h.domain === 'SUS');

// Valor del hábito ese día: 1/0 (o 0–1 para pasos); null = sin dato
export function dayValue(d, h) {
  if (h.source === 'auto') return h.read(d);
  return d.habits[h.id] === true ? 1 : 0;
}

// Un hábito se sigue desde el primer día en que aparece (nunca con datos futuros)
const firstCache = new WeakMap();
export function firstSeen(days) {
  if (!firstCache.has(days)) {
    const first = {};
    for (const h of CATALOG) {
      const i = days.findIndex((d) => (h.source === 'auto' ? (h.read(d) ?? 0) > 0 : d.habits[h.id] === true));
      first[h.id] = i < 0 ? Infinity : i;
    }
    firstCache.set(days, first);
  }
  return firstCache.get(days);
}
export const trackedAt = (days, idx) => CATALOG.filter((h) => firstSeen(days)[h.id] <= idx);

export function daysSince(days, idx, h) {
  for (let i = idx; i >= 0; i--) if ((dayValue(days[i], h) ?? 0) >= 0.5) return idx - i;
  return null;
}

// Traza de 28 días: frecuencia y los 28 valores (para la tira de puntos)
export function trace(days, idx, h) {
  const win = days.slice(Math.max(0, idx - 27), idx + 1);
  const vals = win.map((d) => dayValue(d, h));
  const known = vals.filter((v) => v != null);
  return { freq: known.length ? known.reduce((s, v) => s + v, 0) / known.length : 0, vals };
}
