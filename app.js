'use strict';
/* Lienzo AR: muestra el boceto y los dibujos sobre la cámara del celular y los mantiene pegados
   al lienzo siguiendo puntos de la imagen (flujo óptico Lucas-Kanade + homografía RANSAC, jsfeat). */

const $ = s => document.querySelector(s);
const SRC_W = 3870, SRC_H = 2640;
const KEY = 'lienzo-ar-v1';
const COLORS = ['#ff2d78', '#00e5ff', '#ffe600', '#39ff6a', '#ffffff', '#ff8a00'];

const SRCS = {
  boceto:       { file: 'boceto_lineas.png', w: SRC_W, h: SRC_H },
  banderines:   { file: 'dibujos/banderines.svg', w: 1800, h: 520, vector: true, color: 'dibujos/banderines_color.svg' },
  calabaza:     { file: 'dibujos/calabaza.svg', w: 800, h: 760, vector: true, color: 'dibujos/calabaza_color.svg' },
  guitarra:     { file: 'dibujos/guitarra.svg', w: 400, h: 1100, vector: true, color: 'dibujos/guitarra_color.svg' },
  cara_estatua: { file: 'dibujos/cara_estatua.svg', w: 600, h: 800, vector: true, color: 'dibujos/cara_estatua_color.svg' },
  copihues:     { file: 'dibujos/copihues.svg', w: 900, h: 760, vector: true, color: 'dibujos/copihues_color.svg' },
  f_calabaza:   { file: 'dibujos/foto_calabaza.png', w: 1520, h: 1680 },
  f_aguila:     { file: 'dibujos/foto_aguila.png', w: 1703, h: 1756, color: 'dibujos/foto_aguila_color.png' },
  f_guitarra:   { file: 'dibujos/foto_guitarra.png', w: 869, h: 2400 },
  f_estatua:    { file: 'dibujos/foto_estatua.png', w: 1041, h: 1800, color: 'dibujos/foto_estatua_color.png' },
  f_piramide:   { file: 'dibujos/foto_piramide.png', w: 1789, h: 942, color: 'dibujos/foto_piramide_color.png' },
  f_loro:       { file: 'dibujos/foto_loro.png', w: 1035, h: 1800 },
  f_picado:     { file: 'dibujos/foto_papel_picado.png', w: 973, h: 974, color: 'dibujos/foto_papel_picado_color.png' },
  f_picado_g:   { file: 'dibujos/foto_papel_picado_guirnalda.png', w: 7519, h: 1326, color: 'dibujos/foto_papel_picado_guirnalda_color.png' },
};
// Dónde va cada dibujo según el boceto: [x, y, ancho, alto] en coordenadas de boceto_lineas.png
const ANCLAS = {
  calabaza: [300, 1560, 420, 360], f_calabaza: [300, 1540, 420, 400],
  guitarra: [2170, 1960, 240, 680], f_guitarra: [2170, 1960, 240, 680],
  f_aguila: [2960, 360, 760, 460], f_piramide: [1100, 1700, 680, 540],
  f_loro: [1100, 1950, 520, 690], f_estatua: [0, 560, 560, 1700], cara_estatua: [20, 820, 300, 400],
  f_picado_g: [0, 70, 980, 400], banderines: [2760, 40, 1110, 420],
};
const PRESETS = [
  ['Máscara + pirámide', [680, 1440, 1100, 790]],
  ['Pajarito y flores', [860, 2120, 1110, 520]],
  ['Huemul / venado', [2620, 1700, 720, 940]],
  ['Ave volando + flor', [2960, 40, 910, 700]],
  ['Picaflor', [2970, 1700, 220, 200]],
  ['Marco rectangular', [1890, 1420, 990, 480]],
];
const FOTOS = [
  ['Calabaza', 'f_calabaza'], ['Águila', 'f_aguila'], ['Guitarra Coco', 'f_guitarra'],
  ['Estatua (Snoopy)', 'f_estatua'], ['Pirámide maya', 'f_piramide'], ['Loro en la rama', 'f_loro'],
  ['Papel picado guirnalda', 'f_picado_g'], ['Papel picado 1', 'f_picado'],
];
const DIBUJOS = [
  ['Banderines de América', 'banderines'], ['Calabaza', 'calabaza'], ['Guitarra', 'guitarra'],
  ['Cara de la estatua', 'cara_estatua'], ['Copihues', 'copihues'],
];

const stage = $('#stage'), ov = $('#ov');
const IM = {}, RT = new Map();
let S = null;              // estado guardado: capas, selección, ajustes
let edit = true;           // modo Ajustar: se pueden mover las capas
let brushMode = null;      // 'tapar' | 'destapar' | null

function W() { return innerWidth; }
function H() { return innerHeight; }
function toast(t) { const e = $('#toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toast.t); toast.t = setTimeout(() => e.style.opacity = 0, 2400); }

// ---------------------------------------------------------------- matrices 3x3 (fila)
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function mul(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return C;
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
function ap(Hm, [x, y]) { const w = Hm[6] * x + Hm[7] * y + Hm[8]; return [(Hm[0] * x + Hm[1] * y + Hm[2]) / w, (Hm[3] * x + Hm[4] * y + Hm[5]) / w]; }
function sq2q(p) {  // cuadrado unitario -> cuadrilátero (Heckbert)
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, d = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / d; h = (dx1 * sy - sx * dy1) / d;
  }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

// Hcur lleva las coordenadas guardadas (pantalla al anclar) a la pantalla actual
let Hcur = I3.slice();
function stored(L) { return L.q.map(([x, y]) => [x * W(), y * H()]); }
function px(L) { return stored(L).map(p => ap(Hcur, p)); }
function setDisplayed(L, pts) { const Hi = inv3(Hcur); L.q = pts.map(p => { const [x, y] = ap(Hi, p); return [x / W(), y / H()]; }); }
function screenToUV(L, x, y) { return ap(inv3(sq2q(px(L))), [x, y]); }
function centro(p) { return [p.reduce((s, q) => s + q[0], 0) / 4, p.reduce((s, q) => s + q[1], 0) / 4]; }

// ---------------------------------------------------------------- estado
function defaultState() {
  const s = { layers: [], sel: null, dim: 0.15, brushSize: 50 };
  S = s; const L = mkLayer('Boceto completo', [0, 0, SRC_W, SRC_H], 'boceto'); L.op = 0.85;
  s.layers.push(L); s.sel = L.id; return s;
}
function anclaEnPantalla(box, ar) {
  const B = S && S.layers.find(l => l.src === 'boceto' && l.crop[2] === SRC_W);
  if (!box || !B) return null;
  let [bx, by, bw, bh] = box;
  if (bw / bh > ar) { const w = bh * ar; bx += (bw - w) / 2; bw = w; } else { const h = bw / ar; by += (bh - h) / 2; bh = h; }
  const Hb = sq2q(px(B));
  return [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]].map(([x, y]) => ap(Hb, [x / SRC_W, y / SRC_H]));
}
function mkLayer(name, crop, src) {
  const ar = crop[2] / crop[3], sw = W(), sh = H();
  const L = { id: Date.now() + Math.random(), name, src, crop, color: COLORS[0], op: 1, bold: 1, vis: true, mask: null, q: null };
  const anc = anclaEnPantalla(src === 'boceto' ? (crop[2] < SRC_W ? crop : null) : ANCLAS[src], ar);
  let pts = anc;
  if (!pts) {
    let w = Math.min(sw * 0.9, sh * 0.8 * ar), h = w / ar;
    if (src !== 'boceto') { w = Math.min(sw * 0.6, sh * 0.5 * ar); h = w / ar; }
    const x = (sw - w) / 2, y = (sh - h) / 2;
    pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  setDisplayed(L, pts);
  return L;
}
function save() {
  if (!S) return;
  // el tapado y los colores pesan mucho para localStorage: van a IndexedDB
  for (const L of S.layers) {
    const r = RT.get(L.id); if (!r) continue;
    if (r.maskDirty) { r.maskDirty = false; r.mask.toBlob(b => b && DB.set('mask:' + L.id, b)); }
    if (r.colDirty) { r.colDirty = false; r.col.toBlob(b => b && DB.set('col:' + L.id, b)); }
  }
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { }
}
// almacenamiento local de imágenes (tapado, colores, imágenes propias)
const DB = {
  open() {
    return this.p || (this.p = new Promise(ok => {
      try { const r = indexedDB.open('lienzo-ar', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }
      catch (e) { ok(null); }
    }));
  },
  async get(k) { const db = await this.open(); if (!db) return null; return new Promise(ok => { try { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => ok(q.result ?? null); q.onerror = () => ok(null); } catch (e) { ok(null); } }); },
  async set(k, v) { const db = await this.open(); if (!db) return; return new Promise(ok => { try { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = ok; t.onerror = ok; } catch (e) { ok(); } }); },
  async del(k) { const db = await this.open(); if (!db) return; return new Promise(ok => { try { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = ok; t.onerror = ok; } catch (e) { ok(); } }); },
};
function blobAImagen(b) { return new Promise(ok => { if (!b) return ok(null); const u = URL.createObjectURL(b), im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = u; }); }
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.layers) return s; } catch (e) { }
  return null;
}
function sel() { return S.layers.find(l => l.id === S.sel); }

// ---------------------------------------------------------------- dibujo de capas
function ensureRT(L) {
  let r = RT.get(L.id);
  if (r) return r;
  const big = Math.max(L.crop[2], L.crop[3]), k = SRCS[L.src].vector ? 1600 / big : Math.min(1, 2400 / big);
  const cw = Math.round(L.crop[2] * k), ch = Math.round(L.crop[3] * k);
  const cv = document.createElement('canvas'); cv.className = 'layer'; cv.width = cw; cv.height = ch;
  const lienzo = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const mask = lienzo(), col = lienzo(), tmp = lienzo();
  stage.insertBefore(cv, ov);
  r = { cv, mask, col, tmp, cw, ch, handles: [], undo: [] };
  RT.set(L.id, r);
  const recuperar = async (clave, destino, viejo) => {
    const im = await blobAImagen(await DB.get(clave + ':' + L.id)) || (viejo ? await new Promise(ok => { const m = new Image(); m.onload = () => ok(m); m.onerror = () => ok(null); m.src = viejo; }) : null);
    if (im) { destino.getContext('2d').drawImage(im, 0, 0, cw, ch); paint(L); }
  };
  recuperar('mask', mask, L.mask); recuperar('col', col);
  for (let i = 0; i < 5; i++) {
    const d = document.createElement('div'); d.className = 'h' + (i === 4 ? ' c' : '');
    d.addEventListener('pointerdown', ev => startHandle(ev, L, i));
    stage.appendChild(d); r.handles.push(d);
  }
  return r;
}
function paint(L) {
  const r = ensureRT(L), c = r.cv.getContext('2d'), t = r.tmp.getContext('2d');
  // líneas teñidas en un lienzo aparte
  t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, r.cw, r.ch);
  const [sx, sy, sw, sh] = L.crop, offs = [[0, 0]];
  for (let i = 1; i <= L.bold; i++) offs.push([i, 0], [-i, 0], [0, i], [0, -i]);
  for (const [dx, dy] of offs) t.drawImage(IM[L.src], sx, sy, sw, sh, dx, dy, r.cw, r.ch);
  t.globalCompositeOperation = 'source-in'; t.fillStyle = L.color; t.fillRect(0, 0, r.cw, r.ch);
  t.globalCompositeOperation = 'source-over';
  // colores sugeridos debajo, líneas encima
  c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, r.cw, r.ch);
  if (L.verCol !== false) { c.globalAlpha = L.colOp ?? 0.6; c.drawImage(r.col, 0, 0); c.globalAlpha = 1; }
  c.drawImage(r.tmp, 0, 0);
  c.globalCompositeOperation = 'destination-out'; c.drawImage(r.mask, 0, 0);
  c.globalCompositeOperation = 'source-over';
}
function place() {
  for (const [id, r] of RT) if (!S.layers.find(l => l.id === id)) { r.cv.remove(); r.handles.forEach(h => h.remove()); RT.delete(id); }
  let svg = '';
  S.layers.forEach((L, idx) => {
    const r = ensureRT(L), p = px(L), [a, b, c, d, e, f, g, h] = sq2q(p);
    r.cv.style.zIndex = idx + 1;
    r.cv.style.transform = `matrix3d(${a / r.cw},${d / r.cw},0,${g / r.cw},${b / r.ch},${e / r.ch},0,${h / r.ch},0,0,1,0,${c},${f},0,1)`;
    r.cv.style.opacity = L.op; r.cv.style.display = L.vis ? '' : 'none';
    const isSel = L.id === S.sel && L.vis && edit && !brushMode && !colorMode;
    [...p, centro(p)].forEach(([x, y], i) => { const hd = r.handles[i]; hd.style.left = x + 'px'; hd.style.top = y + 'px'; hd.style.display = isSel ? '' : 'none'; });
    if (L.id === S.sel && L.vis && edit) svg += `<polygon points="${p.map(q => q.join(',')).join(' ')}" fill="none" stroke="#ffe600" stroke-dasharray="8 6" stroke-width="2"/>`;
  });
  if (T.debug && T.vis) for (const i of T.vis) { const [x, y] = ap(T.Sm, [T.cur[2 * i], T.cur[2 * i + 1]]); svg += `<circle cx="${x}" cy="${y}" r="2" fill="#39ff6a"/>`; }
  ov.innerHTML = svg;
}

// ---------------------------------------------------------------- cámara y fuente de imagen
const video = $('#cam'), demo = $('#demo');
let fuente = null, vw = 0, vh = 0, track = null, demoImg = null, wake = null;
async function abrirCamara() {
  if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('La cámara solo funciona si abres la app desde su dirección https.');
  const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  track = st.getVideoTracks()[0];
  try { const cap = track.getCapabilities?.(); if (cap?.zoom && cap.zoom.min <= 1 && cap.zoom.max >= 1) await track.applyConstraints({ advanced: [{ zoom: 1 }] }); if (cap?.torch) $('#bTorch').hidden = false; } catch (e) { }
  video.srcObject = st; await video.play();
  fuente = video; vw = video.videoWidth; vh = video.videoHeight;
  video.addEventListener('resize', () => { vw = video.videoWidth; vh = video.videoHeight; T.setup(); });
}
function abrirDemo() {
  return new Promise((ok, ko) => {
    demoImg = new Image(); demoImg.onload = () => { video.hidden = true; demo.hidden = false; demo.width = 1280; demo.height = 960; fuente = demo; vw = 1280; vh = 960; ok(); };
    demoImg.onerror = () => ko(new Error('No encuentro lienzo_demo.jpg'));
    demoImg.src = 'lienzo_demo.jpg';
  });
}
function dibujarDemo(t) {  // simula un celular en la mano: pequeños movimientos lentos
  const c = demo.getContext('2d'), s = t / 1000;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#ddd'; c.fillRect(0, 0, 1280, 960);
  c.translate(640 + 45 * Math.sin(s * 0.5), 480 + 30 * Math.cos(s * 0.37));
  c.rotate(0.05 * Math.sin(s * 0.29)); const k = 0.8 * (1 + 0.06 * Math.sin(s * 0.41)); c.scale(k, k);
  c.drawImage(demoImg, -800, -600);
}
async function pedirWake() { try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && fuente) pedirWake(); });
let torchOn = false;
$('#bTorch').onclick = async () => { torchOn = !torchOn; try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { toast('Este celular no permite encender la luz desde la app'); } $('#bTorch').classList.toggle('on', torchOn); };

// ---------------------------------------------------------------- seguimiento (jsfeat)
// Al anclar se guarda la imagen de referencia y una lista fija de puntos con textura. En cada cuadro se
// deforma la referencia con la última homografía y se buscan los puntos con flujo óptico (Lucas-Kanade):
// como siempre se compara contra la referencia, el error no se acumula con el tiempo.
const T = {
  on: false, debug: false, n: 0, ok: 0, lostFrames: 0, frame: 0,
  setup() {
    if (!vw) return;
    this.k = 640 / Math.max(vw, vh); this.pw = Math.round(vw * this.k); this.ph = Math.round(vh * this.k);
    this.cnv = document.createElement('canvas'); this.cnv.width = this.pw; this.cnv.height = this.ph;
    this.ctx = this.cnv.getContext('2d', { willReadFrequently: true });
    const typ = jsfeat.U8_t | jsfeat.C1_t;
    this.curr = new jsfeat.pyramid_t(3); this.curr.allocate(this.pw, this.ph, typ);
    this.wpyr = new jsfeat.pyramid_t(3); this.wpyr.allocate(this.pw, this.ph, typ);
    this.refImg = new jsfeat.matrix_t(this.pw, this.ph, typ);
    this.blur = new jsfeat.matrix_t(this.pw, this.ph, typ);
    this.Mw = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t);
    this.corners = []; for (let i = 0; i < this.pw * this.ph; i++) this.corners.push(new jsfeat.keypoint_t(0, 0, 0, 0, -1));
    this.MAX = 300;
    this.ref = new Float32Array(this.MAX * 2); this.cur = new Float32Array(this.MAX * 2);
    this.pred = new Float32Array(this.MAX * 2); this.status = new Uint8Array(this.MAX); this.good = new Uint8Array(this.MAX);
    this.Hp = I3.slice(); this.n = 0; this.on = false;
    this.calcS();
  },
  calcS() {  // proc -> pantalla (video con object-fit: cover)
    const s = Math.max(W() / vw, H() / vh), ox = (W() - vw * s) / 2, oy = (H() - vh * s) / 2, f = s / this.k;
    this.Sm = [f, 0, ox, 0, f, oy, 0, 0, 1]; this.Si = inv3(this.Sm);
  },
  grab() {
    this.ctx.drawImage(fuente, 0, 0, this.pw, this.ph);
    const d = this.ctx.getImageData(0, 0, this.pw, this.ph);
    jsfeat.imgproc.grayscale(d.data, this.pw, this.ph, this.curr.data[0]);
    this.curr.build(this.curr.data[0], true);
  },
  region() {  // zona visible en pantalla (en px de proceso); el lienzo y la pared son planos y sirven
    const a = ap(this.Si, [0, 0]), b = ap(this.Si, [W(), H()]);
    return [Math.max(12, a[0]), Math.max(12, a[1]), Math.min(this.pw - 12, b[0]), Math.min(this.ph - 12, b[1])];
  },
  anclar() {
    // las capas quedan guardadas tal como se ven ahora; desde aquí la homografía parte de cero
    for (const L of S.layers) setDisplayed(L, px(L));
    Hcur = I3.slice(); this.Hp = I3.slice(); this.calcS();
    this.refImg.data.set(this.curr.data[0].data);
    // puntos con textura, repartidos en una grilla (el lápiz sobre tela blanca tiene poco contraste)
    jsfeat.imgproc.gaussian_blur(this.refImg, this.blur, 3);
    let cnt = 0;
    for (const th of [20, 12, 8, 5, 3]) { jsfeat.fast_corners.set_threshold(th); cnt = jsfeat.fast_corners.detect(this.blur, this.corners, 8); if (cnt > 800) break; }
    const [x0, y0, x1, y1] = this.region(), cell = 16, gw = Math.ceil(this.pw / cell), occ = new Uint8Array(gw * Math.ceil(this.ph / cell));
    const cand = [];
    for (let i = 0; i < cnt; i++) { const c = this.corners[i]; if (c.x >= x0 && c.x < x1 && c.y >= y0 && c.y < y1) cand.push(c); }
    cand.sort((a, b) => b.score - a.score);
    this.n = 0;
    for (const c of cand) {
      if (this.n >= this.MAX) break;
      const g = ((c.y / cell) | 0) * gw + ((c.x / cell) | 0); if (occ[g]) continue; occ[g] = 1;
      this.ref[2 * this.n] = c.x; this.ref[2 * this.n + 1] = c.y; this.n++;
    }
    this.on = true; this.lostFrames = 0; this.ok = this.n;
    save();
    return this.n;
  },
  soltar() { for (const L of S.layers) setDisplayed(L, px(L)); Hcur = I3.slice(); this.Hp = I3.slice(); this.on = false; this.n = 0; save(); },
  step() {
    this.grab(); this.frame++;
    if (!this.on || this.n < 10) return;
    const n = this.n, Hp = this.Hp;
    // referencia deformada a la posición esperada
    const Hi = inv3(Hp); for (let i = 0; i < 9; i++) this.Mw.data[i] = Hi[i];
    jsfeat.imgproc.warp_perspective(this.refImg, this.wpyr.data[0], this.Mw, 0);
    this.wpyr.build(this.wpyr.data[0], true);
    for (let i = 0; i < n; i++) { const [x, y] = ap(Hp, [this.ref[2 * i], this.ref[2 * i + 1]]); this.pred[2 * i] = x; this.pred[2 * i + 1] = y; }
    jsfeat.optical_flow_lk.track(this.wpyr, this.curr, this.pred, this.cur, n, 15, 30, this.status, 0.01, 0.0008);
    const from = [], to = [], idx = [];
    for (let i = 0; i < n; i++) {
      const px0 = this.pred[2 * i], py0 = this.pred[2 * i + 1], x = this.cur[2 * i], y = this.cur[2 * i + 1];
      if (this.status[i] !== 1 || px0 < 10 || py0 < 10 || px0 > this.pw - 10 || py0 > this.ph - 10) continue;
      if (x < 2 || y < 2 || x > this.pw - 2 || y > this.ph - 2) continue;
      from.push({ x: this.ref[2 * i], y: this.ref[2 * i + 1] }); to.push({ x, y }); idx.push(i);
    }
    let ok = false;
    const m = from.length;
    if (m >= 12) {
      const M = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t), mask = new jsfeat.matrix_t(m, 1, jsfeat.U8_t | jsfeat.C1_t);
      const kern = new jsfeat.motion_model.homography2d();
      if (jsfeat.motion_estimator.ransac(new jsfeat.ransac_params_t(4, 2, 0.5, 0.995), kern, from, to, m, M, mask, 600)) {
        // reajuste con todos los puntos que concuerdan (RANSAC solo usa 4)
        const fi = [], ti = [];
        for (let i = 0; i < m; i++) if (mask.data[i]) { fi.push(from[i]); ti.push(to[i]); }
        if (fi.length >= 12) kern.run(fi, ti, M, fi.length);
        const Hn = Array.from(M.data); const s9 = Hn[8] || 1; for (let i = 0; i < 9; i++) Hn[i] /= s9;
        if (fi.length >= Math.max(12, m * 0.3) && cuerdo(Hn, this)) {
          for (let i = 0; i < 9; i++) this.Hp[i] = this.Hp[i] * 0.3 + Hn[i] * 0.7;  // suavizado leve, sin retraso visible
          this.ok = fi.length; ok = true;
        }
      }
    }
    this.lostFrames = ok ? 0 : this.lostFrames + 1;
    if (!ok) this.ok = 0;
    this.vis = idx; // para el modo depuración
    Hcur = mul(this.Sm, mul(this.Hp, this.Si));
  },
};
// rechaza homografías absurdas (saltos o deformaciones grandes)
function cuerdo(Hn, t) {
  const c = [[0, 0], [t.pw, 0], [t.pw, t.ph], [0, t.ph]].map(p => ap(Hn, p));
  for (const [x, y] of c) if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 4 * t.pw + t.pw || Math.abs(y) > 4 * t.ph + t.ph) return false;
  let area = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = c[i], [x2, y2] = c[(i + 1) % 4]; area += x1 * y2 - x2 * y1; }
  area = area / 2 / (t.pw * t.ph);
  return area > 0.15 && area < 6;
}

function estado() {
  const e = $('#estado'), sp = e.querySelector('span');
  e.classList.remove('ok', 'warn');
  if (!T.on) sp.textContent = edit ? 'Alinea el boceto y toca Anclar' : 'Sin anclar';
  else if (T.lostFrames > 8) { e.classList.add('warn'); sp.textContent = 'Buscando el lienzo… apunta como al anclar'; }
  else { e.classList.add('ok'); sp.textContent = 'Siguiendo el lienzo · ' + T.ok + ' puntos'; }
}

function loop(t) {
  if (fuente) {
    if (fuente === demo) dibujarDemo(t);
    if (vw && T.pw) { try { T.step(); } catch (e) { console.error(e); } }
  }
  if (S) place();
  if ((loop.k = (loop.k || 0) + 1) % 10 === 0) estado();
  requestAnimationFrame(loop);
}
addEventListener('resize', () => { if (!S) return; if (T.on) T.soltar(); T.calcS && vw && T.calcS(); actualizarBarra(); place(); });

// ---------------------------------------------------------------- tacto: esquinas, mover, pellizcar, pincel
const ptrs = new Map();
let drag = null;
function startHandle(ev, L, i) {
  if (!edit || brushMode) return;
  ev.stopPropagation(); ev.preventDefault();
  S.sel = L.id; drag = { type: 'corner', L, i, x: ev.clientX, y: ev.clientY, p0: px(L) };
  ev.target.setPointerCapture?.(ev.pointerId); renderSheet();
}
function hitLayer(x, y) {
  for (let k = S.layers.length - 1; k >= 0; k--) {
    const L = S.layers[k]; if (!L.vis) continue;
    const [u, v] = screenToUV(L, x, y); if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return L;
  }
  return null;
}
function brushAt(x, y) {
  const L = sel(); if (!L) return;
  const r = ensureRT(L), [u, v] = screenToUV(L, x, y), p = px(L);
  const rad = S.brushSize / 2 * r.cw / Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
  const m = r.mask.getContext('2d');
  m.globalCompositeOperation = brushMode === 'tapar' ? 'source-over' : 'destination-out';
  m.fillStyle = '#000'; m.beginPath(); m.arc(u * r.cw, v * r.ch, rad, 0, 7); m.fill();
  r.maskDirty = true; paint(L);
}
stage.addEventListener('pointerdown', ev => {
  if (ev.target.classList.contains('h')) return;
  ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
  stage.setPointerCapture(ev.pointerId);
  if (colorMode) { if (tocarColor(ev.clientX, ev.clientY)) drag = { type: 'colorbrush' }; return; }
  if (brushMode) { drag = { type: 'brush' }; brushAt(ev.clientX, ev.clientY); return; }
  if (!edit) return;
  if (ptrs.size === 2 && sel()) {
    const [a, b] = [...ptrs.values()];
    drag = { type: 'pinch', L: sel(), a0: a, b0: b, p0: px(sel()) }; return;
  }
  const L = hitLayer(ev.clientX, ev.clientY);
  if (L) { S.sel = L.id; drag = { type: 'move', L, x: ev.clientX, y: ev.clientY, p0: px(L) }; renderSheet(); }
});
addEventListener('pointermove', ev => {
  if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (!drag) return;
  if (drag.type === 'brush') { brushAt(ev.clientX, ev.clientY); return; }
  if (drag.type === 'colorbrush') { pincelColor(ev.clientX, ev.clientY); return; }
  if (drag.type === 'corner') {
    const p = drag.p0.map(q => q.slice()), dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (drag.i === 4) p.forEach(q => { q[0] += dx; q[1] += dy; }); else { p[drag.i][0] += dx; p[drag.i][1] += dy; }
    setDisplayed(drag.L, p);
  } else if (drag.type === 'move') {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    setDisplayed(drag.L, drag.p0.map(([x, y]) => [x + dx, y + dy]));
  } else if (drag.type === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], { a0, b0 } = drag;
    const s = Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, Math.hypot(b0[0] - a0[0], b0[1] - a0[1]));
    const r = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
    const m0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const co = Math.cos(r) * s, si = Math.sin(r) * s;
    setDisplayed(drag.L, drag.p0.map(([x, y]) => [m1[0] + (x - m0[0]) * co - (y - m0[1]) * si, m1[1] + (x - m0[0]) * si + (y - m0[1]) * co]));
  }
});
function finPtr(ev) {
  ptrs.delete(ev.pointerId);
  if (drag && (drag.type !== 'pinch' || ptrs.size < 2)) { drag = null; save(); }
}
addEventListener('pointerup', finPtr); addEventListener('pointercancel', finPtr);

// ---------------------------------------------------------------- barra y hoja de opciones
function actualizarBarra() {
  $('#bAnclar').classList.toggle('on', T.on);
  $('#bAnclar').innerHTML = T.on ? '<b>📌</b>Anclado' : '<b>📌</b>Anclar';
  $('#bAjustar').classList.toggle('on', edit);
  document.body.classList.toggle('locked', !edit);
  const nov = document.body.classList.contains('nooverlay');
  $('#bVer').innerHTML = nov ? '<b>👁</b>Mostrar' : '<b>👁</b>Ocultar';
  $('#bVer').classList.toggle('on', nov);
  $('#shade').style.opacity = S ? S.dim : 0;
  estado();
}
$('#bAnclar').onclick = () => {
  if (!vw) return;
  if (T.on) { T.soltar(); toast('Soltado: el dibujo ya no sigue al celular'); }
  else {
    const n = T.anclar();
    if (n < 20) { T.soltar(); toast('Veo muy pocos detalles. Acércate o ilumina mejor el lienzo.'); }
    else { edit = false; toast('Anclado. Toca ✋ Ajustar si necesitas mover algo.'); }
  }
  actualizarBarra();
};
$('#bAjustar').onclick = () => { edit = !edit; actualizarBarra(); };
$('#bVer').onclick = () => { document.body.classList.toggle('nooverlay'); actualizarBarra(); };
$('#bCapas').onclick = () => { renderSheet(); $('#sheet').hidden = false; };
$('#cerrarSheet').onclick = () => { $('#sheet').hidden = true; };
$('#estado').onclick = () => { T.debug = !T.debug; };

function renderSheet() {
  if (!S) return;
  const L = sel();
  $('#capas').innerHTML = S.layers.map(l => `<div class="c ${l.id === S.sel ? 'sel' : ''}" data-id="${l.id}">
      <span class="dot" style="background:${l.color};opacity:${l.vis ? 1 : .25}"></span><span class="n">${l.name}</span>
      <button data-a="vis" aria-label="Mostrar u ocultar">${l.vis ? '👁' : '🚫'}</button><button data-a="del" aria-label="Quitar">✕</button></div>`).join('');
  $('#capas').querySelectorAll('.c').forEach(d => d.onclick = ev => {
    const l = S.layers.find(x => String(x.id) === d.dataset.id); if (!l) return;
    const a = ev.target.dataset.a;
    if (a === 'vis') l.vis = !l.vis;
    else if (a === 'del') { S.layers = S.layers.filter(x => x !== l); DB.del('mask:' + l.id); DB.del('col:' + l.id); if (S.sel === l.id) S.sel = S.layers.length ? S.layers[S.layers.length - 1].id : null; }
    else S.sel = l.id;
    save(); renderSheet();
  });
  $('#colores').innerHTML = COLORS.map(c => `<button class="sw ${L && L.color === c ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="Color ${c}"></button>`).join('');
  $('#colores').querySelectorAll('.sw').forEach(b => b.onclick = () => { const l = sel(); if (!l) return; l.color = b.dataset.c; paint(l); save(); renderSheet(); });
  $('#op').value = L ? L.op : 1; $('#bold').value = L ? L.bold : 1; $('#dim').value = S.dim;
  renderColorUI();
}
$('#op').oninput = e => { const L = sel(); if (L) { L.op = +e.target.value; save(); } };
$('#bold').oninput = e => { const L = sel(); if (L) { L.bold = +e.target.value; paint(L); save(); } };
$('#dim').oninput = e => { S.dim = +e.target.value; $('#shade').style.opacity = S.dim; save(); };
function setBrush(m) {
  brushMode = m;
  $('#brushBar').hidden = !m;
  $('#bbTapar').classList.toggle('on', m === 'tapar'); $('#bbDestapar').classList.toggle('on', m === 'destapar');
  $('#bbSize').value = S.brushSize;
}
$('#bPincel').onclick = () => { if (!sel()) return; $('#sheet').hidden = true; setColorMode(false); setBrush('tapar'); toast('Pinta con el dedo sobre lo que ya está dibujado'); };
$('#bbTapar').onclick = () => setBrush('tapar');
$('#bbDestapar').onclick = () => setBrush('destapar');
$('#bbListo').onclick = () => { setBrush(null); save(); };
$('#bbSize').oninput = e => { S.brushSize = +e.target.value; };
$('#bLimpiar').onclick = () => { const L = sel(); if (!L) return; const r = ensureRT(L); r.mask.getContext('2d').clearRect(0, 0, r.cw, r.ch); L.mask = null; DB.del('mask:' + L.id); paint(L); save(); };
$('#bReset').onclick = () => { $('#resetConf').hidden = false; };
$('#bResetNo').onclick = () => { $('#resetConf').hidden = true; };
$('#bResetSi').onclick = () => { $('#resetConf').hidden = true; if (T.on) T.soltar(); defaultState(); paint(S.layers[0]); save(); renderSheet(); actualizarBarra(); };

function addLayer(name, crop, src) {
  const L = mkLayer(name, crop, src); L.color = COLORS[S.layers.length % COLORS.length]; S.layers.push(L); S.sel = L.id; ensureRT(L); paint(L);
  edit = true; actualizarBarra(); save(); renderSheet(); $('#sheet').hidden = true;
  toast('Agregado: ' + name + (ANCLAS[src] || src === 'boceto' ? ' (en su lugar del boceto)' : ''));
}
$('#presets').innerHTML = PRESETS.map((p, i) => `<button data-i="${i}">${p[0]}</button>`).join('');
$('#presets').querySelectorAll('button').forEach(b => b.onclick = () => addLayer(...PRESETS[+b.dataset.i], 'boceto'));
$('#fotos').innerHTML = FOTOS.map((d, i) => `<button data-i="${i}">📷 ${d[0]}</button>`).join('');
$('#fotos').querySelectorAll('button').forEach(b => b.onclick = () => { const [n, k] = FOTOS[+b.dataset.i]; addLayer(n, [0, 0, SRCS[k].w, SRCS[k].h], k); });
$('#dibujos').innerHTML = DIBUJOS.map((d, i) => `<button data-i="${i}">★ ${d[0]}</button>`).join('');
$('#dibujos').querySelectorAll('button').forEach(b => b.onclick = () => { const [n, k] = DIBUJOS[+b.dataset.i]; addLayer(n, [0, 0, SRCS[k].w, SRCS[k].h], k); });

// recorte libre del boceto
let crop = null, cdrag = null;
const cimg = $('#cropimg'), cbox = $('#cropbox');
$('#bRecorte').onclick = () => { $('#sheet').hidden = true; $('#modal').hidden = false; crop = null; cbox.hidden = true; };
$('#cropNo').onclick = () => { $('#modal').hidden = true; };
cimg.addEventListener('pointerdown', e => { const r = cimg.getBoundingClientRect(); cdrag = [e.clientX - r.left, e.clientY - r.top]; cimg.setPointerCapture(e.pointerId); });
cimg.addEventListener('pointermove', e => {
  if (!cdrag) return; const r = cimg.getBoundingClientRect();
  const x = Math.max(0, Math.min(r.width, e.clientX - r.left)), y = Math.max(0, Math.min(r.height, e.clientY - r.top));
  const x0 = Math.min(cdrag[0], x), y0 = Math.min(cdrag[1], y), w = Math.abs(x - cdrag[0]), h = Math.abs(y - cdrag[1]);
  cbox.hidden = false; Object.assign(cbox.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
  const k = SRC_W / r.width; crop = [x0 * k, y0 * k, w * k, h * k].map(Math.round);
});
cimg.addEventListener('pointerup', () => cdrag = null);
$('#cropOk').onclick = () => {
  if (!crop || crop[2] < 30 || crop[3] < 30) { toast('Primero arrastra un rectángulo sobre el boceto'); return; }
  $('#modal').hidden = true; addLayer('Recorte ' + S.layers.length, crop, 'boceto');
};

// ---------------------------------------------------------------- inicio
const cargarImagenes = Promise.all(Object.entries(SRCS).map(([k, d]) => new Promise(ok => {
  const im = new Image(); im.onload = () => { IM[k] = im; ok(); }; im.onerror = () => ok(); im.src = d.file;
})));
async function empezar(modo) {
  $('#error').hidden = true;
  try {
    await cargarImagenes;
    if (modo === 'demo') await abrirDemo(); else await abrirCamara();
    await cargarPropias();
  } catch (e) {
    const msg = e && e.name === 'NotAllowedError' ? 'No diste permiso para usar la cámara. Actívalo en la configuración del navegador para este sitio y vuelve a intentar.' : (e.message || String(e));
    $('#error').textContent = msg; $('#error').hidden = false; return;
  }
  S = load() || defaultState();
  S.layers = S.layers.filter(L => IM[L.src]);
  S.layers.forEach(L => { ensureRT(L); paint(L); });
  T.setup(); pedirWake();
  $('#inicio').hidden = true;
  actualizarBarra(); renderSheet();
}
$('#bCam').onclick = () => empezar('cam');
$('#bDemo').onclick = () => empezar('demo');
if (location.hash === '#demo') empezar('demo');
requestAnimationFrame(loop);
