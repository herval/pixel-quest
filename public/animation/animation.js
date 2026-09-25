(() => {
'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const W = 128, H = 96;
const FLOOR = 78;          // first row of the stone floor
const OX = 40;             // wizard robe center x
const STEP_MS = 1000 / 60;
const POSE_EVERY = 5;      // pose snapshot every 5 sim steps -> 12 fps pixel animation

const PALETTE = [
  '#07061a', // 0  sky 0 (deepest)
  '#0f0d2b', // 1  sky 1
  '#1a1642', // 2  sky 2
  '#2a2160', // 3  sky 3
  '#3c2c7a', // 4  sky 4 (horizon)
  '#fff4d6', // 5  moon
  '#cbbf9e', // 6  moon shade
  '#ffffff', // 7  white
  '#0a0612', // 8  ink / outline
  '#4a1830', // 9  robe dark
  '#8a2a3e', // 10 robe mid
  '#c8503f', // 11 robe light
  '#f2b98c', // 12 skin
  '#b06f55', // 13 skin shade
  '#ecebe4', // 14 beard
  '#9a97a8', // 15 beard shade
  '#7a4a2a', // 16 wood
  '#43261a', // 17 wood dark
  '#2c2b45', // 18 stone dark
  '#4a4966', // 19 stone mid
  '#6d6c8c', // 20 stone light
  '#b8fbff', // 21 magic pale
  '#3de0ff', // 22 magic cyan
  '#3a7bff', // 23 magic blue
  '#9b3dff', // 24 magic violet
  '#f2c14e', // 25 gold
];
const SKY0 = 0, SKY1 = 1, SKY2 = 2, SKY3 = 3, SKY4 = 4, MOON = 5, MOON_SH = 6,
      WHITE = 7, INK = 8, ROBE_D = 9, ROBE_M = 10, ROBE_L = 11, SKIN = 12,
      SKIN_SH = 13, BEARD = 14, BEARD_SH = 15, WOOD = 16, WOOD_D = 17,
      STONE_D = 18, STONE_M = 19, STONE_L = 20, MAGIC_P = 21, MAGIC_C = 22,
      MAGIC_B = 23, MAGIC_V = 24, GOLD = 25;
const EMPTY = 255;

// Particle color ramp: white -> magic -> dark, then despawn
const RAMP = new Uint8Array([WHITE, MAGIC_P, MAGIC_C, MAGIC_C, MAGIC_B, MAGIC_V, SKY4, SKY3]);
const RAMPN = RAMP.length;

// 4x4 ordered dither thresholds in (0,1)
const BAYER = new Float32Array(16);
{
  const b = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let i = 0; i < 16; i++) BAYER[i] = (b[i] + 0.5) / 16;
}

// ---------------------------------------------------------------------------
// Buffers (all preallocated)
// ---------------------------------------------------------------------------
const fb = new Uint8Array(W * H);   // palette-indexed frame
const bg = new Uint8Array(W * H);   // static background
const spr = new Uint8Array(W * H);  // wizard sprite layer

const off = document.createElement('canvas');
off.width = W; off.height = H;
const octx = off.getContext('2d');
const img = octx.createImageData(W, H);
const out32 = new Uint32Array(img.data.buffer);

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const PAL32 = new Uint32Array(PALETTE.length);
for (let i = 0; i < PALETTE.length; i++) {
  const v = parseInt(PALETTE[i].slice(1), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  PAL32[i] = littleEndian
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

// Palette remaps for the cast flash (sky and stone lift toward the light)
const RM0 = new Uint8Array(32), RM1 = new Uint8Array(32), RM2 = new Uint8Array(32);
for (let i = 0; i < 32; i++) { RM0[i] = RM1[i] = RM2[i] = i; }
for (let i = SKY0; i <= SKY4; i++) { RM1[i] = Math.min(SKY4, i + 1); RM2[i] = Math.min(SKY4, i + 2); }
RM1[STONE_D] = RM2[STONE_D] = STONE_M;
RM1[STONE_M] = RM2[STONE_M] = STONE_L;
RM2[STONE_L] = BEARD_SH;

// Floor tint under magic light
const LIT = new Uint8Array(32);
for (let i = 0; i < 32; i++) LIT[i] = i;
LIT[SKY0] = STONE_D; LIT[STONE_D] = STONE_M; LIT[STONE_M] = STONE_L; LIT[STONE_L] = BEARD_SH;

// Deterministic PRNG (xorshift32)
let seed = 0x2f6b1d93;
function rnd() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Pixel primitives (integer coords only)
// ---------------------------------------------------------------------------
function px(x, y, c) {
  if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = c;
}
function sp(x, y, c) {
  if (x >= 0 && x < W && y >= 0 && y < H) spr[y * W + x] = c;
}

// Bresenham into the sprite layer. mode 0 = staff pixels, 1 = 2x2 sleeve stamp
function sprLine(x0, y0, x1, y1, mode) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    if (mode === 0) {
      if (y0 < FLOOR) sp(x0, y0, (n % 5 === 4) ? WOOD_D : WOOD);
    } else {
      sp(x0, y0, ROBE_M); sp(x0 + 1, y0, ROBE_M);
      sp(x0, y0 + 1, ROBE_D); sp(x0 + 1, y0 + 1, ROBE_D);
    }
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------------------------------------------------------------------------
// Static background
// ---------------------------------------------------------------------------
const NSTAR = 30;
const starX = new Int16Array(NSTAR), starY = new Int16Array(NSTAR);
const starPh = new Float32Array(NSTAR), starSp = new Float32Array(NSTAR);
const starBig = new Uint8Array(NSTAR);
const MOON_X = 103, MOON_Y = 17, MOON_R = 7;

function buildBackground() {
  // Banded night sky with ordered-dither transitions
  for (let y = 0; y < FLOOR; y++) {
    const v = (y / (FLOOR - 1)) * 4;
    const base = v | 0, f = v - base;
    for (let x = 0; x < W; x++) {
      let c = base;
      if (f > 0.55 && ((f - 0.55) / 0.45) > BAYER[(y & 3) * 4 + (x & 3)]) c++;
      bg[y * W + x] = Math.min(SKY4, c);
    }
  }
  // Moon halo (dithered lift)
  for (let y = MOON_Y - 14; y <= MOON_Y + 14; y++) {
    for (let x = MOON_X - 14; x <= MOON_X + 14; x++) {
      if (x < 0 || x >= W || y < 0) continue;
      const d = Math.sqrt((x - MOON_X) * (x - MOON_X) + (y - MOON_Y) * (y - MOON_Y));
      const lv = 1 - (d - MOON_R - 1) / 6;
      if (d > MOON_R && lv > 0 && lv * 0.6 > BAYER[(y & 3) * 4 + (x & 3)]) {
        const i = y * W + x;
        bg[i] = Math.min(SKY4, bg[i] + 1);
      }
    }
  }
  // Moon disc with crescent shading and craters
  for (let dy = -MOON_R; dy <= MOON_R; dy++) {
    for (let dx = -MOON_R; dx <= MOON_R; dx++) {
      if (dx * dx + dy * dy > MOON_R * MOON_R + MOON_R * 0.6) continue;
      const sh = (dx + 3) * (dx + 3) + (dy + 2) * (dy + 2) > (MOON_R + 1) * (MOON_R + 1);
      bg[(MOON_Y + dy) * W + MOON_X + dx] = sh ? MOON_SH : MOON;
    }
  }
  const craters = [-2, 1, -1, 1, -2, 2, 2, -3, 3, 2, 1, 4, -4, -2];
  for (let i = 0; i < craters.length; i += 2) {
    bg[(MOON_Y + craters[i + 1]) * W + MOON_X + craters[i]] = MOON_SH;
  }
  // Distant hills
  for (let x = 0; x < W; x++) {
    const h = Math.round(70 + 2.5 * Math.sin(x * 0.07 + 1) + 1.5 * Math.sin(x * 0.19 + 0.3) + Math.sin(x * 0.41));
    for (let y = h; y < FLOOR; y++) bg[y * W + x] = y === h ? SKY2 : SKY1;
  }
  // Stone floor: lip + three rows of bricks, widening toward the viewer
  for (let x = 0; x < W; x++) { bg[FLOOR * W + x] = STONE_L; bg[(FLOOR + 1) * W + x] = STONE_M; }
  const rows = [[80, 5, 11, 0], [85, 5, 13, 6], [90, 6, 16, 3]]; // y0, h, brickW, offset
  for (let r = 0; r < rows.length; r++) {
    const y0 = rows[r][0], h = rows[r][1], bw = rows[r][2], o = rows[r][3];
    for (let y = y0; y < y0 + h && y < H; y++) {
      for (let x = 0; x < W; x++) {
        const col = (x + o) % bw, row = y - y0;
        let c;
        if (row === 0 || col === 0) c = STONE_D;
        else if (row === 1 || col === 1) c = STONE_L;
        else if (row === h - 1 || col === bw - 1) c = STONE_D;
        else c = STONE_M;
        if (c === STONE_M && rnd() < 0.05) c = STONE_D;
        bg[y * W + x] = c;
      }
    }
  }
  // Darken the front of the floor
  for (let y = FLOOR + 10; y < H; y++) {
    const lv = (y - FLOOR - 9) / 9;
    for (let x = 0; x < W; x++) {
      if (lv > BAYER[(y & 3) * 4 + (x & 3)]) {
        const i = y * W + x, c = bg[i];
        bg[i] = c === STONE_L ? STONE_M : c === STONE_M ? STONE_D : SKY0;
      }
    }
  }
  // Stars
  for (let i = 0; i < NSTAR; i++) {
    let x, y;
    do {
      x = 2 + ((rnd() * (W - 4)) | 0);
      y = 2 + ((rnd() * 58) | 0);
    } while ((x - MOON_X) * (x - MOON_X) + (y - MOON_Y) * (y - MOON_Y) < 200);
    starX[i] = x; starY[i] = y;
    starPh[i] = rnd() * 6.2832;
    starSp[i] = 0.08 + rnd() * 0.18;
    starBig[i] = i < 4 ? 1 : 0;
  }
}

// ---------------------------------------------------------------------------
// Animation state
// ---------------------------------------------------------------------------
const S_IDLE = 0, S_CHARGE = 1, S_CAST = 2, S_RECOVER = 3;
const DUR = [150, 100, 40, 60];
const EASE_DUR = [1, 70, 8, 48];
const T_ARM = [0, 1, 2, 0];          // 0 = rest, 1 = raised, 2 = thrust
const T_STAFF = [0, 0.12, 1.05, 0];  // radians from vertical, + = forward
const T_TILT = [0, -1, 1, 0];
const FIRE_AT = 5;                   // cast anticipation steps before the burst

let state = S_IDLE, stateT = 0, globalT = 0;
let arm = 0, staff = 0, tilt = 0, fArm = 0, fStaff = 0, fTilt = 0;
let sway = 0, beardS = 0, hatS = 0, glow = 0.35, bob = 0;
let poseClock = 0, animFrame = 0, gemFlick = 0;
let shakeT = 0, shakeX = 0, shakeY = 0, flashT = 0, ringT = -1, ringX = 0, ringY = 0;

// Display (quantized) pose
let dBob = 0, dTilt = 0, dSway = 0, dBeard = 0, dHat = 0, dGlow = 0.35;
let sy0 = FLOOR - 19, dHX = 0, dHY = 0;
let stTopX = 0, stTopY = 0, stBotX = 0, stBotY = 0, gemX = 0, gemY = 0;
let dSin = 0, dCos = 1;

// Projectile
let prActive = false, prX = 0, prY = 0, prT = 0;

// Particles (struct of arrays, pooled)
const PMAX = 384;
const pX = new Float32Array(PMAX), pY = new Float32Array(PMAX);
const pVX = new Float32Array(PMAX), pVY = new Float32Array(PMAX);
const pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX);
const pAng = new Float32Array(PMAX), pRad = new Float32Array(PMAX);
const pAV = new Float32Array(PMAX), pRV = new Float32Array(PMAX);
const pMode = new Uint8Array(PMAX); // 0 free, 1 orbit, 2 burst, 3 trail, 4 mote
let pCursor = 0;

function spawn() {
  for (let n = 0; n < PMAX; n++) {
    const j = (pCursor + n) % PMAX;
    if (pMode[j] === 0) { pCursor = (j + 1) % PMAX; return j; }
  }
  const j = pCursor; pCursor = (pCursor + 1) % PMAX; return j;
}

function easeInOut(k) { return k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k); }
function easeOutBack(k) { const c = 1.9, t = k - 1; return 1 + (c + 1) * t * t * t + c * t * t; }

function enter(s) {
  state = s; stateT = 0;
  fArm = arm; fStaff = staff; fTilt = tilt;
  poseClock = 0;
}

// Freeze the smooth pose into pixel-grid values (runs at 12 fps)
function snapshot() {
  animFrame++;
  dBob = bob;
  dTilt = Math.round(tilt);
  dSway = sway; dBeard = beardS; dHat = hatS; dGlow = glow;
  sy0 = FLOOR - 19 + dBob;
  let hx, hy;
  if (arm <= 1) { hx = 8 + (9 - 8) * arm; hy = 6 + (-7 - 6) * arm; }
  else { const t = arm - 1; hx = 9 + (12 - 9) * t; hy = -7 + (-2 + 7) * t; }
  dHX = OX + Math.round(hx); dHY = sy0 + Math.round(hy);
  dSin = Math.sin(staff); dCos = Math.cos(staff);
  stTopX = Math.round(dHX + dSin * 14); stTopY = Math.round(dHY - dCos * 14);
  stBotX = Math.round(dHX - dSin * 13); stBotY = Math.round(dHY + dCos * 13);
  gemX = Math.round(dHX + dSin * 17); gemY = Math.round(dHY - dCos * 17);
}

function fire() {
  glow = dGlow = 1.45;
  shakeT = 14; flashT = 6;
  ringT = 0; ringX = gemX; ringY = gemY;
  for (let n = 0; n < 60; n++) {
    const i = spawn();
    const a = rnd() * 6.2832, s = 0.5 + rnd() * 2.3;
    pMode[i] = 2;
    pX[i] = gemX; pY[i] = gemY;
    pVX[i] = Math.cos(a) * s + 0.7; pVY[i] = Math.sin(a) * s * 0.85 - 0.3;
    pLife[i] = pMax[i] = 22 + rnd() * 30;
  }
  prActive = true; prX = gemX + 2; prY = gemY; prT = 0;
}

function step() {
  globalT++; stateT++; poseClock++;
  if (stateT >= DUR[state]) enter((state + 1) & 3);

  // Ease pose parameters toward the current state's keyframe
  const k = Math.min(1, stateT / EASE_DUR[state]);
  const e = state === S_CAST ? easeOutBack(k) : easeInOut(k);
  arm = fArm + (T_ARM[state] - fArm) * e;
  staff = fStaff + (T_STAFF[state] - fStaff) * e;
  tilt = fTilt + (T_TILT[state] - fTilt) * e;

  const sk = state === S_CHARGE ? stateT / DUR[S_CHARGE] : 0;
  if (state === S_CHARGE) staff += Math.sin(globalT * 0.9) * 0.05 * sk; // tremble with power

  let swayT, beardT, hatT, glowT;
  if (state === S_IDLE) {
    bob = ((globalT / 30) | 0) & 1;
    swayT = Math.sin(globalT * 0.052); beardT = Math.sin(globalT * 0.07 + 1) * 0.9;
    hatT = Math.sin(globalT * 0.045 + 2) * 0.8; glowT = 0.35 + 0.08 * Math.sin(globalT * 0.1);
  } else if (state === S_CHARGE) {
    bob = 0;
    swayT = Math.sin(globalT * 0.35) * 1.3 * sk; beardT = Math.sin(globalT * 0.45) * 1.2 * sk;
    hatT = Math.sin(globalT * 0.4 + 1) * 1.5 * sk; glowT = 0.35 + 0.8 * sk;
  } else if (state === S_CAST) {
    bob = stateT >= FIRE_AT && stateT < FIRE_AT + 18 ? 1 : 0;
    swayT = stateT >= FIRE_AT ? -2.5 : 1; beardT = stateT >= FIRE_AT ? -2 : 0;
    hatT = stateT >= FIRE_AT ? -2.5 : 0; glowT = 0.8;
  } else {
    bob = 0; swayT = 0; beardT = 0; hatT = 0; glowT = 0.35;
  }
  sway += (swayT - sway) * 0.12;
  beardS += (beardT - beardS) * 0.1;
  hatS += (hatT - hatS) * 0.08;
  glow += (glowT - glow) * 0.08;

  if (poseClock >= POSE_EVERY || stateT === 0) { poseClock = 0; snapshot(); }
  if ((globalT % 3) === 0) gemFlick = rnd();

  // Events
  if (state === S_CAST && stateT === FIRE_AT) fire();
  if (state === S_CHARGE && stateT < DUR[S_CHARGE] - 12) {
    const count = (stateT & 1) + (stateT > 50 ? 1 : 0);
    for (let n = 0; n < count; n++) {
      const i = spawn();
      pMode[i] = 1;
      pAng[i] = rnd() * 6.2832; pRad[i] = 8 + rnd() * 11;
      pAV[i] = 0.09 + rnd() * 0.07; pRV[i] = 0.16 + rnd() * 0.14;
      pLife[i] = pMax[i] = pRad[i] / pRV[i];
    }
  }
  if ((state === S_IDLE || state === S_RECOVER) && (globalT % 16) === 0) {
    const i = spawn();
    pMode[i] = 4;
    pX[i] = gemX + (rnd() - 0.5) * 4; pY[i] = gemY - 1;
    pVX[i] = (rnd() - 0.5) * 0.08; pVY[i] = -0.1 - rnd() * 0.1;
    pLife[i] = pMax[i] = 40 + rnd() * 30;
  }

  // Particles
  for (let i = 0; i < PMAX; i++) {
    const m = pMode[i];
    if (m === 0) continue;
    pLife[i] -= 1;
    if (m === 1) {
      pAng[i] += pAV[i]; pRad[i] -= pRV[i];
      pX[i] = gemX + Math.cos(pAng[i]) * pRad[i];
      pY[i] = gemY + Math.sin(pAng[i]) * pRad[i] * 0.7;
      if (pRad[i] <= 0.5) pMode[i] = 0;
    } else if (m === 2) {
      pX[i] += pVX[i]; pY[i] += pVY[i];
      pVX[i] *= 0.93; pVY[i] = pVY[i] * 0.93 + 0.03;
    } else if (m === 3) {
      pX[i] += pVX[i]; pY[i] += pVY[i];
      pVX[i] *= 0.9; pVY[i] *= 0.9;
    } else {
      pX[i] += pVX[i] + Math.sin((pLife[i] + i) * 0.12) * 0.06; pY[i] += pVY[i];
    }
    if (pLife[i] <= 0 || pY[i] >= FLOOR) pMode[i] = 0;
  }

  // Projectile
  if (prActive) {
    prX += 2.4; prT++;
    for (let n = 0; n < 2; n++) {
      const i = spawn();
      pMode[i] = 3;
      pX[i] = prX - 1; pY[i] = prY + (rnd() - 0.5) * 2;
      pVX[i] = -0.3 - rnd() * 0.5; pVY[i] = (rnd() - 0.5) * 0.7;
      pLife[i] = pMax[i] = 12 + rnd() * 12;
    }
    if (prX > W + 10) prActive = false;
  }

  // Screen shake, flash, ring
  if (shakeT > 0) {
    shakeT--;
    const amp = shakeT > 7 ? 2 : 1;
    shakeX = shakeT > 0 ? ((shakeT & 2) ? amp : -amp) : 0;
    shakeY = shakeT > 6 ? ((shakeT & 4) ? 1 : -1) : 0;
  } else { shakeX = 0; shakeY = 0; }
  if (flashT > 0) flashT--;
  if (ringT >= 0) { ringT++; if (ringT > 12) ringT = -1; }
}

// ---------------------------------------------------------------------------
// Wizard (drawn procedurally into the sprite layer)
// ---------------------------------------------------------------------------
const HAT_W = [8, 7, 7, 6, 5, 4, 4, 3, 2, 1];

function drawWizard() {
  spr.fill(EMPTY);
  const cx = OX + dTilt;

  // Robe: trapezoid scanlines, hem sways, two shades + light fold
  const rows = FLOOR - sy0;
  for (let r = 0; r < rows; r++) {
    const y = sy0 + r, t = r / (rows - 1);
    const hw = r === 0 ? 3 : r === 1 ? 4 : 4 + ((r * 3.6 / rows) | 0);
    const sh = Math.round(dSway * t * t * 1.6);
    const xl = OX - hw + sh, xr = OX + hw + sh + (r > 2 ? 1 : 0);
    const span = xr - xl, foldX = xl + Math.round(span * 0.55);
    for (let x = xl; x <= xr; x++) {
      const u = (x - xl) / span;
      let c = u < 0.3 ? ROBE_D : ROBE_M;
      if (r > 8 && u > 0.8) c = ROBE_L;
      if (r > 9 && x === foldX) c = ROBE_D;
      if (r > 12 && x === xl + 2) c = ROBE_D;
      if (r === 7) c = x === xl ? WOOD : GOLD;
      if (r === rows - 2) c = GOLD;
      if (r === rows - 1) c = ROBE_D;
      sp(x, y, c);
    }
  }
  // Belt tassel
  sp(OX + 4, sy0 + 8, GOLD); sp(OX + 4, sy0 + 9, GOLD); sp(OX + 5, sy0 + 10, GOLD);
  // Curled shoe
  sp(OX + 7, FLOOR - 1, WOOD_D); sp(OX + 8, FLOOR - 1, WOOD_D); sp(OX + 9, FLOOR - 1, WOOD_D);
  sp(OX + 10, FLOOR - 2, WOOD_D);

  // Head
  for (let y = sy0 - 5; y <= sy0 - 1; y++) { sp(cx - 2, y, BEARD_SH); sp(cx - 1, y, BEARD); }
  for (let y = sy0 - 5; y <= sy0 - 2; y++) for (let x = cx; x <= cx + 3; x++) sp(x, y, SKIN);
  sp(cx, sy0 - 5, SKIN_SH); sp(cx + 1, sy0 - 5, SKIN_SH);
  sp(cx, sy0 - 3, SKIN_SH);                                    // ear
  sp(cx + 2, sy0 - 5, BEARD); sp(cx + 3, sy0 - 5, BEARD);      // brow
  sp(cx + 2, sy0 - 4, INK);                                    // eye
  sp(cx + 4, sy0 - 4, SKIN); sp(cx + 4, sy0 - 3, SKIN); sp(cx + 5, sy0 - 3, SKIN_SH); // nose

  // Hat: brim, band, cone that bends back, floppy tip
  const by = sy0 - 6;
  for (let x = cx - 4; x <= cx + 6; x++) sp(x, by, x <= cx - 2 ? ROBE_D : ROBE_M);
  sp(cx - 5, by + 1, ROBE_D);
  for (let x = cx - 3; x <= cx + 4; x++) sp(x, by - 1, x === cx - 3 ? WOOD : GOLD);
  let tipL = cx, tipY = by;
  for (let j = 0; j < HAT_W.length; j++) {
    const y = by - 2 - j, w = HAT_W[j], q = j / (HAT_W.length - 1);
    const bend = Math.round(-j * j / 27 + dHat * q * q * 1.5);
    const L = cx - 3 + ((8 - w) >> 1) + bend, R = L + w - 1;
    const dark = L + ((w * 0.4) | 0);
    for (let x = L; x <= R; x++) {
      let c = x < dark ? ROBE_D : ROBE_M;
      if (x === R && w > 2) c = ROBE_L;
      sp(x, y, c);
    }
    if (j === 3) sp(L + (w >> 1), y, GOLD);
    tipL = L; tipY = y;
  }
  const flop = dHat < -1 ? 0 : 1;
  sp(tipL - 1, tipY, ROBE_M);
  sp(tipL - 2, tipY + flop, ROBE_D);
  sp(tipL - 3, tipY + 1 + flop, ROBE_D);

  // Staff with a claw cradle for the gem
  sprLine(stBotX, stBotY, stTopX, stTopY, 0);
  for (let s = -1; s <= 1; s += 2) {
    sp(Math.round(dHX + dSin * 15 + dCos * 2 * s), Math.round(dHY - dCos * 15 + dSin * 2 * s), WOOD_D);
    sp(Math.round(dHX + dSin * 16 + dCos * 2 * s), Math.round(dHY - dCos * 16 + dSin * 2 * s), WOOD);
  }

  // Sleeve from shoulder to wrist
  const shX = OX + 2, shY = sy0 + 1;
  const ux = shX - dHX, uy = shY - dHY, len = Math.sqrt(ux * ux + uy * uy) || 1;
  const wx = Math.round(dHX + ux / len * 2), wy = Math.round(dHY + uy / len * 2);
  sprLine(shX, shY, wx, wy, 1);
  sp(wx, wy, ROBE_L); sp(wx + 1, wy, ROBE_L);

  // Beard over chest, sways at the tip
  for (let k = 0; k < 12; k++) {
    const y = sy0 - 2 + k, q = k / 11;
    const o = Math.round(dBeard * q * q * 2) - Math.round(dTilt * q);
    let L = cx - 1 + ((k * 0.35) | 0) + o, R = cx + 4 - ((k * 0.2) | 0) + o;
    if (k === 0) { L = cx + 1; R = cx + 5; }
    for (let x = L; x <= R; x++) {
      let c = x === L ? BEARD_SH : BEARD;
      if (k > 2 && x === L + 2 && (k & 1)) c = BEARD_SH;
      if (k === 0 && x === R) c = BEARD_SH;
      sp(x, y, c);
    }
  }

  // Hand gripping the staff
  sp(dHX - 1, dHY, SKIN); sp(dHX, dHY, SKIN);
  sp(dHX - 1, dHY + 1, SKIN_SH); sp(dHX, dHY + 1, SKIN);
}

// Composite sprite onto the frame: auto outline + 1px rim light facing the gem
function composeSprite() {
  const gx = gemX, gy = gemY;
  const R = 6 + dGlow * 20, R2 = R * R;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x, c = spr[i];
      if (c === EMPTY) {
        if ((x > 0 && spr[i - 1] !== EMPTY) || (x < W - 1 && spr[i + 1] !== EMPTY) ||
            (y > 0 && spr[i - W] !== EMPTY) || (y < H - 1 && spr[i + W] !== EMPTY)) fb[i] = INK;
        continue;
      }
      let o = c;
      const dx = gx - x, dy = gy - y, d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
        let lit = false;
        if (adx > 0 && adx * 2 >= ady) {
          const nx = x + (dx > 0 ? 1 : -1);
          if (nx < 0 || nx >= W || spr[i + (dx > 0 ? 1 : -1)] === EMPTY) lit = true;
        }
        if (!lit && ady > 0 && ady * 2 >= adx) {
          const ny = y + (dy > 0 ? 1 : -1);
          if (ny < 0 || ny >= H || spr[i + (dy > 0 ? W : -W)] === EMPTY) lit = true;
        }
        if (lit && (c !== WOOD && c !== WOOD_D || d2 < 30)) {
          const lv = dGlow * (1 - Math.sqrt(d2) / R);
          if (lv > 0.55) o = MAGIC_P; else if (lv > 0.28) o = MAGIC_C; else if (lv > 0.07) o = MAGIC_B;
        }
      }
      fb[i] = o;
    }
  }
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------
function drawStars() {
  for (let i = 0; i < NSTAR; i++) {
    const b = Math.sin(animFrame * starSp[i] + starPh[i]);
    const x = starX[i], y = starY[i];
    if (b > 0.55) {
      px(x, y, WHITE);
      if (starBig[i] && b > 0.8) { px(x - 1, y, SKY4); px(x + 1, y, SKY4); px(x, y - 1, SKY4); px(x, y + 1, SKY4); }
    } else if (b > -0.15) px(x, y, BEARD_SH);
    else if (b > -0.6) px(x, y, SKY4);
  }
}

function drawFloorLight() {
  const R = 10 + dGlow * 16;
  const x0 = Math.max(0, Math.floor(gemX - R)), x1 = Math.min(W - 1, Math.ceil(gemX + R));
  for (let y = FLOOR; y < FLOOR + 8; y++) {
    const fy = 1 - (y - FLOOR) / 8;
    for (let x = x0; x <= x1; x++) {
      const dx = x - gemX < 0 ? gemX - x : x - gemX;
      const lv = dGlow * 0.85 * (1 - dx / R) * fy;
      if (lv > BAYER[(y & 3) * 4 + (x & 3)]) { const i = y * W + x; fb[i] = LIT[fb[i]]; }
    }
  }
  // Contact shadow under the wizard
  for (let x = OX - 8; x <= OX + 10; x++) px(x, FLOOR, STONE_D);
  for (let x = OX - 6; x <= OX + 8; x++) if ((x & 1) === 0) px(x, FLOOR + 1, STONE_D);
}

function drawHalo() {
  const R = 3 + dGlow * 3.5, Ri = Math.ceil(R);
  for (let dy = -Ri; dy <= Ri; dy++) {
    for (let dx = -Ri; dx <= Ri; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) continue;
      const x = gemX + dx, y = gemY + dy;
      if (x < 0 || x >= W || y < 0 || y >= FLOOR) continue;
      const lv = dGlow * (1 - d / R) * 0.9;
      if (lv > BAYER[(y & 3) * 4 + (x & 3)]) fb[y * W + x] = lv > 0.5 ? MAGIC_B : MAGIC_V;
    }
  }
}

function drawParticles(behind) {
  for (let i = 0; i < PMAX; i++) {
    const m = pMode[i];
    if (m === 0) continue;
    if (m === 1) { if ((Math.sin(pAng[i]) < 0) !== behind) continue; }
    else if (behind) continue;
    let ci = ((1 - pLife[i] / pMax[i]) * RAMPN) | 0;
    if (ci < 0) ci = 0; else if (ci >= RAMPN) ci = RAMPN - 1;
    const x = Math.round(pX[i]), y = Math.round(pY[i]);
    px(x, y, RAMP[ci]);
    if (m === 2 && ci < 3) px(Math.round(pX[i] - pVX[i]), Math.round(pY[i] - pVY[i]), RAMP[ci + 1]);
  }
}

function drawGem() {
  const x = gemX, y = gemY;
  let core, hi, lo;
  if (state === S_CAST && stateT >= FIRE_AT && stateT < FIRE_AT + 10) { core = WHITE; hi = WHITE; lo = MAGIC_P; }
  else if (state === S_CHARGE) {
    core = gemFlick < 0.5 ? WHITE : MAGIC_P;
    hi = gemFlick < 0.3 ? MAGIC_P : MAGIC_C;
    lo = gemFlick < 0.7 ? MAGIC_B : MAGIC_V;
  } else { core = (animFrame & 7) < 6 ? MAGIC_P : WHITE; hi = MAGIC_C; lo = MAGIC_B; }

  px(x, y - 2, INK); px(x, y + 2, INK); px(x - 2, y, INK); px(x + 2, y, INK);
  px(x - 1, y - 1, INK); px(x + 1, y - 1, INK); px(x - 1, y + 1, INK); px(x + 1, y + 1, INK);
  px(x, y, core); px(x, y - 1, hi); px(x + 1, y, hi); px(x - 1, y, lo); px(x, y + 1, lo);

  // Gleam spikes when charged
  const charged = (state === S_CHARGE && stateT > 55) || (state === S_CAST && stateT < FIRE_AT + 8);
  if (charged) {
    if (animFrame & 1) {
      px(x, y - 3, MAGIC_P); px(x, y - 4, MAGIC_C); px(x, y + 3, MAGIC_P); px(x, y + 4, MAGIC_C);
      px(x - 3, y, MAGIC_P); px(x - 4, y, MAGIC_C); px(x + 3, y, MAGIC_P); px(x + 4, y, MAGIC_C);
    } else {
      px(x - 2, y - 2, MAGIC_C); px(x + 2, y - 2, MAGIC_C); px(x - 2, y + 2, MAGIC_C); px(x + 2, y + 2, MAGIC_C);
    }
  }
}

function drawRing() {
  if (ringT < 0) return;
  const r = 2 + ringT * 1.4;
  const c = ringT < 3 ? WHITE : ringT < 6 ? MAGIC_P : ringT < 9 ? MAGIC_C : MAGIC_B;
  const n = 48;
  for (let i = 0; i < n; i++) {
    if (ringT > 7 && ((i + ringT) & 1)) continue;
    const a = i * 6.2832 / n;
    px(ringX + Math.round(Math.cos(a) * r), ringY + Math.round(Math.sin(a) * r), c);
  }
}

function drawProjectile() {
  if (!prActive) return;
  const x = Math.round(prX), y = prY + (((prT >> 2) & 1) ? 1 : 0);
  px(x - 6, y, MAGIC_V); px(x - 5, y, MAGIC_B); px(x - 4, y, MAGIC_B); px(x - 3, y, MAGIC_C);
  px(x - 2, y, MAGIC_C); px(x - 2, y - 1, MAGIC_B); px(x - 2, y + 1, MAGIC_B);
  px(x - 1, y - 1, MAGIC_C); px(x - 1, y + 1, MAGIC_C); px(x, y - 1, MAGIC_P); px(x, y + 1, MAGIC_P);
  px(x + 1, y, MAGIC_C); px(x + 2, y, MAGIC_B);
  px(x - 1, y, WHITE); px(x, y, WHITE);
  if ((prT >> 1) & 1) { px(x, y - 2, MAGIC_C); px(x, y + 2, MAGIC_C); }
}

function render() {
  fb.set(bg);
  drawStars();
  drawFloorLight();
  drawHalo();
  drawParticles(true);
  drawWizard();
  composeSprite();
  drawGem();
  drawRing();
  drawParticles(false);
  drawProjectile();

  // Palette -> RGBA with shake offset (edge clamped) and flash remap
  const rm = flashT > 3 ? RM2 : flashT > 0 ? RM1 : RM0;
  for (let y = 0; y < H; y++) {
    let sy = y - shakeY; if (sy < 0) sy = 0; else if (sy >= H) sy = H - 1;
    const src = sy * W, dst = y * W;
    for (let x = 0; x < W; x++) {
      let sx = x - shakeX; if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1;
      out32[dst + x] = PAL32[rm[fb[src + sx]]];
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.drawImage(off, 0, 0, W, H, viewX, viewY, W * scale, H * scale);
}

// ---------------------------------------------------------------------------
// Display + loop
// ---------------------------------------------------------------------------
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
let scale = 1, viewX = 0, viewY = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.floor(window.innerWidth * dpr));
  const ch = Math.max(1, Math.floor(window.innerHeight * dpr));
  canvas.width = cw; canvas.height = ch;
  scale = Math.max(1, Math.floor(Math.min(cw / W, ch / H)));
  viewX = (cw - W * scale) >> 1; viewY = (ch - H * scale) >> 1;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, cw, ch);
}

buildBackground();
snapshot();
resize();
window.addEventListener('resize', resize);

// Optional ?t=<steps>: fast-forward the simulation and freeze on that frame
const freezeAt = parseInt(new URLSearchParams(location.search).get('t'), 10);
if (freezeAt >= 0) {
  for (let i = 0; i < freezeAt; i++) step();
  render();
  return;
}

let acc = 0, last = performance.now();
function frame(now) {
  let dt = now - last; last = now;
  if (dt > 250) dt = 250;
  acc += dt;
  let n = 0;
  while (acc >= STEP_MS && n < 8) { step(); acc -= STEP_MS; n++; }
  if (n === 8) acc = 0;
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
