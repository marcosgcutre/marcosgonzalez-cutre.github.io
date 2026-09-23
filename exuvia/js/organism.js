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
varying vec3 vColor;
varying float vAlpha;
${SNOISE}
const float TAU = 6.2831853;
void main(){
  float u = aSeed.x, v = aSeed.y, w = aSeed.z, s = aSeed.w;
  // aparición/desaparición gradual: sin partículas que "saltan" al cambiar la densidad
  float visible = smoothstep(s - 0.04, s + 0.04, 0.3 + 0.7 * uDensity);
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

  float chaos = mix(0.34, 0.035, uCoherence);
  vec3 q = p * 1.5 + vec3(uSeedShift * 3.1);
  float tt = t * 0.25;
  vec3 disp = vec3(snoise(q + vec3(0.0, 0.0, tt)),
                   snoise(q + vec3(31.4, 0.0, tt)),
                   snoise(q + vec3(0.0, 47.2, tt)));
  p += disp * chaos;

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
    };
    for (const k of PARAMS) uniforms[UNIFORM_OF(k)] = { value: this.genome[k] };
    this.material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this._apply();
  }

  setTarget(genome, immediate = false) {
    Object.assign(this.target, genome);
    if (immediate) { Object.assign(this.genome, this.target); this._apply(); }
  }

  // rate ≈ fracción por segundo; transiciones lentas = mutación orgánica
  update(dt, time, rate = 1.2) {
    const f = 1 - Math.exp(-rate * dt);
    for (const k of PARAMS) this.genome[k] += (this.target[k] - this.genome[k]) * f;
    this.material.uniforms.uTime.value = time;
    this._apply();
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
