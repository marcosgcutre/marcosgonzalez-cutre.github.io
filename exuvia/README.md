# EXUVIA — prototipo

Prototipo web del organismo generativo MUTANT. Abrir `index.html` servido por HTTP (por ejemplo `python3 -m http.server` desde la raíz del repositorio y visitar `/exuvia/`). Necesita WebGL.

- `?n=20000` fija la cantidad de partículas (por defecto 40.000 en táctil, 80.000 en escritorio).
- Un enlace con `#m=…` abre el modo visitante: sólo el organismo, sin datos.

Estructura: `js/simulator.js` (fuentes simuladas WHOOP / Apple Health / registro manual) → `js/ingest.js` (normalizador) → `js/genome.js` (rasgos y reglas) + `js/patterns.js` (ritmo semanal, ciclos, acoplamientos, estratos) → `js/mutations.js` (mudas y exuvias) → `js/organism.js` (shader de partículas). `js/share.js` exporta imagen, animación y enlace. `js/main.js` arma la interfaz.

El análisis técnico está en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).
