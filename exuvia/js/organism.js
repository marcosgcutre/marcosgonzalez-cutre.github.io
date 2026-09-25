// MUTANT — organismo de partículas.
// Toda la forma se calcula en el vertex shader a partir de una semilla fija por
// partícula y de un conjunto de uniforms (el "genoma visual"). La CPU no toca
// las posiciones en cada frame: sólo interpola uniforms. Eso es lo que permite
// decenas de miles de partículas en un teléfono.

import * as THREE from 'three';
import { CATALOG, DOMAINS, MAX_TRACES } from './catalog.js';

const TRACE_DOMAINS = Array.from({ length: MAX_TRACES }, (_, i) => (CATALOG[i] ? DOMAINS[CATALOG[i].domain].idx : 0));

export const PARAMS = [
  'expansion', 'coherence', 'density', 'flow', 'lobes', 'lobeAmp', 'twist',
  'elong', 'skirt', 'filament', 'pulse', 'pulseAmp', 'glow',
  'cyan', 'blue', 'violet', 'orange', 'seedShift',
];

// Ashima Arts / Stefan Gustavson — simplex noise 3D (MIT).
const SNOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime, uPixelRatio, uPointSize;
uniform float uExpansion, uCoherence, uDensity, uFlow, uLobes, uLobeAmp, uTwist;
uniform float uElong, uSkirt, uFilament, uPulse, uPulseAmp, uGlow, uSeedShift;
uniform vec4 uPalette; // cyan, blue, violet, orange
// patrones detectados en los datos (ver patterns.js)
uniform float uWeek[7];   // perfil semanal L..D, 0–1
uniform float uWeekStr;   // fuerza del ritmo semanal
uniform float uCycleTurns, uCycleStr;
uniform vec2 uRings[8];   // estratos: x = posición temporal 0–1, y = intensidad
uniform vec4 uLinks[3];   // acoplamientos: ángulo A, ángulo B, intensidad, signo
uniform float uTrace[24];    // TRAZAS: frecuencia 28 d de cada hábito del catálogo (0 = no seguido)
uniform float uTraceDom[24]; // dominio de cada hábito: 0 sustancias, 1 cuerpo, 2 mente, 3 recuperación, 4 nutrición
uniform float uFresh[24];    // cuán reciente es cada hábito: 1 = hoy, se apaga en días
uniform float uFocus;        // estructura aislada: 0 ninguna, 1 semana, 2 ciclo, 3 acoplamientos, 5 trazas, 10 estratos
uniform float uAbsorb;       // onda al absorber una espora (1 → 0)
uniform float uShell;        // 1 = esta instancia es una cáscara (exuvia desprendida)
uniform float uShellAlpha;
varying vec3 vColor;
varying float vAlpha;
${SNOISE}
const float TAU = 6.2831853;
// Órbitas de los planetas (mismas fórmulas en main.js para tocar y etiquetar)
float planetR(float f) { return 1.9 - 1.3 * f; }
float planetA(float c, float r) { return c * 2.39996 + uTime * 0.22 / pow(r, 1.5); }
vec3 planetP(float c, float r, float a) { return vec3(cos(a) * r, sin(c * 1.7) * 0.12, sin(a) * r); }
// nodo de un acoplamiento: índice ≥ 0 = planeta de ese hábito; negativo = señal fisiológica en el núcleo
vec3 nodePos(float idx) {
  if (idx < -0.5) { float a = -idx * 2.1; return vec3(cos(a) * 0.3, 0.12, sin(a) * 0.3); }
  float f = 0.0;
  for (int i = 0; i < 24; i++) { if (float(i) == idx) f = uTrace[i]; }
  float r = planetR(f);
  return planetP(idx, r, planetA(idx, r));
}
void main(){
  float u = aSeed.x, v = aSeed.y, w = aSeed.z, s = aSeed.w;
  // Toda la materia está siempre presente: ningún dato "quita" partículas ni brillo.
  // La densidad sólo decide cómo se distribuye (compacta ↔ dispersa).
  float visible = 1.0;
  float t = uTime * uFlow;
  float ringGlow = 0.0, structAmt = 0.0, kind = 0.0, tipGlow = 0.0;

  // ===== GALAXIA =====
  // Núcleo (vos) + disco con brazos espirales generados por el genoma.
  // Cantidad de brazos = lóbulos, enrollamiento = torsión, nitidez = filamento,
  // grosor del disco = elongación, extensión = base, barra central = amplitud de lóbulos.
  float spin = t * 0.07;
  float diskR = 1.2 + 0.65 * uSkirt;
  float g1 = fract(w * 7.31 + s * 3.7), g2 = fract(s * 17.9 + u * 3.1);
  float gauss = (g1 + g2 + fract(w * 91.3)) / 1.5 - 1.0;        // ~normal en [-1, 1]
  vec3 p;
  if (fract(s * 5.71) < 0.16 + 0.12 * uDensity) {
    // bulbo: núcleo brillante, con barra si la amplitud de lóbulos es alta
    float rb = 0.42 * pow(fract(w * 3.3), 1.6) * (1.25 - 0.5 * uDensity);
    float th = u * TAU, ph2 = acos(1.0 - 2.0 * v);
    p = vec3(sin(ph2) * cos(th) * (1.0 + 1.3 * uLobeAmp), cos(ph2) * 0.55, sin(ph2) * sin(th)) * rb;
    float cb = cos(spin), sb = sin(spin);
    p.xz = vec2(cb * p.x - sb * p.z, sb * p.x + cb * p.z);
  } else {
    // disco: radio con más densidad hacia adentro
    float r = 0.18 + diskR * pow(v, 0.85);
    // ESTRATOS: anillos en el disco; el radio codifica la fecha (adentro = pasado)
    if (fract(s * 91.7) < 0.35) {
      float jf = floor(fract(s * 17.3) * 8.0);
      for (int i = 0; i < 8; i++) {
        if (float(i) == jf && uRings[i].y > 0.0) {
          float target = mix(0.35, diskR, uRings[i].x) + (fract(s * 431.0) - 0.5) * 0.02;
          r = mix(r, target, uRings[i].y);
          ringGlow = uRings[i].y;
        }
      }
    }
    // brazos: se mezclan dos cantidades enteras para que nada salte al cambiar
    float nA = 2.0 + floor(uLobes * 0.8), nB = nA + 1.0, nf = fract(uLobes * 0.8);
    float wind = 1.1 + 3.2 * uTwist;
    float spread = mix(0.6, 0.1, uFilament) * (1.2 - 0.4 * uDensity);
    float off = gauss * spread;
    float interarm = step(fract(s * 29.3), 0.18 + 0.3 * (1.0 - uCoherence)); // polvo entre brazos
    float angA = floor(u * nA) / nA * TAU + r * wind + off;
    float angB = floor(u * nB) / nB * TAU + r * wind + off;
    float ang = mix(angA, angB, smoothstep(0.35, 0.65, nf));
    ang = mix(ang, u * TAU * 7.0, interarm) - spin + uSeedShift;
    float thick = (0.03 + 0.22 * uElong) * (1.0 - 0.6 * r / (diskR + 0.2));
    p = vec3(cos(ang) * r, gauss * thick, sin(ang) * r);
  }

  // ESTRUCTURAS: una fracción fija de partículas se reorganiza según patrones y hábitos.
  // Con intensidad 0 vuelven a la galaxia; nunca aparecen ni desaparecen de golpe.
  float role = fract(s * 53.13 + v * 3.7);
  vec3 sp = p;
  if (role < 0.07) {
    // RITMO SEMANAL: halo de 7 lóbulos alrededor del núcleo; radio = actividad de ese día
    float d = u * 7.0, i0 = floor(d), f0 = fract(d);
    float w0 = 0.0, w1 = 0.0;
    for (int i = 0; i < 7; i++) {
      if (float(i) == i0) w0 = uWeek[i];
      if (float(i) == mod(i0 + 1.0, 7.0)) w1 = uWeek[i];
    }
    float wv = mix(w0, w1, smoothstep(0.4, 0.6, f0));
    float rr = 0.55 + 0.4 * wv + (fract(w * 59.0) - 0.5) * 0.04;
    float a7 = u * TAU - spin * 0.5;
    sp = vec3(cos(a7) * rr, 0.08 + (fract(w * 37.0) - 0.5) * (0.02 + 0.18 * step(f0, 0.015)), sin(a7) * rr);
    structAmt = smoothstep(0.03, 0.2, uWeekStr); kind = 1.0;
  } else if (role < 0.13) {
    // CICLO: chorros polares en espiral; cada vuelta es un ciclo observado
    float sgn = step(0.5, fract(s * 7.0)) * 2.0 - 1.0;
    float aj = v * uCycleTurns * TAU + t * 0.1;
    float rj = 0.05 + 0.16 * v;
    sp = vec3(cos(aj) * rj, sgn * (0.12 + 1.35 * v), sin(aj) * rj);
    structAmt = uCycleStr; kind = 2.0;
  } else if (role < 0.19) {
    // ACOPLAMIENTOS: puente de luz entre dos planetas (o nodos del núcleo)
    float jf = floor(fract(s * 11.0) * 3.0);
    vec4 L = vec4(0.0);
    for (int i = 0; i < 3; i++) { if (float(i) == jf) L = uLinks[i]; }
    vec3 A = nodePos(L.x), B = nodePos(L.y);
    vec3 c = (A + B) * 0.5 + vec3(0.0, 0.45 + 0.15 * length(A - B), 0.0);
    sp = mix(mix(A, c, v), mix(c, B, v), v) + (vec3(fract(w * 13.0), fract(w * 29.0), fract(w * 47.0)) - 0.5) * 0.025;
    structAmt = L.z; kind = L.w < 0.0 ? 4.0 : 3.0;
  } else if (role < 0.44) {
    // PLANETAS: cada hábito seguido es un planeta que orbita el núcleo.
    // Órbita más cerrada = más frecuente. Tamaño = frecuencia. Color = dominio.
    // Deja una estela en su órbita: every habit leaves a trace.
    float c = floor(fract(s * 23.7) * 24.0);
    float f = 0.0, dom = 0.0, fr = 0.0;
    for (int i = 0; i < 24; i++) { if (float(i) == c) { f = uTrace[i]; dom = uTraceDom[i]; fr = uFresh[i]; } }
    float pr = planetR(f);
    float pa = planetA(c, pr);
    vec3 P = planetP(c, pr, pa);
    float size = 0.045 + 0.1 * f;
    float q = fract(w * 5.3);
    if (q < 0.42) {
      // estela: arco de la órbita detrás del planeta, que se desvanece
      float back = v * (0.35 + 1.4 * f);
      float ab = pa - back;
      sp = vec3(cos(ab) * pr, P.y, sin(ab) * pr) + (vec3(fract(w * 13.0), fract(w * 29.0), fract(w * 47.0)) - 0.5) * 0.02;
      tipGlow = fr * 0.25 * (1.0 - v);
    } else {
      vec3 rnd = normalize(vec3(fract(w * 13.7), fract(w * 31.1), fract(w * 57.3)) - 0.5);
      float rr = size * pow(fract(w * 77.0), 0.4);
      if (dom < 0.5) {
        // sustancias: esfera densa con halo de gas
        rr = size * (fract(w * 3.1) < 0.75 ? pow(fract(w * 77.0), 0.5) : 1.6 + fract(w * 9.0));
        sp = P + rnd * rr;
      } else if (dom < 1.5) {
        // cuerpo: estrella con corona de rayos
        rr = size * (0.6 + 2.2 * pow(fract(w * 77.0), 4.0));
        sp = P + rnd * rr;
      } else if (dom < 2.5) {
        // mente: estrella doble, dos cuerpos que giran entre sí
        float ab = t * 1.6 + c;
        vec3 o = vec3(cos(ab), 0.0, sin(ab)) * size * 1.2 * (step(0.5, fract(w * 19.0)) * 2.0 - 1.0);
        sp = P + o + rnd * size * 0.55;
      } else if (dom < 3.5) {
        // recuperación: planeta con anillo plano inclinado
        if (fract(w * 23.0) < 0.5) sp = P + rnd * size * 0.7;
        else { float ar = u * TAU; sp = P + vec3(cos(ar) * size * 2.0, sin(ar) * size * 0.5, sin(ar) * size * 1.6); }
      } else {
        // nutrición: mundo-anillo
        float ar = u * TAU;
        sp = P + vec3(cos(ar), (fract(w * 7.0) - 0.5) * 0.15, sin(ar)) * size * 1.3;
      }
      tipGlow = fr;
    }
    structAmt = smoothstep(0.0, 0.03, f); kind = 5.0 + dom;
    tipGlow *= structAmt;
  }
  p = mix(p, sp, structAmt);

  float chaos = mix(0.34, 0.035, uCoherence);
  vec3 q = p * 1.5 + vec3(uSeedShift * 3.1);
  float tt = t * 0.25;
  vec3 disp = vec3(snoise(q + vec3(0.0, 0.0, tt)),
                   snoise(q + vec3(31.4, 0.0, tt)),
                   snoise(q + vec3(0.0, 47.2, tt)));
  p += disp * chaos * (1.0 - 0.8 * structAmt); // las estructuras se leen nítidas

  p *= uExpansion * (1.0 + uPulseAmp * 0.035 * sin(uTime * uPulse * TAU));
  // absorción: una onda que recorre el cuerpo desde el centro hacia afuera
  p *= 1.0 + uAbsorb * 0.07 * sin(length(p) * 9.0 - (1.0 - uAbsorb) * 18.0);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uPointSize * (0.55 + 1.4 * pow(fract(s * 113.0), 4.0));
  gl_PointSize = visible * sz * (1.0 + 1.3 * tipGlow) * uPixelRatio * (3.2 / -mv.z);

  vec3 CY = vec3(0.25, 0.94, 1.0), BL = vec3(0.16, 0.40, 1.0);
  vec3 VI = vec3(0.56, 0.30, 1.0), OR = vec3(1.0, 0.47, 0.16);
  vec4 wgt = max(uPalette, vec4(0.001));
  wgt /= (wgt.x + wgt.y + wgt.z + wgt.w);
  float pick = fract(s * 37.17 + u * 0.13);
  float e = 0.03;
  vec3 col = CY;
  col = mix(col, BL, smoothstep(wgt.x - e, wgt.x + e, pick));
  col = mix(col, VI, smoothstep(wgt.x + wgt.y - e, wgt.x + wgt.y + e, pick));
  col = mix(col, OR, smoothstep(1.0 - wgt.w - e, 1.0 - wgt.w + e, pick));
  col = mix(col, vec3(1.0), step(0.985, fract(s * 211.0)) * 0.8);
  // color por estructura: anillo semanal cian-blanco, hélice violeta, acoplamientos
  // cian (se mueven en el mismo sentido) u naranja (en sentido opuesto), estratos claros
  if (kind == 1.0) col = mix(col, vec3(0.7, 1.0, 1.0), 0.65 * structAmt);
  else if (kind == 2.0) col = mix(col, vec3(0.78, 0.6, 1.0), 0.85 * structAmt);
  else if (kind == 3.0) col = mix(col, CY, 0.75 * structAmt);
  else if (kind == 4.0) col = mix(col, OR, 0.75 * structAmt);
  else if (kind >= 5.0) {
    vec3 dc = kind < 5.5 ? OR : kind < 6.5 ? CY : kind < 7.5 ? VI * 1.3 : kind < 8.5 ? BL * 1.4 : vec3(0.92, 0.97, 1.0);
    col = mix(col, dc * 1.15, 0.95 * structAmt);
    col = mix(col, vec3(1.0), tipGlow * 0.18); // lo reciente brilla más, sin perder su color
  }
  col = mix(col, vec3(0.8, 0.95, 1.0), ringGlow * 0.45 * (1.0 - structAmt));
  vColor = col;
  vAlpha = visible * (0.35 + 0.75 * uGlow) * (0.5 + 0.5 * fract(s * 71.0));
  vAlpha *= 1.0 + 1.5 * tipGlow;
  if (uShell > 0.5) { vColor = mix(col, vec3(0.82, 0.9, 1.0), 0.75); vAlpha *= uShellAlpha; }
  if (uFocus > 0.5) {
    float isStrata = step(0.01, ringGlow) * (1.0 - step(0.01, structAmt));
    float inF = uFocus > 9.5 ? isStrata
      : uFocus > 4.5 ? step(4.5, kind) * step(0.01, structAmt)
      : uFocus > 2.5 ? step(2.5, kind) * step(kind, 4.5) * step(0.01, structAmt)
      : (1.0 - step(0.1, abs(kind - uFocus))) * step(0.01, structAmt);
    vAlpha *= mix(0.1, 1.4, inF);
  }
}`;

const FRAG = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vColor * a * vAlpha * 1.9, a * vAlpha);
}`;

const UNIFORM_OF = (k) => 'u' + k[0].toUpperCase() + k.slice(1);

export function emptyPatterns() {
  return {
    week: Array(7).fill(0), weekStr: 0, cycleTurns: 0, cycleStr: 0,
    rings: Array.from({ length: 8 }, () => [0, 0]), links: Array.from({ length: 3 }, () => [0, 0, 0, 1]),
    traces: Array(MAX_TRACES).fill(0),
    fresh: Array(MAX_TRACES).fill(0),
  };
}

export function defaultGenome() {
  return {
    expansion: 1, coherence: 0.5, density: 0.5, flow: 0.4, lobes: 2, lobeAmp: 0.4,
    twist: 0.4, elong: 0.4, skirt: 0.5, filament: 0.3, pulse: 0.2, pulseAmp: 0.6,
    glow: 0.7, cyan: 0.5, blue: 0.6, violet: 0.4, orange: 0.1, seedShift: 1.0,
  };
}

export class Organism {
  constructor(count, seed = 1) {
    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 4);
    let x = seed >>> 0 || 1;
    const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    // posición ficticia: el shader la ignora, pero three.js la necesita para el draw count
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);

    this.genome = defaultGenome();
    this.target = defaultGenome();
    const uniforms = {
      uTime: { value: 0 }, uPixelRatio: { value: 1 }, uPointSize: { value: 5.5 },
      uPalette: { value: new THREE.Vector4() },
      uWeek: { value: new Array(7).fill(0) }, uWeekStr: { value: 0 },
      uCycleTurns: { value: 0 }, uCycleStr: { value: 0 },
      uRings: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) },
      uLinks: { value: Array.from({ length: 3 }, () => new THREE.Vector4(0, 0, 0, 1)) },
      uTrace: { value: new Array(24).fill(0) },
      uFocus: { value: 0 },
      uFresh: { value: new Array(24).fill(0) },
      uAbsorb: { value: 0 }, uShell: { value: 0 }, uShellAlpha: { value: 1 },
      uTraceDom: { value: TRACE_DOMAINS },
    };
    this.pat = emptyPatterns();
    this.patTarget = emptyPatterns();
    for (const k of PARAMS) uniforms[UNIFORM_OF(k)] = { value: this.genome[k] };
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this._apply();
  }

  // patrones en forma compacta (patterns.toUniforms); se interpolan igual que el genoma
  setPatterns(p, immediate = false) {
    p = { ...emptyPatterns(), ...p };
    this.patTarget = structuredClone(p);
    // los ángulos de un acoplamiento que aparece no deben barrer desde otro par
    this.patTarget.links.forEach((l, i) => { if (this.pat.links[i][2] < 0.02) this.pat.links[i] = [l[0], l[1], 0, l[3]]; });
    this.patTarget.rings.forEach((r, i) => { if (this.pat.rings[i][1] < 0.02) this.pat.rings[i] = [r[0], 0]; });
    if (immediate) this.pat = structuredClone(p);
    this._applyPatterns();
  }

  setTarget(genome, immediate = false) {
    Object.assign(this.target, genome);
    if (immediate) { Object.assign(this.genome, this.target); this._apply(); }
  }

  // rate ≈ fracción por segundo; transiciones lentas = mutación orgánica
  update(dt, time, rate = 1.2) {
    const f = 1 - Math.exp(-rate * dt);
    for (const k of PARAMS) this.genome[k] += (this.target[k] - this.genome[k]) * f;
    const P = this.pat, T = this.patTarget, lerp = (a, b) => a + (b - a) * f;
    P.week = P.week.map((x, i) => lerp(x, T.week[i]));
    P.weekStr = lerp(P.weekStr, T.weekStr);
    P.cycleTurns = lerp(P.cycleTurns, T.cycleTurns);
    P.cycleStr = lerp(P.cycleStr, T.cycleStr);
    P.rings = P.rings.map((r, i) => r.map((x, j) => lerp(x, T.rings[i][j])));
    P.links = P.links.map((l, i) => l.map((x, j) => (j === 3 ? T.links[i][3] : lerp(x, T.links[i][j]))));
    P.traces = P.traces.map((x, i) => lerp(x, T.traces?.[i] ?? 0));
    P.fresh = P.fresh.map((x, i) => lerp(x, T.fresh?.[i] ?? 0));
    this.material.uniforms.uTime.value = time;
    this._apply();
    this._applyPatterns();
  }

  _applyPatterns() {
    const u = this.material.uniforms, P = this.pat;
    P.week.forEach((x, i) => (u.uWeek.value[i] = x));
    u.uWeekStr.value = P.weekStr;
    u.uCycleTurns.value = P.cycleTurns;
    u.uCycleStr.value = P.cycleStr;
    P.rings.forEach((r, i) => u.uRings.value[i].set(r[0], r[1]));
    P.links.forEach((l, i) => u.uLinks.value[i].set(l[0], l[1], l[2], l[3]));
    P.traces.forEach((x, i) => (u.uTrace.value[i] = x));
    P.fresh.forEach((x, i) => (u.uFresh.value[i] = x));
  }

  _apply() {
    const u = this.material.uniforms, g = this.genome;
    for (const k of PARAMS) if (u[UNIFORM_OF(k)]) u[UNIFORM_OF(k)].value = g[k];
    u.uPalette.value.set(g.cyan, g.blue, g.violet, g.orange);
  }

  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}

// Escena mínima reutilizable (pantalla principal, reloj, exportación).
export class Stage {
  constructor(canvas, { count, maxDpr = 2, controls = null, seed = 1, fov = 38, preserve = false } = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: preserve });
    this.renderer.setClearColor(0x000000, 1);
    this.maxDpr = maxDpr;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 50);
    // vista inclinada sobre el disco de la galaxia
    this.camera.position.set(0, 3.0, 6.6);
    this.camera.lookAt(0, 0, 0);
    this.organism = new Organism(count, seed);
    this.scene.add(this.organism.points);
    this.controls = controls ? controls(this.camera, canvas) : null;
    this.resize();
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || c.width, h = c.clientHeight || c.height;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.organism.material.uniforms.uPixelRatio.value = dpr * (h / 700);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt, time) {
    this.organism.update(dt, time);
    // onda de absorción
    const u = this.organism.material.uniforms.uAbsorb;
    u.value = Math.max(0, u.value - dt * 0.9);
    // cáscaras: se desprenden, se corren al costado, quedan tenues y se desvanecen
    for (const sh of this.shells ?? []) {
      sh.t += dt;
      const k = Math.min(1, sh.t / 3.5), ease = 1 - Math.pow(1 - k, 3);
      // nebulosa: la capa expulsada se expande y se aleja lentamente
      sh.o.points.position.set(0, 0.15 * ease, -0.4 * ease);
      sh.o.points.scale.setScalar(1 + 0.9 * ease);
      sh.o.points.rotation.y = sh.rot + 0.5 * ease;
      const a = sh.t < 3.5 ? 1.3 - 0.95 * ease : Math.max(0, 0.35 - (sh.t - 3.5) * 0.02);
      sh.o.material.uniforms.uShellAlpha.value = a;
      sh.o.update(dt, time * 0.2);
    }
    this.shells = (this.shells ?? []).filter((sh) => {
      if (sh.t < 20) return true;
      this.scene.remove(sh.o.points); sh.o.dispose(); return false;
    });
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Absorber: dispara la onda
  absorb() { this.organism.material.uniforms.uAbsorb.value = 1; }

  // Mudar: la forma anterior se desprende como cáscara translúcida
  shed(genome, patterns) {
    this.shells = this.shells ?? [];
    while (this.shells.length > 2) { const old = this.shells.shift(); this.scene.remove(old.o.points); old.o.dispose(); }
    const o = new Organism(12000, 4721);
    o.material.uniforms.uShell.value = 1;
    o.material.uniforms.uPixelRatio.value = this.organism.material.uniforms.uPixelRatio.value;
    o.setTarget(genome, true);
    if (patterns) o.setPatterns(patterns, true);
    this.scene.add(o.points);
    this.shells.push({ o, t: 0, side: this.shells.length % 2 ? 1 : -1, rot: 0 });
  }

  dispose() { this.organism.dispose(); this.renderer.dispose(); }
}
