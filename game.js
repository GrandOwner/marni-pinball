'use strict';

/* ============ Пинбол Марни — одна попытка, один шар ============ */

const cv = document.getElementById('table');
const cx = cv.getContext('2d');
const W = 540, H = 960;
// чёткая картинка на retina
const dpr = Math.min(3, window.devicePixelRatio || 1);
cv.width = W * dpr; cv.height = H * dpr;
cx.setTransform(dpr, 0, 0, dpr, 0, 0);

const COL = {
  bg: '#0d171c', line: '#2a4652', teal: '#35d6c5', tealDim: '#1b7f78',
  gold: '#d8a94e', goldDim: '#8a6b2f', danger: '#e2564a', text: '#cfe6e3',
};

/* ---------- состояние кошелька и лавки ---------- */
const store = {
  load(k, d) { try { const v = JSON.parse(localStorage.getItem('marni_' + k)); return v === null ? d : v; } catch { return d; } },
  save(k, v) { try { localStorage.setItem('marni_' + k, JSON.stringify(v)); } catch {} },
};
let silver = store.load('silver', 10);
let tokens = store.load('tokens', 0);
let owned = store.load('owned', []);
let board = store.load('board', []);

const SHOP = [
  ['Сундук материалов удачи', 77],
  ['Чертёж: Огнезащита', 100],
  ['Чертёж: Морозозащита', 100],
  ['Чертёж: Грозозащита', 100],
  ['Кинетическое семейство дельфинов', 200],
  ['Артефакт Бездны', 200],
  ['Кинетический рыцарь', 300],
  ['Шляпа циркового шута (+10% серебра)', 777],
  ['Малый сундук артефактов (3 шт.)', 1000],
  ['Средний сундук артефактов (5 шт.)', 2500],
  ['Золотой слиток', 10000],
];

/* ---------- геометрия стола ---------- */
const R = 11;                       // радиус шара
const GRAV = 2650;
const LANE_X = 470;                 // внутренняя стенка жёлоба запуска

function arcPoints(cxa, cya, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * i / n;
    pts.push([cxa + r * Math.cos(a), cya + r * Math.sin(a)]);
  }
  return pts;
}

const walls = [];                   // [x1,y1,x2,y2, restitution]
function poly(pts, rest = 0.5) {
  for (let i = 0; i < pts.length - 1; i++) walls.push([...pts[i], ...pts[i + 1], rest]);
}

// купол
poly(arcPoints(270, 262, 246, Math.PI, Math.PI * 2, 26));
// левая стенка и воронка к флипперам
poly([[24, 262], [24, 780], [167, 868]]);
// правая: стенка жёлоба изнутри и воронка
poly([[LANE_X, 380], [LANE_X, 780], [373, 868]]);
// жёлоб запуска: внешняя стенка + пол
poly([[516, 262], [516, 902], [LANE_X, 902], [LANE_X, 780]]);
// слингшоты: замкнутые треугольники, любая грань отбивает
const slings = [
  { verts: [[100, 726], [100, 816], [166, 828]], flash: 0 },
  { verts: [[440, 726], [440, 816], [374, 828]], flash: 0 },
];

const bumpers = [
  { x: 186, y: 314, r: 26, flash: 0, pts: 100 },
  { x: 272, y: 238, r: 26, flash: 0, pts: 100 },
  { x: 358, y: 314, r: 26, flash: 0, pts: 100 },
  { x: 272, y: 560, r: 13, flash: 0, pts: 25, pin: true },
];

const targets = [ // банки целей на левой стене
  { x: 66, y: 452, w: 12, h: 44, up: true, flash: 0 },
  { x: 66, y: 508, w: 12, h: 44, up: true, flash: 0 },
  { x: 66, y: 564, w: 12, h: 44, up: true, flash: 0 },
];

const lanes = [ // огни Марни под куполом
  { x: 210, y: 130, lit: false, cd: 0 },
  { x: 270, y: 108, lit: false, cd: 0 },
  { x: 330, y: 130, lit: false, cd: 0 },
];

/* ---------- флипперы ---------- */
function makeFlipper(px, py, len, rest, raised, dir) {
  return { px, py, len, rest, raised, dir, ang: rest, target: rest, prev: rest, vel: 0 };
}
const FL_SPEED = 40;
const flippers = [
  makeFlipper(172, 874, 90, 0.62, -0.46, 1),
  makeFlipper(368, 874, 90, Math.PI - 0.62, Math.PI + 0.46, -1),
];

/* ---------- шар и партия ---------- */
const ball = { x: 0, y: 0, vx: 0, vy: 0, alive: false, exitedLane: false };
let playing = false;          // партия идёт (шар куплен)
let launching = false;        // шар в жёлобе, ждём запуск
let launchPower = 0;
let holdingLaunch = false;
let score = 0;
let startTime = 0;
let tilt = false;
let tiltMeter = 0;
let stuckTime = 0;
let playedTime = 0;   // игровое время партии — только пока шар в полёте
let cradled = false;  // шар лежит на поднятом флиппере
const popups = [];    // всплывающие очки
const trail = [];     // хвост шара
function addPopup(x, y, text, color) {
  popups.push({ x, y, text, color: color || COL.gold, age: 0 });
  if (popups.length > 12) popups.shift();
}
let msgTimer = null;

/* ---------- звук ---------- */
let audio = null;
function blip(freq, dur = 0.05, vol = 0.12, type = 'square') {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  } catch {}
}

/* ---------- интерфейс ---------- */
const $ = id => document.getElementById(id);
function hud() {
  $('hud-silver').textContent = silver;
  $('hud-score').textContent = score;
  $('hud-tokens').textContent = tokens;
}
function flash(text, color) {
  const m = $('msg');
  m.textContent = text;
  m.style.color = color || COL.gold;
  m.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => m.classList.remove('show'), 1200);
}
function open(id) { ['overlay', 'shop', 'board', 'gameover'].forEach(p => $(p).className = p === id ? 'open' : 'closed'); }
function closeAll() { ['overlay', 'shop', 'board', 'gameover'].forEach(p => $(p).className = 'closed'); }

function addScore(n) { if (!tilt) { score += n; hud(); } }

function startGame() {
  if (silver <= 0) { // Джаспер жалеет зевак
    silver = 5;
    flash('ДЖАСПЕР ЖАЛУЕТ 5 СЕРЕБРА', COL.teal);
  }
  silver--; store.save('silver', silver);
  score = 0; tilt = false; tiltMeter = 0;
  targets.forEach(t => { t.up = true; });
  lanes.forEach(l => { l.lit = false; });
  ball.x = 493; ball.y = 886; ball.vx = 0; ball.vy = 0;
  ball.alive = true; ball.exitedLane = false;
  playing = true; launching = true; launchPower = 0;
  playedTime = 0; startTime = performance.now();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  closeAll(); hud();
  blip(520, .08, .1, 'triangle');
}

function endGame() {
  playing = false; ball.alive = false;
  const secs = Math.floor(playedTime);
  const earned = Math.floor(score / 200) + Math.min(30, Math.floor(secs / 10));
  tokens += earned; store.save('tokens', tokens);
  $('go-title').textContent = tilt ? 'TILT — шар потерян' : 'Шар потерян';
  $('go-score').textContent = score;
  $('go-time').textContent = secs + 'с';
  $('go-tokens').textContent = earned;
  const qualifies = score > 0 && (board.length < 10 || score > board[board.length - 1].s);
  $('go-name-row').className = qualifies ? 'row open' : 'row closed';
  open('gameover'); hud();
  blip(140, .4, .14, 'sawtooth');
}

/* ---------- лавка и табло ---------- */
function renderShop() {
  $('shop-tokens').textContent = tokens;
  const ul = $('shop-list');
  ul.innerHTML = '';
  SHOP.forEach(([name, price]) => {
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.textContent = name;
    const pr = document.createElement('span'); pr.className = 'price'; pr.textContent = price + ' жет.';
    const btn = document.createElement('button'); btn.textContent = 'Купить';
    btn.disabled = tokens < price;
    btn.onclick = () => {
      tokens = store.load('tokens', tokens);
      if (tokens < price) { renderShop(); hud(); return; }
      tokens -= price; owned.push(name);
      store.save('tokens', tokens); store.save('owned', owned);
      renderShop(); hud(); blip(760, .07, .1);
    };
    li.append(nm, pr, btn); ul.append(li);
  });
  $('shop-owned').textContent = owned.length ? owned.join(', ') : 'пока ничего';
}
function renderBoard() {
  const ol = $('board-list');
  ol.innerHTML = '';
  if (!board.length) ol.innerHTML = '<li>Пока пусто — стань первым.</li>';
  board.forEach(r => {
    const li = document.createElement('li');
    li.textContent = r.n + ' ';
    const b = document.createElement('b'); b.textContent = r.s;
    li.append(b); ol.append(li);
  });
}

$('btn-play').onclick = startGame;
$('btn-again').onclick = startGame;
$('btn-menu').onclick = () => open('overlay');
$('btn-shop').onclick = () => { renderShop(); open('shop'); };
$('btn-shop-close').onclick = () => open(playing ? '' : 'overlay');
$('btn-board').onclick = () => { renderBoard(); open('board'); };
$('btn-board-close').onclick = () => open('overlay');
$('btn-save-score').onclick = () => {
  const n = $('go-name').value.trim() || 'Клифф';
  board.push({ n, s: score });
  board.sort((a, b) => b.s - a.s);
  board = board.slice(0, 10);
  store.save('board', board);
  $('go-name-row').className = 'row closed';
  renderBoard(); open('board');
};

/* ---------- управление ---------- */
const keys = { left: false, right: false };
function nudge() {
  if (!playing || tilt || !ball.alive || launching) return;
  ball.vx += (Math.random() - 0.5) * 260;
  ball.vy -= 200;
  tiltMeter += 1.1;
  blip(220, .05, .1);
  if (tiltMeter > 3) {
    tilt = true;
    flash('TILT!', COL.danger);
    blip(90, .5, .18, 'sawtooth');
  }
}
function resetInputs() {
  keys.left = false; keys.right = false;
  holdingLaunch = false; launchPower = 0;
}
addEventListener('blur', resetInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInputs(); });

function typingInField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
addEventListener('keydown', e => {
  if (e.repeat || typingInField(e)) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyZ') { keys.left = true; blip(340, .03, .06); }
  if (e.code === 'ArrowRight' || e.code === 'Slash') { keys.right = true; blip(360, .03, .06); }
  if (e.code === 'KeyT') nudge();
  if (e.code === 'Space') {
    e.preventDefault();
    if (launching) holdingLaunch = true;
    else if (!playing && $('overlay').className === 'open') { startGame(); holdingLaunch = true; }
  }
});
addEventListener('keyup', e => {
  if (typingInField(e)) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyZ') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'Slash') keys.right = false;
  if (e.code === 'Space' && launching && holdingLaunch) fireBall();
});
function bindTouch(id, down, up, cancel) {
  const el = $(id);
  el.addEventListener('touchstart', e => { e.preventDefault(); down(); }, { passive: false });
  el.addEventListener('touchend', e => { e.preventDefault(); up && up(); }, { passive: false });
  el.addEventListener('touchcancel', () => { (cancel || up) && (cancel || up)(); }, { passive: true });
}
bindTouch('touch-left', () => keys.left = true, () => keys.left = false);
bindTouch('touch-right', () => keys.right = true, () => keys.right = false);
bindTouch('touch-launch',
  () => { if (launching) holdingLaunch = true; else if (!playing && $('overlay').className === 'open') { startGame(); holdingLaunch = true; } },
  () => { if (launching && holdingLaunch) fireBall(); },
  () => { holdingLaunch = false; launchPower = 0; });
// на десктопе с тачскрином медиазапрос может не сработать — показываем зоны по первому касанию
document.addEventListener('touchstart', () => document.getElementById('touch-controls').classList.add('force'), { once: true, passive: true });

function fireBall() {
  holdingLaunch = false;
  launching = false;
  ball.vx = 0;
  ball.vy = -(1250 + 1550 * Math.min(1, launchPower)) * (0.97 + Math.random() * 0.06);
  launchPower = 0;
  blip(600, .12, .12, 'triangle');
}

/* ---------- физика ---------- */
function collideSegment(x1, y1, x2, y2, rest, surfVX = 0, surfVY = 0, pad = 0) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = ((ball.x - x1) * dx + (ball.y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx, py = y1 + t * dy;
  let nx = ball.x - px, ny = ball.y - py;
  const d = Math.hypot(nx, ny);
  const rr = R + pad;
  if (d >= rr || d === 0) return false;
  nx /= d; ny /= d;
  ball.x = px + nx * rr; ball.y = py + ny * rr;
  const rvx = ball.vx - surfVX, rvy = ball.vy - surfVY;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    ball.vx -= (1 + rest) * vn * nx;
    ball.vy -= (1 + rest) * vn * ny;
  }
  return true;
}

function step(dt) {
  // флипперы
  for (const f of flippers) {
    f.prev = f.ang;
    const raised = (f.dir === 1 ? keys.left : keys.right) && !tilt;
    f.target = raised ? f.raised : f.rest;
    const diff = f.target - f.ang;
    const maxStep = FL_SPEED * dt;
    f.ang += Math.abs(diff) < maxStep ? diff : Math.sign(diff) * maxStep;
    f.vel = (f.ang - f.prev) / dt;
  }
  if (!ball.alive) return;

  if (launching) {
    if (holdingLaunch) launchPower = Math.min(1, launchPower + dt / 1.1);
    return;
  }

  playedTime += dt;
  if (ball.x < LANE_X - R) ball.exitedLane = true;
  ball.vy += GRAV * dt;
  const drag = 1 - 0.03 * dt;
  ball.vx *= drag; ball.vy *= drag;
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > 2800) { ball.vx *= 2800 / sp; ball.vy *= 2800 / sp; }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  tiltMeter = Math.max(0, tiltMeter - dt * 0.6);

  // стены
  for (const [x1, y1, x2, y2, rest] of walls) collideSegment(x1, y1, x2, y2, rest);

  // односторонняя заслонка жёлоба: не пускаем обратно шар, уже вышедший в поле
  if (ball.exitedLane && ball.x > LANE_X - R && ball.y > 355 && ball.y < 385 && ball.vy > 0 && !launching) {
    collideSegment(LANE_X, 370, 516, 370, 0.4);
  }

  // слингшоты
  for (const s of slings) {
    const v = s.verts;
    let hit = false;
    for (let i = 0; i < 3; i++) {
      const [x1, y1] = v[i], [x2, y2] = v[(i + 1) % 3];
      if (collideSegment(x1, y1, x2, y2, 0.4)) hit = true;
    }
    if (hit) {
      const mx = (v[0][0] + v[1][0] + v[2][0]) / 3;
      const my = (v[0][1] + v[1][1] + v[2][1]) / 3;
      let nx = ball.x - mx, ny = ball.y - my;
      const d = Math.hypot(nx, ny) || 1;
      ball.vx += nx / d * 520; ball.vy += ny / d * 520 - 150;
      s.flash = 1; addScore(50); addPopup(ball.x, ball.y, '+50'); blip(300, .05, .1);
    }
  }

  // бамперы
  for (const b of bumpers) {
    let nx = ball.x - b.x, ny = ball.y - b.y;
    const d = Math.hypot(nx, ny);
    if (d < R + b.r && d > 0) {
      nx /= d; ny /= d;
      ball.x = b.x + nx * (R + b.r);
      ball.y = b.y + ny * (R + b.r);
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) { ball.vx -= 2 * vn * nx; ball.vy -= 2 * vn * ny; }
      const kick = b.pin ? 150 : 420;
      const j = (Math.random() - 0.5) * 0.25; // лёгкий развал угла, чтобы шар не зациклило
      const jx = nx * Math.cos(j) - ny * Math.sin(j), jy = nx * Math.sin(j) + ny * Math.cos(j);
      ball.vx += jx * kick; ball.vy += jy * kick;
      b.flash = 1; addScore(b.pts); addPopup(b.x, b.y - b.r - 8, '+' + b.pts, COL.teal);
      blip(500 + Math.random() * 200, .05, .12);
    }
  }

  // банк целей
  for (const t of targets) {
    if (!t.up) continue;
    if (ball.x - R < t.x + t.w && ball.x + R > t.x && ball.y - R < t.y + t.h && ball.y + R > t.y) {
      t.up = false; t.flash = 1;
      ball.vx = Math.abs(ball.vx) * 0.7 + 160;
      addScore(500); addPopup(t.x + 30, t.y, '+500'); blip(680, .07, .12);
      if (targets.every(q => !q.up)) {
        addScore(5000);
        flash('БАНК ЦЕЛЕЙ +5000', COL.teal);
        setTimeout(() => targets.forEach(q => { q.up = true; }), 1400);
        blip(880, .25, .14, 'triangle');
      }
    }
  }

  // огни Марни
  for (const l of lanes) {
    l.cd = Math.max(0, l.cd - dt);
    const d = Math.hypot(ball.x - l.x, ball.y - l.y);
    if (d < R + 16 && l.cd === 0) {
      l.cd = 1;
      if (!l.lit) {
        l.lit = true; addScore(200); addPopup(l.x, l.y + 26, '+200', COL.teal); blip(590, .06, .1);
        if (lanes.every(q => q.lit)) {
          addScore(1000);
          flash('ОГНИ МАРНИ +1000', COL.teal);
          setTimeout(() => lanes.forEach(q => { q.lit = false; }), 1200);
        }
      } else addScore(50);
    }
  }

  // флипперы
  cradled = false;
  for (const f of flippers) {
    const tx = f.px + Math.cos(f.ang) * f.len;
    const ty = f.py + Math.sin(f.ang) * f.len;
    const rx = ball.x - f.px, ry = ball.y - f.py;
    const svx = -f.vel * ry, svy = f.vel * rx;
    const hit = collideSegment(f.px, f.py, tx, ty, 0.35, svx, svy, 8);
    if (hit && f.target === f.raised) cradled = true;
  }

  // шар скатился обратно в жёлоб — перезаряжаем пружину
  if (!launching && ball.x > LANE_X && ball.y > 875 && Math.abs(ball.vy) < 60) {
    launching = true; launchPower = 0; ball.exitedLane = false;
  }

  // страховка от застревания: почти неподвижный шар мягко подталкиваем,
  // но не тот, что честно пойман поднятым флиппером
  if (Math.hypot(ball.vx, ball.vy) < 12 && !cradled) {
    stuckTime += dt;
    if (stuckTime > 2.5) {
      ball.vx += (270 - ball.x) > 0 ? 90 : -90;
      ball.vy -= 160;
      stuckTime = 0;
    }
  } else stuckTime = 0;

  // слив
  if (ball.y > H + R * 2) endGame();
}

/* ---------- отрисовка ---------- */
function roundGear(gx, gy, r, teeth, rot, alpha) {
  cx.save();
  cx.translate(gx, gy); cx.rotate(rot);
  cx.globalAlpha = alpha;
  cx.strokeStyle = COL.tealDim;
  cx.lineWidth = 3;
  cx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.5) / teeth) * Math.PI * 2;
    const r1 = r, r2 = r * 0.86;
    cx.arc(0, 0, r1, a0, a0 + Math.PI / teeth * 0.9);
    cx.arc(0, 0, r2, a1, a1 + Math.PI / teeth * 0.9);
  }
  cx.stroke();
  cx.beginPath(); cx.arc(0, 0, r * 0.35, 0, Math.PI * 2); cx.stroke();
  cx.restore();
}

function drawTable() {
  const t = performance.now() / 1000;

  // фон: глубина + виньетка
  const bg = cx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0c181e');
  bg.addColorStop(0.55, '#0a1418');
  bg.addColorStop(1, '#060c10');
  cx.fillStyle = bg;
  cx.fillRect(0, 0, W, H);

  // вращающиеся шестерни Марни в глубине
  roundGear(270, 470, 160, 14, t * 0.05, 0.10);
  roundGear(120, 620, 70, 10, -t * 0.09, 0.08);
  roundGear(415, 560, 55, 9, t * 0.12, 0.08);
  cx.globalAlpha = 1;

  // виньетка
  const vg = cx.createRadialGradient(270, 430, 220, 270, 480, 620);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  cx.fillStyle = vg;
  cx.fillRect(0, 0, W, H);

  // борта: тёмная подложка + светящаяся кромка
  cx.lineCap = 'round';
  cx.strokeStyle = '#1c333d';
  cx.lineWidth = 10;
  cx.beginPath();
  for (const [x1, y1, x2, y2] of walls) { cx.moveTo(x1, y1); cx.lineTo(x2, y2); }
  cx.stroke();
  cx.strokeStyle = COL.teal;
  cx.lineWidth = 2;
  cx.shadowColor = 'rgba(53,214,197,0.55)';
  cx.shadowBlur = 8;
  cx.beginPath();
  for (const [x1, y1, x2, y2] of walls) { cx.moveTo(x1, y1); cx.lineTo(x2, y2); }
  cx.stroke();
  cx.shadowBlur = 0;

  // слингшоты: металлический клин с подсветкой при ударе
  for (const s of slings) {
    const g = cx.createLinearGradient(s.verts[0][0], s.verts[0][1], s.verts[2][0], s.verts[2][1]);
    g.addColorStop(0, s.flash > 0 ? '#f0cc7a' : '#20404c');
    g.addColorStop(1, s.flash > 0 ? COL.gold : '#12242c');
    cx.fillStyle = g;
    cx.beginPath();
    cx.moveTo(...s.verts[0]); cx.lineTo(...s.verts[1]); cx.lineTo(...s.verts[2]);
    cx.closePath(); cx.fill();
    cx.strokeStyle = s.flash > 0 ? COL.gold : COL.tealDim;
    cx.lineWidth = 2.5; cx.stroke();
    s.flash = Math.max(0, s.flash - 0.08);
  }

  // бамперы: пульсирующее кольцо + металлическая шляпка
  for (const b of bumpers) {
    const pulse = b.pin ? 0 : 2 + Math.sin(t * 3 + b.x) * 1.5;
    const glow = cx.createRadialGradient(b.x, b.y, b.r * 0.4, b.x, b.y, b.r + 14 + pulse);
    glow.addColorStop(0, b.flash > 0 ? 'rgba(255,240,200,0.9)' : 'rgba(53,214,197,0.35)');
    glow.addColorStop(1, 'rgba(53,214,197,0)');
    cx.fillStyle = glow;
    cx.beginPath(); cx.arc(b.x, b.y, b.r + 14 + pulse, 0, Math.PI * 2); cx.fill();

    const cap = cx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, 2, b.x, b.y, b.r);
    cap.addColorStop(0, b.flash > 0 ? '#fff4d6' : '#2c5a64');
    cap.addColorStop(0.7, b.flash > 0 ? COL.gold : '#123138');
    cap.addColorStop(1, '#0b1e24');
    cx.fillStyle = cap;
    cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = b.flash > 0 ? '#ffe9b0' : COL.teal;
    cx.lineWidth = 2.5; cx.stroke();
    cx.beginPath(); cx.arc(b.x, b.y, b.r * 0.55, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(53,214,197,0.5)'; cx.lineWidth = 1.5; cx.stroke();
    if (!b.pin) {
      cx.fillStyle = b.flash > 0 ? '#14100a' : COL.text;
      cx.font = 'bold 12px sans-serif'; cx.textAlign = 'center';
      cx.fillText(String(b.pts), b.x, b.y + 4);
    }
    b.flash = Math.max(0, b.flash - 0.06);
  }

  // банк целей: светодиодные пластины
  for (const tg of targets) {
    cx.save();
    if (tg.up) {
      cx.shadowColor = 'rgba(216,169,78,0.8)'; cx.shadowBlur = 10;
      const g = cx.createLinearGradient(tg.x, tg.y, tg.x + tg.w, tg.y);
      g.addColorStop(0, '#f2d488'); g.addColorStop(1, COL.gold);
      cx.fillStyle = g;
    } else cx.fillStyle = '#152730';
    cx.fillRect(tg.x, tg.y, tg.w, tg.h);
    cx.restore();
    cx.strokeStyle = tg.up ? '#8a6b2f' : '#0e1c22';
    cx.lineWidth = 1.5;
    cx.strokeRect(tg.x, tg.y, tg.w, tg.h);
  }

  // огни Марни: линзы
  for (const l of lanes) {
    const lg = cx.createRadialGradient(l.x, l.y, 2, l.x, l.y, 16);
    if (l.lit) { lg.addColorStop(0, '#d8fff8'); lg.addColorStop(0.5, COL.teal); lg.addColorStop(1, 'rgba(53,214,197,0.15)'); }
    else { lg.addColorStop(0, '#1b3840'); lg.addColorStop(1, '#0f2026'); }
    cx.fillStyle = lg;
    cx.beginPath(); cx.arc(l.x, l.y, 14, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = l.lit ? COL.teal : '#22434e';
    cx.lineWidth = 2; cx.stroke();
  }

  // пружина в жёлобе
  if (launching) {
    const comp = 54 * launchPower;
    const top = 838 + comp;
    cx.strokeStyle = COL.danger;
    cx.lineWidth = 3.2;
    cx.beginPath();
    const coils = 7;
    for (let i = 0; i <= coils * 2; i++) {
      const yy = top + (896 - top) * i / (coils * 2);
      const xx = 493 + (i % 2 ? 11 : -11);
      i === 0 ? cx.moveTo(493, yy) : cx.lineTo(xx, yy);
    }
    cx.stroke();
    cx.fillStyle = '#c9d6d3';
    cx.fillRect(480, top - 7, 26, 7);
  }

  // флипперы: клин с втулкой
  for (const f of flippers) {
    const txp = f.px + Math.cos(f.ang) * f.len;
    const typ = f.py + Math.sin(f.ang) * f.len;
    const px = -Math.sin(f.ang), py = Math.cos(f.ang);
    const wBase = 11, wTip = 5;
    const grad = cx.createLinearGradient(f.px, f.py - 14, f.px, f.py + 14);
    grad.addColorStop(0, '#f2d488'); grad.addColorStop(0.5, COL.gold); grad.addColorStop(1, '#7a5c26');
    cx.fillStyle = grad;
    cx.beginPath();
    cx.moveTo(f.px + px * wBase, f.py + py * wBase);
    cx.lineTo(txp + px * wTip, typ + py * wTip);
    cx.arc(txp, typ, wTip, Math.atan2(py, px), Math.atan2(-py, -px));
    cx.lineTo(f.px - px * wBase, f.py - py * wBase);
    cx.arc(f.px, f.py, wBase, Math.atan2(-py, -px), Math.atan2(py, px));
    cx.closePath(); cx.fill();
    cx.strokeStyle = '#5c451c'; cx.lineWidth = 1.5; cx.stroke();
    cx.fillStyle = '#2a2013';
    cx.beginPath(); cx.arc(f.px, f.py, 5, 0, Math.PI * 2); cx.fill();
  }

  // хвост шара
  if (ball.alive && !launching) {
    trail.push([ball.x, ball.y]);
    if (trail.length > 8) trail.shift();
    for (let i = 0; i < trail.length; i++) {
      cx.globalAlpha = (i / trail.length) * 0.25;
      cx.fillStyle = COL.teal;
      cx.beginPath(); cx.arc(trail[i][0], trail[i][1], R * (0.4 + i / trail.length * 0.5), 0, Math.PI * 2); cx.fill();
    }
    cx.globalAlpha = 1;
  } else trail.length = 0;

  // шар
  if (ball.alive) {
    cx.fillStyle = 'rgba(0,0,0,0.4)';
    cx.beginPath(); cx.ellipse(ball.x + 3, ball.y + 5, R * 0.9, R * 0.55, 0, 0, Math.PI * 2); cx.fill();
    const g = cx.createRadialGradient(ball.x - 4, ball.y - 4, 1.5, ball.x, ball.y, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#d9e6ea');
    g.addColorStop(1, '#79929e');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(ball.x, ball.y, R, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = 'rgba(255,255,255,0.85)';
    cx.beginPath(); cx.arc(ball.x - 3.5, ball.y - 3.5, 2.2, 0, Math.PI * 2); cx.fill();
  }

  // всплывающие очки
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.age += 1 / 60;
    if (p.age > 0.9) { popups.splice(i, 1); continue; }
    cx.globalAlpha = 1 - p.age / 0.9;
    cx.fillStyle = p.color;
    cx.font = 'bold 15px sans-serif';
    cx.textAlign = 'center';
    cx.fillText(p.text, p.x, p.y - p.age * 40);
  }
  cx.globalAlpha = 1;

  // индикатор наклона
  if (tiltMeter > 0.2 && !tilt) {
    cx.fillStyle = COL.danger;
    cx.globalAlpha = Math.min(1, tiltMeter / 3);
    cx.fillRect(20, 8, (W - 40) * Math.min(1, tiltMeter / 3), 4);
    cx.globalAlpha = 1;
  }
}

/* ---------- главный цикл ---------- */
let last = performance.now();
function frame(now) {
  const dtRaw = Math.min(0.033, (now - last) / 1000);
  last = now;
  const sub = Math.max(6, Math.ceil(Math.hypot(ball.vx, ball.vy) * dtRaw / 8));
  for (let i = 0; i < sub; i++) step(dtRaw / sub);
  drawTable();
  requestAnimationFrame(frame);
}
hud();
requestAnimationFrame(frame);

// фоновая вкладка не качает requestAnimationFrame — физика едет на таймере;
// число подшагов подбираем под скорость, чтобы шар не пролетал сквозь стены
setInterval(() => {
  if (!document.hidden) return;
  const now = performance.now();
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  const n = Math.max(6, Math.ceil(Math.hypot(ball.vx, ball.vy) * dt / 8));
  for (let i = 0; i < n; i++) step(dt / n);
}, 16);

// служебный доступ для отладки
window.MP = {
  ball,
  tick: dt => { for (let i = 0; i < 6; i++) step(dt / 6); },
  set(x, y, vx, vy) { ball.x = x; ball.y = y; ball.vx = vx; ball.vy = vy; },
  get state() { return { playing, launching, launchPower, score, tilt, silver, tokens }; },
};
