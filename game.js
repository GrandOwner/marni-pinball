'use strict';

/* ============ Пинбол Марни — одна попытка, один шар ============ */

const cv = document.getElementById('table');
const cx = cv.getContext('2d');
const W = cv.width, H = cv.height;

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
const GRAV = 1900;
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
const FL_SPEED = 30;
const flippers = [
  makeFlipper(172, 874, 98, 0.62, -0.46, 1),
  makeFlipper(368, 874, 98, Math.PI - 0.62, Math.PI + 0.46, -1),
];

/* ---------- шар и партия ---------- */
const ball = { x: 0, y: 0, vx: 0, vy: 0, alive: false, inLane: false };
let playing = false;          // партия идёт (шар куплен)
let launching = false;        // шар в жёлобе, ждём запуск
let launchPower = 0;
let holdingLaunch = false;
let score = 0;
let startTime = 0;
let tilt = false;
let tiltMeter = 0;
let stuckTime = 0;
let msgTimer = null;

/* ---------- звук ---------- */
let audio = null;
function blip(freq, dur = 0.05, vol = 0.12, type = 'square') {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
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
  ball.alive = true; ball.inLane = true;
  playing = true; launching = true; launchPower = 0;
  startTime = performance.now();
  closeAll(); hud();
  blip(520, .08, .1, 'triangle');
}

function endGame() {
  playing = false; ball.alive = false;
  const secs = Math.floor((performance.now() - startTime) / 1000);
  const earned = Math.floor(score / 200) + Math.floor(secs / 10);
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
  if (!playing || tilt || !ball.alive) return;
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
addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyZ') { keys.left = true; blip(340, .03, .06); }
  if (e.code === 'ArrowRight' || e.code === 'Slash') { keys.right = true; blip(360, .03, .06); }
  if (e.code === 'KeyT') nudge();
  if (e.code === 'Space') {
    e.preventDefault();
    if (launching) holdingLaunch = true;
    else if (!playing && $('overlay').className === 'open') startGame();
  }
});
addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyZ') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'Slash') keys.right = false;
  if (e.code === 'Space' && launching && holdingLaunch) fireBall();
});
function bindTouch(id, down, up) {
  const el = $(id);
  el.addEventListener('touchstart', e => { e.preventDefault(); down(); }, { passive: false });
  el.addEventListener('touchend', e => { e.preventDefault(); up && up(); }, { passive: false });
}
bindTouch('touch-left', () => keys.left = true, () => keys.left = false);
bindTouch('touch-right', () => keys.right = true, () => keys.right = false);
bindTouch('touch-launch', () => { if (launching) holdingLaunch = true; }, () => { if (launching && holdingLaunch) fireBall(); });

function fireBall() {
  holdingLaunch = false;
  launching = false;
  ball.vy = -(1000 + 1300 * Math.min(1, launchPower)) * (0.97 + Math.random() * 0.06);
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

  ball.vy += GRAV * dt;
  const drag = 1 - 0.03 * dt;
  ball.vx *= drag; ball.vy *= drag;
  const sp = Math.hypot(ball.vx, ball.vy);
  if (sp > 2300) { ball.vx *= 2300 / sp; ball.vy *= 2300 / sp; }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  tiltMeter = Math.max(0, tiltMeter - dt * 0.6);

  // стены
  for (const [x1, y1, x2, y2, rest] of walls) collideSegment(x1, y1, x2, y2, rest);

  // односторонняя заслонка жёлоба: сверху вниз не пускаем обратно
  if (ball.x > LANE_X - R && ball.y > 355 && ball.y < 385 && ball.vy > 0 && !launching) {
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
      ball.vx += nx / d * 380; ball.vy += ny / d * 380 - 120;
      s.flash = 1; addScore(50); blip(300, .05, .1);
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
      const kick = b.pin ? 120 : 300;
      const j = (Math.random() - 0.5) * 0.25; // лёгкий развал угла, чтобы шар не зациклило
      const jx = nx * Math.cos(j) - ny * Math.sin(j), jy = nx * Math.sin(j) + ny * Math.cos(j);
      ball.vx += jx * kick; ball.vy += jy * kick;
      b.flash = 1; addScore(b.pts); blip(500 + Math.random() * 200, .05, .12);
    }
  }

  // банк целей
  for (const t of targets) {
    if (!t.up) continue;
    if (ball.x - R < t.x + t.w && ball.x + R > t.x && ball.y - R < t.y + t.h && ball.y + R > t.y) {
      t.up = false; t.flash = 1;
      ball.vx = Math.abs(ball.vx) * 0.7 + 160;
      addScore(500); blip(680, .07, .12);
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
        l.lit = true; addScore(200); blip(590, .06, .1);
        if (lanes.every(q => q.lit)) {
          addScore(1000);
          flash('ОГНИ МАРНИ +1000', COL.teal);
          setTimeout(() => lanes.forEach(q => { q.lit = false; }), 1200);
        }
      } else addScore(50);
    }
  }

  // флипперы
  for (const f of flippers) {
    const tx = f.px + Math.cos(f.ang) * f.len;
    const ty = f.py + Math.sin(f.ang) * f.len;
    // скорость поверхности в точке контакта — приблизительно в точке касания
    const mx = (f.px + tx) / 2, my = (f.py + ty) / 2;
    const rx = ball.x - f.px, ry = ball.y - f.py;
    const svx = -f.vel * ry, svy = f.vel * rx;
    collideSegment(f.px, f.py, tx, ty, 0.35, svx, svy, 8);
  }

  // шар скатился обратно в жёлоб — перезаряжаем пружину
  if (!launching && ball.x > LANE_X && ball.y > 875 && Math.abs(ball.vy) < 60) {
    launching = true; launchPower = 0;
  }

  // страховка от застревания: почти неподвижный шар мягко подталкиваем
  if (Math.hypot(ball.vx, ball.vy) < 6) {
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
function drawTable() {
  cx.fillStyle = COL.bg;
  cx.fillRect(0, 0, W, H);

  // фоновые кольца механики Марни
  cx.save();
  cx.globalAlpha = 0.07;
  cx.strokeStyle = COL.teal;
  for (let r = 40; r < 240; r += 40) {
    cx.beginPath(); cx.arc(270, 430, r, 0, Math.PI * 2); cx.stroke();
  }
  cx.restore();

  // стены
  cx.strokeStyle = COL.line;
  cx.lineWidth = 4;
  cx.lineCap = 'round';
  cx.beginPath();
  for (const [x1, y1, x2, y2] of walls) { cx.moveTo(x1, y1); cx.lineTo(x2, y2); }
  cx.stroke();

  // слингшоты
  for (const s of slings) {
    cx.fillStyle = s.flash > 0 ? COL.gold : '#173038';
    cx.beginPath();
    cx.moveTo(...s.verts[0]); cx.lineTo(...s.verts[1]); cx.lineTo(...s.verts[2]);
    cx.closePath(); cx.fill();
    cx.strokeStyle = COL.tealDim; cx.lineWidth = 2; cx.stroke();
    s.flash = Math.max(0, s.flash - 0.08);
  }

  // бамперы — ядра Марни
  for (const b of bumpers) {
    const g = cx.createRadialGradient(b.x, b.y, 4, b.x, b.y, b.r + 6);
    g.addColorStop(0, b.flash > 0 ? '#fff2cf' : COL.teal);
    g.addColorStop(1, 'rgba(53,214,197,0)');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = b.flash > 0 ? COL.gold : '#123138';
    cx.beginPath(); cx.arc(b.x, b.y, b.r, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = COL.teal; cx.lineWidth = 2; cx.stroke();
    if (!b.pin) {
      cx.fillStyle = COL.text;
      cx.font = 'bold 11px sans-serif'; cx.textAlign = 'center';
      cx.fillText(String(b.pts), b.x, b.y + 4);
    }
    b.flash = Math.max(0, b.flash - 0.06);
  }

  // банк целей
  for (const t of targets) {
    cx.fillStyle = t.up ? COL.gold : '#1a2c33';
    cx.fillRect(t.x, t.y, t.w, t.h);
    t.flash = Math.max(0, t.flash - 0.08);
  }

  // огни Марни
  for (const l of lanes) {
    cx.beginPath(); cx.arc(l.x, l.y, 14, 0, Math.PI * 2);
    cx.fillStyle = l.lit ? COL.teal : '#12262c';
    cx.fill();
    cx.strokeStyle = COL.tealDim; cx.lineWidth = 2; cx.stroke();
  }

  // жёлоб: пружина
  if (launching) {
    const h = 60 * launchPower;
    cx.fillStyle = COL.gold;
    cx.fillRect(482, 896 - 4, 24, 6 + h * 0);
    cx.fillStyle = COL.danger;
    cx.fillRect(482, 900, 24, -h);
  }

  // флипперы
  for (const f of flippers) {
    const tx = f.px + Math.cos(f.ang) * f.len;
    const ty = f.py + Math.sin(f.ang) * f.len;
    cx.strokeStyle = COL.gold;
    cx.lineWidth = 16;
    cx.beginPath(); cx.moveTo(f.px, f.py); cx.lineTo(tx, ty); cx.stroke();
    cx.strokeStyle = COL.goldDim;
    cx.lineWidth = 8;
    cx.beginPath(); cx.moveTo(f.px, f.py); cx.lineTo(tx, ty); cx.stroke();
  }

  // шар
  if (ball.alive) {
    const g = cx.createRadialGradient(ball.x - 4, ball.y - 4, 2, ball.x, ball.y, R);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#8fa8b5');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(ball.x, ball.y, R, 0, Math.PI * 2); cx.fill();
  }

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
  const sub = 6;
  for (let i = 0; i < sub; i++) step(dtRaw / sub);
  drawTable();
  requestAnimationFrame(frame);
}
hud();
requestAnimationFrame(frame);

// фоновая вкладка не качает requestAnimationFrame — физика едет на таймере
setInterval(() => {
  if (!document.hidden) return;
  const now = performance.now();
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  for (let i = 0; i < 4; i++) step(dt / 4);
}, 16);

// служебный доступ для отладки
window.MP = {
  ball,
  tick: dt => { for (let i = 0; i < 6; i++) step(dt / 6); },
  set(x, y, vx, vy) { ball.x = x; ball.y = y; ball.vx = vx; ball.vy = vy; },
  get state() { return { playing, launching, launchPower, score, tilt, silver, tokens }; },
};
