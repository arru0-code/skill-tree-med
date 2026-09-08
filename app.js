/* ============================================================
   Древо навыков — интерактивная карта созвездий
   ============================================================ */

const WORLD = { w: 2400, h: 1500 };
const SVG_NS = 'http://www.w3.org/2000/svg';

const PALETTE = ['#7cc6ea', '#e0a35c', '#8fd6a8', '#c98fd6', '#e0788a', '#6fb3c9',
  '#d4c46a', '#9aa8e6', '#6fc9b0', '#e59a6f', '#b6d46a', '#d67f9e', '#7f9de0', '#c9a06a'];

const $ = (id) => document.getElementById(id);
const map = $('map');
const stage = $('stage');

let data = load();
let view = { x: 0, y: 0, w: WORLD.w, h: WORLD.h };
let target = { ...view };
let anim = null;
let focused = null;      // id дерева в фокусе
let selected = null;     // { treeId, starId }
let editMode = false;
let linkFrom = null;     // ожидание второй звезды для связи
const nodes = new Map(); // starId -> { g, core, spike, label, rank, tree, star }

/* ---------- данные ---------- */

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function load() {
  return normalize(clone(window.SKILL_DATA));
}

/* Прогресс хранится в памяти сессии. Чтобы сохранить его надолго,
   откройте «Данные» и скопируйте JSON (или вставьте его в data.js). */
function save() { /* no-op: состояние живёт в памяти, экспорт через «Данные» */ }

function normalize(d) {
  d.trees.forEach((t, i) => {
    if (!t.color) t.color = PALETTE[i % PALETTE.length];
    t.tdx = Number(t.tdx) || 0;
    t.tdy = Number(t.tdy) || 0;
  });
  d.trees.forEach((t) => t.stars.forEach((s) => {
    s.max = Math.max(1, Math.min(5, Number(s.max) || 5));
    s.rank = Math.max(0, Math.min(s.max, Number(s.rank) || 0));
    s.links = Array.isArray(s.links) ? s.links : [];
  }));
  return d;
}

function allStars() { return data.trees.flatMap((t) => t.stars.map((s) => ({ tree: t, star: s }))); }
function findStar(id) { return allStars().find((r) => r.star.id === id); }
function treeRanks(t) { return t.stars.reduce((a, s) => a + s.rank, 0); }
function treeMax(t) { return t.stars.reduce((a, s) => a + s.max, 0); }

/* ---------- фон: звёздное небо ---------- */

const sky = $('sky');
const ctx = sky.getContext('2d');
let dust = [];

function initSky() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  sky.width = Math.floor(innerWidth * dpr);
  sky.height = Math.floor(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const count = Math.round((innerWidth * innerHeight) / 5200);
  dust = Array.from({ length: count }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    r: Math.random() * 1.1 + 0.25,
    a: Math.random() * 0.5 + 0.15,
    sp: Math.random() * 0.7 + 0.25,
    ph: Math.random() * Math.PI * 2
  }));
}

function drawSky(t) {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const d of dust) {
    const tw = 0.55 + 0.45 * Math.sin(t * 0.0009 * d.sp + d.ph);
    ctx.globalAlpha = d.a * tw;
    ctx.fillStyle = d.r > 1 ? '#dff0ff' : '#9fc4dd';
    ctx.beginPath();
    ctx.arc(d.x, d.y + Math.sin(t * 0.00003 + d.ph) * 4, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  requestAnimationFrame(drawSky);
}

/* ---------- построение карты ---------- */

function el(tag, attrs, cls) {
  const n = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (cls) n.setAttribute('class', cls);
  return n;
}

/* ---------- цвет созвездия ---------- */

function hex2rgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  const v = m ? parseInt(m[1], 16) : 0x7cc6ea;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgb2hex(a) {
  return '#' + a.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}
function mix(c1, c2, t) {
  const a = hex2rgb(c1), b = hex2rgb(c2);
  return rgb2hex(a.map((v, i) => v + (b[i] - v) * t));
}
function shades(base) {
  return {
    glow: base,
    core: mix(base, '#ffffff', 0.78),
    haloIn: mix(base, '#ffffff', 0.8),
    dim: mix(base, '#38505f', 0.72),
    dimIn: mix(base, '#8095a6', 0.6),
    dimOut: mix(base, '#101c27', 0.6),
    line: mix(base, '#0b1522', 0.52),
    title: mix(base, '#dce9f4', 0.5),
    max: mix(base, '#ffffff', 0.55),
    label: mix(base, '#ffffff', 0.72)
  };
}
function treeColor(t) { return t.color || PALETTE[data.trees.indexOf(t) % PALETTE.length]; }

function applyTreeColor(tree) {
  const g = map.querySelector(`.tree-group[data-tree="${tree.id}"]`);
  const c = shades(treeColor(tree));
  if (g) {
    g.style.setProperty('--tc-glow', c.glow);
    g.style.setProperty('--tc-core', c.core);
    g.style.setProperty('--tc-dim', c.dim);
    g.style.setProperty('--tc-line', c.line);
    g.style.setProperty('--tc-title', c.title);
    g.style.setProperty('--tc-max', c.max);
    g.style.setProperty('--tc-label', c.label);
  }
  const set = (id, pairs) => {
    const grad = map.querySelector(`#${id}`);
    if (!grad) return;
    [...grad.children].forEach((st, i) => { if (pairs[i]) st.setAttribute('stop-color', pairs[i]); });
  };
  set('gLit-' + tree.id, [c.haloIn, c.glow, c.glow]);
  set('gCold-' + tree.id, [c.dimIn, c.dimOut, c.dimOut]);
  set('gMax-' + tree.id, ['#ffffff', c.max, c.max]);
}

function spikePath(r) {
  const s = r * 0.34;
  return `M0 ${-r} L${s} ${-s} L${r} 0 L${s} ${s} L0 ${r} L${-s} ${s} L${-r} 0 L${-s} ${-s} Z`;
}

/* подпись звезды: аккуратный перенос на 1-3 строки */
function wrapName(name, per = 19) {
  const words = String(name).split(/\s+/);
  const lines = [];
  let cur = '';
  words.forEach((w) => {
    if (!cur.length) { cur = w; return; }
    if ((cur + ' ' + w).length <= per || lines.length === 2) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function setLabelText(textEl, name) {
  const lines = wrapName(name);
  textEl.textContent = '';
  lines.forEach((ln, i) => {
    const t = el('tspan', { x: 0 });
    if (i) t.setAttribute('dy', '1.12em');
    t.textContent = ln;
    textEl.appendChild(t);
  });
  textEl.dataset.lines = String(lines.length);
}

function buildDefs() {
  const defs = el('defs');
  const mk = (id, c1, c2) => {
    const g = el('radialGradient', { id });
    g.appendChild(el('stop', { offset: '0%', 'stop-color': c1, 'stop-opacity': '0.85' }));
    g.appendChild(el('stop', { offset: '45%', 'stop-color': c2, 'stop-opacity': '0.28' }));
    g.appendChild(el('stop', { offset: '100%', 'stop-color': c2, 'stop-opacity': '0' }));
    return g;
  };
  data.trees.forEach((t) => {
    const c = shades(treeColor(t));
    defs.appendChild(mk('gLit-' + t.id, c.haloIn, c.glow));
    defs.appendChild(mk('gCold-' + t.id, c.dimIn, c.dimOut));
    defs.appendChild(mk('gMax-' + t.id, '#ffffff', c.max));
  });
  return defs;
}

function build() {
  map.innerHTML = '';
  map.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  map.appendChild(buildDefs());
  nodes.clear();

  const world = el('g', { id: 'world' });
  map.appendChild(world);

  data.trees.forEach((tree) => {
    const g = el('g', { 'data-tree': tree.id }, 'tree-group');
    const lines = el('g', null, 'lines');
    g.appendChild(lines);

    tree.stars.forEach((s) => {
      s.links.forEach((tid) => {
        const to = tree.stars.find((x) => x.id === tid);
        if (!to) return;
        const ln = el('line', {
          x1: tree.cx + s.x, y1: tree.cy + s.y,
          x2: tree.cx + to.x, y2: tree.cy + to.y,
          'data-a': s.id, 'data-b': to.id
        }, 'link-line');
        lines.appendChild(ln);
      });
    });

    tree.stars.forEach((s) => {
      const sg = el('g', { 'data-star': s.id }, 'star');
      const halo = el('circle', { r: 30, fill: `url(#gCold-${tree.id})` }, 'halo');
      halo.style.animation = `twinkle ${(4 + Math.random() * 4).toFixed(1)}s ease-in-out ${(Math.random() * 3).toFixed(1)}s infinite`;
      const spike = el('path', { d: spikePath(17), fill: 'none' }, 'spike');
      const core = el('circle', { r: 5 }, 'core');
      const ring = el('circle', { r: 22, 'stroke-width': 1.2 }, 'ring');
      const hit = el('circle', { r: 40, fill: 'transparent' });
      const label = el('text', { y: 46, 'font-size': 19 }, 'star-label');
      setLabelText(label, s.name);
      const rank = el('text', { y: 74 }, 'star-rank');
      rank.setAttribute('y', 62 + (Number(label.dataset.lines) || 1) * 22);

      sg.append(halo, spike, core, ring, label, rank, hit);
      g.appendChild(sg);
      const rec = { g: sg, halo, core, spike, label, rank, tree, star: s };
      nodes.set(s.id, rec);
      sg.setAttribute('transform', starTransform(rec));
    });

    const title = el('text', {
      x: tree.cx + (tree.tdx || 0),
      y: tree.cy + 215 + (tree.tdy || 0),
      'font-size': 30, 'data-title': tree.id
    }, 'tree-title');
    title.textContent = tree.name;
    g.appendChild(title);

    world.appendChild(g);
    applyTreeColor(tree);
  });

  paint();
  if (focused) map.querySelectorAll('.tree-group').forEach((g) => g.classList.toggle('dim', g.dataset.tree !== focused));
  applyView();
}

function paint() {
  data.trees.forEach((tree) => {
    tree.stars.forEach((s) => {
      const n = nodes.get(s.id);
      if (!n) return;
      const done = s.rank >= s.max;
      n.g.classList.toggle('lit', s.rank > 0);
      n.g.classList.toggle('maxed', done);
      n.core.setAttribute('r', s.rank > 0 ? (5.5 + 3.5 * (s.rank / s.max)).toFixed(1) : 4.2);
      const gid = done ? 'gMax-' : s.rank > 0 ? 'gLit-' : 'gCold-';
      n.halo.setAttribute('fill', `url(#${gid}${tree.id})`);
      n.halo.setAttribute('r', s.rank > 0 ? 34 + 10 * (s.rank / s.max) : 26);
      n.rank.textContent = s.rank > 0 ? `${s.rank} / ${s.max}` : `0 / ${s.max}`;
      if (n.label.dataset.name !== s.name) {
        setLabelText(n.label, s.name);
        n.label.dataset.name = s.name;
        n.rank.setAttribute('y', 62 + (Number(n.label.dataset.lines) || 1) * 22);
      }
    });
  });

  map.querySelectorAll('.link-line').forEach((ln) => {
    const a = findStar(ln.dataset.a), b = findStar(ln.dataset.b);
    const live = a && b && a.star.rank > 0 && b.star.rank > 0;
    ln.classList.toggle('live', !!live);
  });

  map.querySelectorAll('.tree-group').forEach((g) => {
    const t = data.trees.find((x) => x.id === g.dataset.tree);
    if (t) g.querySelector('.tree-title').textContent = t.name;
  });

  renderSidebar();
  renderStats();
  if (selected) renderPanel();
}

function renderStats() {
  const rows = allStars();
  $('statRanks').textContent = rows.reduce((a, r) => a + r.star.rank, 0);
  $('statSkills').textContent = rows.filter((r) => r.star.rank > 0).length;
  if (!editMode) {
    $('mapTitle').textContent = data.title || 'Древо навыков';
    $('mapSubtitle').textContent = data.subtitle || '';
  }
}

function renderSidebar() {
  const list = $('treeList');
  list.innerHTML = '';
  data.trees.forEach((t) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tree-item';
    b.setAttribute('aria-current', String(focused === t.id));
    const done = treeRanks(t), total = treeMax(t);
    const col = treeColor(t);
    b.innerHTML = `<span class="tn"></span><span class="tc">${done}/${total}</span>
      <span class="bar"><i style="width:${total ? (done / total) * 100 : 0}%"></i></span>`;
    b.style.setProperty('--tc-glow', col);
    b.querySelector('.tn').textContent = t.name;
    b.addEventListener('click', () => focusTree(t.id));
    li.appendChild(b);

    if (editMode) {
      const row = document.createElement('div');
      row.className = 'edit-row';
      const inp = document.createElement('input');
      inp.className = 'edit-input tn-input';
      inp.value = t.name;
      inp.setAttribute('aria-label', 'Название созвездия');
      inp.addEventListener('input', () => {
        t.name = inp.value;
        const title = map.querySelector(`.tree-group[data-tree="${t.id}"] .tree-title`);
        if (title) title.textContent = inp.value;
        b.querySelector('.tn').textContent = inp.value;
        if (selected && selected.treeId === t.id) $('panelTree').textContent = inp.value;
        save();
      });
      row.appendChild(inp);

      const col = document.createElement('input');
      col.type = 'color';
      col.className = 'color-pick';
      col.value = treeColor(t);
      col.title = 'Цвет созвездия';
      col.setAttribute('aria-label', 'Цвет созвездия ' + t.name);
      col.addEventListener('input', () => {
        t.color = col.value;
        applyTreeColor(t);
        save();
      });
      row.appendChild(col);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del-tree';
      del.title = 'Удалить созвездие';
      del.setAttribute('aria-label', 'Удалить созвездие');
      del.textContent = '×';
      del.addEventListener('click', () => {
        if (!confirm(`Удалить созвездие «${t.name}» и все его звёзды?`)) return;
        data.trees = data.trees.filter((x) => x.id !== t.id);
        if (focused === t.id) focused = null;
        if (selected && selected.treeId === t.id) closePanel();
        build();
        save();
        showOverview();
        toast('Созвездие удалено');
      });
      row.appendChild(del);
      li.appendChild(row);
    }
    list.appendChild(li);
  });

  if (editMode) {
    const li = document.createElement('li');
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn tree-add';
    add.textContent = '+ созвездие';
    add.addEventListener('click', addTree);
    li.appendChild(add);
    list.appendChild(li);
  }

  const rows = allStars();
  const total = rows.reduce((a, r) => a + r.star.max, 0);
  const done = rows.reduce((a, r) => a + r.star.rank, 0);
  $('sidebarFoot').textContent = `Общий прогресс — ${done} из ${total} ранков (${total ? Math.round((done / total) * 100) : 0}%)`;
}

/* ---------- камера ---------- */

function scaleNow() {
  const r = stage.getBoundingClientRect();
  return Math.min(r.width / view.w, r.height / view.h);
}

function applyView() {
  map.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const s = scaleNow();
  const wide = innerWidth > 900;
  map.dataset.zoom = s > (wide ? 0.3 : 0.2) ? 'near' : 'far';
  const near = map.dataset.zoom === 'near';

  /* звёзды и подписи держим постоянного размера на экране */
  const k = Math.max(0.55, Math.min(4.2, 0.4 / s));
  if (Math.abs(k - (applyView._k || 0)) > 0.01) {
    applyView._k = k;
    nodes.forEach((n) => { n.g.setAttribute('transform', starTransform(n, k)); });
  }
  const ttl = Math.min(150, Math.max(wide ? 20 : 15, 19 / s));

  map.querySelectorAll('.tree-group').forEach((g) => {
    const dim = g.classList.contains('dim');
    const show = !dim && s > (wide ? 0.13 : 0.16);
    g.querySelectorAll('.star-label, .star-rank').forEach((n) => { n.style.opacity = show ? 1 : 0; });
    const title = g.querySelector('.tree-title');
    title.style.opacity = dim ? 0.3 : focused === g.dataset.tree ? (editMode ? 0.5 : 0) : 0.85;
    title.setAttribute('font-size', ttl.toFixed(1));
  });
}

function starTransform(rec, k) {
  const x = rec.tree.cx + rec.star.x, y = rec.tree.cy + rec.star.y;
  return `translate(${x} ${y}) scale(${(k || applyView._k || 1).toFixed(3)})`;
}

/* свободное место карты: слева панель созвездий, справа — карточка навыка */
function insets() {
  const wide = innerWidth > 900;
  return {
    left: wide ? 320 : 20,
    right: wide && !$('panel').hidden ? 372 : 20,
    top: 96,
    bottom: wide ? 60 : 300
  };
}

/* строим viewBox так, чтобы мир-бокс попал в свободную область экрана */
function fitBox(x1, y1, x2, y2) {
  const r = stage.getBoundingClientRect();
  const ins = insets();
  const iw = Math.max(200, r.width - ins.left - ins.right);
  const ih = Math.max(200, r.height - ins.top - ins.bottom);
  const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
  const s = Math.min(iw / bw, ih / bh);
  const w = r.width / s, h = r.height / s;
  const cx = (x1 + x2) / 2 - (ins.left - ins.right) / (2 * s);
  const cy = (y1 + y2) / 2 - (ins.top - ins.bottom) / (2 * s);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function tweenTo(box, ms = 700) {
  target = box;
  const from = { ...view };
  const t0 = performance.now();
  if (anim) cancelAnimationFrame(anim);
  const ease = (p) => 1 - Math.pow(1 - p, 3);
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = ease(p);
    view = {
      x: from.x + (box.x - from.x) * e,
      y: from.y + (box.y - from.y) * e,
      w: from.w + (box.w - from.w) * e,
      h: from.h + (box.h - from.h) * e
    };
    applyView();
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function boxFor(tree) {
  if (!tree.stars.length) return fitBox(tree.cx - 400, tree.cy - 300, tree.cx + 400, tree.cy + 300);
  const xs = tree.stars.map((s) => tree.cx + s.x);
  const ys = tree.stars.map((s) => tree.cy + s.y);
  const pad = innerWidth > 900 ? 140 : 280;
  return fitBox(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad + 110);
}

function worldBounds() {
  const xs = [], ys = [];
  data.trees.forEach((t) => {
    t.stars.forEach((s) => { xs.push(t.cx + s.x); ys.push(t.cy + s.y); });
    xs.push(t.cx + (t.tdx || 0));
    ys.push(t.cy + 215 + (t.tdy || 0));
  });
  if (!xs.length) return { x1: 0, y1: 0, x2: WORLD.w, y2: WORLD.h };
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

function overviewBox() {
  const b = worldBounds();
  return fitBox(b.x1 - 220, b.y1 - 200, b.x2 + 220, b.y2 + 220);
}

/* переключение созвездий по кругу, как в Skyrim */
function cycleTree(dir) {
  const ids = data.trees.map((t) => t.id);
  if (!ids.length) return;
  const i = focused ? ids.indexOf(focused) : -1;
  const next = ids[((i + dir) % ids.length + ids.length) % ids.length];
  selected = null;
  closePanel();
  focusTree(next);
}

function focusTree(id) {
  const tree = data.trees.find((t) => t.id === id);
  if (!tree) return;
  focused = id;
  map.querySelectorAll('.tree-group').forEach((g) => g.classList.toggle('dim', g.dataset.tree !== id));
  tweenTo(boxFor(tree));
  renderSidebar();
}

function showOverview() {
  focused = null;
  selected = null;
  closePanel();
  map.querySelectorAll('.tree-group').forEach((g) => g.classList.remove('dim'));
  map.querySelectorAll('.star').forEach((s) => s.classList.remove('sel'));
  tweenTo(overviewBox());
  renderSidebar();
}

/* ---------- панель навыка ---------- */

function selectStar(id) {
  const rec = findStar(id);
  if (!rec) return;
  selected = { treeId: rec.tree.id, starId: id };
  map.querySelectorAll('.star').forEach((s) => s.classList.toggle('sel', s.dataset.star === id));
  renderPanel();
  if (focused !== rec.tree.id) focusTree(rec.tree.id);
  else tweenTo(boxFor(rec.tree), 420);
}

function renderPanel() {
  const rec = findStar(selected.starId);
  if (!rec) { closePanel(); return; }
  const { tree, star } = rec;
  $('panel').hidden = false;
  $('panelTree').textContent = tree.name;
  $('panelName').textContent = star.name;
  $('panelName').hidden = editMode;
  $('panelNameInput').hidden = !editMode;
  $('panelNameInput').value = star.name;
  $('panelDesc').textContent = star.desc || '';
  $('panelDesc').hidden = editMode;
  $('panelDescInput').hidden = !editMode;
  $('panelDescInput').value = star.desc || '';
  $('panelEdit').hidden = !editMode;
  $('editMax').value = star.max;

  const pips = $('panelPips');
  pips.innerHTML = '';
  for (let i = 0; i < star.max; i++) {
    const p = document.createElement('span');
    p.className = 'pip' + (i < star.rank ? (star.rank >= star.max ? ' full' : ' on') : '');
    pips.appendChild(p);
  }
  $('panelRank').textContent = star.rank >= star.max
    ? `Освоено — ${star.rank} из ${star.max}`
    : `Прогресс — ${star.rank} из ${star.max}`;
  $('btnMinus').disabled = star.rank === 0;
  $('btnPlus').disabled = star.rank >= star.max;
  $('btnMinus').style.opacity = star.rank === 0 ? 0.4 : 1;
  $('btnPlus').style.opacity = star.rank >= star.max ? 0.4 : 1;
}

function closePanel() {
  const was = !$('panel').hidden;
  $('panel').hidden = true;
  selected = null;
  map.querySelectorAll('.star').forEach((s) => s.classList.remove('sel'));
  if (was && focused) {
    const t = data.trees.find((x) => x.id === focused);
    if (t) tweenTo(boxFor(t), 420);
  }
}

function bumpRank(delta) {
  if (!selected) return;
  const { star } = findStar(selected.starId);
  const next = Math.max(0, Math.min(star.max, star.rank + delta));
  if (next === star.rank) return;
  star.rank = next;
  if (delta > 0) burst(selected.starId);
  paint();
  save();
}

function burst(id) {
  const n = nodes.get(id);
  if (!n) return;
  const c = el('circle', { r: 14, 'stroke-width': 2.5 }, 'burst');
  n.g.appendChild(c);
  setTimeout(() => c.remove(), 800);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------- мышь: сдвиг, масштаб, перетаскивание звёзд ---------- */

let drag = null;

function svgPoint(evt) {
  const r = map.getBoundingClientRect();
  const s = Math.min(r.width / view.w, r.height / view.h);
  const offX = (r.width - view.w * s) / 2;
  const offY = (r.height - view.h * s) / 2;
  return {
    x: view.x + (evt.clientX - r.left - offX) / s,
    y: view.y + (evt.clientY - r.top - offY) / s,
    s
  };
}

map.addEventListener('pointerdown', (e) => {
  const starEl = e.target.closest('.star');
  const titleEl = e.target.closest('.tree-title');
  const p = svgPoint(e);
  if (titleEl && editMode) {
    const tree = data.trees.find((t) => t.id === titleEl.dataset.title);
    drag = { type: 'title', tree, el: titleEl, sx: p.x, sy: p.y, ox: tree.tdx || 0, oy: tree.tdy || 0, moved: false };
  } else if (starEl && editMode) {
    const rec = findStar(starEl.dataset.star);
    drag = { type: 'star', id: starEl.dataset.star, rec, sx: p.x, sy: p.y, ox: rec.star.x, oy: rec.star.y, moved: false };
  } else if (starEl) {
    drag = { type: 'tap', id: starEl.dataset.star };
  } else {
    drag = { type: 'pan', sx: p.x, sy: p.y, vx: view.x, vy: view.y, moved: false };
    map.classList.add('dragging');
  }
  map.setPointerCapture(e.pointerId);
});

map.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = svgPoint(e);
  if (drag.type === 'pan') {
    const dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (anim) cancelAnimationFrame(anim);
    view = { ...view, x: drag.vx - dx, y: drag.vy - dy };
    applyView();
  } else if (drag.type === 'title') {
    const dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    drag.tree.tdx = Math.round(drag.ox + dx);
    drag.tree.tdy = Math.round(drag.oy + dy);
    drag.el.setAttribute('x', drag.tree.cx + drag.tree.tdx);
    drag.el.setAttribute('y', drag.tree.cy + 215 + drag.tree.tdy);
  } else if (drag.type === 'star') {
    const dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    drag.rec.star.x = Math.round(drag.ox + dx);
    drag.rec.star.y = Math.round(drag.oy + dy);
    moveStarEl(drag.rec);
  }
});

map.addEventListener('pointerup', (e) => {
  if (!drag) return;
  map.classList.remove('dragging');
  if (drag.type === 'tap' || (drag.type === 'star' && !drag.moved)) {
    if (linkFrom && linkFrom !== drag.id) toggleLink(linkFrom, drag.id);
    else selectStar(drag.id);
  } else if ((drag.type === 'star' || drag.type === 'title') && drag.moved) {
    save();
  }
  drag = null;
});

function moveStarEl(rec) {
  const n = nodes.get(rec.star.id);
  n.g.setAttribute('transform', starTransform(n));
  map.querySelectorAll('.link-line').forEach((ln) => {
    if (ln.dataset.a === rec.star.id) {
      ln.setAttribute('x1', rec.tree.cx + rec.star.x);
      ln.setAttribute('y1', rec.tree.cy + rec.star.y);
    }
    if (ln.dataset.b === rec.star.id) {
      ln.setAttribute('x2', rec.tree.cx + rec.star.x);
      ln.setAttribute('y2', rec.tree.cy + rec.star.y);
    }
  });
}

map.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (anim) cancelAnimationFrame(anim);
  const p = svgPoint(e);
  const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
  const b = worldBounds();
  const minW = 380, maxW = (b.x2 - b.x1 + 900) * 1.5;
  const w = Math.max(minW, Math.min(maxW, view.w * k));
  const ratio = w / view.w;
  view = {
    x: p.x - (p.x - view.x) * ratio,
    y: p.y - (p.y - view.y) * ratio,
    w,
    h: view.h * ratio
  };
  applyView();
}, { passive: false });



/* ---------- правка ---------- */

function toggleLink(a, b) {
  const ra = findStar(a), rb = findStar(b);
  linkFrom = null;
  $('btnLink').textContent = 'Соединить с…';
  if (!ra || !rb || ra.tree.id !== rb.tree.id) { toast('Соединять можно только звёзды одного созвездия'); return; }
  const has = ra.star.links.includes(b) || rb.star.links.includes(a);
  if (has) {
    ra.star.links = ra.star.links.filter((x) => x !== b);
    rb.star.links = rb.star.links.filter((x) => x !== a);
    toast('Связь убрана');
  } else {
    ra.star.links.push(b);
    toast('Связь создана');
  }
  build();
  save();
  selectStar(a);
}

function addTree() {
  const cols = 3, i = data.trees.length;
  const id = 't' + Math.random().toString(36).slice(2, 7);
  const cx = 400 + (i % cols) * 800;
  const cy = 380 + Math.floor(i / cols) * 700;
  data.trees.push({
    id,
    name: 'Новое созвездие',
    cx: Math.min(WORLD.w - 300, cx),
    cy: Math.min(WORLD.h - 250, cy),
    stars: [{ id: 's' + Math.random().toString(36).slice(2, 7), name: 'Новый навык', x: 0, y: 0, max: 5, rank: 0, desc: '', links: [] }]
  });
  build();
  save();
  focusTree(id);
  toast('Созвездие добавлено — двойной клик по пустому месту создаёт звезду');
}

function setEditMode(on) {
  editMode = on;
  ['mapTitle', 'mapSubtitle'].forEach((k) => {
    const n = $(k);
    n.contentEditable = on ? 'true' : 'false';
    n.oninput = on ? () => {
      data[k === 'mapTitle' ? 'title' : 'subtitle'] = n.textContent.trim();
      save();
    } : null;
  });
  renderSidebar();
  document.documentElement.dataset.mode = on ? 'edit' : 'view';
  $('btnEdit').dataset.on = on ? '1' : '0';
  $('btnEdit').textContent = on ? 'Правка включена' : 'Режим правки';
  linkFrom = null;
  if (selected) renderPanel();
  toast(on ? 'Режим правки: переименование, перенос звёзд, связи' : 'Режим просмотра');
}

$('btnEdit').addEventListener('click', () => setEditMode(!editMode));
$('btnOverview').addEventListener('click', showOverview);
$('btnPrev').addEventListener('click', () => cycleTree(-1));
$('btnNext').addEventListener('click', () => cycleTree(1));
$('panelClose').addEventListener('click', closePanel);
$('btnPlus').addEventListener('click', () => bumpRank(1));
$('btnMinus').addEventListener('click', () => bumpRank(-1));

$('panelNameInput').addEventListener('input', (e) => {
  const rec = findStar(selected.starId);
  rec.star.name = e.target.value;
  setLabelText(nodes.get(rec.star.id).label, e.target.value);
  $('panelName').textContent = e.target.value;
  save();
});

$('panelDescInput').addEventListener('input', (e) => {
  const rec = findStar(selected.starId);
  rec.star.desc = e.target.value;
  save();
});

$('editMax').addEventListener('change', (e) => {
  const rec = findStar(selected.starId);
  rec.star.max = Math.max(1, Math.min(5, Number(e.target.value) || 1));
  rec.star.rank = Math.min(rec.star.rank, rec.star.max);
  paint();
  save();
});

$('btnLink').addEventListener('click', () => {
  if (!selected) return;
  linkFrom = linkFrom ? null : selected.starId;
  $('btnLink').textContent = linkFrom ? 'Выберите вторую звезду…' : 'Соединить с…';
  if (linkFrom) toast('Кликните по второй звезде этого созвездия');
});

$('btnDelete').addEventListener('click', () => {
  if (!selected) return;
  const rec = findStar(selected.starId);
  const id = rec.star.id;
  rec.tree.stars = rec.tree.stars.filter((s) => s.id !== id);
  rec.tree.stars.forEach((s) => { s.links = s.links.filter((x) => x !== id); });
  closePanel();
  build();
  save();
  toast('Звезда удалена');
});

/* двойной клик по пустому месту: в правке — новая звезда, иначе — вся карта */
map.addEventListener('dblclick', (e) => {
  if (e.target.closest('.star')) return;
  if (!editMode || !focused) { showOverview(); return; }
  const tree = data.trees.find((t) => t.id === focused);
  const p = svgPoint(e);
  const id = 'n' + Math.random().toString(36).slice(2, 8);
  tree.stars.push({
    id,
    name: 'Новый навык',
    x: Math.round(p.x - tree.cx),
    y: Math.round(p.y - tree.cy),
    max: 5,
    rank: 0,
    desc: '',
    links: []
  });
  build();
  save();
  selectStar(id);
  toast('Звезда добавлена — задайте название');
});

/* ---------- данные: экспорт / импорт ---------- */

$('btnData').addEventListener('click', () => {
  $('jsonBox').value = JSON.stringify(data, null, 2);
  $('modalMsg').textContent = '';
  $('modal').hidden = false;
});
$('modalClose').addEventListener('click', () => { $('modal').hidden = true; });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });

$('btnCopy').addEventListener('click', async () => {
  const box = $('jsonBox');
  try {
    await navigator.clipboard.writeText(box.value);
    $('modalMsg').textContent = 'Скопировано в буфер обмена.';
  } catch (err) {
    box.select();
    $('modalMsg').textContent = 'Текст выделен — скопируйте вручную (Ctrl+C).';
  }
});

$('btnLoad').addEventListener('click', () => {
  try {
    const next = normalize(JSON.parse($('jsonBox').value));
    if (!next.trees || !Array.isArray(next.trees)) throw new Error('нет списка созвездий');
    data = next;
    selected = null;
    focused = null;
    closePanel();
    build();
    save();
    showOverview();
    $('modal').hidden = true;
    toast('Карта загружена');
  } catch (err) {
    $('modalMsg').textContent = 'Не удалось прочитать текст: ' + err.message;
  }
});

$('btnReset').addEventListener('click', () => {
  data = normalize(clone(window.SKILL_DATA));
  selected = null;
  build();
  showOverview();
  $('modal').hidden = true;
  toast('Прогресс сброшен');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('modal').hidden) $('modal').hidden = true;
    else if (!$('panel').hidden) closePanel();
    else showOverview();
  }
  if (e.target.matches('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowRight' || k === 'e' || k === 'у') { e.preventDefault(); cycleTree(1); }
  if (e.key === 'ArrowLeft' || k === 'q' || k === 'й') { e.preventDefault(); cycleTree(-1); }
  if (selected && (e.key === '+' || e.key === '=')) bumpRank(1);
  if (selected && (e.key === '-' || e.key === '_')) bumpRank(-1);
});

/* ---------- запуск ---------- */

function start() {
  initSky();
  requestAnimationFrame(drawSky);
  build();
  view = overviewBox();
  applyView();
  setTimeout(() => { $('hint').style.opacity = 0.25; }, 6000);
}

let rz;
window.addEventListener('resize', () => {
  initSky();
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (focused) { const t = data.trees.find((x) => x.id === focused); if (t) tweenTo(boxFor(t), 250); }
    else tweenTo(overviewBox(), 250);
  }, 120);
});

start();
