(() => {
'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const H = 180;             // logical screen height (fixed)
const MINW = 240, MAXW = 480;
let W = 320;               // logical screen width (follows the window aspect)
const FLOOR = 150;         // first row of the stone floor
const GH = H - FLOOR;      // ground strip height
const WORLD_W = 1600;      // scrolling world width
const OX = 96;             // hero anchor x in sprite-local space
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
  '#8e5aa8', // 26 bat
  '#5e3470', // 27 bat dark
  '#ff4a5a', // 28 red
  '#5fcf4a', // 29 slime
  '#2f8a3a', // 30 slime dark
  '#b6f07a', // 31 slime light
  '#b3122a', // 32 blood
  '#5c0a1a', // 33 blood dark
  '#d9dfeb', // 34 steel light
  '#8e97ad', // 35 steel mid
  '#4a5068', // 36 steel dark
  '#1f3d2c', // 37 forest dark
  '#3c6e42', // 38 forest mid
  '#6fa65a', // 39 forest light
  '#1f2f6b', // 40 tabard dark
  '#3657b0', // 41 tabard mid
];
const SKY0 = 0, SKY1 = 1, SKY2 = 2, SKY3 = 3, SKY4 = 4, MOON = 5, MOON_SH = 6,
      WHITE = 7, INK = 8, ROBE_D = 9, ROBE_M = 10, ROBE_L = 11, SKIN = 12,
      SKIN_SH = 13, BEARD = 14, BEARD_SH = 15, WOOD = 16, WOOD_D = 17,
      STONE_D = 18, STONE_M = 19, STONE_L = 20, MAGIC_P = 21, MAGIC_C = 22,
      MAGIC_B = 23, MAGIC_V = 24, GOLD = 25, BAT = 26, BAT_D = 27, RED = 28,
      SLIME = 29, SLIME_D = 30, SLIME_L = 31, BLOOD = 32, BLOOD_D = 33,
      STEEL_L = 34, STEEL_M = 35, STEEL_D = 36, FOREST_D = 37, FOREST_M = 38, FOREST_L = 39,
      BLUE_D = 40, BLUE_M = 41;
const EMPTY = 255;

// Particle color ramps: magic (white -> cyan -> violet -> dark) and gold (steel sparks)
const RAMP = new Uint8Array([WHITE, MAGIC_P, MAGIC_C, MAGIC_C, MAGIC_B, MAGIC_V, SKY4, SKY3]);
const RAMP_GOLD = new Uint8Array([WHITE, GOLD, GOLD, ROBE_L, WOOD, WOOD_D, SKY3, SKY2]);
const RAMPN = RAMP.length;
// Bolt trail, nearest to farthest
const TRAIL = new Uint8Array([MAGIC_P, MAGIC_C, MAGIC_C, MAGIC_B, MAGIC_B, MAGIC_V]);
const TRAILN = TRAIL.length;

// 4x4 ordered dither thresholds in (0,1)
const BAYER = new Float32Array(16);
{
  const b = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let i = 0; i < 16; i++) BAYER[i] = (b[i] + 0.5) / 16;
}

// ---------------------------------------------------------------------------
// Heroes
// ---------------------------------------------------------------------------
const WIZARD = 0, KNIGHT = 1, ARCHER = 2;
const HEROES = [
  { name: 'WIZARD', desc: 'MAGIC BOLTS', hp: 3, spd: 1.0, jump: 3.1, rest: 0, ready: 1.1,
    full: 60, med: 22, castDur: 22, fireAt: 5 },
  { name: 'KNIGHT', desc: 'SWORD + BEAM', hp: 5, spd: 0.8, jump: 2.8, rest: 2.5, ready: 0.35,
    full: 45, med: 18, castDur: 16, fireAt: 3 },
  { name: 'ARCHER', desc: 'BOW + ARROWS', hp: 3, spd: 1.15, jump: 3.35, rest: 1.5708, ready: 1.3,
    full: 50, med: 18, castDur: 14, fireAt: 1 },
];
let hero = WIZARD, HD = HEROES[WIZARD], sel = WIZARD;

// ---------------------------------------------------------------------------
// Buffers (all preallocated at the maximum screen width)
// ---------------------------------------------------------------------------
const fb = new Uint8Array(MAXW * H);           // palette-indexed frame
const skyBg = new Uint8Array(MAXW * H);        // static sky + moon (screen space)
const spr = new Uint8Array(MAXW * H);          // hero sprite layer (local, facing right)
const tmp = new Uint8Array(MAXW * H);          // outlined hero, for rotated drawing
const ground = new Uint8Array(WORLD_W * GH);   // floor strip (world space)
const decal = new Uint8Array(WORLD_W * H);     // blood / goo stains (palette + 1)
const FAR = new Int16Array(2048), NEAR = new Int16Array(2048); // parallax skylines
const NWIN = 8;
const winU = new Int16Array(NWIN), winY = new Int16Array(NWIN);
let nWin = 0;

const off = document.createElement('canvas');
const octx = off.getContext('2d');
let img = null, out32 = null;

const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const PAL32 = new Uint32Array(PALETTE.length);
for (let i = 0; i < PALETTE.length; i++) {
  const v = parseInt(PALETTE[i].slice(1), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  PAL32[i] = littleEndian
    ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

// Palette remaps: cast flash (sky/stone lift) and hurt flash (sky goes red)
const RM0 = new Uint8Array(64), RM1 = new Uint8Array(64), RM2 = new Uint8Array(64), RMH = new Uint8Array(64);
for (let i = 0; i < 64; i++) { RM0[i] = RM1[i] = RM2[i] = RMH[i] = i; }
for (let i = SKY0; i <= SKY4; i++) { RM1[i] = Math.min(SKY4, i + 1); RM2[i] = Math.min(SKY4, i + 2); }
RM1[STONE_D] = RM2[STONE_D] = STONE_M;
RM1[STONE_M] = RM2[STONE_M] = STONE_L;
RM2[STONE_L] = BEARD_SH;
RMH[SKY0] = RMH[SKY1] = RMH[SKY2] = ROBE_D; RMH[SKY3] = RMH[SKY4] = ROBE_M;

// Floor tint under magic light
const LIT = new Uint8Array(64);
for (let i = 0; i < 64; i++) LIT[i] = i;
LIT[SKY0] = STONE_D; LIT[STONE_D] = STONE_M; LIT[STONE_M] = STONE_L; LIT[STONE_L] = BEARD_SH;

// Deterministic PRNG (xorshift32)
let seed = 0x2f6b1d93;
function rnd() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 4294967296;
}
function hash(i) { // stable per-index noise for screen-space decoration
  let h = (i * 374761393 + 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Level layout (world space), generated once
// ---------------------------------------------------------------------------
const PMAXP = 64;
const PLX = new Int16Array(PMAXP), PLY = new Int16Array(PMAXP), PLW = new Int16Array(PMAXP);
let NPLAT = 0;
const TIERS = [FLOOR - 22, FLOOR - 44, FLOOR - 66, FLOOR - 88];
const CMAXC = 16;
const COLX = new Int16Array(CMAXC), COLH = new Int16Array(CMAXC);
let NCOL = 0;
const WALL_W = 8, COL_W = 11;

function buildLevel() {
  let x = 70, tier = 0;
  NPLAT = 0;
  while (x < WORLD_W - 90 && NPLAT < PMAXP) {
    const w = 32 + ((rnd() * 28) | 0);
    PLX[NPLAT] = x; PLY[NPLAT] = TIERS[tier]; PLW[NPLAT] = w; NPLAT++;
    let nt = tier + (rnd() < 0.55 ? 1 : -1);
    if (nt < 0) nt = 0; else if (nt > 3) nt = 2;
    let gap = nt > tier ? 8 + ((rnd() * 14) | 0) : 14 + ((rnd() * 30) | 0);
    if (nt === 0 && tier === 0) gap += 40;
    x += w + gap; tier = nt;
  }
  NCOL = 0;
  for (let cx = 40; cx < WORLD_W - 60 && NCOL < CMAXC; cx += 140 + ((rnd() * 90) | 0)) {
    COLX[NCOL] = cx; COLH[NCOL] = 24 + ((rnd() * 46) | 0); NCOL++;
  }
}

// ---------------------------------------------------------------------------
// Pixel primitives (integer coords only). px = screen space, wpx = world space
// ---------------------------------------------------------------------------
let camX = 0, camI = 0;
function px(x, y, c) {
  if (x >= 0 && x < W && y >= 0 && y < H) fb[y * W + x] = c;
}
function wpx(x, y, c) { px(x - camI, y, c); }
function rect(x, y, w, h, c) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(i, j, c);
}
function sp(x, y, c) {
  if (x >= 0 && x < W && y >= 0 && y < H) spr[y * W + x] = c;
}
function stain(x, y, c) {
  if (x >= 0 && x < WORLD_W && y >= 0 && y < H) decal[y * WORLD_W + x] = c + 1;
}

// Bresenham into the sprite layer.
// mode 0: 1px line (c1, every 5th pixel c2), clipped above the floor
// mode 1: 2x2 stamp (top c1, bottom c2) for sleeves
// mode 3: 2px wide (left c1, right c2) for legs
function sprLine(x0, y0, x1, y1, mode, c1, c2) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    if (mode === 0) {
      if (y0 < FLOOR) sp(x0, y0, (n % 5 === 4) ? c2 : c1);
    } else if (mode === 1) {
      sp(x0, y0, c1); sp(x0 + 1, y0, c1);
      sp(x0, y0 + 1, c2); sp(x0 + 1, y0 + 1, c2);
    } else {
      sp(x0, y0, c1); sp(x0 + 1, y0, c2);
    }
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// Bresenham straight into the frame (screen space)
function fbLine(x0, y0, x1, y1, c, c2) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  for (;;) {
    px(x0, y0, (n % 5 === 4) ? c2 : c);
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------------------------------------------------------------------------
// 3x5 pixel font
// ---------------------------------------------------------------------------
const FONT = new Uint16Array(128);
{
  const g = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101101111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
    8: '111101111101111', 9: '111101111001110',
    '-': '000000111000000', '/': '001001010100100', '!': '010010010000010',
    ':': '000010000010000', '+': '000010111010000', '.': '000000000000010',
  };
  for (const k in g) FONT[k.charCodeAt(0)] = parseInt(g[k], 2);
}

function drawGlyph(code, x, y, c, s) {
  const g = FONT[code & 127];
  if (!g) return;
  for (let pass = 0; pass < 2; pass++) {
    const col = pass === 0 ? INK : c, o = pass === 0 ? 1 : 0;
    for (let r = 0; r < 5; r++) {
      for (let q = 0; q < 3; q++) {
        if (g & (1 << (14 - r * 3 - q))) rect(x + q * s + o, y + r * s + o, s, s, col);
      }
    }
  }
}
function textW(str, s) { return (str.length * 4 - 1) * s; }
function drawText(str, x, y, c, s) {
  for (let i = 0; i < str.length; i++) drawGlyph(str.charCodeAt(i), x + i * 4 * s, y, c, s);
}
function drawTextC(str, y, c, s) { drawText(str, (W - textW(str, s)) >> 1, y, c, s); }
function drawTextAt(str, cx, y, c) { drawText(str, cx - (textW(str, 1) >> 1), y, c, 1); }
const numBuf = new Uint8Array(12);
function numDigits(n) { let len = 0; do { len++; n = (n / 10) | 0; } while (n > 0); return len; }
function drawNumber(n, x, y, c, digits) {
  let len = 0;
  do { numBuf[len++] = n % 10; n = (n / 10) | 0; } while (n > 0 && len < 12);
  while (len < digits) numBuf[len++] = 0;
  for (let i = 0; i < len; i++) drawGlyph(48 + numBuf[len - 1 - i], x + i * 4, y, c, 1);
  return len * 4;
}

// ---------------------------------------------------------------------------
// Sprites (palette index + 1, 0 = transparent)
// ---------------------------------------------------------------------------
const SPR_MAP = {
  '.': 0, B: BAT + 1, b: BAT_D + 1, R: RED + 1, G: SLIME + 1, g: SLIME_D + 1, L: SLIME_L + 1,
  K: INK + 1, D: ROBE_D + 1, M: ROBE_M + 1, l: ROBE_L + 1, Y: GOLD + 1, P: MAGIC_P + 1,
  S: STEEL_D + 1, T: STEEL_M + 1, U: STEEL_L + 1, F: FOREST_D + 1, f: FOREST_M + 1, h: FOREST_L + 1,
};
function makeSprite(rows) {
  const h = rows.length, w = rows[0].length, d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = SPR_MAP[rows[y][x]];
  return d;
}
function rotateCW(d, w, h) { // result is h wide, w tall
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + (h - 1 - y)] = d[y * w + x];
  return o;
}
const SW = 9;
const BAT_F = [
  makeSprite(['b.......b', 'Bb.B.B.bB', '.BBBBBBB.', '..BRBRB..', '...bBb...', '.........']),
  makeSprite(['.........', '...B.B...', '..BBBBB..', '.bBRBRBb.', 'bB.bBb.Bb', 'b.......b']),
];
const BAT_H = 6;
const SLIME_F = [
  makeSprite(['...GGG...', '..GLLGG..', '.GLGGGGG.', '.GGGKGGK.', 'GGGGGGGGG', 'GGGGGGGGg', '.ggggggg.']),
  makeSprite(['.........', '.........', '..GGGGG..', '.GLLGGGG.', 'GGGGKGGKG', 'GGGGGGGGG', 'ggggggggg']),
];
const SLIME_DIE = [
  makeSprite(['.........', '.........', '.........', '..GGGGG..', '.GLGGGGG.', 'GGGGKGGKG', 'ggggggggg']),
  makeSprite(['.........', '.........', '.........', '.........', '...GGGG..', '.GGGgGGGg', 'ggggggggg']),
  makeSprite(['.........', '.........', '.........', '.........', '.........', '..g.GG.g.', '.ggggggg.']),
];
const SLIME_H = 7;
const HEART = makeSprite(['.R.R.', 'RRRRR', '.RRR.', '..R..']);
// Headgear props, knocked off at 1 heart (already battered by then)
const HG_W = [11, 9, 11], HG_H = [12, 8, 7];
const HG_UP = [
  makeSprite(['...........', '...........', '..D.M......', '..DMM......', '...DMM.....', '...DKMM....',
    '...DDYMM...', '..DDMMMMl..', '..DDMMMMMl.', '..YYYYYYYY.', 'DDDDMMMMMMM', '...........']),
  makeSprite(['..R......', '.RR......', '..SSSSS..', '.STUUTTS.', '.STKKKKS.', '.STUSTTS.', '.STTTTTS.', '..SSSSS..']),
  makeSprite(['...........', '......R....', '.....hR....', '....hhf....', '..hhfKffF..', '.hffffffffF', 'FFFFFFFFFF.']),
];
const HG_SIDE = [rotateCW(HG_UP[0], 11, 12), rotateCW(HG_UP[1], 9, 8), rotateCW(HG_UP[2], 11, 7)];
const GHOST_W = 7, GHOST_H = 10;
const GHOST = makeSprite([
  '....P..', '...PP..', '..PPP..', 'PPPPPPP', '.PPPPP.', '.PKPKP.', '.PPPPP.', '.PPPPP.', '.PPPPP.', '.P.P.P.',
]);

// Draw a sprite at screen coords with a 1px ink outline
function drawSprite(d, w, h, x0, y0, flip, flash, vflip) {
  if (x0 > W || x0 + w < 0) return;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const sy = vflip ? h - 1 - y : y;
      for (let x = 0; x < w; x++) {
        const v = d[sy * w + (flip ? w - 1 - x : x)];
        if (!v) continue;
        const X = x0 + x, Y = y0 + y;
        if (pass === 0) { px(X - 1, Y, INK); px(X + 1, Y, INK); px(X, Y - 1, INK); px(X, Y + 1, INK); }
        else px(X, Y, flash ? WHITE : v - 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Background construction
// ---------------------------------------------------------------------------
const NSTARMAX = 96;
const starX = new Int16Array(NSTARMAX), starY = new Int16Array(NSTARMAX);
const starPh = new Float32Array(NSTARMAX), starSp = new Float32Array(NSTARMAX);
const starBig = new Uint8Array(NSTARMAX);
let NSTAR = 0, MOON_X = 270;
const MOON_Y = 34, MOON_R = 10;

// Sky + moon + stars depend on the screen width, so they rebuild on resize
function buildSky() {
  MOON_X = W - 50;
  for (let y = 0; y < FLOOR; y++) {
    const v = (y / (FLOOR - 1)) * 4;
    const base = v | 0, f = v - base;
    for (let x = 0; x < W; x++) {
      let c = base;
      if (f > 0.55 && ((f - 0.55) / 0.45) > BAYER[(y & 3) * 4 + (x & 3)]) c++;
      skyBg[y * W + x] = Math.min(SKY4, c);
    }
  }
  for (let y = MOON_Y - 20; y <= MOON_Y + 20; y++) {
    for (let x = MOON_X - 20; x <= MOON_X + 20; x++) {
      if (x < 0 || x >= W || y < 0) continue;
      const d = Math.sqrt((x - MOON_X) * (x - MOON_X) + (y - MOON_Y) * (y - MOON_Y));
      const lv = 1 - (d - MOON_R - 1) / 9;
      if (d > MOON_R && lv > 0 && lv * 0.6 > BAYER[(y & 3) * 4 + (x & 3)]) {
        const i = y * W + x;
        skyBg[i] = Math.min(SKY4, skyBg[i] + 1);
      }
    }
  }
  for (let dy = -MOON_R; dy <= MOON_R; dy++) {
    for (let dx = -MOON_R; dx <= MOON_R; dx++) {
      if (dx * dx + dy * dy > MOON_R * MOON_R + MOON_R * 0.6) continue;
      const sh = (dx + 4) * (dx + 4) + (dy + 3) * (dy + 3) > (MOON_R + 1) * (MOON_R + 1);
      skyBg[(MOON_Y + dy) * W + MOON_X + dx] = sh ? MOON_SH : MOON;
    }
  }
  const craters = [-3, 1, -2, 1, -3, 2, 3, -4, 4, 3, 1, 5, -5, -3, 5, -1, 0, -6, -1, -6];
  for (let i = 0; i < craters.length; i += 2) {
    skyBg[(MOON_Y + craters[i + 1]) * W + MOON_X + craters[i]] = MOON_SH;
  }
  NSTAR = Math.min(NSTARMAX, (W / 5) | 0);
  let n = 0;
  for (let i = 0; n < NSTAR && i < 1000; i++) {
    const x = 2 + ((hash(i * 3) * (W - 4)) | 0), y = 2 + ((hash(i * 3 + 1) * 96) | 0);
    if ((x - MOON_X) * (x - MOON_X) + (y - MOON_Y) * (y - MOON_Y) < 400) continue;
    starX[n] = x; starY[n] = y;
    starPh[n] = hash(i * 3 + 2) * 6.2832;
    starSp[n] = 0.08 + hash(i * 7) * 0.18;
    starBig[n] = n < 6 ? 1 : 0;
    n++;
  }
  NSTAR = n;
}

function buildWorld() {
  // Parallax skylines: far mountains and near hills with ruined towers
  for (let u = 0; u < 2048; u++) {
    FAR[u] = Math.round(FLOOR - 44 + 12 * Math.sin(u * 0.013 + 0.5) + 6 * Math.sin(u * 0.037 + 2) + 3 * Math.abs(Math.sin(u * 0.11)));
    NEAR[u] = Math.round(FLOOR - 16 + 5 * Math.sin(u * 0.027 + 1) + 3 * Math.sin(u * 0.071) + 1.5 * Math.sin(u * 0.19));
  }
  const towers = [200, 520, 860, 1150];
  nWin = 0;
  for (let t = 0; t < towers.length; t++) {
    const u0 = towers[t], base = NEAR[u0 + 4], top = base - 30 - (t % 2) * 8;
    for (let u = u0; u < u0 + 9; u++) NEAR[u] = Math.min(NEAR[u], top - ((u - u0) % 2 === 0 ? 3 : 0));
    winU[nWin] = u0 + 4; winY[nWin] = top + 8; nWin++;
    winU[nWin] = u0 + 4; winY[nWin] = top + 19; nWin++;
  }

  // Floor strip: lip + four rows of bricks, widening toward the viewer
  for (let x = 0; x < WORLD_W; x++) { ground[x] = STONE_L; ground[WORLD_W + x] = STONE_M; }
  const rows = [[2, 6, 12, 0], [8, 7, 14, 6], [15, 7, 17, 3], [22, 8, 20, 9]]; // y0, h, brickW, offset
  for (let r = 0; r < rows.length; r++) {
    const y0 = rows[r][0], h = rows[r][1], bw = rows[r][2], o = rows[r][3];
    for (let y = y0; y < y0 + h && y < GH; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const col = (x + o) % bw, row = y - y0;
        let c;
        if (row === 0 || col === 0) c = STONE_D;
        else if (row === 1 || col === 1) c = STONE_L;
        else if (row === h - 1 || col === bw - 1) c = STONE_D;
        else c = STONE_M;
        if (c === STONE_M && rnd() < 0.05) c = STONE_D;
        ground[y * WORLD_W + x] = c;
      }
    }
  }
  for (let y = 16; y < GH; y++) {
    const lv = (y - 15) / 14;
    for (let x = 0; x < WORLD_W; x++) {
      if (lv > BAYER[((y + FLOOR) & 3) * 4 + (x & 3)]) {
        const i = y * WORLD_W + x, c = ground[i];
        ground[i] = c === STONE_L ? STONE_M : c === STONE_M ? STONE_D : SKY0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
let kLeft = 0, kRight = 0, kJump = 0, kDown = 0, kFire = 0, mFire = 0;
let fireLatch = 0, jumpLatch = 0, leftLatch = 0, rightLatch = 0;
let aimMouse = false, mouseX = 220, mouseY = 90; // mouse in screen space

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const G_TITLE = 0, G_PLAY = 1, G_DYING = 2, G_OVER = 3;
let game = G_TITLE, overT = 0, score = 0, hp = 3, spawnT = 90;
const best = new Int32Array(3);
for (let i = 0; i < 3; i++) {
  try { best[i] = parseInt(localStorage.getItem('pixelQuestBest' + i), 10) || 0; } catch (e) { best[i] = 0; }
}

// Player body: wx = center x (world), fy = feet y (world), py = height above floor line
let wx = 60, fy = FLOOR, py = 0, vx = 0, vy = 0, onGround = true, standP = -1, dropT = 0, facing = 1;
let walkT = 0, knockT = 0, invuln = 0, feet = 0;
const WALK_FEET = new Uint8Array([1, 0, 2, 0]);

// Death sequence: headgear and weapon become props, body kneels then topples backward
let dead = false, deathT = 0, sink = 0, fallA = 0;
let hatOff = false, hatT = 0; // headgear gets knocked off at 1 heart
let hatX = 0, hatY = 0, hatVX = 0, hatVY = 0, hatLand = 0;
let stBX = 0, stBY = 0, stA = 0, stW = 0, stLand = 0, gemBroken = 0;
// How beaten up the hero looks: 0 pristine, 1 torn, 2 ragged
function damageLevel() {
  if (dead) return 2;
  if (game === G_TITLE || hp >= HD.hp) return 0;
  return hp <= 1 ? 2 : 1;
}

// Attack state machine (charge -> attack -> recover)
const C_LOCO = 0, C_CHARGE = 1, C_CAST = 2, C_RECOVER = 3;
const EASE_DUR = [10, 10, 8, 18];
let CAST_DUR = 22, FIRE_AT = 5, CHARGE_MED = 22, CHARGE_FULL = 60;
const REC_DUR = 18;
const AIM_MIN = 0.1, AIM_MAX = 2.3;
let cstate = C_LOCO, cT = 0, chargeT = 0, castPow = 0, castCk = 0, aimA = Math.PI / 2, fireBuf = 0;
let arm = 0, staff = 0, tilt = 0, fArm = 0, fStaff = 0, fTilt = 0, tArm = 0, tStaff = 0, tTilt = 0;
let sway = 0, beardS = 0, hatS = 0, glow = 0.35, bob = 0, drawAmt = 0;
let globalT = 0, poseClock = 0, animFrame = 0, gemFlick = 0;
let shakeT = 0, shakeAmp = 0, shakeX = 0, shakeY = 0, flashT = 0, hurtT = 0;
let ringT = -1, ringX = 0, ringY = 0, ringBig = 0, ringGold = 0;
// Attack direction (world), refreshed while aiming
let aimDX = 1, aimDY = 0;
// Knight sword slash effect
let slT = -1, slX = 0, slY = 0, slA = 0, slR = 0, slP = 0, slF = 1;

// Display (quantized) pose, sprite-local coordinates
let dBob = 0, dTilt = 0, dSway = 0, dBeard = 0, dHat = 0, dGlow = 0.35, dFacing = 1, dFeet = 0;
let dSink = 0, dFall = 0, dDraw = 0;
let sy0 = FLOOR - 19, dHX = 0, dHY = 0;
let stTopX = 0, stTopY = 0, stBotX = 0, stBotY = 0, gemX = 0, gemY = 0;
let dSin = 0, dCos = 1;
// Weapon focus point in world space (gem, blade tip or arrow tip) and the hand
let gemWX = 0, gemWY = 0, handWX = 0, handWY = 0;

// Particles (struct of arrays, pooled)
// modes: 0 free, 1 orbit, 2 burst, 3 trail, 4 mote, 5 debris, 6 gib, 7 blood drop, 8 gold spark
const PMAX = 1024;
const pX = new Float32Array(PMAX), pY = new Float32Array(PMAX);
const pVX = new Float32Array(PMAX), pVY = new Float32Array(PMAX);
const pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX);
const pAng = new Float32Array(PMAX), pRad = new Float32Array(PMAX);
const pAV = new Float32Array(PMAX), pRV = new Float32Array(PMAX);
const pMode = new Uint8Array(PMAX);
const pCol = new Uint8Array(PMAX), pCol2 = new Uint8Array(PMAX), pBleed = new Uint8Array(PMAX);
let pCursor = 0;

function spawn() {
  for (let n = 0; n < PMAX; n++) {
    const j = (pCursor + n) % PMAX;
    if (pMode[j] === 0) { pCursor = (j + 1) % PMAX; return j; }
  }
  const j = pCursor; pCursor = (pCursor + 1) % PMAX; return j;
}

// Projectiles. kind 0 magic bolt, 1 arrow (gravity, sticks in walls), 2 sword beam
const BMAX = 24;
const bAct = new Uint8Array(BMAX), bKind = new Uint8Array(BMAX), bPow = new Uint8Array(BMAX), bKills = new Uint8Array(BMAX);
const bPierce = new Int8Array(BMAX), bT = new Int32Array(BMAX);
const bX = new Float32Array(BMAX), bY = new Float32Array(BMAX);
const bVX = new Float32Array(BMAX), bVY = new Float32Array(BMAX);
const bUX = new Float32Array(BMAX), bUY = new Float32Array(BMAX);
const B_SPEED = [3.6, 3.4, 3.0], B_R = [1.5, 2.5, 3.5], B_DMG = [1, 2, 4], B_PIERCE = [0, 1, 99];
const A_DMG = [1, 2, 3], A_PIERCE = [0, 0, 2];
function arrowSpeed(ck) { return 2.2 + 2.8 * ck; }

// Arrows stuck in floors, platforms and walls
const SAMAX = 40;
const saAct = new Uint8Array(SAMAX), saT = new Int32Array(SAMAX);
const saX = new Float32Array(SAMAX), saY = new Float32Array(SAMAX), saUX = new Float32Array(SAMAX), saUY = new Float32Array(SAMAX);
let saCursor = 0;

// Enemies
const EMAX = 24;
const eAct = new Uint8Array(EMAX), eType = new Uint8Array(EMAX); // 1 bat, 2 slime
const eX = new Float32Array(EMAX), eY = new Float32Array(EMAX);
const eVX = new Float32Array(EMAX), eVY = new Float32Array(EMAX), eBase = new Float32Array(EMAX);
const eHP = new Int8Array(EMAX), eT = new Int32Array(EMAX), eDir = new Int8Array(EMAX);
const eFlash = new Uint8Array(EMAX), eInv = new Uint8Array(EMAX);
let eAlive = 0;

// Corpses: dying bats tumble and splat, slimes melt
const KMAX = 24;
const kAct = new Uint8Array(KMAX), kType = new Uint8Array(KMAX), kLand = new Uint8Array(KMAX);
const kX = new Float32Array(KMAX), kY = new Float32Array(KMAX);
const kVX = new Float32Array(KMAX), kVY = new Float32Array(KMAX), kT = new Int32Array(KMAX);
const kDir = new Int8Array(KMAX);

// Score popups
const UMAX = 8;
const uAct = new Uint8Array(UMAX), uVal = new Int32Array(UMAX), uT = new Int32Array(UMAX);
const uX = new Float32Array(UMAX), uY = new Float32Array(UMAX);

function easeInOut(k) { return k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k); }
function easeOutBack(k) { const c = 1.9, t = k - 1; return 1 + (c + 1) * t * t * t + c * t * t; }

function startShake(amp, t) {
  if (amp >= shakeAmp || shakeT === 0) shakeAmp = amp;
  if (t > shakeT) shakeT = t;
}
function ring(x, y, big) { ringT = 0; ringX = x; ringY = y; ringBig = big; ringGold = hero === WIZARD ? 0 : 1; }

// Surface hit when moving down from prevY to y at x: returns surface row or -1
function landY(x, prevY, y) {
  if (y >= FLOOR) return FLOOR;
  for (let p = 0; p < NPLAT; p++) {
    if (prevY <= PLY[p] && y >= PLY[p] && x >= PLX[p] && x < PLX[p] + PLW[p]) return PLY[p];
  }
  return -1;
}
// Top of the surface under x at or below y (platform or floor)
function supportBelow(x, y) {
  let top = FLOOR;
  for (let p = 0; p < NPLAT; p++) {
    if (x >= PLX[p] - 2 && x <= PLX[p] + PLW[p] + 1 && PLY[p] >= y - 0.5 && PLY[p] < top) top = PLY[p];
  }
  return top;
}
function hasSurface(x, y) {
  if (y === FLOOR) return true;
  for (let p = 0; p < NPLAT; p++) if (PLY[p] === y && x >= PLX[p] && x < PLX[p] + PLW[p]) return true;
  return false;
}
function inPlatform(x, y) {
  for (let q = 0; q < NPLAT; q++) {
    if (x >= PLX[q] && x <= PLX[q] + PLW[q] && y >= PLY[q] && y <= PLY[q] + 4) return true;
  }
  return false;
}

function burst(x, y, n, bx, by, spd) {
  for (let k = 0; k < n; k++) {
    const i = spawn();
    const a = rnd() * 6.2832, s = 0.3 + rnd() * spd;
    pMode[i] = 2;
    pX[i] = x; pY[i] = y;
    pVX[i] = Math.cos(a) * s + bx; pVY[i] = Math.sin(a) * s * 0.85 + by;
    pLife[i] = pMax[i] = 16 + rnd() * 26;
  }
}
function sparks(x, y, n, bx, by, spd) { // gold/steel sparks
  for (let k = 0; k < n; k++) {
    const i = spawn();
    const a = rnd() * 6.2832, s = 0.3 + rnd() * spd;
    pMode[i] = 8;
    pX[i] = x; pY[i] = y;
    pVX[i] = Math.cos(a) * s + bx; pVY[i] = Math.sin(a) * s * 0.85 + by;
    pLife[i] = pMax[i] = 12 + rnd() * 20;
  }
}
function debris(x, y, n, c1, c2) {
  for (let k = 0; k < n; k++) {
    const i = spawn();
    const a = rnd() * 6.2832, s = 0.4 + rnd() * 1.4;
    pMode[i] = 5; pCol[i] = (k & 1) ? c1 : c2;
    pX[i] = x; pY[i] = y;
    pVX[i] = Math.cos(a) * s; pVY[i] = Math.sin(a) * s - 0.8;
    pLife[i] = pMax[i] = 24 + rnd() * 24;
  }
}
// Blood (or goo) drops: fly, then stain whatever surface they land on
function spray(x, y, n, bx, by, spd, c, stainC) {
  for (let k = 0; k < n; k++) {
    const i = spawn();
    const a = rnd() * 6.2832, s = 0.3 + rnd() * spd;
    pMode[i] = 7; pCol[i] = c; pCol2[i] = stainC;
    pX[i] = x + (rnd() - 0.5) * 3; pY[i] = y + (rnd() - 0.5) * 3;
    pVX[i] = Math.cos(a) * s + bx; pVY[i] = Math.sin(a) * s - 0.9 + by;
    pLife[i] = pMax[i] = 200;
  }
}
// Chunks that bounce, settle, bleed while flying, and linger a while
function gibs(x, y, n, c1, c2, bleed, spd) {
  for (let k = 0; k < n; k++) {
    const i = spawn();
    const a = rnd() * 6.2832, s = 0.6 + rnd() * spd;
    pMode[i] = 6; pCol[i] = (k % 3 === 2) ? c2 : c1; pCol2[i] = c2; pBleed[i] = bleed;
    pX[i] = x + (rnd() - 0.5) * 4; pY[i] = y + (rnd() - 0.5) * 4;
    pVX[i] = Math.cos(a) * s; pVY[i] = Math.sin(a) * s - 1.6;
    pLife[i] = pMax[i] = 420 + rnd() * 240;
  }
}
function dust(x, y) {
  for (let k = 0; k < 5; k++) {
    const i = spawn();
    pMode[i] = 5; pCol[i] = k & 1 ? STONE_L : BEARD_SH;
    pX[i] = x + (rnd() - 0.5) * 12; pY[i] = y - 1;
    pVX[i] = (pX[i] - x) * 0.08; pVY[i] = -0.3 - rnd() * 0.4;
    pLife[i] = pMax[i] = 10 + rnd() * 8;
  }
}
function splat(x, y, r, c1, c2) {
  for (let dx = -r; dx <= r; dx++) {
    const xx = Math.round(x) + dx;
    if (!hasSurface(xx, y) || rnd() < 0.2) continue;
    stain(xx, y, rnd() < 0.5 ? c1 : c2);
    if (dx > -r + 1 && dx < r - 1 && rnd() < 0.5) stain(xx, y + 1, c2);
  }
}
function popup(x, y, v) {
  for (let i = 0; i < UMAX; i++) {
    if (uAct[i]) continue;
    uAct[i] = 1; uX[i] = x; uY[i] = y; uVal[i] = v; uT[i] = 0;
    return;
  }
}

function enterC(s) {
  cstate = s; cT = 0;
  fArm = arm; fStaff = staff; fTilt = tilt;
  poseClock = POSE_EVERY; // snapshot immediately
  if (s === C_LOCO || s === C_RECOVER) { tArm = 0; tStaff = HD.rest; tTilt = 0; }
  else if (s === C_CHARGE) { tArm = 1; chargeT = 0; }
  else tArm = hero === ARCHER ? 1.2 : 2;
}

// Aim angle (sprite-local, 0 = straight up, PI/2 = forward) from the shoulder to the mouse
function computeAim() {
  if (aimMouse) {
    const mwx = mouseX + camI;
    if (mwx > wx + 1) facing = 1; else if (mwx < wx - 1) facing = -1;
    const sx = wx + facing * 2, sy = fy - 18;
    let dxl = (mwx - sx) * facing;
    if (dxl < 0.5) dxl = 0.5;
    aimA = Math.atan2(dxl, -(mouseY - sy));
  } else {
    aimA = kDown ? 2.2 : Math.PI / 2;
  }
  if (aimA < AIM_MIN) aimA = AIM_MIN; else if (aimA > AIM_MAX) aimA = AIM_MAX;
  // Knight winds the sword back over the shoulder; others point along the aim
  tStaff = hero === KNIGHT ? Math.max(-0.9, aimA - 1.7) : aimA;
  tTilt = aimA < 0.9 ? -1 : aimA > 1.9 ? 1 : 0;
}

// Attack direction: from the weapon's origin straight through the cursor
function computeAimDir() {
  aimDX = facing * Math.sin(aimA); aimDY = -Math.cos(aimA);
  if (!aimMouse) return;
  let ox, oy;
  if (hero === WIZARD) { ox = gemWX; oy = gemWY; }
  else if (hero === ARCHER) { ox = handWX; oy = handWY; }
  else { ox = wx + facing * 2; oy = fy - 18; }
  const dx = mouseX + camI - ox, dy = mouseY - oy;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 6 && dx * facing > -2) { aimDX = dx / d; aimDY = dy / d; }
}

// Pose geometry from the current (smooth) parameters, quantized to the pixel grid
function poseGeom() {
  sy0 = FLOOR - 19 + dBob + dSink;
  // Hand: rests at the side (arm 0), holds the weapon out along its angle (arm 1), thrusts (arm 2)
  const sa = Math.sin(staff), ca = Math.cos(staff);
  const lift = hero === WIZARD && ca > 0 ? ca * 4 : 0; // keep the staff clear of the face when aiming up
  let hx, hy;
  if (arm <= 1) {
    const tx = 2 + sa * 6 + lift, ty = 1 - ca * 6;
    hx = 8 + (tx - 8) * arm; hy = 6 + (ty - 6) * arm;
  } else {
    const t = arm - 1, r = 6 + 5 * t;
    hx = 2 + sa * r + lift; hy = 1 - ca * r;
  }
  dHX = OX + Math.round(hx); dHY = sy0 + Math.round(hy);
  dSin = sa; dCos = ca;
  if (hero === WIZARD) {
    stTopX = Math.round(dHX + dSin * 14); stTopY = Math.round(dHY - dCos * 14);
    stBotX = Math.round(dHX - dSin * 13); stBotY = Math.round(dHY + dCos * 13);
    gemX = Math.round(dHX + dSin * 17); gemY = Math.round(dHY - dCos * 17);
  } else if (hero === KNIGHT) {
    gemX = Math.round(dHX + dSin * 15); gemY = Math.round(dHY - dCos * 15); // blade tip
  } else {
    const nock = 1.5 - dDraw * 6;
    gemX = Math.round(dHX + dSin * (nock + 12)); gemY = Math.round(dHY - dCos * (nock + 12)); // arrow tip
  }
}
// Freeze the smooth pose into pixel-grid values (runs at 12 fps)
function snapshot() {
  animFrame++;
  dBob = bob;
  dTilt = Math.max(-1, Math.min(1, Math.round(tilt + (damageLevel() === 2 && !dead ? 0.6 : 0)))); // droop when badly hurt
  dSway = sway; dBeard = beardS; dHat = hatS; dGlow = glow;
  dFacing = facing; dFeet = feet; dSink = sink; dDraw = drawAmt;
  dFall = Math.round(fallA / 0.2618) * 0.2618; // 15 degree steps
  poseGeom();
}
function updateGemWorld() {
  const rwx = Math.round(wx), rpy = Math.round(py);
  gemWX = rwx + dFacing * (gemX - OX);
  gemWY = gemY - rpy;
  handWX = rwx + dFacing * (dHX - OX);
  handWY = dHY - rpy;
}

function fire() {
  const p = castPow;
  computeAimDir();
  if (hero === WIZARD) {
    glow = dGlow = p === 2 ? 1.45 : p === 1 ? 1.15 : 0.9;
    startShake(p === 2 ? 2 : 1, p === 2 ? 14 : p === 1 ? 8 : 4);
    flashT = p === 2 ? 6 : p === 1 ? 3 : 0;
    if (p > 0) ring(gemWX, gemWY, 1);
    burst(gemWX, gemWY, p === 2 ? 50 : p === 1 ? 26 : 10, aimDX * 0.7, aimDY * 0.7, p === 2 ? 2.4 : 1.6);
    spawnBolt(0, p, gemWX + aimDX * 2, gemWY + aimDY * 2, aimDX * B_SPEED[p], aimDY * B_SPEED[p], B_PIERCE[p]);
  } else if (hero === ARCHER) {
    const s = arrowSpeed(castCk);
    startShake(p === 2 ? 1 : 0, p === 2 ? 5 : 0);
    if (p === 2) ring(handWX, handWY, 0);
    spawnBolt(1, p, handWX + aimDX * 3, handWY + aimDY * 3, aimDX * s, aimDY * s, A_PIERCE[p]);
  } else {
    swordSlash(p);
  }
}

function spawnBolt(kind, p, x, y, vx0, vy0, pierce) {
  for (let i = 0; i < BMAX; i++) {
    if (bAct[i]) continue;
    bAct[i] = 1; bKind[i] = kind; bPow[i] = p; bKills[i] = 0; bPierce[i] = pierce; bT[i] = 0;
    bX[i] = x; bY[i] = y; bVX[i] = vx0; bVY[i] = vy0;
    const s = Math.sqrt(vx0 * vx0 + vy0 * vy0) || 1;
    bUX[i] = vx0 / s; bUY[i] = vy0 / s;
    return i;
  }
  return -1;
}

// Knight: an arc of steel in front of the shoulder; full charge also throws a beam
function swordSlash(p) {
  const sx = wx + facing * 2, sy = fy - 18;
  const reach = p === 2 ? 25 : p === 1 ? 22 : 18, dmg = p + 1;
  let kills = 0;
  for (let i = 0; i < EMAX; i++) {
    if (!eAct[i] || eInv[i]) continue;
    const cy = eType[i] === 2 ? eY[i] - 3 : eY[i];
    const dx = eX[i] - sx, dy = cy - sy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > reach + 5) continue;
    if (d > 4 && (dx * aimDX + dy * aimDY) / d < 0.15) continue;
    eHP[i] -= dmg; eFlash[i] = 6; eInv[i] = 12;
    sparks(eX[i], cy, 6, aimDX, aimDY, 1.2);
    if (eHP[i] <= 0) { killEnemy(i, true, p, aimDX, aimDY, kills); kills++; }
    else {
      eVX[i] += aimDX * 2.2;
      if (eType[i] === 1) eBase[i] += aimDY * 8;
      spray(eX[i], cy, 6, aimDX, aimDY, 1, eType[i] === 2 ? SLIME : BLOOD, eType[i] === 2 ? SLIME_D : BLOOD_D);
    }
  }
  slT = 0; slX = sx; slY = sy; slA = Math.atan2(aimDY, aimDX); slR = reach; slP = p; slF = facing;
  startShake(p === 2 ? 2 : 1, p === 2 ? 10 : 4);
  if (p === 2) {
    flashT = 3;
    ring(Math.round(sx + aimDX * 12), Math.round(sy + aimDY * 12), 1);
    spawnBolt(2, 2, sx + aimDX * 10, sy + aimDY * 10, aimDX * 3.2, aimDY * 3.2, 99);
  }
}

function boltExplode(i) {
  const p = bPow[i];
  bAct[i] = 0;
  if (bKind[i] === 2) { sparks(bX[i], bY[i], 16, 0, -0.3, 1.6); return; }
  burst(bX[i], bY[i], p === 2 ? 30 : p === 1 ? 16 : 8, 0, -0.3, p === 2 ? 2 : 1.2);
  if (p === 2) { ring(Math.round(bX[i]), Math.round(bY[i]), 1); startShake(1, 6); }
}

function stickArrow(i, x, y) {
  bAct[i] = 0;
  const k = saCursor; saCursor = (saCursor + 1) % SAMAX;
  saAct[k] = 1; saT[k] = 0; saX[k] = x; saY[k] = y; saUX[k] = bUX[i]; saUY[k] = bUY[i];
  debris(x, y, 3, STONE_L, BEARD_SH);
}

function spawnEnemy() {
  let i = -1;
  for (let k = 0; k < EMAX; k++) if (!eAct[k]) { i = k; break; }
  if (i < 0) return;
  let side = rnd() < 0.5 ? -1 : 1;
  if (side < 0 && camI < 20) side = 1;
  else if (side > 0 && camI + W > WORLD_W - 20) side = -1;
  const sx = side < 0 ? camI - 10 : camI + W + 10;
  const diff = Math.min(0.4, score / 1500);
  eAct[i] = 1; eFlash[i] = 0; eInv[i] = 0;
  if (score >= 40 && rnd() < 0.35) {
    eType[i] = 2; eHP[i] = 2;
    eX[i] = sx; eY[i] = FLOOR - 1;
    eVX[i] = 0; eVY[i] = 0; eT[i] = 50 + ((rnd() * 15) | 0); eDir[i] = -side;
  } else {
    eType[i] = 1; eHP[i] = 1;
    eX[i] = sx; eBase[i] = 30 + rnd() * (FLOOR - 70); eY[i] = eBase[i];
    eVY[i] = 0.5 + rnd() * 0.25 + diff;           // max speed
    eVX[i] = -side * eVY[i]; eT[i] = (rnd() * 100) | 0;
  }
}

function spawnCorpse(type, x, y, vx0, vy0, dir) {
  for (let k = 0; k < KMAX; k++) {
    if (kAct[k]) continue;
    kAct[k] = 1; kType[k] = type; kLand[k] = 0; kT[k] = 0;
    kX[k] = x; kY[k] = y; kVX[k] = vx0; kVY[k] = vy0; kDir[k] = dir;
    return;
  }
}

// Kill an enemy with gore scaled by the hit's power; scoring adds a combo bonus
function killEnemy(i, scoring, p, ux, uy, bonus) {
  eAct[i] = 0;
  const cy = eType[i] === 2 ? eY[i] - 3 : eY[i];
  const explode = p === 2 || (eType[i] === 1 && p === 1);
  if (eType[i] === 1) {
    if (explode) {
      gibs(eX[i], cy, 5, BAT, BAT_D, 1, 1.8);
      gibs(eX[i], cy, 1, RED, BLOOD_D, 1, 1.2);
      spray(eX[i], cy, 26, ux * 1.2, uy * 1.2, 1.8, BLOOD, BLOOD_D);
    } else {
      spray(eX[i], cy, 10, ux, uy, 1.2, BLOOD, BLOOD_D);
      spawnCorpse(1, eX[i], cy, ux * 1.2 + eVX[i] * 0.3, -1.2 + uy, ux >= 0 ? 1 : -1);
    }
  } else {
    if (explode) {
      gibs(eX[i], cy, 8, SLIME, SLIME_D, 2, 1.8);
      spray(eX[i], cy, 26, ux, uy, 1.8, SLIME, SLIME_D);
    } else {
      spray(eX[i], cy, 8, ux * 0.6, 0, 1, SLIME, SLIME_D);
      spawnCorpse(2, eX[i], eY[i], 0, eY[i] < FLOOR - 1 ? eVY[i] : 0, eDir[i]);
    }
  }
  burst(eX[i], cy, 6, 0, -0.2, 1.2);
  if (!scoring) return;
  const val = (eType[i] === 1 ? 10 : 25) + bonus * 10;
  score += val;
  popup(eX[i], cy - 8, val);
  startShake(explode ? 2 : 1, explode ? 8 : 5);
}

function hurt(fromX) {
  hp--;
  invuln = 90; knockT = 14; hurtT = 5;
  const away = wx < fromX ? -1 : 1;
  vx = away * 1.4;
  if (onGround) { vy = -1.6; onGround = false; standP = -1; }
  startShake(2, 10);
  spray(wx, fy - 16, 14, away * 1.2, -0.3, 1.4, BLOOD, BLOOD_D);
  if (hero === KNIGHT) sparks(wx, fy - 16, 10, away, -0.5, 1.4);               // armor clang
  else debris(wx, fy - 14, 8, hero === ARCHER ? FOREST_M : ROBE_M, hero === ARCHER ? FOREST_D : ROBE_D); // cloth scraps
  if (hero === WIZARD) debris(wx, fy - 22, 3, BEARD, BEARD_SH);                // tufts of beard
  if (cstate === C_CHARGE) enterC(C_LOCO);
  if (hp === 1 && !hatOff) launchHat(away);
  if (hp <= 0) startDeath(away);
}

function launchHat(away) {
  hatOff = true; hatT = 0; hatLand = 0;
  hatX = wx - dFacing * 2; hatY = fy - 28;
  hatVX = away * (0.8 + rnd() * 0.4); hatVY = -2.6;
}

function updateHat() {
  hatT++;
  if (hatLand) return;
  hatVY += 0.12;
  const prev = hatY;
  hatX += hatVX; hatY += hatVY;
  if (hatX < WALL_W + 6) { hatX = WALL_W + 6; hatVX = -hatVX * 0.5; }
  if (hatX > WORLD_W - WALL_W - 6) { hatX = WORLD_W - WALL_W - 6; hatVX = -hatVX * 0.5; }
  if (hatVY > 0) {
    const s = landY(Math.round(hatX), prev, hatY);
    if (s >= 0) {
      hatY = s;
      if (hatVY > 1) { hatVY = -hatVY * 0.35; hatVX *= 0.5; if (hero === KNIGHT) sparks(hatX, s - 2, 4, 0, -0.5, 0.8); }
      else { hatVY = 0; hatVX = 0; hatLand = 1; }
    }
  }
}

function startDeath(away) {
  game = G_DYING; dead = true; deathT = 0; invuln = 0;
  hurtT = 8; startShake(3, 16);
  spray(wx, fy - 18, 40, away * 1.6, -0.6, 2.2, BLOOD, BLOOD_D);
  gibs(wx, fy - 16, 3, hero === KNIGHT ? STEEL_M : hero === ARCHER ? FOREST_M : ROBE_M,
       hero === KNIGHT ? STEEL_D : hero === ARCHER ? FOREST_D : ROBE_D, 1, 1.4);
  if (!hatOff) launchHat(-dFacing);
  // Weapon drops from the hand and topples forward
  stBX = wx + dFacing * 7; stBY = fy - 1;
  stA = dFacing * (hero === WIZARD && staff < 1.2 ? staff : 0.5); stW = dFacing * 0.02; stLand = 0; gemBroken = 0;
  slT = -1;
  if (cstate !== C_LOCO) enterC(C_LOCO);
  if (score > best[hero]) {
    best[hero] = score;
    try { localStorage.setItem('pixelQuestBest' + hero, String(score)); } catch (e) { /* storage unavailable */ }
  }
}

function updateDeath() {
  deathT++;
  // Body: stagger, sink to the knees, then topple backward with a small bounce
  sink = deathT < 12 ? 0 : Math.min(5, ((deathT - 12) / 3) | 0);
  if (deathT < 30) fallA = 0;
  else if (deathT < 54) { const k = (deathT - 30) / 24; fallA = k * k * 1.5708; }
  else if (deathT < 66) fallA = 1.5708 - Math.sin((deathT - 54) / 12 * Math.PI) * 0.26;
  else fallA = 1.5708;
  if (deathT === 54) { startShake(1, 6); dust(wx - dFacing * 16, fy); }
  if (deathT > 20 && deathT < 60 && (deathT % 4) === 0) spray(wx - dFacing * 4, fy - 12, 1, -dFacing * 0.3, 0, 0.5, BLOOD, BLOOD_D);
  // Blood pool spreading under the body
  if (deathT >= 58 && deathT < 160 && (deathT % 3) === 0) {
    const r = Math.min(18, ((deathT - 58) / 4) | 0), cx = Math.round(wx - dFacing * 16);
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (!hasSurface(x, fy)) continue;
      stain(x, fy, dx > -r + 2 && dx < r - 2 ? BLOOD : BLOOD_D);
      if (dx > -r + 3 && dx < r - 3) stain(x, fy + 1, ((x * 3) % 7) === 0 ? BLOOD : BLOOD_D);
      if (dx > -r + 8 && dx < r - 8) stain(x, fy + 2, BLOOD_D);
    }
  }
  // Weapon prop: topples around its base; the wizard's gem shatters, steel clangs
  if (!stLand) {
    const sg = stA >= 0 ? 1 : -1;
    stW += sg * 0.006 + Math.sin(stA) * 0.012;
    stA += stW;
    if (stA * sg >= 1.5) {
      stA = 1.5 * sg;
      if (!gemBroken) {
        gemBroken = 1;
        const len = hero === WIZARD ? 30 : 16;
        const tx = stBX + Math.sin(stA) * len, ty = stBY - Math.cos(stA) * len;
        if (hero === WIZARD) {
          burst(tx, ty, 24, 0, -0.6, 1.8);
          gibs(tx, ty, 4, MAGIC_C, MAGIC_B, 0, 1.2);
          ring(Math.round(tx), Math.round(ty), 0);
        } else if (hero === KNIGHT) sparks(tx, ty, 10, 0, -0.6, 1.4);
        startShake(1, 5);
      }
      if (stW * sg > 0.04) stW = -stW * 0.3; else { stW = 0; stLand = 1; }
    }
  }
}

// Clear the arena (used when entering hero select and when starting a run)
function resetWorld() {
  decal.fill(0);
  for (let i = 0; i < EMAX; i++) eAct[i] = 0;
  for (let i = 0; i < BMAX; i++) bAct[i] = 0;
  for (let i = 0; i < UMAX; i++) uAct[i] = 0;
  for (let i = 0; i < KMAX; i++) kAct[i] = 0;
  for (let i = 0; i < SAMAX; i++) saAct[i] = 0;
  for (let i = 0; i < PMAX; i++) pMode[i] = 0;
  dead = false; deathT = 0; sink = 0; fallA = 0; hatOff = false; slT = -1;
  invuln = 0; knockT = 0; vx = 0; vy = 0;
  wx = 60; fy = FLOOR; py = 0; onGround = true; standP = -1; facing = 1;
  camX = 0; camI = 0;
}

function selectHero(i) {
  hero = i; HD = HEROES[i];
  CHARGE_FULL = HD.full; CHARGE_MED = HD.med; CAST_DUR = HD.castDur; FIRE_AT = HD.fireAt;
}

function startGame() {
  resetWorld();
  selectHero(sel);
  game = G_PLAY; score = 0; hp = HD.hp; spawnT = 90;
  arm = 0; staff = HD.rest; tilt = 0; glow = hero === WIZARD ? 0.35 : 0;
  enterC(C_LOCO);
  snapshot();
}

// ---------------------------------------------------------------------------
// Simulation step (fixed 60 Hz)
// ---------------------------------------------------------------------------
function step() {
  globalT++;
  const fireHeld = kFire || mFire ? 1 : 0;
  if (fireLatch) { fireBuf = 8; fireLatch = 0; } else if (fireBuf > 0) fireBuf--;
  const jumpPressed = jumpLatch; jumpLatch = 0;

  if (game === G_TITLE) {
    // Hero select: A/D or arrows, mouse hover; click / J / jump starts
    if (leftLatch) sel = (sel + 2) % 3;
    if (rightLatch) sel = (sel + 1) % 3;
    if (aimMouse && mouseY > 90) {
      for (let i = 0; i < 3; i++) if (Math.abs(mouseX - selX(i)) < 26) sel = i;
    }
    if (fireBuf > 0 || jumpPressed) { fireBuf = 0; startGame(); }
  } else if (game === G_DYING) {
    if (deathT >= 150) { game = G_OVER; overT = 0; }
    fireBuf = 0;
  } else if (game === G_OVER) {
    overT++;
    if (overT > 40 && fireBuf > 0) { fireBuf = 0; resetWorld(); game = G_TITLE; }
    else if (overT <= 40) fireBuf = 0;
  }
  leftLatch = 0; rightLatch = 0;
  const playing = game === G_PLAY;
  if (dead) updateDeath();
  if (hatOff) updateHat();
  if (playing && hp < HD.hp && (globalT % (hp === 1 ? 30 : 90)) === 0) {
    spray(wx - facing * 2, fy - (hp === 1 ? 24 : 14), 1, -facing * 0.2, 0.8, 0.2, BLOOD, BLOOD_D);
  }

  // Horizontal movement
  let mv = playing ? (kRight ? 1 : 0) - (kLeft ? 1 : 0) : 0;
  if (knockT > 0) { knockT--; mv = 0; }
  const maxV = (cstate === C_CHARGE ? 0.45 : 1.0) * HD.spd;
  vx += (mv * maxV - vx) * (onGround ? (dead ? 0.15 : 0.25) : 0.1);
  if (vx > -0.02 && vx < 0.02) vx = 0;
  wx += vx;
  if (wx < WALL_W + 6) { wx = WALL_W + 6; vx = 0; } else if (wx > WORLD_W - WALL_W - 6) { wx = WORLD_W - WALL_W - 6; vx = 0; }

  // Jump, drop-through (S + jump on a platform), one-way platform landing
  if (playing && jumpPressed && onGround) {
    if (kDown && standP >= 0) { dropT = 12; vy = 0.5; }
    else vy = -HD.jump;
    onGround = false; standP = -1;
  }
  if (onGround && standP >= 0 && (wx < PLX[standP] - 2 || wx > PLX[standP] + PLW[standP] + 1)) {
    onGround = false; standP = -1; vy = 0; // walked off the edge
  }
  if (!onGround) {
    if (!kJump && vy < 0 && knockT === 0 && playing) vy += 0.25; // release early for a short hop
    vy += 0.17;
    const prev = fy;
    fy += vy;
    if (vy > 0) {
      if (dropT === 0) {
        for (let p = 0; p < NPLAT; p++) {
          if (prev <= PLY[p] && fy >= PLY[p] && wx >= PLX[p] - 2 && wx <= PLX[p] + PLW[p] + 1) {
            fy = PLY[p]; onGround = true; standP = p; vy = 0; dust(wx, fy); break;
          }
        }
      }
      if (!onGround && fy >= FLOOR) { fy = FLOOR; onGround = true; standP = -1; vy = 0; dust(wx, fy); }
    }
  }
  if (dropT > 0) dropT--;
  py = FLOOR - fy;

  // Facing: movement, or the mouse when standing still / aiming
  if (!dead) {
    if (mv !== 0 && cstate === C_LOCO) facing = mv;
    if (aimMouse && playing && (mv === 0 || cstate !== C_LOCO) && cstate !== C_CAST) {
      const mwx = mouseX + camI;
      if (mwx > wx + 3) facing = 1; else if (mwx < wx - 3) facing = -1;
    }
  }
  const walking = onGround && !dead && (vx > 0.15 || vx < -0.15);
  walkT = walking ? walkT + 1 : 0;
  feet = walking ? WALK_FEET[((walkT / (8 / HD.spd)) | 0) & 3] : 0;

  // Camera follows with a little look-ahead
  if (game !== G_TITLE) {
    const camT = wx - W / 2 + (dead ? 0 : facing * 30);
    camX += (camT - camX) * 0.08;
    if (camX < 0) camX = 0; else if (camX > WORLD_W - W) camX = WORLD_W - W;
  }
  camI = Math.round(camX);

  // Attack state machine
  if (playing) {
    const canStart = cstate === C_LOCO || cstate === C_RECOVER || (cstate === C_CAST && cT > FIRE_AT + 6);
    if (fireBuf > 0 && canStart) { fireBuf = 0; enterC(C_CHARGE); computeAim(); }
    if (cstate === C_CHARGE) {
      chargeT++;
      computeAim();
      if (chargeT === CHARGE_FULL) ring(gemWX, gemWY, 0);
      if (!fireHeld) {
        castPow = chargeT >= CHARGE_FULL ? 2 : chargeT >= CHARGE_MED ? 1 : 0;
        castCk = Math.min(1, chargeT / CHARGE_FULL);
        enterC(C_CAST);
        tStaff = hero === KNIGHT ? Math.min(2.9, aimA + 0.9) : aimA;
      }
    }
  }
  if (cstate === C_CAST && cT >= CAST_DUR) enterC(C_RECOVER);
  else if (cstate === C_RECOVER && cT >= REC_DUR) enterC(C_LOCO);
  drawAmt = cstate === C_CHARGE ? Math.min(1, chargeT / CHARGE_FULL) : 0;

  // Ease pose toward the current keyframe
  const k = Math.min(1, cT / EASE_DUR[cstate]);
  const e = cstate === C_CAST ? easeOutBack(k) : easeInOut(k);
  arm = fArm + (tArm - fArm) * e;
  staff = fStaff + (tStaff - fStaff) * e;
  tilt = fTilt + (tTilt - fTilt) * e;
  const ck = cstate === C_CHARGE ? Math.min(1, chargeT / CHARGE_FULL) : 0;
  if (cstate === C_CHARGE) staff += Math.sin(globalT * 0.9) * 0.04 * ck;
  if (dead) tilt = deathT < 30 ? -1 : 1;

  // Secondary motion (sprite-local: negative = trailing behind)
  const fired = cstate === C_CAST && cT >= FIRE_AT;
  let swayT, beardT, hatT, glowT;
  if (dead) {
    swayT = deathT < 30 ? -2 : 1.5; beardT = deathT < 30 ? -2 : 1; hatT = 0; glowT = 0;
  } else if (cstate === C_CHARGE) {
    swayT = Math.sin(globalT * 0.35) * 1.3 * ck; beardT = Math.sin(globalT * 0.45) * 1.2 * ck;
    hatT = Math.sin(globalT * 0.4 + 1) * 1.5 * ck; glowT = 0.35 + 0.85 * ck;
  } else if (fired) {
    const kick = castPow === 2 ? 1 : castPow === 1 ? 0.7 : 0.4;
    swayT = -2.5 * kick; beardT = -2 * kick; hatT = -2.5 * kick; glowT = 0.8;
  } else {
    swayT = Math.sin(globalT * 0.052); beardT = Math.sin(globalT * 0.07 + 1) * 0.9;
    hatT = Math.sin(globalT * 0.045 + 2) * 0.8; glowT = 0.35 + 0.08 * Math.sin(globalT * 0.1);
  }
  if (hero !== WIZARD) glowT = 0;
  if (!dead) {
    const spd = (vx < 0 ? -vx : vx) * (vx * facing < 0 ? -1 : 1);
    if (onGround) { swayT -= spd * 1.4; beardT -= spd * 1.6; hatT -= spd * 1.8; }
    else { swayT += vy > 0 ? 1.2 : -1.2; beardT += vy > 0 ? -1.5 : 1; hatT += vy > 0 ? 1 : -2; }
  }
  if (dead || !onGround) bob = 0;
  else if (walking) bob = feet !== 0 ? 1 : 0;
  else if (fired && cT < FIRE_AT + 12) bob = 1;
  else if (cstate === C_LOCO || cstate === C_RECOVER) bob = ((globalT / 30) | 0) & 1;
  else bob = 0;
  sway += (swayT - sway) * 0.12;
  beardS += (beardT - beardS) * 0.1;
  hatS += (hatT - hatS) * 0.08;
  glow += (glowT - glow) * (dead ? 0.2 : 0.08);

  poseClock++;
  if (poseClock >= POSE_EVERY) { poseClock = 0; snapshot(); }
  updateGemWorld();
  if (cstate === C_CHARGE) computeAimDir();
  if ((globalT % 3) === 0) gemFlick = rnd();

  // Attack events and charge effects
  if (cstate === C_CAST && cT === FIRE_AT) fire();
  if (cstate === C_CHARGE) {
    if (hero === WIZARD) {
      const count = chargeT < CHARGE_FULL ? (chargeT & 1) + (chargeT > 30 ? 1 : 0) : (chargeT & 1);
      for (let n = 0; n < count; n++) {
        const i = spawn();
        pMode[i] = 1;
        pAng[i] = rnd() * 6.2832; pRad[i] = 8 + rnd() * 11;
        pAV[i] = 0.09 + rnd() * 0.07; pRV[i] = 0.16 + rnd() * 0.14;
        pLife[i] = pMax[i] = pRad[i] / pRV[i];
      }
    } else if (hero === KNIGHT && chargeT > CHARGE_MED && (chargeT % (chargeT >= CHARGE_FULL ? 3 : 7)) === 0) {
      sparks(gemWX, gemWY, 1, 0, -0.3, 0.6); // glints running off the raised blade
    } else if (hero === ARCHER && chargeT >= CHARGE_FULL && (chargeT % 6) === 0) {
      sparks(gemWX, gemWY, 1, 0, -0.2, 0.3);
    }
  }
  if (hero === WIZARD && (cstate === C_LOCO || cstate === C_RECOVER) && game === G_PLAY && (globalT % 16) === 0) {
    const i = spawn();
    pMode[i] = 4;
    pX[i] = gemWX + (rnd() - 0.5) * 4; pY[i] = gemWY - 1;
    pVX[i] = (rnd() - 0.5) * 0.08; pVY[i] = -0.1 - rnd() * 0.1;
    pLife[i] = pMax[i] = 40 + rnd() * 30;
  }
  if (slT >= 0) { slT++; if (slT > 9) slT = -1; }

  // Particles
  for (let i = 0; i < PMAX; i++) {
    const m = pMode[i];
    if (m === 0) continue;
    pLife[i] -= 1;
    if (m === 1) {
      pAng[i] += pAV[i]; pRad[i] -= pRV[i];
      pX[i] = gemWX + Math.cos(pAng[i]) * pRad[i];
      pY[i] = gemWY + Math.sin(pAng[i]) * pRad[i] * 0.7;
      if (pRad[i] <= 0.5) pMode[i] = 0;
    } else if (m === 2 || m === 8) {
      pX[i] += pVX[i]; pY[i] += pVY[i];
      pVX[i] *= 0.93; pVY[i] = pVY[i] * 0.93 + (m === 8 ? 0.06 : 0.03);
    } else if (m === 3) {
      pX[i] += pVX[i]; pY[i] += pVY[i];
      pVX[i] *= 0.9; pVY[i] *= 0.9;
    } else if (m === 4) {
      pX[i] += pVX[i] + Math.sin((pLife[i] + i) * 0.12) * 0.06; pY[i] += pVY[i];
    } else if (m === 5) {
      pX[i] += pVX[i]; pY[i] += pVY[i];
      pVX[i] *= 0.96; pVY[i] = pVY[i] * 0.96 + 0.08;
      if (pY[i] > FLOOR - 1) { pY[i] = FLOOR - 1; pVY[i] *= -0.4; pVX[i] *= 0.6; }
    } else if (m === 6) {
      // Gib: bounce on floor/platforms, bleed while moving, then rest
      pVY[i] += 0.12;
      const prev = pY[i] + 1;
      pX[i] += pVX[i]; pY[i] += pVY[i];
      if (pX[i] < WALL_W) { pX[i] = WALL_W; pVX[i] = -pVX[i] * 0.5; }
      if (pX[i] > WORLD_W - WALL_W - 2) { pX[i] = WORLD_W - WALL_W - 2; pVX[i] = -pVX[i] * 0.5; }
      if (pVY[i] > 0) {
        const s = landY(Math.round(pX[i]), prev, pY[i] + 1);
        if (s >= 0) {
          if (pVY[i] > 0.8 && pBleed[i]) splat(pX[i], s, 2, pBleed[i] === 2 ? SLIME_D : BLOOD, pBleed[i] === 2 ? SLIME_D : BLOOD_D);
          pY[i] = s - 1;
          if (pVY[i] > 0.6) { pVY[i] = -pVY[i] * 0.3; pVX[i] *= 0.6; }
          else { pVY[i] = 0; pVX[i] *= 0.7; }
        }
      }
      const moving = pVX[i] > 0.1 || pVX[i] < -0.1 || pVY[i] !== 0;
      if (moving && pBleed[i] && (i + globalT) % 4 === 0) {
        const j = spawn();
        pMode[j] = 7;
        pCol[j] = pBleed[i] === 2 ? SLIME : BLOOD; pCol2[j] = pBleed[i] === 2 ? SLIME_D : BLOOD_D;
        pX[j] = pX[i]; pY[j] = pY[i]; pVX[j] = pVX[i] * 0.3; pVY[j] = 0;
        pLife[j] = pMax[j] = 200;
      }
      if (pY[i] > H) pMode[i] = 0;
    } else {
      // Blood drop: stains the first surface it reaches
      pVY[i] += 0.14;
      const prev = pY[i];
      pVX[i] *= 0.985;
      pX[i] += pVX[i]; pY[i] += pVY[i];
      if (pVY[i] > 0) {
        const xi = Math.round(pX[i]);
        const s = landY(xi, prev, pY[i]);
        if (s >= 0) {
          stain(xi, s, pCol2[i]);
          if (rnd() < 0.4) stain(xi + (pVX[i] > 0 ? 1 : -1), s, pCol2[i]);
          if (rnd() < 0.15) stain(xi, s, pCol[i]);
          pMode[i] = 0;
        }
      }
    }
    if (pLife[i] <= 0 || ((m < 5 || m === 8) && pY[i] >= FLOOR)) pMode[i] = 0;
  }

  // Projectiles
  for (let b = 0; b < BMAX; b++) {
    if (!bAct[b]) continue;
    const kind = bKind[b], p = bPow[b];
    if (kind === 1) {
      bVY[b] += 0.07;
      const s = Math.sqrt(bVX[b] * bVX[b] + bVY[b] * bVY[b]) || 1;
      bUX[b] = bVX[b] / s; bUY[b] = bVY[b] / s;
    }
    bX[b] += bVX[b]; bY[b] += bVY[b]; bT[b]++;
    if (kind === 0) {
      for (let n = 0; n <= p; n++) {
        const i = spawn();
        pMode[i] = 3;
        pX[i] = bX[b] - bUX[b] * 2 + (rnd() - 0.5) * (1 + p); pY[i] = bY[b] - bUY[b] * 2 + (rnd() - 0.5) * (1 + p);
        pVX[i] = -bUX[b] * (0.3 + rnd() * 0.5) + (rnd() - 0.5) * 0.4;
        pVY[i] = -bUY[b] * (0.3 + rnd() * 0.5) + (rnd() - 0.5) * 0.4;
        pLife[i] = pMax[i] = 10 + rnd() * 12;
      }
    } else if (kind === 2 && (bT[b] & 1)) {
      sparks(bX[b] - bUX[b] * 3, bY[b] - bUY[b] * 3, 1, -bUX[b] * 0.4, -bUY[b] * 0.4, 0.4);
    } else if (kind === 1 && p === 2 && (bT[b] % 3) === 0) {
      sparks(bX[b], bY[b], 1, -bUX[b] * 0.3, 0, 0.2);
    }
    // Surfaces: arrows stick, magic explodes, the beam bursts into sparks
    if (bY[b] >= FLOOR - 1) {
      if (kind === 1) stickArrow(b, bX[b], FLOOR); else { bY[b] = FLOOR - 1; boltExplode(b); }
      continue;
    }
    if (bX[b] < WALL_W || bX[b] > WORLD_W - WALL_W) {
      if (kind === 1) stickArrow(b, bX[b] < WALL_W ? WALL_W : WORLD_W - WALL_W, bY[b]); else boltExplode(b);
      continue;
    }
    if (bX[b] < camI - 60 || bX[b] > camI + W + 60 || bY[b] < (kind === 1 ? -400 : -16)) { bAct[b] = 0; continue; }
    if (kind === 2 && bT[b] > 50) { boltExplode(b); continue; }
    if (inPlatform(bX[b], bY[b])) {
      if (kind === 1) stickArrow(b, bX[b], bY[b]); else boltExplode(b);
      continue;
    }
    const br = kind === 0 ? B_R[p] : kind === 1 ? 1.5 : 4;
    const dmg = kind === 0 ? B_DMG[p] : kind === 1 ? A_DMG[p] : 3;
    for (let i = 0; i < EMAX; i++) {
      if (!eAct[i] || eInv[i]) continue;
      const cy = eType[i] === 2 ? eY[i] - 3 : eY[i];
      const dx = eX[i] - bX[b], dy = cy - bY[b], r = (eType[i] === 2 ? 5 : 4) + br;
      if (dx * dx + dy * dy > r * r) continue;
      eHP[i] -= dmg; eFlash[i] = 6; eInv[i] = 8;
      if (kind === 0) burst(bX[b], bY[b], 6, bUX[b] * 0.5, bUY[b] * 0.5, 1);
      else sparks(bX[b], bY[b], 4, bUX[b] * 0.5, bUY[b] * 0.5, 1);
      if (eHP[i] <= 0) { killEnemy(i, true, kind === 2 ? 2 : p, bUX[b], bUY[b], bKills[b]); bKills[b]++; }
      else {
        eVX[i] += bUX[b] * 0.8;
        if (eType[i] === 2) spray(eX[i], cy, 6, bUX[b] * 0.8, 0, 0.8, SLIME, SLIME_D);
        else spray(eX[i], cy, 5, bUX[b] * 0.8, 0, 0.8, BLOOD, BLOOD_D);
      }
      if (bPierce[b] <= 0) {
        if (kind === 1) bAct[b] = 0; else boltExplode(b);
        break;
      }
      bPierce[b]--;
    }
  }
  for (let k = 0; k < SAMAX; k++) if (saAct[k] && ++saT[k] > 900) saAct[k] = 0;

  // Enemies
  eAlive = 0;
  const diff = Math.min(0.4, score / 1500);
  for (let i = 0; i < EMAX; i++) {
    if (!eAct[i]) continue;
    eAlive++;
    eT[i]++;
    if (eFlash[i]) eFlash[i]--;
    if (eInv[i]) eInv[i]--;
    if (eType[i] === 1) {
      const ms = eVY[i];
      eVX[i] += (wx > eX[i] ? 1 : -1) * 0.012;
      if (eVX[i] > ms) eVX[i] = ms; else if (eVX[i] < -ms) eVX[i] = -ms;
      eBase[i] += ((fy - (dead ? 34 : 20)) - eBase[i]) * 0.004;
      eX[i] += eVX[i];
      eY[i] = eBase[i] + Math.sin(eT[i] * 0.07) * 6;
    } else {
      if (eY[i] >= FLOOR - 1 && eVY[i] >= 0) {
        eY[i] = FLOOR - 1; eVX[i] = 0;
        if (eT[i] % 70 === 0) {
          eDir[i] = wx > eX[i] ? 1 : -1;
          eVX[i] = eDir[i] * (0.8 + diff); eVY[i] = -1.7; eY[i] -= 0.1;
        }
      } else {
        eX[i] += eVX[i]; eVY[i] += 0.1; eY[i] += eVY[i];
        if (eY[i] >= FLOOR - 1) { eY[i] = FLOOR - 1; eVY[i] = 0; eVX[i] = 0; }
      }
    }
    if (eX[i] < wx - W * 1.5 || eX[i] > wx + W * 1.5) { eAct[i] = 0; continue; }
    if (playing && invuln === 0) {
      const cy = eType[i] === 2 ? eY[i] - 3 : eY[i];
      const dx = eX[i] - wx;
      if (dx > -7 && dx < 7 && cy > fy - 30 && cy < fy + 1) {
        hurt(eX[i]);
        if (eType[i] === 1) eVX[i] = -eVX[i];
      }
    }
  }

  // Corpses
  for (let k = 0; k < KMAX; k++) {
    if (!kAct[k]) continue;
    kT[k]++;
    if (!kLand[k]) {
      kVY[k] += kType[k] === 1 ? 0.1 : 0.12;
      kVX[k] *= 0.985;
      const prev = kY[k];
      kX[k] += kVX[k]; kY[k] += kVY[k];
      if (kType[k] === 1 && (kT[k] % 4) === 0) spray(kX[k], kY[k], 1, 0, 0, 0.3, BLOOD, BLOOD_D);
      if (kVY[k] > 0) {
        const s = landY(Math.round(kX[k]), prev, kY[k]);
        if (s >= 0) {
          kY[k] = s - 1; kLand[k] = 1; kT[k] = 0;
          if (kType[k] === 1) {
            splat(kX[k], s, 4, BLOOD, BLOOD_D);
            spray(kX[k], s - 2, 8, 0, -0.6, 1, BLOOD, BLOOD_D);
            gibs(kX[k], s - 2, 1, BAT_D, BAT_D, 1, 0.8);
          }
        }
      }
    } else if (kType[k] === 1) {
      if (kT[k] > 420) kAct[k] = 0;
    } else {
      if (kT[k] === 1) spray(kX[k], kY[k] - 3, 6, 0, -0.4, 0.8, SLIME, SLIME_D);
      if (kT[k] === 30) { splat(kX[k], Math.round(kY[k]) + 1, 6, SLIME, SLIME_D); kAct[k] = 0; }
    }
  }

  // Spawner
  if (playing && --spawnT <= 0) {
    const cap = Math.min(12, 4 + ((score / 80) | 0));
    if (eAlive < cap) spawnEnemy();
    spawnT = (Math.max(30, 110 - ((score / 6) | 0)) * (0.7 + rnd() * 0.6)) | 0;
  }

  // Popups
  for (let i = 0; i < UMAX; i++) {
    if (!uAct[i]) continue;
    uT[i]++; uY[i] -= 0.3;
    if (uT[i] > 45) uAct[i] = 0;
  }

  // Shake, flashes, ring
  if (shakeT > 0) {
    shakeT--;
    const a = shakeT > 4 ? shakeAmp : 1;
    shakeX = shakeT > 0 ? ((shakeT & 2) ? a : -a) : 0;
    shakeY = shakeT > 4 && shakeAmp > 1 ? ((shakeT & 4) ? 1 : -1) : 0;
    if (shakeT === 0) shakeAmp = 0;
  } else { shakeX = 0; shakeY = 0; }
  if (flashT > 0) flashT--;
  if (hurtT > 0) hurtT--;
  if (invuln > 0) invuln--;
  if (ringT >= 0) { ringT++; if (ringT > (ringBig ? 12 : 8)) ringT = -1; }
  cT++;
}

// ---------------------------------------------------------------------------
// Heroes (drawn procedurally into the sprite layer, facing right)
// ---------------------------------------------------------------------------
const HAT_W = [8, 7, 7, 6, 5, 4, 4, 3, 2, 1];

// Shared battle damage on cloth: returns -1 to cut the pixel away (ragged hem),
// otherwise the color, possibly slashed or bloodied. Armor dents instead of tearing.
function clothDamage(lx, r, lastRow, c, dmg, armor, edge) {
  if (dmg >= 1) {
    if (!armor && r === lastRow && ((lx * 13 + 40) % 5 === 0 || (lx * 7 + 40) % 6 === 0)) return -1;
    if (!armor && dmg >= 2 && r === lastRow - 1 && (lx * 11 + 40) % 4 === 0) return -1;
    if (r >= 9 && r <= 13 && lx === 4 - (r - 9)) return armor ? STEEL_D : INK;
    if (r >= 9 && r <= 13 && lx === 5 - (r - 9)) return armor ? STEEL_L : edge;
    if (((lx * 7 + r * 3 + 400) % 17) === 0) return BLOOD;
  }
  if (dmg >= 2) {
    if (r >= 10 && r <= 14 && lx === -5 + (r - 10)) return armor ? STEEL_D : INK;
    if (((lx * 5 + r * 7 + 400) % 9) === 0) return BLOOD;
  }
  if (dead && deathT > 8 && ((lx * 7 + r * 3 + 400) % 11) === 0) return BLOOD; // blood-soaked
  return c;
}

// Two legs from the hips to the floor, striding with the walk frame, with boots
function drawLegs(topR, c, cd, boot) {
  const yTop = sy0 + topR, yFoot = FLOOR - 2;
  const bx = dFeet === 1 ? -4 : dFeet === 2 ? -5 : -3;
  const fx = dFeet === 1 ? 3 : dFeet === 2 ? 0 : 1;
  sprLine(OX - 2, yTop, OX + bx, yFoot, 3, cd, cd);
  sprLine(OX, yTop, OX + fx, yFoot, 3, c, cd);
  for (let k = 0; k < 3; k++) { sp(OX + bx + k, FLOOR - 1, boot); sp(OX + fx + k, FLOOR - 1, boot); }
  sp(OX + fx, FLOOR - 2, boot); sp(OX + fx + 1, FLOOR - 2, boot);
}

function drawBodyWizard(dmg) {
  // Back shoe (walk stride)
  if (dFeet === 2) { sp(OX - 9, FLOOR - 1, WOOD_D); sp(OX - 8, FLOOR - 1, WOOD_D); sp(OX - 7, FLOOR - 1, WOOD_D); }
  // Robe: trapezoid scanlines, hem sways, two shades + light fold
  const rows = FLOOR - sy0;
  for (let r = 0; r < rows; r++) {
    const y = sy0 + r, t = r / (rows - 1);
    const hw = r === 0 ? 3 : r === 1 ? 4 : 4 + ((r * 3.6 / rows) | 0);
    const sh = Math.round(dSway * t * t * 1.6);
    const xl = OX - hw + sh, xr = OX + hw + sh + (r > 2 ? 1 : 0);
    const span = xr - xl, foldX = xl + Math.round(span * 0.55);
    for (let x = xl; x <= xr; x++) {
      const u = (x - xl) / span, lx = x - OX;
      let c = u < 0.3 ? ROBE_D : ROBE_M;
      if (r > 8 && u > 0.8) c = ROBE_L;
      if (r > 9 && x === foldX) c = ROBE_D;
      if (r > 12 && x === xl + 2) c = ROBE_D;
      if (r === 7) c = x === xl ? WOOD : (dmg >= 2 && lx % 3 === 0 ? ROBE_M : GOLD);
      if (r === rows - 2) c = GOLD;
      if (r === rows - 1) c = ROBE_D;
      if (dmg >= 2 && r >= rows - 5 && r <= rows - 4 && lx >= -1 && lx <= 1) c = r === rows - 5 ? INK : SKIN_SH; // hole, leg showing
      c = clothDamage(lx, r, rows - 1, c, dmg, false, ROBE_L);
      if (c < 0) continue;
      sp(x, y, c);
    }
  }
  // Belt tassel (torn off when badly hurt)
  if (dmg < 2) { sp(OX + 4, sy0 + 8, GOLD); sp(OX + 4, sy0 + 9, GOLD); sp(OX + 5, sy0 + 10, GOLD); }
  // Front shoe
  if (dFeet === 2) {
    sp(OX + 5, FLOOR - 1, WOOD_D); sp(OX + 6, FLOOR - 1, WOOD_D); sp(OX + 7, FLOOR - 1, WOOD_D); sp(OX + 8, FLOOR - 2, WOOD_D);
  } else {
    const s = dFeet === 1 ? 1 : 0;
    sp(OX + 7 + s, FLOOR - 1, WOOD_D); sp(OX + 8 + s, FLOOR - 1, WOOD_D); sp(OX + 9 + s, FLOOR - 1, WOOD_D);
    sp(OX + 10 + s, FLOOR - 2, WOOD_D);
  }
}

function drawBodyKnight(dmg) {
  const rows = FLOOR - sy0, legTop = Math.min(14, rows - 2);
  drawLegs(legTop, STEEL_M, STEEL_D, STEEL_D);
  for (let r = 0; r < legTop; r++) {
    const y = sy0 + r, armor = r < 10;
    const hw = r === 0 ? 4 : r < 3 ? 5 : r < 10 ? 4 : 5 + ((r - 10) >> 1);
    const sh = r >= 10 ? Math.round(dSway * (r - 9) / 5) : 0;
    const xl = OX - hw + sh, xr = OX + hw + sh, span = xr - xl;
    for (let x = xl; x <= xr; x++) {
      const u = (x - xl) / span, lx = x - OX;
      let c;
      if (armor) {
        c = u < 0.3 ? STEEL_D : (u > 0.55 && u < 0.75) ? STEEL_L : STEEL_M;
        if (r === 0) c = STEEL_L;
        if (r === 2 && (x === xl || x === xr)) c = STEEL_D; // pauldron edge
      } else {
        c = u < 0.3 ? BLUE_D : BLUE_M;
        if (r === legTop - 1) c = GOLD; // tabard hem trim
      }
      // Tabard panel with a gold cross over the breastplate
      if (r >= 3 && r < 10 && lx >= -1 && lx <= 2) {
        c = lx === -1 ? BLUE_D : BLUE_M;
        if ((lx === 1 && r >= 4 && r <= 8) || (r === 5 && lx >= 0 && lx <= 2)) c = GOLD;
      }
      if (r === 9) c = lx === 2 ? GOLD : WOOD_D; // belt and buckle
      c = clothDamage(lx, r, legTop - 1, c, dmg, armor, BLUE_M);
      if (c < 0) continue;
      sp(x, y, c);
    }
  }
}

function drawBodyArcher(dmg) {
  const rows = FLOOR - sy0, legTop = Math.min(13, rows - 2);
  // Quiver slung on the back, fletchings poking out
  for (let y = sy0 - 3; y <= sy0 + 8; y++) { sp(OX - 6, y, WOOD_D); sp(OX - 5, y, WOOD); }
  sp(OX - 7, sy0 - 5, RED); sp(OX - 6, sy0 - 6, WHITE); sp(OX - 5, sy0 - 5, RED); sp(OX - 6, sy0 - 4, WOOD);
  sp(OX - 4, sy0 - 5, WHITE);
  drawLegs(legTop, WOOD, WOOD_D, WOOD_D);
  for (let r = 0; r < legTop + 1; r++) {
    const y = sy0 + r;
    const hw = r === 0 ? 3 : r < 8 ? 4 : 4 + ((r - 7) >> 1);
    const sh = r >= 8 ? Math.round(dSway * (r - 7) / 6) : 0;
    const xl = OX - hw + sh, xr = OX + hw + sh + (r > 2 ? 1 : 0), span = xr - xl;
    for (let x = xl; x <= xr; x++) {
      const u = (x - xl) / span, lx = x - OX;
      if (r === legTop && ((lx + 40) & 1)) continue; // zig-zag hem
      let c = u < 0.3 ? FOREST_D : (u > 0.78 && r > 1) ? FOREST_L : FOREST_M;
      if (r === 7) c = lx === 2 ? GOLD : (dmg >= 2 && lx % 3 === 0 ? FOREST_M : WOOD); // belt and buckle
      c = clothDamage(lx, r, legTop, c, dmg, false, FOREST_L);
      if (c < 0) continue;
      sp(x, y, c);
    }
  }
  // Quiver strap across the chest
  sprLine(OX - 3, sy0, OX + 3, sy0 + 6, 0, WOOD_D, WOOD_D);
}

function drawHeadWizard(cx, dmg, bald) {
  for (let y = sy0 - 5; y <= sy0 - 1; y++) { sp(cx - 2, y, BEARD_SH); sp(cx - 1, y, BEARD); }
  for (let y = sy0 - 5; y <= sy0 - 2; y++) for (let x = cx; x <= cx + 3; x++) sp(x, y, SKIN);
  sp(cx, sy0 - 5, SKIN_SH); sp(cx + 1, sy0 - 5, SKIN_SH);
  sp(cx, sy0 - 3, SKIN_SH);                                    // ear
  sp(cx + 2, sy0 - 5, BEARD); sp(cx + 3, sy0 - 5, BEARD);      // brow
  sp(cx + 2, sy0 - 4, INK);                                    // eye
  sp(cx + 4, sy0 - 4, SKIN); sp(cx + 4, sy0 - 3, SKIN); sp(cx + 5, sy0 - 3, SKIN_SH); // nose
  if (dmg >= 1) sp(cx + 1, sy0 - 3, BLOOD);                    // cut cheek
  if (dmg >= 2) { sp(cx + 3, sy0 - 4, SKIN_SH); sp(cx + 1, sy0 - 2, BLOOD); } // swollen eye, bleeding
  if (bald) {
    // Bald head once the hat is gone, with a bloody gash
    for (let x = cx - 1; x <= cx + 3; x++) sp(x, sy0 - 6, x === cx - 1 ? BEARD_SH : SKIN);
    for (let x = cx; x <= cx + 2; x++) sp(x, sy0 - 7, SKIN);
    sp(cx + 1, sy0 - 6, BLOOD); sp(cx + 2, sy0 - 5, BLOOD);
    return;
  }
  // Hat: brim, band, cone that bends back, floppy tip (torn when hurt)
  const by = sy0 - 6;
  for (let x = cx - 4; x <= cx + 6; x++) sp(x, by, x <= cx - 2 ? ROBE_D : ROBE_M);
  sp(cx - 5, by + 1, ROBE_D);
  for (let x = cx - 3; x <= cx + 4; x++) sp(x, by - 1, x === cx - 3 ? WOOD : GOLD);
  let tipL = cx, tipY = by;
  const hatRows = dmg >= 1 ? HAT_W.length - 3 : HAT_W.length;
  for (let j = 0; j < hatRows; j++) {
    const y = by - 2 - j, w = HAT_W[j], q = j / (HAT_W.length - 1);
    const bend = Math.round(-j * j / 27 + dHat * q * q * 1.5);
    const L = cx - 3 + ((8 - w) >> 1) + bend, R = L + w - 1;
    const dark = L + ((w * 0.4) | 0);
    for (let x = L; x <= R; x++) {
      let c = x < dark ? ROBE_D : ROBE_M;
      if (x === R && w > 2) c = ROBE_L;
      sp(x, y, c);
    }
    if (j === 3) sp(L + (w >> 1), y, dmg >= 1 ? INK : GOLD); // star torn out
    if (dmg >= 1 && j === 1) sp(L + 1, y, INK);                  // rip
    tipL = L; tipY = y;
  }
  if (dmg >= 1) {
    sp(tipL, tipY - 1, ROBE_D); sp(tipL + 2, tipY - 1, ROBE_M); sp(tipL + 3, tipY - 2, ROBE_D);
  } else {
    const flop = dHat < -1 ? 0 : 1;
    sp(tipL - 1, tipY, ROBE_M);
    sp(tipL - 2, tipY + flop, ROBE_D);
    sp(tipL - 3, tipY + 1 + flop, ROBE_D);
  }
}

function drawHeadKnight(cx, dmg, bald) {
  if (!bald) {
    // Great helm with a visor slit, breathing holes and a red plume
    for (let y = sy0 - 8; y <= sy0 - 1; y++) {
      for (let x = cx - 2; x <= cx + 4; x++) {
        if (y === sy0 - 8 && (x === cx - 2 || x === cx + 4)) continue;
        let c = x === cx - 2 ? STEEL_D : x === cx + 2 ? STEEL_L : STEEL_M;
        if (y === sy0 - 5 && x >= cx + 1) c = INK;
        if ((y === sy0 - 3 && x === cx + 3) || (y === sy0 - 2 && x === cx + 2)) c = INK;
        if (dmg >= 1 && ((y === sy0 - 7 && x === cx) || (y === sy0 - 6 && x === cx + 1))) c = STEEL_D; // dents
        if (dmg >= 1 && y === sy0 - 4 && x === cx + 3) c = BLOOD;
        sp(x, y, c);
      }
    }
    const pl = Math.round(dHat * 0.8);
    sp(cx + 1, sy0 - 9, RED); sp(cx, sy0 - 9, RED); sp(cx - 1, sy0 - 10, ROBE_L);
    if (dmg < 1) {
      sp(cx - 2, sy0 - 10, RED); sp(cx - 3, sy0 - 9 + (pl < 0 ? 0 : 0), RED);
      sp(cx - 4, sy0 - 8 - (pl < -1 ? 1 : 0), ROBE_L); sp(cx - 5, sy0 - 7 - (pl < -1 ? 1 : 0), RED);
    } else {
      sp(cx - 2, sy0 - 9, INK); // plume sheared off
    }
    return;
  }
  // Helmet knocked off: short brown hair, stubble, a bleeding gash
  for (let y = sy0 - 6; y <= sy0 - 2; y++) for (let x = cx; x <= cx + 3; x++) sp(x, y, SKIN);
  for (let x = cx - 1; x <= cx + 3; x++) { sp(x, sy0 - 8, WOOD); sp(x, sy0 - 7, x === cx + 3 ? SKIN : WOOD); }
  for (let y = sy0 - 7; y <= sy0 - 3; y++) { sp(cx - 2, y, WOOD_D); sp(cx - 1, y, WOOD); }
  sp(cx + 2, sy0 - 5, WOOD_D); sp(cx + 3, sy0 - 5, WOOD_D); // brow
  sp(cx + 2, sy0 - 4, INK);                                 // eye
  sp(cx + 4, sy0 - 4, SKIN); sp(cx + 4, sy0 - 3, SKIN_SH);  // nose
  sp(cx + 1, sy0 - 2, SKIN_SH); sp(cx + 2, sy0 - 2, SKIN_SH); sp(cx + 3, sy0 - 2, SKIN_SH); // stubble
  sp(cx + 1, sy0 - 7, BLOOD); sp(cx + 1, sy0 - 6, BLOOD); sp(cx + 3, sy0 - 3, BLOOD);
  for (let x = cx - 1; x <= cx + 3; x++) sp(x, sy0 - 1, STEEL_M); // gorget
}

function drawHeadArcher(cx, dmg, bald) {
  // Face, blonde ponytail swinging behind
  for (let y = sy0 - 5; y <= sy0 - 2; y++) for (let x = cx; x <= cx + 3; x++) sp(x, y, SKIN);
  for (let x = cx + 1; x <= cx + 3; x++) sp(x, sy0 - 1, SKIN_SH);
  for (let y = sy0 - 6; y <= sy0 - 2; y++) { sp(cx - 2, y, WOOD); sp(cx - 1, y, GOLD); }
  const pt = Math.round(dBeard);
  sp(cx - 3, sy0 - 4, GOLD); sp(cx - 4 + (pt > 0 ? 1 : 0), sy0 - 3, GOLD); sp(cx - 4 + pt, sy0 - 2, WOOD); sp(cx - 5 + pt, sy0 - 1, GOLD);
  sp(cx + 2, sy0 - 5, WOOD); sp(cx + 3, sy0 - 5, WOOD);   // brow
  sp(cx + 2, sy0 - 4, INK);                               // eye
  sp(cx + 4, sy0 - 3, SKIN_SH);                           // nose
  if (dmg >= 1) sp(cx + 1, sy0 - 3, BLOOD);
  if (dmg >= 2) { sp(cx + 3, sy0 - 4, SKIN_SH); sp(cx + 2, sy0 - 2, BLOOD); }
  if (bald) {
    // Cap gone: messy blonde hair and a gash
    for (let x = cx - 1; x <= cx + 3; x++) { sp(x, sy0 - 6, x & 1 ? WOOD : GOLD); sp(x, sy0 - 7, GOLD); }
    sp(cx + 4, sy0 - 6, GOLD);
    sp(cx + 1, sy0 - 7, BLOOD); sp(cx + 2, sy0 - 6, BLOOD);
    return;
  }
  // Feathered cap, pointing back
  for (let x = cx - 2; x <= cx + 5; x++) sp(x, sy0 - 6, FOREST_D);
  for (let x = cx - 2; x <= cx + 3; x++) sp(x, sy0 - 7, x > cx + 1 ? FOREST_L : FOREST_M);
  for (let x = cx - 3; x <= cx + 1; x++) sp(x, sy0 - 8, x === cx + 1 ? FOREST_L : FOREST_M);
  for (let x = cx - 5; x <= cx - 1; x++) sp(x, sy0 - 9, FOREST_M);
  sp(cx - 6, sy0 - 10 + (dHat < -1 ? 0 : 1), FOREST_D); sp(cx - 7, sy0 - 10 + (dHat < -1 ? 0 : 1), FOREST_D);
  if (dmg >= 1) { sp(cx - 1, sy0 - 8, INK); sp(cx + 2, sy0 - 9, RED); } // hole, snapped feather
  else { sp(cx + 2, sy0 - 8, RED); sp(cx + 2, sy0 - 9, RED); sp(cx + 1, sy0 - 10, RED); sp(cx, sy0 - 11, ROBE_L); }
}

function drawWeapon() {
  const dx = dSin, dy = -dCos, qx = dCos, qy = dSin; // along the weapon, and perpendicular
  if (hero === WIZARD) {
    sprLine(stBotX, stBotY, stTopX, stTopY, 0, WOOD, WOOD_D);
    for (let s = -1; s <= 1; s += 2) {
      sp(Math.round(dHX + dx * 15 + qx * 2 * s), Math.round(dHY + dy * 15 + qy * 2 * s), WOOD_D);
      sp(Math.round(dHX + dx * 16 + qx * 2 * s), Math.round(dHY + dy * 16 + qy * 2 * s), WOOD);
    }
  } else if (hero === KNIGHT) {
    const full = cstate === C_CHARGE && chargeT >= CHARGE_FULL;
    const bl = full && (animFrame & 1) ? WHITE : STEEL_L;
    sprLine(Math.round(dHX + dx * 2), Math.round(dHY + dy * 2), gemX, gemY, 0, bl, bl);
    sprLine(Math.round(dHX + dx * 3 + qx), Math.round(dHY + dy * 3 + qy),
            Math.round(dHX + dx * 13 + qx), Math.round(dHY + dy * 13 + qy), 0, STEEL_M, STEEL_M);
    for (let s = -2; s <= 2; s++) if (s) sp(Math.round(dHX + dx + qx * s), Math.round(dHY + dy + qy * s), GOLD); // crossguard
    sp(Math.round(dHX - dx), Math.round(dHY - dy), WOOD_D);          // grip
    sp(Math.round(dHX - dx * 2), Math.round(dHY - dy * 2), GOLD);    // pommel
  } else {
    // Bow: a curve through the hand, string pulled back to the nock
    const nock = -dDraw * 6;
    let lx = 0, ly = 0;
    for (let k = 0; k <= 6; k++) {
      const t = k / 3 - 1, bend = 2 * (1 - t * t);
      const x = Math.round(dHX + qx * t * 7 + dx * bend), y = Math.round(dHY + qy * t * 7 + dy * bend);
      if (k > 0) sprLine(lx, ly, x, y, 0, k === 3 || k === 4 ? WOOD_D : WOOD, WOOD);
      lx = x; ly = y;
    }
    const t1x = Math.round(dHX - qx * 7), t1y = Math.round(dHY - qy * 7);
    const t2x = Math.round(dHX + qx * 7), t2y = Math.round(dHY + qy * 7);
    const nx = Math.round(dHX + dx * nock), ny = Math.round(dHY + dy * nock);
    sprLine(t1x, t1y, nx, ny, 0, BEARD_SH, BEARD_SH);
    sprLine(nx, ny, t2x, t2y, 0, BEARD_SH, BEARD_SH);
    if (cstate === C_CHARGE || (game === G_TITLE && dDraw > 0)) {
      // Nocked arrow and the drawing hand
      sprLine(Math.round(nx + dx), Math.round(ny + dy), Math.round(nx + dx * 11), Math.round(ny + dy * 11), 0, WOOD, WOOD);
      sp(gemX, gemY, STEEL_L); sp(Math.round(nx + dx * 11.5), Math.round(ny + dy * 11.5), STEEL_M);
      sp(Math.round(nx + dx * 2 + qx), Math.round(ny + dy * 2 + qy), RED);
      sp(Math.round(nx + dx * 2 - qx), Math.round(ny + dy * 2 - qy), RED);
      sp(nx, ny, SKIN);
    }
  }
}

function drawHero() {
  for (let y = 0; y < H; y++) spr.fill(EMPTY, y * W + OX - 34, y * W + OX + 38);
  const cx = OX + dTilt;
  const dmg = damageLevel(), bald = dead || hatOff;

  if (hero === WIZARD) drawBodyWizard(dmg);
  else if (hero === KNIGHT) drawBodyKnight(dmg);
  else drawBodyArcher(dmg);

  if (hero === WIZARD) drawHeadWizard(cx, dmg, bald);
  else if (hero === KNIGHT) drawHeadKnight(cx, dmg, bald);
  else drawHeadArcher(cx, dmg, bald);

  if (!dead) drawWeapon();

  // Sleeve from shoulder to wrist
  const sM = hero === KNIGHT ? STEEL_M : hero === ARCHER ? FOREST_M : ROBE_M;
  const sD = hero === KNIGHT ? STEEL_D : hero === ARCHER ? FOREST_D : ROBE_D;
  const shX = OX + 2, shY = sy0 + 1;
  const ux = shX - dHX, uy = shY - dHY, len = Math.sqrt(ux * ux + uy * uy) || 1;
  const wxr = Math.round(dHX + ux / len * 2), wyr = Math.round(dHY + uy / len * 2);
  sprLine(shX, shY, wxr, wyr, 1, sM, sD);
  if (dmg >= 2 && hero !== KNIGHT) {
    // Sleeve torn away: bare forearm, frayed edge
    for (let k = 0; k <= 3; k++) {
      const ax = Math.round(dHX + ux / len * k), ay = Math.round(dHY + uy / len * k);
      sp(ax, ay, k === 3 ? sD : SKIN); sp(ax, ay + 1, k === 3 ? sD : SKIN_SH);
    }
  } else {
    const cuff = hero === KNIGHT ? STEEL_L : hero === ARCHER ? WOOD : ROBE_L;
    sp(wxr, wyr, cuff); sp(wxr + 1, wyr, cuff);
  }

  // Wizard's beard over the chest, swaying at the tip (singed and short when hurt)
  if (hero === WIZARD) {
    const beardLen = dmg >= 2 ? 9 : 12;
    for (let k = 0; k < beardLen; k++) {
      const y = sy0 - 2 + k, q = k / 11;
      const o = Math.round(dBeard * q * q * 2) - Math.round(dTilt * q);
      let L = cx - 1 + ((k * 0.35) | 0) + o, R = cx + 4 - ((k * 0.2) | 0) + o;
      if (k === 0) { L = cx + 1; R = cx + 5; }
      for (let x = L; x <= R; x++) {
        let c = x === L ? BEARD_SH : BEARD;
        if (k > 2 && x === L + 2 && (k & 1)) c = BEARD_SH;
        if (k === 0 && x === R) c = BEARD_SH;
        if (dmg >= 2 && k === beardLen - 1) c = (x & 1) ? INK : BEARD_SH;
        if (dead && deathT > 4 && k < 6 && ((x + k) % 3) === 0) c = BLOOD;
        sp(x, y, c);
      }
    }
  }

  // Hand gripping the weapon (a steel gauntlet for the knight)
  const h1 = hero === KNIGHT ? STEEL_L : SKIN, h2 = hero === KNIGHT ? STEEL_M : SKIN_SH;
  sp(dHX - 1, dHY, h1); sp(dHX, dHY, h1);
  sp(dHX - 1, dHY + 1, h2); sp(dHX, dHY + 1, h1);
}

// Composite the sprite into the frame at a world position: auto outline + 1px rim
// light facing the gem (wizard only), computed in local space and mirrored by facing.
function composeSprite(worldX, rpy, f, blink) {
  if (blink && invuln > 0 && (animFrame & 1)) return; // hurt blink
  const gx = gemX, gy = gemY;
  const R = 6 + dGlow * 20, R2 = dGlow > 0.05 ? R * R : 0;
  const rwx = Math.round(worldX) - camI;
  for (let y = 0; y < H; y++) {
    const row = y * W, wy = y - rpy;
    if (wy < 0 || wy >= H) continue;
    for (let x = OX - 32; x < OX + 36; x++) {
      const i = row + x, c = spr[i];
      const sx = rwx + f * (x - OX);
      if (sx < 0 || sx >= W) continue;
      if (c === EMPTY) {
        if (spr[i - 1] !== EMPTY || spr[i + 1] !== EMPTY ||
            (y > 0 && spr[i - W] !== EMPTY) || (y < H - 1 && spr[i + W] !== EMPTY)) fb[wy * W + sx] = INK;
        continue;
      }
      let o = c;
      const dx = gx - x, dy = gy - y, d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
        let lit = false;
        if (adx > 0 && adx * 2 >= ady && spr[i + (dx > 0 ? 1 : -1)] === EMPTY) lit = true;
        if (!lit && ady > 0 && ady * 2 >= adx) {
          const ny = y + (dy > 0 ? 1 : -1);
          if (ny < 0 || ny >= H || spr[i + (dy > 0 ? W : -W)] === EMPTY) lit = true;
        }
        if (lit && (c !== WOOD && c !== WOOD_D || d2 < 30)) {
          const lv = dGlow * (1 - Math.sqrt(d2) / R);
          if (lv > 0.55) o = MAGIC_P; else if (lv > 0.28) o = MAGIC_C; else if (lv > 0.07) o = MAGIC_B;
        }
      }
      fb[wy * W + sx] = o;
    }
  }
}

// Dead hero: outline into tmp, then draw rotated around the back heel
function composeFallen() {
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = OX - 32; x < OX + 36; x++) {
      const i = row + x, c = spr[i];
      if (c !== EMPTY) { tmp[i] = c; continue; }
      tmp[i] = (spr[i - 1] !== EMPTY || spr[i + 1] !== EMPTY ||
                (y > 0 && spr[i - W] !== EMPTY) || (y < H - 1 && spr[i + W] !== EMPTY)) ? INK : EMPTY;
    }
  }
  const PXL = OX - 6, PYL = FLOOR - 1, f = dFacing;
  const pX0 = Math.round(wx) - camI + f * (PXL - OX), pY0 = PYL - Math.round(py);
  const c = Math.cos(dFall), s = Math.sin(dFall);
  for (let dy = -46; dy <= 1; dy++) {
    const Y = pY0 + dy;
    if (Y < 0 || Y >= H) continue;
    for (let dx = -46; dx <= 46; dx++) {
      const X = pX0 + dx;
      if (X < 0 || X >= W) continue;
      const up = dx * f;
      const lx = Math.round(PXL + up * c - dy * s), ly = Math.round(PYL + up * s + dy * c);
      if (lx < OX - 32 || lx >= OX + 36 || ly < 0 || ly >= H) continue;
      const t = tmp[ly * W + lx];
      if (t !== EMPTY) fb[Y * W + X] = t;
    }
  }
}

function drawProps() {
  if (hatOff) {
    // Knocked-off headgear, tumbling while airborne
    const hx = Math.round(hatX) - camI, hy = Math.round(hatY), hw = HG_W[hero], hh = HG_H[hero];
    if (hatLand || ((hatT >> 3) & 1)) drawSprite(HG_SIDE[hero], hh, hw, hx - (hh >> 1), hy - hw + 1, hatX < wx, false, false);
    else drawSprite(HG_UP[hero], hw, hh, hx - (hw >> 1), hy - hh + 1, hatX < wx, false, false);
  }
  if (!dead) return;
  // Dropped weapon, toppling or lying
  const len = hero === WIZARD ? 30 : 16;
  const bx = Math.round(stBX) - camI, by = Math.round(stBY);
  const tx = Math.round(stBX + Math.sin(stA) * len) - camI, ty = Math.round(stBY - Math.cos(stA) * len);
  fbLine(bx - 1, by, tx - 1, ty, INK, INK); fbLine(bx + 1, by, tx + 1, ty, INK, INK);
  fbLine(bx, by - 1, tx, ty - 1, INK, INK); fbLine(bx, by + 1, tx, ty + 1, INK, INK);
  if (hero === WIZARD) {
    fbLine(bx, by, tx, ty, WOOD, WOOD_D);
    px(tx, ty, gemBroken ? MAGIC_V : MAGIC_C);
  } else if (hero === KNIGHT) {
    fbLine(bx, by, tx, ty, STEEL_L, STEEL_M);
    const gx = Math.round(stBX + Math.sin(stA) * 3) - camI, gy = Math.round(stBY - Math.cos(stA) * 3);
    px(gx, gy, GOLD); px(gx + (stA > 0 ? 1 : -1), gy - 1, GOLD); px(bx, by, GOLD);
  } else {
    fbLine(bx, by, tx, ty, WOOD, WOOD_D);
    fbLine(bx, by - 2, tx, ty - 2, BEARD_SH, BEARD_SH); // slack string
  }
  // Ghost drifting up from the body
  if (deathT > 70 && deathT < 260) {
    const t = deathT - 70, alpha = 1 - t / 190;
    const gx = Math.round(wx - dFacing * 18 + Math.sin(deathT * 0.08) * 3) - camI;
    const gy = Math.round(fy - 20 - t * 0.35);
    for (let y = 0; y < GHOST_H; y++) {
      for (let x = 0; x < GHOST_W; x++) {
        const v = GHOST[y * GHOST_W + (dFacing < 0 ? GHOST_W - 1 - x : x)];
        const X = gx + x - 3, Y = gy + y;
        if (!v || X < 0 || X >= W || Y < 0 || Y >= H) continue;
        if (alpha > BAYER[(Y & 3) * 4 + (X & 3)]) fb[Y * W + X] = v - 1;
      }
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

function drawParallax() {
  const farOff = Math.round(camX * 0.2), nearOff = Math.round(camX * 0.45);
  for (let x = 0; x < W; x++) {
    const ft = FAR[(x + farOff) & 2047];
    for (let y = ft; y < FLOOR; y++) fb[y * W + x] = y === ft ? SKY3 : SKY2;
    const nt = NEAR[(x + nearOff) & 2047];
    for (let y = nt; y < FLOOR; y++) fb[y * W + x] = y === nt ? SKY2 : SKY1;
  }
  // Lit tower windows, flickering slowly
  for (let t = 0; t < nWin; t++) {
    const x = winU[t] - nearOff;
    if (x >= 0 && x < W) {
      px(x, winY[t], ((animFrame + t * 3) % 11) === 0 ? ROBE_L : GOLD);
      px(x, winY[t] + 1, WOOD);
    }
  }
}

function drawGround() {
  for (let y = 0; y < GH; y++) {
    const src = y * WORLD_W + camI, dst = (FLOOR + y) * W;
    for (let x = 0; x < W; x++) fb[dst + x] = ground[src + x];
  }
}

function drawDecals() {
  for (let y = 0; y < H; y++) {
    const src = y * WORLD_W + camI, dst = y * W;
    for (let x = 0; x < W; x++) { const v = decal[src + x]; if (v) fb[dst + x] = v - 1; }
  }
}

// Background ruins: broken columns and the two end walls
function drawRuins() {
  for (let n = 0; n < NCOL; n++) {
    const x0 = COLX[n] - camI, top = FLOOR - COLH[n];
    if (x0 > W || x0 + COL_W + 2 < 0) continue;
    for (let dx = -1; dx <= COL_W; dx++) {
      px(x0 + dx, FLOOR - 1, STONE_M); px(x0 + dx, FLOOR - 2, STONE_D);
    }
    for (let dx = 0; dx < COL_W; dx++) {
      const jag = top + ((dx * 7 + n * 3) % 5);
      for (let y = jag; y < FLOOR - 2; y++) {
        let c = dx === 0 ? STONE_M : dx === COL_W - 1 ? SKY1 : (dx === 3 || dx === 7) ? SKY2 : STONE_D;
        if (y === jag) c = STONE_M;
        px(x0 + dx, y, c);
      }
    }
  }
  for (let side = 0; side < 2; side++) {
    const wx0 = side === 0 ? 0 : WORLD_W - WALL_W;
    const x0 = wx0 - camI;
    if (x0 > W || x0 + WALL_W < 0) continue;
    for (let y = 0; y < FLOOR; y++) {
      for (let dx = 0; dx < WALL_W; dx++) {
        const brick = (y % 6) === 0 || ((dx + wx0 + (((y / 6) | 0) & 1) * 3) % 6) === 0;
        let c = brick ? STONE_D : STONE_M;
        if ((side === 0 && dx === WALL_W - 1) || (side === 1 && dx === 0)) c = INK;
        else if ((side === 0 && dx === WALL_W - 2) || (side === 1 && dx === 1)) c = STONE_L;
        px(x0 + dx, y, c);
      }
    }
  }
}

function drawPlatforms() {
  for (let p = 0; p < NPLAT; p++) {
    const x0 = PLX[p] - camI, y0 = PLY[p], w = PLW[p];
    if (x0 > W || x0 + w < 0) continue;
    rect(x0 - 1, y0 - 1, w + 2, 6, INK);
    for (let dx = 0; dx < w; dx++) {
      px(x0 + dx, y0, STONE_L);
      const seam1 = ((dx + p * 3) % 8) === 0, seam2 = ((dx + p * 3 + 4) % 8) === 0;
      px(x0 + dx, y0 + 1, seam1 ? STONE_D : dx === 0 ? STONE_L : STONE_M);
      px(x0 + dx, y0 + 2, seam2 ? STONE_D : STONE_M);
      px(x0 + dx, y0 + 3, STONE_D);
      if ((dx + p) % 7 === 3) { px(x0 + dx, y0 + 4, STONE_D); px(x0 + dx, y0 + 5, INK); }
    }
  }
}

function drawStuckArrows() {
  for (let k = 0; k < SAMAX; k++) {
    if (!saAct[k] || (saT[k] > 840 && (saT[k] & 4))) continue;
    const ux = saUX[k], uy = saUY[k], qx = -uy, qy = ux;
    for (let j = 1; j <= 7; j++) {
      const x = Math.round(saX[k] - ux * j), y = Math.round(saY[k] - uy * j);
      if (j >= 6) { wpx(Math.round(x + qx), Math.round(y + qy), RED); wpx(Math.round(x - qx), Math.round(y - qy), RED); }
      wpx(x, y, j >= 6 ? WHITE : WOOD);
    }
  }
}

function drawFloorLight() {
  if (dead || hero !== WIZARD) return;
  const gx = gemWX - camI;
  const R = 10 + dGlow * 16;
  const x0 = Math.max(0, Math.floor(gx - R)), x1 = Math.min(W - 1, Math.ceil(gx + R));
  const reach = 1 - (FLOOR - gemWY - 20) / 40; // weaker when the gem is high above the floor
  if (reach > 0) {
    for (let y = FLOOR; y < FLOOR + 8; y++) {
      const fyk = (1 - (y - FLOOR) / 8) * (reach > 1 ? 1 : reach);
      for (let x = x0; x <= x1; x++) {
        const dx = x - gx < 0 ? gx - x : x - gx;
        const lv = dGlow * 0.85 * (1 - dx / R) * fyk;
        if (lv > BAYER[(y & 3) * 4 + (x & 3)]) { const i = y * W + x; fb[i] = LIT[fb[i]]; }
      }
    }
  }
}

function drawShadow(worldX, feetY) {
  const sy = supportBelow(worldX, feetY), h = sy - feetY;
  const rwx = Math.round(worldX) - camI, sw = Math.max(3, 9 - ((h / 3) | 0));
  for (let x = rwx - sw; x <= rwx + sw; x++) px(x, sy, STONE_D);
  for (let x = rwx - sw + 2; x <= rwx + sw - 2; x++) if ((x & 1) === 0) px(x, sy + 1, STONE_D);
}

function drawHalo() {
  if (dead || hero !== WIZARD) return;
  const R = 3 + dGlow * 3.5, Ri = Math.ceil(R);
  for (let dy = -Ri; dy <= Ri; dy++) {
    for (let dx = -Ri; dx <= Ri; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > R) continue;
      const x = gemWX + dx - camI, y = gemWY + dy;
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
    const f = 1 - pLife[i] / pMax[i];
    const x = Math.round(pX[i]), y = Math.round(pY[i]);
    if (m === 5) { wpx(x, y, f < 0.7 ? pCol[i] : INK); continue; }
    if (m === 6) {
      if (pLife[i] < 60 && (pLife[i] & 4)) continue; // blink out
      wpx(x - 1, y - 1, INK); wpx(x + 2, y - 1, INK); wpx(x - 1, y, INK); wpx(x + 2, y, INK);
      wpx(x, y - 2, INK); wpx(x + 1, y - 2, INK);
      wpx(x, y - 1, pCol[i]); wpx(x + 1, y - 1, pCol[i]); wpx(x, y, pCol2[i]); wpx(x + 1, y, pCol2[i]);
      continue;
    }
    if (m === 7) {
      wpx(x, y, pCol[i]);
      if (pVY[i] > 1.2) wpx(x, y - 1, pCol2[i]);
      continue;
    }
    let ci = (f * RAMPN) | 0;
    if (ci < 0) ci = 0; else if (ci >= RAMPN) ci = RAMPN - 1;
    const ramp = m === 8 ? RAMP_GOLD : RAMP;
    wpx(x, y, ramp[ci]);
    if ((m === 2 || m === 8) && ci < 3) wpx(Math.round(pX[i] - pVX[i]), Math.round(pY[i] - pVY[i]), ramp[ci + 1]);
  }
}

function drawGem() {
  if (dead || hero !== WIZARD) return;
  const x = gemWX, y = gemWY;
  let core, hi, lo;
  if (cstate === C_CAST && cT >= FIRE_AT && cT < FIRE_AT + 10) { core = WHITE; hi = WHITE; lo = MAGIC_P; }
  else if (cstate === C_CHARGE) {
    core = gemFlick < 0.5 ? WHITE : MAGIC_P;
    hi = gemFlick < 0.3 ? MAGIC_P : MAGIC_C;
    lo = gemFlick < 0.7 ? MAGIC_B : MAGIC_V;
  } else { core = (animFrame & 7) < 6 ? MAGIC_P : WHITE; hi = MAGIC_C; lo = MAGIC_B; }

  wpx(x, y - 2, INK); wpx(x, y + 2, INK); wpx(x - 2, y, INK); wpx(x + 2, y, INK);
  wpx(x - 1, y - 1, INK); wpx(x + 1, y - 1, INK); wpx(x - 1, y + 1, INK); wpx(x + 1, y + 1, INK);
  wpx(x, y, core); wpx(x, y - 1, hi); wpx(x + dFacing, y, hi); wpx(x - dFacing, y, lo); wpx(x, y + 1, lo);

  // Gleam spikes: pulsing at full charge
  const charged = (cstate === C_CHARGE && chargeT >= CHARGE_FULL) || (cstate === C_CAST && cT < FIRE_AT + 8 && castPow === 2);
  const mid = cstate === C_CHARGE && chargeT >= CHARGE_MED && chargeT < CHARGE_FULL;
  if (charged) {
    if (animFrame & 1) {
      wpx(x, y - 3, MAGIC_P); wpx(x, y - 4, MAGIC_C); wpx(x, y + 3, MAGIC_P); wpx(x, y + 4, MAGIC_C);
      wpx(x - 3, y, MAGIC_P); wpx(x - 4, y, MAGIC_C); wpx(x + 3, y, MAGIC_P); wpx(x + 4, y, MAGIC_C);
    } else {
      wpx(x - 2, y - 2, MAGIC_C); wpx(x + 2, y - 2, MAGIC_C); wpx(x - 2, y + 2, MAGIC_C); wpx(x + 2, y + 2, MAGIC_C);
    }
  } else if (mid && (animFrame & 2)) {
    wpx(x, y - 3, MAGIC_C); wpx(x, y + 3, MAGIC_C); wpx(x - 3, y, MAGIC_C); wpx(x + 3, y, MAGIC_C);
  }
}

// Aim preview while charging: a straight line (wizard), the arrow's arc (archer),
// or the slash's reach (knight). Marching dots, colored by charge level.
function drawAimGuide() {
  if (cstate !== C_CHARGE || game !== G_PLAY) return;
  const ck = Math.min(1, chargeT / CHARGE_FULL);
  const c = chargeT >= CHARGE_FULL ? (hero === WIZARD ? MAGIC_P : GOLD) : chargeT >= CHARGE_MED ? (hero === WIZARD ? MAGIC_C : ROBE_L) : (hero === WIZARD ? MAGIC_B : BEARD_SH);
  const phase = (globalT >> 2) & 3;
  if (hero === WIZARD) {
    const len = 50 + ck * 60;
    for (let d = 5; d < len; d++) {
      if (((d + 4 - phase) & 3) !== 0) continue;
      const x = Math.round(gemWX + aimDX * d), y = Math.round(gemWY + aimDY * d);
      if (y >= FLOOR) break;
      wpx(x, y, d > len - 14 ? MAGIC_V : c);
    }
  } else if (hero === ARCHER) {
    const s = arrowSpeed(ck);
    let x = handWX + aimDX * 3, y = handWY + aimDY * 3, vx0 = aimDX * s, vy0 = aimDY * s;
    for (let n = 0; n < 110; n++) {
      vy0 += 0.07; x += vx0; y += vy0;
      if (y >= FLOOR || x < WALL_W || x > WORLD_W - WALL_W || inPlatform(x, y)) break;
      if (((n + 4 - phase) & 3) === 0 && n > 1) wpx(Math.round(x), Math.round(y), n > 80 ? BEARD_SH : c);
    }
  } else {
    const reach = chargeT >= CHARGE_FULL ? 25 : chargeT >= CHARGE_MED ? 22 : 18;
    const sx = wx + facing * 2, sy = fy - 18, a = Math.atan2(aimDY, aimDX);
    for (let k = -8; k <= 8; k++) {
      if (((k + 16 - phase) & 1) !== 0) continue;
      const t = a + k * 0.14;
      wpx(Math.round(sx + Math.cos(t) * reach), Math.round(sy + Math.sin(t) * reach), c);
    }
    if (chargeT >= CHARGE_FULL) { // beam path hint
      for (let d = reach + 6; d < reach + 50; d += 4) wpx(Math.round(sx + aimDX * d), Math.round(sy + aimDY * d), (d >> 2) & 1 ? GOLD : ROBE_L);
    }
  }
}

// Knight's sword arc: sweeps over a few frames and fades behind its leading edge
function drawSlash() {
  if (slT < 0) return;
  const a0 = slA - 1.25 * slF, a1 = slA + 0.95 * slF;
  const prog = Math.min(1, (slT + 1) / 4);
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    if (t > prog) break;
    const age = (prog - t) + slT * 0.09;
    let c;
    if (age < 0.15) c = WHITE;
    else if (age < 0.4) c = slP === 2 ? GOLD : STEEL_L;
    else if (age < 0.7) c = slP === 2 ? ROBE_L : STEEL_M;
    else continue;
    const a = a0 + (a1 - a0) * t, ca = Math.cos(a), sa = Math.sin(a);
    const thick = 1 + Math.round(Math.sin(t * Math.PI) * (2 + slP));
    for (let r = slR - thick; r <= slR; r++) wpx(Math.round(slX + ca * r), Math.round(slY + sa * r), c);
  }
}

function drawRing() {
  if (ringT < 0) return;
  const r = 2 + ringT * (ringBig ? 1.4 : 0.8);
  const c = ringGold
    ? (ringT < 3 ? WHITE : ringT < 6 ? GOLD : ringT < 9 ? ROBE_L : WOOD)
    : (ringT < 3 ? WHITE : ringT < 6 ? MAGIC_P : ringT < 9 ? MAGIC_C : MAGIC_B);
  const n = 48;
  for (let i = 0; i < n; i++) {
    if (ringT > 6 && ((i + ringT) & 1)) continue;
    const a = i * 6.2832 / n;
    wpx(ringX + Math.round(Math.cos(a) * r), ringY + Math.round(Math.sin(a) * r), c);
  }
}

function drawBolts() {
  for (let b = 0; b < BMAX; b++) {
    if (!bAct[b]) continue;
    const p = bPow[b], ux = bUX[b], uy = bUY[b], kind = bKind[b];
    const x = Math.round(bX[b]), y = Math.round(bY[b]);
    if (kind === 1) {
      // Arrow: steel head, wooden shaft, red fletching
      const qx = -uy, qy = ux;
      for (let j = 0; j <= 7; j++) {
        const ax = Math.round(bX[b] - ux * j), ay = Math.round(bY[b] - uy * j);
        if (j >= 6) { wpx(Math.round(ax + qx), Math.round(ay + qy), RED); wpx(Math.round(ax - qx), Math.round(ay - qy), RED); }
        wpx(ax, ay, j === 0 ? STEEL_L : j === 1 ? STEEL_M : j >= 6 ? WHITE : WOOD);
      }
      continue;
    }
    if (kind === 2) {
      // Sword beam: a white-gold crescent
      const qx = -uy, qy = ux;
      for (let t = -5; t <= 5; t++) {
        const back = t * t * 0.22;
        const cx = bX[b] + qx * t - ux * back, cy = bY[b] + qy * t - uy * back;
        const c = (t > -3 && t < 3) ? WHITE : GOLD;
        wpx(Math.round(cx), Math.round(cy), c);
        wpx(Math.round(cx - ux), Math.round(cy - uy), (t > -2 && t < 2) ? GOLD : ROBE_L);
      }
      continue;
    }
    const tl = p === 0 ? 5 : p === 1 ? 8 : 12;
    for (let k = tl; k >= 1; k--) {
      const c = TRAIL[((k - 1) * TRAILN / tl) | 0];
      const tx = bX[b] - ux * k, ty = bY[b] - uy * k;
      wpx(Math.round(tx), Math.round(ty), c);
      if (p > 0 && k < tl - 2) {
        const w = p === 2 && k < tl - 5 ? 2 : 1;
        const c2 = TRAIL[Math.min(TRAILN - 1, (((k - 1) * TRAILN / tl) | 0) + 1)];
        wpx(Math.round(tx - uy * w), Math.round(ty + ux * w), c2);
        wpx(Math.round(tx + uy * w), Math.round(ty - ux * w), c2);
      }
    }
    const r = p === 0 ? 1 : p === 1 ? 2 : 3;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r + (r >> 1)) continue;
        let c;
        if (d2 <= (r * r) / 4) c = WHITE;
        else if (d2 <= (r - 0.5) * (r - 0.5)) c = MAGIC_P;
        else c = ((bT[b] + dx + dy) & 3) === 0 ? MAGIC_B : MAGIC_C;
        wpx(x + dx, y + dy, c);
      }
    }
    if ((bT[b] >> 1) & 1) {
      const s = r + 1;
      wpx(x, y - s, MAGIC_P); wpx(x, y + s, MAGIC_P);
      if (p === 2) { wpx(x - s - 1, y, MAGIC_C); wpx(x + s + 1, y, MAGIC_C); wpx(x, y - s - 1, MAGIC_C); wpx(x, y + s + 1, MAGIC_C); }
    }
  }
}

function drawEnemies() {
  for (let i = 0; i < EMAX; i++) {
    if (!eAct[i]) continue;
    const x = Math.round(eX[i]) - camI, flash = eFlash[i] > 0 && (eFlash[i] & 2) !== 0;
    if (eType[i] === 1) {
      const f = ((eT[i] / 6) | 0) & 1;
      drawSprite(BAT_F[f], SW, BAT_H, x - 4, Math.round(eY[i]) - 3, false, flash, false);
    } else {
      const grounded = eY[i] >= FLOOR - 1;
      const f = !grounded ? 0 : (eT[i] % 70) > 58 ? 1 : ((eT[i] >> 4) & 1);
      drawSprite(SLIME_F[f], SW, SLIME_H, x - 4, Math.round(eY[i]) - SLIME_H + 1, eDir[i] < 0, flash, false);
    }
  }
}

function drawCorpses() {
  for (let k = 0; k < KMAX; k++) {
    if (!kAct[k]) continue;
    const x = Math.round(kX[k]) - camI, y = Math.round(kY[k]);
    if (kType[k] === 1) {
      if (!kLand[k]) {
        // Tumbling: alternate flips every few steps, flashing white at first
        const spin = (kT[k] >> 2) & 3;
        drawSprite(BAT_F[spin & 1], SW, BAT_H, x - 4, y - 3, spin > 1, kT[k] < 6, (spin & 1) === 1);
      } else if (kT[k] < 360 || (kT[k] & 4)) {
        drawSprite(BAT_F[1], SW, BAT_H, x - 4, y - BAT_H + 2, kDir[k] < 0, false, true);
      }
    } else {
      const f = kLand[k] ? Math.min(2, (kT[k] / 10) | 0) : 0;
      drawSprite(SLIME_DIE[f], SW, SLIME_H, x - 4, y - SLIME_H + 1, kDir[k] < 0, !kLand[k] || kT[k] < 4, false);
    }
  }
}

// Edge arrows for enemies just off screen
function drawOffscreenMarkers() {
  for (let i = 0; i < EMAX; i++) {
    if (!eAct[i]) continue;
    const sx = eX[i] - camI;
    if (sx >= -4 && sx < W + 4) continue;
    if (sx < -80 || sx > W + 80) continue;
    const y = Math.max(20, Math.min(FLOOR - 4, Math.round(eType[i] === 2 ? eY[i] - 3 : eY[i])));
    const c = (animFrame & 2) ? RED : ROBE_L;
    if (sx < 0) { px(1, y, c); px(2, y - 1, c); px(2, y + 1, c); px(2, y, c); }
    else { px(W - 2, y, c); px(W - 3, y - 1, c); px(W - 3, y + 1, c); px(W - 3, y, c); }
  }
}

function drawPopups() {
  for (let i = 0; i < UMAX; i++) {
    if (!uAct[i] || (uT[i] > 35 && (uT[i] & 2))) continue;
    const x = Math.round(uX[i]) - 6 - camI, y = Math.round(uY[i]);
    drawGlyph(43, x, y, GOLD, 1);
    drawNumber(uVal[i], x + 4, y, GOLD, 1);
  }
}

function drawHearts(n, full, cx, y) {
  const x0 = cx - ((n * 8 - 3) >> 1);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 8;
    drawSprite(HEART, 5, 4, x, y, false, false, false);
    if (i >= full) { px(x + 1, y, SKY3); px(x + 3, y, SKY3); rect(x, y + 1, 5, 1, SKY3); rect(x + 1, y + 2, 3, 1, SKY3); px(x + 2, y + 3, SKY3); }
  }
}

function drawHUD() {
  drawHearts(HD.hp, hp, 5 + ((HD.hp * 8 - 3) >> 1), 5);
  drawNumber(score, W - 28, 5, WHITE, 6);
  // World minimap: a thin bar showing where the view and the hero are
  const mx0 = 12 + HD.hp * 8, mw = W - mx0 - 44, my = 6;
  for (let x = 0; x < mw; x++) px(mx0 + x, my + 1, SKY3);
  const v0 = mx0 + Math.round(camX / WORLD_W * mw), v1 = mx0 + Math.round((camX + W) / WORLD_W * mw);
  for (let x = v0; x < v1; x++) { px(x, my, SKY4); px(x, my + 2, SKY4); }
  for (let i = 0; i < EMAX; i++) if (eAct[i]) px(mx0 + Math.round(eX[i] / WORLD_W * mw), my + 1, RED);
  const pm = mx0 + Math.round(wx / WORLD_W * mw);
  px(pm, my, GOLD); px(pm, my + 1, GOLD); px(pm, my + 2, GOLD);
}

function drawReticle() {
  if (!aimMouse || game !== G_PLAY) return;
  const mx = Math.round(mouseX), my = Math.round(mouseY);
  const c = cstate === C_CHARGE && chargeT >= CHARGE_FULL ? (hero === WIZARD ? MAGIC_P : GOLD) : WHITE;
  px(mx - 3, my, c); px(mx - 2, my, c); px(mx + 2, my, c); px(mx + 3, my, c);
  px(mx, my - 3, c); px(mx, my - 2, c); px(mx, my + 2, c); px(mx, my + 3, c);
}

// ---------------------------------------------------------------------------
// Hero select screen
// ---------------------------------------------------------------------------
function selX(i) { return (W >> 1) + (i - 1) * 84; }

// Pose one hero for the lineup and draw it; the selected one readies its weapon
function drawSelectHero(i) {
  const chosen = i === sel;
  selectHero(i);
  hatOff = false; dead = false; sink = 0; fallA = 0;
  arm = chosen ? 1 : 0; staff = chosen ? HD.ready : HD.rest; tilt = 0;
  dBob = chosen ? 0 : ((((globalT / 30) | 0) + i) & 1); dTilt = 0; dFeet = 0; dSink = 0; dFall = 0;
  dSway = Math.sin(globalT * 0.05 + i * 2); dBeard = Math.sin(globalT * 0.07 + i); dHat = Math.sin(globalT * 0.045 + i);
  dFacing = 1; dDraw = chosen && i === ARCHER ? 0.7 : 0;
  dGlow = i === WIZARD ? (chosen ? 0.7 : 0.35) : 0;
  poseGeom();
  const x = selX(i);
  drawShadow(x, FLOOR);
  drawHero();
  composeSprite(x, 0, 1, false);
  if (i === WIZARD) { gemWX = x + (gemX - OX); gemWY = gemY; drawGem(); }
  if (chosen && ((globalT >> 3) & 3) === 0 && i === KNIGHT) sparks(x + (gemX - OX), gemY, 1, 0, -0.3, 0.5);
}

function drawSelect() {
  for (let i = 0; i < 3; i++) drawSelectHero(i);
  selectHero(sel);
  drawTextC('PIXEL QUEST', 20, GOLD, 3);
  drawTextC('CHOOSE YOUR HERO', 46, WHITE, 1);
  if (((globalT >> 5) & 1) === 0) drawTextC('A D OR MOUSE TO PICK - CLICK OR J TO START', 56, MAGIC_C, 1);
  drawTextC('W JUMP  S+W DROP  HOLD CLICK: CHARGE  RELEASE: ATTACK', 68, BEARD_SH, 1);
  for (let i = 0; i < 3; i++) {
    const x = selX(i), chosen = i === sel, h = HEROES[i];
    // Dark plate behind the hero's info so it reads over the bricks
    rect(x - 38, 152, 76, 28, INK);
    rect(x - 37, 153, 74, 27, SKY1);
    if (chosen) { rect(x - 38, 152, 76, 1, GOLD); rect(x - 38, 152, 1, 28, GOLD); rect(x + 37, 152, 1, 28, GOLD); }
    if (chosen) { // bobbing marker over the chosen hero
      const my = 92 + ((globalT >> 4) & 1);
      for (let k = 0; k < 4; k++) rect(x - 3 + k, my + k, 7 - k * 2, 1, GOLD);
    }
    drawTextAt(h.name, x, 155, chosen ? GOLD : BEARD);
    drawTextAt(h.desc, x, 162, chosen ? WHITE : BEARD_SH);
    drawHearts(h.hp, h.hp, x, 169);
    if (best[i] > 0) {
      const bw = 20 + numDigits(best[i]) * 4, bx = x - (bw >> 1);
      drawText('BEST', bx, 174, BEARD_SH, 1); drawNumber(best[i], bx + 20, 174, BEARD_SH, 1);
    }
  }
}

function drawOverlay() {
  const blink = ((globalT >> 5) & 1) === 0;
  if (game === G_OVER) {
    drawTextC('GAME OVER', 40, RED, 3);
    drawTextC(HD.name, 58, GOLD, 1);
    const sx = (W - (textW('SCORE ', 1) + 24)) >> 1;
    drawText('SCORE', sx, 68, WHITE, 1); drawNumber(score, sx + 24, 68, WHITE, 6);
    drawText('BEST ', sx + 4, 76, BEARD_SH, 1); drawNumber(best[hero], sx + 24, 76, BEARD_SH, 6);
    if (overT > 40 && blink) drawTextC('CLICK OR J TO CONTINUE', 90, WHITE, 1);
  }
}

function render() {
  fb.set(skyBg.subarray(0, W * H));
  drawStars();
  drawParallax();
  drawGround();
  drawRuins();
  drawPlatforms();
  drawDecals();
  drawStuckArrows();
  if (game === G_TITLE) {
    drawSelect();
  } else {
    drawFloorLight();
    if (!dead) drawShadow(wx, fy);
    drawHalo();
    drawParticles(true);
    drawCorpses();
    drawHero();
    if (dead) composeFallen(); else composeSprite(wx, Math.round(py), dFacing, true);
    drawProps();
    drawGem();
    drawEnemies();
    drawAimGuide();
    drawSlash();
    drawRing();
    drawParticles(false);
    drawBolts();
    drawPopups();
    if (game === G_PLAY) { drawOffscreenMarkers(); drawHUD(); }
    drawOverlay();
    drawReticle();
  }
  if (game === G_TITLE) { drawParticles(false); }

  // Palette -> RGBA with shake offset (edge clamped) and flash remap
  const rm = hurtT > 0 ? RMH : flashT > 3 ? RM2 : flashT > 0 ? RM1 : RM0;
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
// Display, input wiring, loop
// ---------------------------------------------------------------------------
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
let scale = 1, viewX = 0, viewY = 0;

// Fill the window: the integer pixel scale comes from the height, the logical
// width stretches to match the window's aspect ratio.
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.floor(window.innerWidth * dpr));
  const ch = Math.max(1, Math.floor(window.innerHeight * dpr));
  canvas.width = cw; canvas.height = ch;
  scale = Math.max(1, Math.floor(Math.min(ch / H, cw / MINW)));
  const nw = Math.max(MINW, Math.min(MAXW, Math.ceil(cw / scale)));
  if (nw !== W || !img) {
    W = nw;
    off.width = W; off.height = H;
    img = octx.createImageData(W, H);
    out32 = new Uint32Array(img.data.buffer);
    buildSky();
    if (camX > WORLD_W - W) camX = WORLD_W - W;
  }
  viewX = (cw - W * scale) >> 1; viewY = (ch - H * scale) >> 1;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE[0];
  ctx.fillRect(0, 0, cw, ch);
}

function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  const cx = (e.clientX - r.left) * canvas.width / r.width;
  const cy = (e.clientY - r.top) * canvas.height / r.height;
  mouseX = (cx - viewX) / scale; mouseY = (cy - viewY) / scale;
}

function setKey(code, down) {
  const v = down ? 1 : 0;
  switch (code) {
    case 'ArrowLeft': case 'KeyA':
      if (down && !kLeft) leftLatch = 1;
      kLeft = v; return true;
    case 'ArrowRight': case 'KeyD':
      if (down && !kRight) rightLatch = 1;
      kRight = v; return true;
    case 'ArrowUp': case 'KeyW': case 'Space':
      if (down && !kJump) jumpLatch = 1;
      kJump = v; return true;
    case 'ArrowDown': case 'KeyS': kDown = v; return true;
    case 'KeyJ': case 'KeyK': case 'KeyX': case 'KeyZ': case 'Enter':
      if (down && !kFire) { fireLatch = 1; aimMouse = false; }
      kFire = v; return true;
  }
  return false;
}
window.addEventListener('keydown', (e) => { if (setKey(e.code, true)) e.preventDefault(); });
window.addEventListener('keyup', (e) => { if (setKey(e.code, false)) e.preventDefault(); });
window.addEventListener('blur', () => { kLeft = kRight = kJump = kDown = kFire = mFire = 0; });
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  toLogical(e); aimMouse = true;
  if (game === G_TITLE && mouseY > 90) {
    for (let i = 0; i < 3; i++) if (Math.abs(mouseX - selX(i)) < 26) sel = i;
  }
  if (!mFire) fireLatch = 1;
  mFire = 1;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
});
canvas.addEventListener('pointermove', (e) => { toLogical(e); if (e.pointerType === 'mouse') aimMouse = true; });
canvas.addEventListener('pointerup', () => { mFire = 0; });
canvas.addEventListener('pointercancel', () => { mFire = 0; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

buildLevel();
buildWorld();
resize();
selectHero(sel);
snapshot();
updateGemWorld();
window.addEventListener('resize', resize);

// ?debug exposes a manual stepper for automated testing
if (new URLSearchParams(location.search).has('debug')) {
  window.wizardDebug = {
    run(n) { for (let i = 0; i < n; i++) step(); render(); },
    state() { return { game, hero, sel, score, hp, wx, fy, camI, W, cstate, chargeT, deathT, enemies: eAlive }; },
    enemies() { const a = []; for (let i = 0; i < EMAX; i++) if (eAct[i]) a.push({ x: eX[i], y: eType[i] === 2 ? eY[i] - 3 : eY[i], type: eType[i] }); return a; },
    pick(i) { sel = i; },
    hurt() { hurt(wx + 10); },
    killNearest(p) {
      let bi = -1, bd = 1e9;
      for (let i = 0; i < EMAX; i++) if (eAct[i] && Math.abs(eX[i] - wx) < bd) { bd = Math.abs(eX[i] - wx); bi = i; }
      if (bi >= 0) killEnemy(bi, true, p, eX[bi] > wx ? 1 : -1, 0, 0);
      return bi;
    },
  };
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
