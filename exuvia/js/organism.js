// MUTANT — organismo de partículas.
// Toda la forma se calcula en el vertex shader a partir de una semilla fija por
// partícula y de un conjunto de uniforms (el "genoma visual"). La CPU no toca
// las posiciones en cada frame: sólo interpola uniforms. Eso es lo que permite
// decenas de miles de partículas en un teléfono.

import * as THREE from 'three';

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
varying vec3 vColor;
varying float vAlpha;
${SNOISE}
const float TAU = 6.2831853;
void main(){
  float u = aSeed.x, v = aSeed.y, w = aSeed.z, s = aSeed.w;
  // Toda la materia está siempre presente: ningún dato "quita" partículas ni brillo.
  // La densidad sólo decide cómo se distribuye (compacta ↔ dispersa).
  float visible = 1.0;
  float t = uTime * uFlow;

  // bandas fijas: el filamento sólo decide cuánto se agrupan, nunca cuántas bandas hay
  float theta = u * TAU;
  const float BANDS = 36.0;
  float banded = (floor(u * BANDS) + 0.5) / BANDS * TAU + (fract(u * 977.0) - 0.5) * 0.015;
  theta = mix(theta, banded, uFilament * 0.85);

  // cuerpo: volumen con densidad variable hacia la superficie
  float phi = acos(1.0 - 2.0 * v);
  float k = fract(w * 7.31 + s * 3.7);
  float rad = mix(pow(k, 0.33), 0.9 + 0.1 * k, 0.3 + 0.6 * uDensity);
  rad *= 1.0 + (1.0 - uDensity) * 0.45 * pow(fract(s * 13.7), 3.0); // halo cuando es dispersa

  // ESTRATOS: parte de la materia se deposita en capas concéntricas, una por cambio de
  // hábito detectado. El radio codifica la fecha: centro = pasado, superficie = presente.
  float ringGlow = 0.0;
  if (fract(s * 91.7) < 0.4) {
    float jf = floor(fract(s * 17.3) * 8.0);
    for (int i = 0; i < 8; i++) {
      if (float(i) == jf && uRings[i].y > 0.0) {
        float target = mix(0.3, 1.0, uRings[i].x) + (fract(s * 431.0) - 0.5) * 0.012;
        rad = mix(rad, target, uRings[i].y);
        ringGlow = uRings[i].y;
      }
    }
  }
  // lóbulos enteros mezclados: sin costura en theta = 0 y sin saltos entre 2 y 3 lóbulos
  float l0 = floor(uLobes), lf = fract(uLobes);
  float ph = uSeedShift * 2.0 + t * 0.35;
  float lobe = mix(sin(l0 * theta + ph) * sin(phi * (1.0 + floor(l0 * 0.5))),
                   sin((l0 + 1.0) * theta + ph) * sin(phi * (1.0 + floor((l0 + 1.0) * 0.5))), lf);
  rad *= 1.0 + uLobeAmp * 0.38 * lobe;
  vec3 body = vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta)) * rad;
  body.y = body.y * (0.85 + 0.75 * uElong) + 0.15;
  float up = max(body.y, 0.0);
  body.x += 0.45 * sin(uSeedShift) * up * up;
  body.z += 0.35 * cos(uSeedShift * 1.3) * up * up;
  body.xz *= mix(1.0, 0.55, smoothstep(-0.2, 1.5, body.y) * (0.3 + 0.7 * uElong));

  // base: disco que se abre y se curva, como la cola de la referencia
  float r = 0.3 + 0.85 * sqrt(v) * (0.5 + 0.5 * uSkirt);
  float h = -0.92 + 0.10 * sin(theta * 3.0 + r * 5.0 + uSeedShift * 2.3);
  h += 0.22 * r * r * r * (0.3 + uSkirt) + (fract(w * 531.0) - 0.5) * 0.05;
  vec3 skirt = vec3(cos(theta) * r, h, sin(theta) * r);

  // pertenencia continua: al crecer la base, las partículas migran del cuerpo al disco
  vec3 p = mix(body, skirt, smoothstep(w, w + 0.05, uSkirt * 0.42));

  float a = uTwist * p.y * 1.7 + 0.12 * sin(t * 0.4);
  float ca = cos(a), sa = sin(a);
  p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);

  // ESTRUCTURAS: una fracción fija de partículas se reorganiza según los patrones.
  // Con intensidad 0 vuelven al cuerpo; nunca aparecen ni desaparecen de golpe.
  float role = fract(s * 53.13 + v * 3.7);
  float structAmt = 0.0, kind = 0.0;
  vec3 sp = p;
  if (role < 0.07) {
    // RITMO SEMANAL: anillo orbital, un lóbulo por día; el radio es la actividad de ese día
    float d = u * 7.0, i0 = floor(d), f0 = fract(d);
    float w0 = 0.0, w1 = 0.0;
    for (int i = 0; i < 7; i++) {
      if (float(i) == i0) w0 = uWeek[i];
      if (float(i) == mod(i0 + 1.0, 7.0)) w1 = uWeek[i];
    }
    float wv = mix(w0, w1, smoothstep(0.4, 0.6, f0));
    float tick = step(f0, 0.012);
    float rr = 1.3 + 0.42 * wv + (fract(w * 59.0) - 0.5) * 0.06 * (0.3 + wv);
    float yy = 0.1 + (fract(w * 37.0) - 0.5) * (0.035 + 0.3 * tick);
    sp = vec3(cos(u * TAU) * rr, yy, sin(u * TAU) * rr);
    structAmt = smoothstep(0.03, 0.2, uWeekStr); kind = 1.0;
  } else if (role < 0.13) {
    // CICLO: doble hélice; cada vuelta es un ciclo observado
    float ang = v * uCycleTurns * TAU + step(0.5, fract(s * 7.0)) * 3.14159 + t * 0.05;
    float rr = 1.42 + (fract(w * 71.0) - 0.5) * 0.035;
    sp = vec3(cos(ang) * rr, mix(-0.95, 1.55, v), sin(ang) * rr);
    structAmt = uCycleStr; kind = 2.0;
  } else if (role < 0.19) {
    // ACOPLAMIENTOS: arco entre los nodos de dos variables que se mueven juntas
    float jf = floor(fract(s * 11.0) * 3.0);
    vec4 L = vec4(0.0);
    for (int i = 0; i < 3; i++) { if (float(i) == jf) L = uLinks[i]; }
    vec3 A = vec3(cos(L.x) * 0.95, 0.35 + 0.45 * sin(L.x * 2.0), sin(L.x) * 0.95);
    vec3 B = vec3(cos(L.y) * 0.95, 0.35 + 0.45 * sin(L.y * 2.0), sin(L.y) * 0.95);
    vec3 m = (A + B) * 0.5;
    vec3 c = m + normalize(m + vec3(0.0, 0.6, 0.0)) * 0.9;
    sp = mix(mix(A, c, v), mix(c, B, v), v) + (vec3(fract(w * 13.0), fract(w * 29.0), fract(w * 47.0)) - 0.5) * 0.03;
    structAmt = L.z; kind = L.w < 0.0 ? 4.0 : 3.0;
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

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uPointSize * (0.55 + 1.4 * pow(fract(s * 113.0), 4.0));
  gl_PointSize = visible * sz * uPixelRatio * (3.2 / -mv.z);

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
  col = mix(col, vec3(0.8, 0.95, 1.0), ringGlow * 0.45 * (1.0 - structAmt));
  vColor = col;
  vAlpha = visible * (0.35 + 0.75 * uGlow) * (0.5 + 0.5 * fract(s * 71.0));
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
    this.camera.position.set(0, 0.35, 6.4);
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
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() { this.organism.dispose(); this.renderer.dispose(); }
}
