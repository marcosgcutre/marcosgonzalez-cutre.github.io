// SHARE MUTATION: imagen, animación y enlace.
// Privacidad por defecto: la tarjeta sólo lleva el organismo y el nombre de la
// mutación. Cada indicador se agrega explícitamente.

import { Stage, PARAMS } from './organism.js';
import { RULES, GLOW } from './genome.js';

const W = 1080, H = 1350;

function makeStage(genome, size, count, seed, patterns) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const st = new Stage(c, { count, maxDpr: 1, seed, preserve: true });
  st.renderer.setPixelRatio(1);
  st.renderer.setSize(size, size, false);
  st.organism.material.uniforms.uPixelRatio.value = size / 700;
  st.organism.setTarget(genome, true);
  if (patterns) st.organism.setPatterns(patterns, true);
  return st;
}

function compose(ctx, organismCanvas, info, opts) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(organismCanvas, 100, 190, W - 200, W - 200); // termina en y=1070, sin pisar el texto
  ctx.fillStyle = '#e8f6ff';
  ctx.textAlign = 'center';
  ctx.font = '300 64px Montserrat, sans-serif';
  ctx.letterSpacing = '28px';
  ctx.fillText('EXUVIA', W / 2 + 14, 110);
  ctx.letterSpacing = '6px';
  ctx.font = '400 22px "Space Grotesk", sans-serif';
  ctx.fillStyle = '#3ff0ff';
  ctx.fillText(`SPECIMEN ${info.mutantId} · M${String(info.stage + 1).padStart(2, '0')} ${info.name}`, W / 2, 152);
  ctx.fillStyle = '#e8f6ff';
  ctx.font = '200 96px Montserrat, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText(String(info.age), W / 2, 1150);
  ctx.font = '400 20px "Space Grotesk", sans-serif';
  ctx.letterSpacing = '6px';
  ctx.fillStyle = '#7fa6c9';
  ctx.fillText(info.ageLabel ?? 'CICLO ACTUAL · DÍAS', W / 2, 1182);

  const chosen = info.indicators.filter((x) => opts.include.has(x.id));
  if (chosen.length) {
    const cw = W / chosen.length;
    chosen.forEach((x, i) => {
      const cx = cw * i + cw / 2;
      ctx.fillStyle = '#7fa6c9'; ctx.font = '400 18px "Space Grotesk", sans-serif'; ctx.letterSpacing = '4px';
      ctx.fillText(`${x.code} · ${x.label}`.toUpperCase(), cx, 1240);
      ctx.fillStyle = '#e8f6ff'; ctx.font = '300 34px Montserrat, sans-serif'; ctx.letterSpacing = '2px';
      ctx.fillText(`${x.count}/28 · ${x.value} ${x.unit}`, cx, 1282);
    });
  }
  ctx.fillStyle = '#ff7a2f'; ctx.font = '400 16px "Space Grotesk", sans-serif'; ctx.letterSpacing = '8px';
  ctx.fillText('EVERY HABIT LEAVES A TRACE', W / 2, H - 22);
  ctx.letterSpacing = '0px';
}

export async function shareImage(genome, info, opts) {
  await document.fonts?.ready; // sin esto el texto de la tarjeta sale en la fuente de sistema
  const st = makeStage(genome, W, 70000, info.seed, info.patterns);
  st.render(0, info.time);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  compose(out.getContext('2d'), st.renderer.domElement, info, opts);
  st.dispose();
  const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
  return deliver(blob, `exuvia-mutation-${info.stage + 1}.png`);
}

export async function shareVideo(genome, info, opts, seconds = 4, onProgress) {
  await document.fonts?.ready;
  const st = makeStage(genome, W, 60000, info.seed, info.patterns);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  if (!mime) throw new Error('Este navegador no permite grabar vídeo desde canvas.');
  const rec = new MediaRecorder(out.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start();
  const t0 = performance.now();
  await new Promise((resolve) => {
    const frame = () => {
      const el = (performance.now() - t0) / 1000;
      st.scene.rotation.y = (el / seconds) * Math.PI * 0.5;
      st.render(1 / 30, info.time + el);
      compose(ctx, st.renderer.domElement, info, opts);
      onProgress?.(Math.min(1, el / seconds));
      if (el < seconds) requestAnimationFrame(frame); else resolve();
    };
    frame();
  });
  rec.stop(); await done; st.dispose();
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  return deliver(new Blob(chunks, { type: mime.split(';')[0] }), `exuvia-mutation-${info.stage + 1}.${ext}`);
}

async function deliver(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'EXUVIA' }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

// ---- Enlace: sólo geometría cuantizada (1 byte por valor), sin datos ----
const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (str) => [...atob(str.replace(/-/g, '+').replace(/_/g, '/'))].map((c) => c.charCodeAt(0));
const q = (x, max = 1) => Math.max(0, Math.min(255, Math.round((x / max) * 255)));
const dq = (b, max = 1) => (b / 255) * max;
const TAU = Math.PI * 2;

export function encodeGenome(genome, meta, patterns) {
  const bytes = PARAMS.filter((k) => RULES[k]).map((k) => {
    const r = RULES[k]; return q(genome[k] - r.min, r.max - r.min);
  });
  bytes.push(q(genome.seedShift % 64, 64), meta.stage & 255);
  let url = `${location.origin}${location.pathname}#m=${b64(bytes)}&n=${encodeURIComponent(meta.name)}&id=${meta.mutantId}`;
  if (patterns) {
    const pb = [...patterns.week.map((x) => q(x)), q(patterns.weekStr), q(patterns.cycleTurns, 20), q(patterns.cycleStr),
      ...patterns.rings.flatMap(([a, b]) => [q(a), q(b)]),
      ...patterns.links.flatMap(([a, b, c, d]) => [q(a, TAU), q(b, TAU), q(c), d >= 0 ? 255 : 0]),
      ...(patterns.traces ?? []).map((x) => q(x))];
    url += `&p=${b64(pb)}`;
  }
  return url;
}

export function decodeGenome(hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (!p.get('m')) return null;
  let bytes;
  try { bytes = unb64(p.get('m')); } catch { return null; } // enlace roto → app normal
  const keys = PARAMS.filter((k) => RULES[k]);
  if (bytes.length < keys.length + 1) return null;
  const g = { glow: GLOW }; let i = 0;
  for (const k of keys) { const r = RULES[k]; g[k] = r.min + dq(bytes[i++], r.max - r.min); }
  g.seedShift = dq(bytes[i++], 64);
  let patterns = null;
  try {
    const b = p.get('p') ? unb64(p.get('p')) : null;
    if (b && b.length >= 38) {
      let j = 0;
      patterns = {
        week: Array.from({ length: 7 }, () => dq(b[j++])), weekStr: dq(b[j++]),
        cycleTurns: dq(b[j++], 20), cycleStr: dq(b[j++]),
        rings: Array.from({ length: 8 }, () => [dq(b[j++]), dq(b[j++])]),
        links: Array.from({ length: 3 }, () => [dq(b[j++], TAU), dq(b[j++], TAU), dq(b[j++]), b[j++] ? 1 : -1]),
        traces: Array.from({ length: 24 }, () => (j < b.length ? dq(b[j++]) : 0)),
      };
    }
  } catch { patterns = null; }
  return { genome: g, stage: bytes[i] ?? 0, name: p.get('n') ?? '', mutantId: p.get('id') ?? '', patterns };
}
