'use strict';
/* Lienzo AR — extras: colorear tocando, colores sugeridos, imágenes propias y generador de banderines
   (incluye papel picado estilo Coco). Usa las funciones y el estado de app.js. */

const PINTURAS = ['#d52b1e', '#ff7a00', '#ffd100', '#2bb24c', '#00a6a6', '#1e88e5', '#0039a6', '#7b2cbf',
  '#e4007c', '#f4a6c6', '#8b5a2b', '#e3a865', '#f2d0a9', '#8cc7b0', '#ffffff', '#222222'];
let colorMode = false, pintura = PINTURAS[0], herramienta = 'balde';
const IMC = {};  // imágenes de colores sugeridos ya cargadas

// ---------------------------------------------------------------- colores sugeridos
function tieneSugerencia(L) { return !!(L && SRCS[L.src] && SRCS[L.src].color); }
function cargarSugerencia(src) {
  if (IMC[src]) return Promise.resolve(IMC[src]);
  return new Promise(ok => { const im = new Image(); im.onload = () => ok(IMC[src] = im); im.onerror = () => ok(null); im.src = SRCS[src].color; });
}
async function aplicarSugerencia(L, silencio) {
  const im = await cargarSugerencia(L.src); if (!im) { if (!silencio) toast('Este dibujo no trae colores sugeridos. Usa 🎨 Colorear.'); return; }
  const r = ensureRT(L), c = r.col.getContext('2d'), [sx, sy, sw, sh] = L.crop;
  guardarDeshacer(r);
  c.clearRect(0, 0, r.cw, r.ch); c.drawImage(im, sx, sy, sw, sh, 0, 0, r.cw, r.ch);
  L.verCol = true; r.colDirty = true; paint(L); save(); renderSheet();
}

// ---------------------------------------------------------------- colorear tocando (balde de pintura)
function guardarDeshacer(r) { r.undo.push(r.col.getContext('2d').getImageData(0, 0, r.cw, r.ch)); if (r.undo.length > 6) r.undo.shift(); }
function barrera(L, cierre) {
  // líneas como muro; "cierre" engrosa las líneas para tapar aberturas del lápiz
  const r = ensureRT(L);
  r.bars = r.bars || {};
  const clave = L.bold + ':' + cierre;
  if (r.bars[clave]) return r.bars[clave];
  const w = r.cw, h = r.ch, n = w * h;
  if (!r.base) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'), [sx, sy, sw, sh] = L.crop;
    x.drawImage(IM[L.src], sx, sy, sw, sh, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    r.base = new Uint8Array(n);
    for (let i = 0; i < n; i++) r.base[i] = d[i * 4 + 3] > 50 ? 1 : 0;
  }
  const b = r.base.slice();
  for (let k = 0; k < cierre; k++) {
    const o = b.slice();
    for (let y = 1; y < h - 1; y++) for (let xx = 1, i = y * w + 1; xx < w - 1; xx++, i++)
      if (!o[i] && (o[i - 1] | o[i + 1] | o[i - w] | o[i + w])) b[i] = 1;
  }
  r.bars[clave] = b;
  return b;
}
function inundar(bar, w, h, x0, y0) {
  if (bar[y0 * w + x0]) {  // tocó justo una línea: buscar el espacio libre más cercano
    let hallado = false;
    for (let rad = 1; rad < 12 && !hallado; rad++) for (let dy = -rad; dy <= rad && !hallado; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = x0 + dx, y = y0 + dy; if (x >= 0 && y >= 0 && x < w && y < h && !bar[y * w + x]) { x0 = x; y0 = y; hallado = true; break; }
    }
    if (!hallado) return null;
  }
  const lleno = new Uint8Array(w * h), pila = [x0, y0];
  let cuenta = 0;
  while (pila.length) {
    const y = pila.pop(), x = pila.pop(), fila = y * w;
    if (lleno[fila + x]) continue;
    let xl = x; while (xl > 0 && !bar[fila + xl - 1] && !lleno[fila + xl - 1]) xl--;
    let xr = x; while (xr < w - 1 && !bar[fila + xr + 1] && !lleno[fila + xr + 1]) xr++;
    for (let xx = xl; xx <= xr; xx++) {
      lleno[fila + xx] = 1; cuenta++;
      if (y > 0 && !bar[fila - w + xx] && !lleno[fila - w + xx]) pila.push(xx, y - 1);
      if (y < h - 1 && !bar[fila + w + xx] && !lleno[fila + w + xx]) pila.push(xx, y + 1);
    }
  }
  return { lleno, cuenta };
}
function relleno(L, u, v) {
  const r = ensureRT(L), w = r.cw, h = r.ch;
  const x0 = Math.floor(u * w), y0 = Math.floor(v * h);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;
  // si el color se escapa por una abertura, probar cerrando aberturas cada vez más grandes
  const escala = Math.max(1, Math.round(w / 1200));
  let res = null, bar = null, escapo = true;
  for (const cierre of [2, 4, 7, 11].map(c => c * escala)) {
    bar = barrera(L, cierre);
    res = inundar(bar, w, h, x0, y0);
    if (!res) return;
    if (res.cuenta < 0.25 * w * h) { escapo = false; break; }
  }
  if (escapo) { toast('Esa zona no está cerrada y el color se escapaba. Píntala con 🖌 Pincel.'); return res.cuenta / (w * h); }
  // que el color llegue hasta debajo de las líneas (sin bordes blancos)
  const m = res.lleno;
  for (let k = 0; k < 3 + 2 * escala; k++) {
    const o = m.slice();
    for (let y = 1; y < h - 1; y++) for (let xx = 1, i = y * w + 1; xx < w - 1; xx++, i++)
      if (!o[i] && bar[i] && (o[i - 1] | o[i + 1] | o[i - w] | o[i + w])) m[i] = 1;
  }
  guardarDeshacer(r);
  const cx = r.col.getContext('2d'), img = cx.getImageData(0, 0, w, h), d = img.data;
  const cr = parseInt(pintura.slice(1, 3), 16), cg = parseInt(pintura.slice(3, 5), 16), cb = parseInt(pintura.slice(5, 7), 16);
  for (let i = 0; i < w * h; i++) if (m[i]) { const j = i * 4; d[j] = cr; d[j + 1] = cg; d[j + 2] = cb; d[j + 3] = 255; }
  cx.putImageData(img, 0, 0);
  L.verCol = true; r.colDirty = true; paint(L); save();
  return res.cuenta / (w * h);
}
function setColorMode(on) {
  colorMode = on;
  if (on) setBrush(null);
  $('#colorBar').hidden = !on;
  $('#sheet').hidden = true;
  place();
}
function pintarBarra() {
  $('#pinturas').innerHTML = PINTURAS.map(c => `<button class="sw ${c === pintura ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="Color ${c}"></button>`).join('');
  $('#pinturas').querySelectorAll('.sw').forEach(b => b.onclick = () => { pintura = b.dataset.c; pintarBarra(); });
}
// toque sobre el escenario en modo colorear (lo llama app.js); devuelve true si sigue pintando al arrastrar
function tocarColor(x, y) {
  const L = herramienta === 'pincel' ? sel() : (hitLayer(x, y) || sel()); if (!L) return false;
  S.sel = L.id;
  if (herramienta === 'pincel') { guardarDeshacer(ensureRT(L)); pincelColor.ult = null; pincelColor(x, y); return true; }
  const [u, v] = screenToUV(L, x, y);
  relleno(L, u, v);
  return false;
}
function pincelColor(x, y) {
  const L = sel(); if (!L) return;
  const r = ensureRT(L), [u, v] = screenToUV(L, x, y), p = px(L);
  const rad = S.brushSize / 2 * r.cw / Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
  const c = r.col.getContext('2d'), x1 = u * r.cw, y1 = v * r.ch;
  // trazo continuo desde el punto anterior
  c.strokeStyle = c.fillStyle = pintura; c.lineCap = 'round'; c.lineWidth = rad * 2;
  c.beginPath(); if (pincelColor.ult) { c.moveTo(...pincelColor.ult); c.lineTo(x1, y1); c.stroke(); } else { c.arc(x1, y1, rad, 0, 7); c.fill(); }
  pincelColor.ult = [x1, y1];
  L.verCol = true; r.colDirty = true; paint(L);
}
function marcarHerramienta() {
  $('#cbBalde').classList.toggle('on', herramienta === 'balde'); $('#cbPincel').classList.toggle('on', herramienta === 'pincel');
  $('#cbTam').hidden = herramienta !== 'pincel'; $('#cbTam').value = S.brushSize;
}
$('#cbBalde').onclick = () => { herramienta = 'balde'; marcarHerramienta(); };
$('#cbPincel').onclick = () => { herramienta = 'pincel'; marcarHerramienta(); toast('Pinta con el dedo sobre el dibujo'); };
$('#cbTam').oninput = e => { S.brushSize = +e.target.value; };
$('#bColorear').onclick = () => { if (!sel()) return; pintarBarra(); marcarHerramienta(); setColorMode(true); toast('Toca dentro de una zona del dibujo para pintarla'); };
$('#cbListo').onclick = () => setColorMode(false);
$('#cbUndo').onclick = () => { const L = sel(); if (!L) return; const r = ensureRT(L); const u = r.undo.pop(); if (!u) return; r.col.getContext('2d').putImageData(u, 0, 0); r.colDirty = true; paint(L); save(); };
$('#cbOtro').oninput = e => { pintura = e.target.value; pintarBarra(); };
$('#bSugerir').onclick = () => { const L = sel(); if (L) aplicarSugerencia(L); };
$('#bVerCol').onclick = () => { const L = sel(); if (!L) return; L.verCol = L.verCol === false; paint(L); save(); renderSheet(); };
$('#colOp').oninput = e => { const L = sel(); if (!L) return; L.colOp = +e.target.value; paint(L); save(); };
$('#bBorrarCol').onclick = () => { const L = sel(); if (!L) return; const r = ensureRT(L); guardarDeshacer(r); r.col.getContext('2d').clearRect(0, 0, r.cw, r.ch); r.colDirty = true; paint(L); save(); };
function renderColorUI() {
  const L = sel();
  $('#bSugerir').hidden = !tieneSugerencia(L);
  $('#bVerCol').textContent = L && L.verCol === false ? 'Mostrar colores' : 'Ocultar colores';
  $('#colOp').value = L ? (L.colOp ?? 0.6) : 0.6;
}

// ---------------------------------------------------------------- imágenes propias (guardadas en el celular)
const KEY_PROPIAS = KEY + '-propias';
function listaPropias() { try { return JSON.parse(localStorage.getItem(KEY_PROPIAS)) || []; } catch (e) { return []; } }
function guardarLista(l) { try { localStorage.setItem(KEY_PROPIAS, JSON.stringify(l)); } catch (e) { } }
async function cargarPropias() {
  for (const p of listaPropias()) {
    const lineas = await blobAImagen(await DB.get('src:' + p.id));
    if (!lineas) continue;
    IM[p.id] = lineas;
    const cb = await DB.get('srccol:' + p.id);
    SRCS[p.id] = { w: p.w, h: p.h, propia: true, color: cb ? URL.createObjectURL(cb) : null };
  }
  renderPropias();
}
function renderPropias() {
  const l = listaPropias().filter(p => IM[p.id]);
  $('#propias').innerHTML = l.length ? l.map(p => `<div class="c"><span class="n">${p.name.replace(/</g, '&lt;')}</span><button data-a="add" data-id="${p.id}">＋ Agregar</button><button data-a="del" data-id="${p.id}" aria-label="Borrar">✕</button></div>`).join('')
    : '<p class="nota">Aquí aparecen las imágenes que subas y los banderines que generes.</p>';
  $('#propias').querySelectorAll('button').forEach(b => b.onclick = async () => {
    const p = listaPropias().find(q => q.id === b.dataset.id); if (!p) return;
    if (b.dataset.a === 'add') { addLayer(p.name, [0, 0, p.w, p.h], p.id); if (SRCS[p.id].color) aplicarSugerencia(sel(), true); }
    else { guardarLista(listaPropias().filter(q => q.id !== p.id)); DB.del('src:' + p.id); DB.del('srccol:' + p.id); renderPropias(); }
  });
}
async function nuevaFuente(nombre, lineas, color) {
  const id = 'u' + Date.now().toString(36);
  const bL = await new Promise(ok => lineas.toBlob(ok)), bC = color ? await new Promise(ok => color.toBlob(ok)) : null;
  await DB.set('src:' + id, bL); if (bC) await DB.set('srccol:' + id, bC);
  IM[id] = await blobAImagen(bL);
  SRCS[id] = { w: lineas.width, h: lineas.height, propia: true, color: bC ? URL.createObjectURL(bC) : null };
  guardarLista([...listaPropias(), { id, name: nombre, w: lineas.width, h: lineas.height }]);
  renderPropias();
  addLayer(nombre, [0, 0, lineas.width, lineas.height], id);
  if (bC) aplicarSugerencia(sel(), true);
}

// ---------------------------------------------------------------- ➕ nueva imagen: foto o dibujo -> líneas
const NI = { img: null, w: 0, h: 0, g: null, rgb: null, crop: null, modo: 'lapiz' };
function desenfocar(src, w, h, rad) {  // tres pasadas de caja ≈ gaussiana
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let p = 0; p < 3; p++) {
    for (let y = 0; y < h; y++) {
      let s = 0; const f = y * w;
      for (let x = -rad; x <= rad; x++) s += a[f + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { b[f + x] = s / (2 * rad + 1); s += a[f + Math.min(w - 1, x + rad + 1)] - a[f + Math.max(0, x - rad)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -rad; y <= rad; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { a[y * w + x] = s / (2 * rad + 1); s += b[Math.min(h - 1, y + rad + 1) * w + x] - b[Math.max(0, y - rad) * w + x]; }
    }
  }
  return a;
}
function cargarNueva(file) {
  const u = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    const k = Math.min(1, 1400 / Math.max(im.width, im.height));
    const w = Math.round(im.width * k), h = Math.round(im.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    Object.assign(NI, { img: c, w, h, g, rgb: d, crop: [0, 0, w, h] });
    $('#niNombre').value = file.name.replace(/\.[^.]+$/, '').slice(0, 30);
    $('#niPaso2').hidden = false;
    procesarNueva();
  };
  im.onerror = () => toast('No pude abrir esa imagen');
  im.src = u;
}
function procesarNueva() {
  const { w, h, g, rgb } = NI; if (!g) return;
  const det = +$('#niDetalle').value, tinta = new Float32Array(w * h);
  if (NI.modo === 'lapiz') {
    const bg = desenfocar(g, w, h, Math.max(8, Math.round(Math.max(w, h) / 40)));
    const th = 0.12 - 0.09 * det, gan = 3 + 5 * det;
    for (let i = 0; i < w * h; i++) { const b = Math.max(bg[i], g[i], 1), dd = 1 - g[i] / b; tinta[i] = Math.min(1, Math.max(0, (dd - th) * gan)); }
  } else {
    const gb = desenfocar(g, w, h, 1), th = 70 - 55 * det;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gb[i - w + 1] + 2 * gb[i + 1] + gb[i + w + 1] - gb[i - w - 1] - 2 * gb[i - 1] - gb[i + w - 1];
      const gy = gb[i + w - 1] + 2 * gb[i + w] + gb[i + w + 1] - gb[i - w - 1] - 2 * gb[i - w] - gb[i - w + 1];
      tinta[i] = Math.min(1, Math.max(0, (Math.hypot(gx, gy) - th) / 40));
    }
  }
  // fondo: color del borde de la imagen
  let fondo = null;
  if ($('#niFondo').checked) {
    const s = [0, 0, 0]; let n = 0;
    const tomar = i => { s[0] += rgb[i * 4]; s[1] += rgb[i * 4 + 1]; s[2] += rgb[i * 4 + 2]; n++; };
    for (let x = 0; x < w; x += 4) { tomar(x); tomar((h - 1) * w + x); }
    for (let y = 0; y < h; y += 4) { tomar(y * w); tomar(y * w + w - 1); }
    const f = s.map(v => v / n);
    fondo = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const dist = Math.hypot(rgb[i * 4] - f[0], rgb[i * 4 + 1] - f[1], rgb[i * 4 + 2] - f[2]); fondo[i] = dist > 45 ? 1 : 0; }
    fondo = desenfocar(fondo, w, h, 3);
    for (let i = 0; i < w * h; i++) { fondo[i] = fondo[i] > 0.3 ? 1 : 0; tinta[i] *= fondo[i]; }
  }
  // salida recortada
  const [cx, cy, cw, ch] = NI.crop.map(Math.round);
  const L = document.createElement('canvas'); L.width = cw; L.height = ch;
  const C = document.createElement('canvas'); C.width = cw; C.height = ch;
  const li = L.getContext('2d').createImageData(cw, ch), co = C.getContext('2d').createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = (y + cy) * w + (x + cx), j = (y * cw + x) * 4;
    li.data[j] = li.data[j + 1] = li.data[j + 2] = 255; li.data[j + 3] = tinta[i] * 255;
    co.data[j] = rgb[i * 4]; co.data[j + 1] = rgb[i * 4 + 1]; co.data[j + 2] = rgb[i * 4 + 2]; co.data[j + 3] = fondo ? fondo[i] * 255 : 255;
  }
  L.getContext('2d').putImageData(li, 0, 0); C.getContext('2d').putImageData(co, 0, 0);
  NI.lineas = L; NI.color = C;
  // vista previa: líneas sobre la imagen apagada
  const pv = $('#niPrev'); pv.width = w; pv.height = h;
  const p = pv.getContext('2d');
  p.fillStyle = '#111'; p.fillRect(0, 0, w, h);
  p.globalAlpha = 0.35; p.drawImage(NI.img, 0, 0); p.globalAlpha = 1;
  const t = document.createElement('canvas'); t.width = cw; t.height = ch; const tx = t.getContext('2d');
  tx.drawImage(L, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#ff2d78'; tx.fillRect(0, 0, cw, ch);
  p.drawImage(t, cx, cy);
  p.strokeStyle = '#ffe600'; p.lineWidth = Math.max(2, w / 300); p.setLineDash([12, 8]); p.strokeRect(cx, cy, cw, ch);
}
$('#bNueva').onclick = () => { $('#sheet').hidden = true; $('#mNueva').hidden = false; $('#niPaso2').hidden = !NI.g; };
$('#niArchivo').onchange = e => { const f = e.target.files && e.target.files[0]; if (f) cargarNueva(f); e.target.value = ''; };
$('#niDetalle').oninput = () => procesarNueva();
$('#niFondo').onchange = () => procesarNueva();
document.querySelectorAll('#niModo button').forEach(b => b.onclick = () => {
  NI.modo = b.dataset.m; document.querySelectorAll('#niModo button').forEach(x => x.classList.toggle('on', x === b)); procesarNueva();
});
$('#niNo').onclick = () => { $('#mNueva').hidden = true; };
$('#niTodo').onclick = () => { NI.crop = [0, 0, NI.w, NI.h]; procesarNueva(); };
$('#niOk').onclick = async () => {
  if (!NI.lineas) { toast('Primero elige una imagen'); return; }
  $('#mNueva').hidden = true;
  await nuevaFuente($('#niNombre').value.trim() || 'Mi imagen', NI.lineas, NI.color);
};
// recortar arrastrando sobre la vista previa
(() => {
  const pv = $('#niPrev'); let a = null;
  const pos = e => { const r = pv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * NI.w, (e.clientY - r.top) / r.height * NI.h]; };
  pv.addEventListener('pointerdown', e => { if (!NI.g) return; a = pos(e); pv.setPointerCapture(e.pointerId); });
  pv.addEventListener('pointermove', e => {
    if (!a) return; const b = pos(e);
    const x0 = Math.max(0, Math.min(a[0], b[0])), y0 = Math.max(0, Math.min(a[1], b[1]));
    const x1 = Math.min(NI.w, Math.max(a[0], b[0])), y1 = Math.min(NI.h, Math.max(a[1], b[1]));
    if (x1 - x0 > 20 && y1 - y0 > 20) { NI.crop = [x0, y0, x1 - x0, y1 - y0]; procesarNueva(); }
  });
  pv.addEventListener('pointerup', () => a = null);
})();

// ---------------------------------------------------------------- 🎏 generador de banderines
const PALETAS = {
  coco: ['#e4007c', '#ff7a00', '#00a6a6', '#7b2cbf', '#ffd100', '#2bb24c', '#ff3b3b', '#1e88e5'],
  chile: ['#d52b1e', '#ffffff', '#0039a6'],
  arcoiris: ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'],
  pastel: ['#f8b4c8', '#ffd59e', '#fff3a0', '#b8e6b0', '#a9d6f5', '#d5b8f0'],
};
// figuras recortadas del papel picado (caja -50..50)
const FIGURAS = {
  calavera: ['M0,-42 C-26,-42 -38,-22 -38,-2 C-38,12 -30,20 -22,24 L-22,40 L22,40 L22,24 C30,20 38,12 38,-2 C38,-22 26,-42 0,-42 Z',
    'M-15,-6 m-10,0 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0 Z', 'M15,-6 m-10,0 a10,10 0 1,0 20,0 a10,10 0 1,0 -20,0 Z',
    'M0,8 L-6,18 L6,18 Z', 'M-12,28 L-12,38 M-4,28 L-4,38 M4,28 L4,38 M12,28 L12,38'],
  guitarra: ['M0,-6 C-14,-6 -20,2 -18,12 C-17,18 -24,20 -24,30 C-24,40 -12,46 0,46 C12,46 24,40 24,30 C24,20 17,18 18,12 C20,2 14,-6 0,-6 Z',
    'M0,20 m-7,0 a7,7 0 1,0 14,0 a7,7 0 1,0 -14,0 Z', 'M-4,-6 L-4,-38 L4,-38 L4,-6 Z', 'M-7,-38 L-7,-48 L7,-48 L7,-38 Z'],
  flor: ['M0,-10 C8,-38 26,-30 14,-8 C38,-18 40,4 14,4 C34,20 18,36 4,14 C2,40 -18,36 -6,14 C-28,30 -40,12 -14,4 C-40,-4 -32,-24 -12,-8 C-24,-30 -8,-40 0,-10 Z',
    'M0,0 m-8,0 a8,8 0 1,0 16,0 a8,8 0 1,0 -16,0 Z'],
  corazon: ['M0,36 C-30,14 -40,-4 -32,-20 C-24,-36 -6,-34 0,-18 C6,-34 24,-36 32,-20 C40,-4 30,14 0,36 Z',
    'M0,16 C-12,6 -16,-2 -12,-10 C-8,-16 -2,-14 0,-8 C2,-14 8,-16 12,-10 C16,-2 12,6 0,16 Z'],
  estrella: ['M0,-40 L10,-12 L40,-12 L16,6 L25,36 L0,18 L-25,36 L-16,6 L-40,-12 L-10,-12 Z'],
};
const BG = { forma: 'coco', n: 7, curva: 0.5, paleta: 'coco', figura: 'mezcla' };
function generarBanderines() {
  const n = BG.n, W = 2400, fw = W / (n * 1.12 + 0.12), gap = fw * 0.12;
  const fh = BG.forma === 'tri' ? fw * 1.2 : BG.forma === 'rect' ? fw * 0.8 : fw * 1.1;
  const top = 40, sag = BG.curva * fh * 0.9, H = Math.ceil(top + sag + fh + 40);
  const L = document.createElement('canvas'); L.width = W; L.height = H;
  const C = document.createElement('canvas'); C.width = W; C.height = H;
  const l = L.getContext('2d'), c = C.getContext('2d');
  const yc = x => top + sag * 4 * (x / W) * (1 - x / W);
  l.strokeStyle = '#fff'; l.lineJoin = l.lineCap = 'round'; l.lineWidth = 6;
  l.beginPath(); for (let x = 0; x <= W; x += 8) x ? l.lineTo(x, yc(x)) : l.moveTo(x, yc(x)); l.stroke();
  const pal = PALETAS[BG.paleta], figs = Object.keys(FIGURAS).filter(k => k !== 'estrella');
  for (let i = 0; i < n; i++) {
    const xc = gap + fw / 2 + i * (fw + gap), ang = Math.atan(sag * 4 * (1 - 2 * xc / W) / W);
    for (const ctx of [l, c]) { ctx.save(); ctx.translate(xc, yc(xc)); ctx.rotate(ang); }
    const hw = fw / 2, forma = new Path2D(), huecos = new Path2D();
    if (BG.forma === 'tri') { forma.moveTo(-hw, 0); forma.lineTo(hw, 0); forma.lineTo(0, fh); forma.closePath(); }
    else if (BG.forma === 'rect') { forma.rect(-hw, 0, fw, fh); }
    else {
      // papel picado: borde inferior con ondas
      const ond = 3, base = fh * 0.86, r = fw / ond / 2;
      forma.moveTo(-hw, 0); forma.lineTo(hw, 0); forma.lineTo(hw, base);
      for (let k = ond - 1; k >= 0; k--) { const cx0 = -hw + r + k * 2 * r; forma.arc(cx0, base, r, 0, Math.PI, false); }
      forma.closePath();
      // figura central
      const fig = BG.figura === 'mezcla' ? figs[i % figs.length] : BG.figura, s = fw * 0.55 / 100, cy = fh * 0.45;
      const m = new DOMMatrix().translate(0, cy).scale(s);
      for (const d of FIGURAS[fig]) huecos.addPath(new Path2D(d), m);
      // puntitos del borde y franja de triángulos bajo el doblez
      const mg = fw * 0.09, rr = fw * 0.018;
      for (let x = -hw + mg; x <= hw - mg + 1; x += (fw - 2 * mg) / 8) { const p = new Path2D(); p.arc(x, base - mg * 0.4, rr, 0, 7); huecos.addPath(p); }
      for (let y = fh * 0.2; y < base - mg; y += (base - fh * 0.2) / 6) for (const x of [-hw + mg * 0.7, hw - mg * 0.7]) { const p = new Path2D(); p.arc(x, y, rr, 0, 7); huecos.addPath(p); }
      const z = new Path2D(), tz = fw / 12; z.moveTo(-hw + mg, fh * 0.11);
      for (let k = 0; k < 10; k++) { z.lineTo(-hw + mg + (k + 0.5) * (fw - 2 * mg) / 10, fh * 0.11 + tz * 0.6); z.lineTo(-hw + mg + (k + 1) * (fw - 2 * mg) / 10, fh * 0.11); }
      l.lineWidth = 3; l.stroke(z); l.lineWidth = 6;
      // esquinas: florcitas
      for (const [x, y] of [[-hw + mg * 1.8, fh * 0.22], [hw - mg * 1.8, fh * 0.22], [-hw + mg * 1.8, base - mg * 1.6], [hw - mg * 1.8, base - mg * 1.6]])
        huecos.addPath(new Path2D(FIGURAS.flor[0]), new DOMMatrix().translate(x, y).scale(fw * 0.0016));
    }
    const color = pal[i % pal.length];
    c.fillStyle = color;
    const todo = new Path2D(forma); todo.addPath(huecos);
    c.fill(todo, 'evenodd');
    l.lineWidth = 6; l.stroke(forma);
    l.lineWidth = 4; l.stroke(huecos);
    l.lineWidth = 3; l.beginPath(); l.moveTo(-hw, fh * 0.06); l.lineTo(hw, fh * 0.06); l.stroke();  // doblez sobre la cuerda
    for (const ctx of [l, c]) ctx.restore();
  }
  BG.lineas = L; BG.color = C;
  const pv = $('#bgPrev'); pv.width = W / 2; pv.height = H / 2;
  const p = pv.getContext('2d'); p.fillStyle = '#f4efe6'; p.fillRect(0, 0, pv.width, pv.height);
  p.globalAlpha = 0.85; p.drawImage(C, 0, 0, pv.width, pv.height); p.globalAlpha = 1;
  const t = document.createElement('canvas'); t.width = W; t.height = H; const tx = t.getContext('2d');
  tx.drawImage(L, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#222'; tx.fillRect(0, 0, W, H);
  p.drawImage(t, 0, 0, pv.width, pv.height);
}
function marcar(sel_, val) { document.querySelectorAll(sel_ + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === String(val))); }
$('#bBanderines').onclick = () => { $('#sheet').hidden = true; $('#mBand').hidden = false; marcar('#bgForma', BG.forma); marcar('#bgPaleta', BG.paleta); marcar('#bgFigura', BG.figura); generarBanderines(); };
for (const [id, campo] of [['#bgForma', 'forma'], ['#bgPaleta', 'paleta'], ['#bgFigura', 'figura']])
  document.querySelectorAll(id + ' button').forEach(b => b.onclick = () => {
    BG[campo] = b.dataset.v; marcar(id, b.dataset.v);
    $('#bgFiguraFila').hidden = BG.forma !== 'coco';
    generarBanderines();
  });
$('#bgN').oninput = e => { BG.n = +e.target.value; $('#bgNval').textContent = BG.n; generarBanderines(); };
$('#bgCurva').oninput = e => { BG.curva = +e.target.value; generarBanderines(); };
$('#bgNo').onclick = () => { $('#mBand').hidden = true; };
$('#bgOk').onclick = async () => {
  $('#mBand').hidden = true;
  const nombres = { coco: 'Papel picado Coco', tri: 'Banderines triangulares', rect: 'Banderines rectangulares' };
  await nuevaFuente(nombres[BG.forma] + ' (' + BG.n + ')', BG.lineas, BG.color);
};
