import { addBlock } from '../physics/destructible';
import { rand } from '../util';

export function buildBrickHouse(cx: number, cz: number): void {
  const B = { x: 1.0, y: 0.5, z: 0.5 };                 // brick unit
  const W = 7, D = 6, H = 8;                            // bricks wide/deep, courses high
  for (let level = 0; level < H; level++) {
    const y = B.y / 2 + level * B.y;
    // front & back walls (with door + windows)
    for (let i = 0; i < W; i++) {
      const x = cx - (W * B.x) / 2 + B.x / 2 + i * B.x;
      const isDoor = (i === 3 && level < 4);
      const isWinF = ((i === 1 || i === 5) && level >= 3 && level <= 5);
      if (!isDoor && !isWinF) addBlock('brick', B.x * 0.98, B.y * 0.96, B.z * 0.98, x, y, cz - (D * B.x) / 2);
      const isWinB = ((i === 2 || i === 4) && level >= 3 && level <= 5);
      if (!isWinB) addBlock('brick', B.x * 0.98, B.y * 0.96, B.z * 0.98, x, y, cz + (D * B.x) / 2);
    }
    // side walls
    for (let j = 1; j < D; j++) {
      const z = cz - (D * B.x) / 2 + j * B.x;
      const isWin = (j === 3 && level >= 3 && level <= 5);
      if (!isWin) {
        addBlock('brick', B.z * 0.98, B.y * 0.96, B.x * 0.98, cx - (W * B.x) / 2, y, z);
        addBlock('brick', B.z * 0.98, B.y * 0.96, B.x * 0.98, cx + (W * B.x) / 2, y, z);
      }
    }
  }
  // steel corner columns
  const colH = H * B.y + 0.6;
  ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).forEach(([sx, sz]) => {
    addBlock('metal', 0.28, colH, 0.28, cx + sx * ((W * B.x) / 2 + 0.5), colH / 2, cz + sz * ((D * B.x) / 2 + 0.5));
  });
  // timber joists + plank roof
  const topY = H * B.y;
  for (let j = 0; j <= D; j += 2)
    addBlock('wood', W * B.x + 1.2, 0.16, 0.24, cx, topY + 0.12, cz - (D * B.x) / 2 + j * B.x);
  for (let i = 0; i < W + 1; i++)
    addBlock('wood', 0.9, 0.08, D * B.x + 0.9, cx - (W * B.x) / 2 + i * B.x, topY + 0.28, cz);
}

export function buildWatchtower(cx: number, cz: number): void {
  const legH = 5.4;
  const s = 1.7;
  ([[-s, -s], [s, -s], [-s, s], [s, s]] as const).forEach(([lx, lz]) =>
    addBlock('wood', 0.24, legH, 0.24, cx + lx, legH / 2, cz + lz));
  for (const yLevel of [1.4, 3.2]) {
    addBlock('wood', s * 2 + 0.3, 0.14, 0.18, cx, yLevel, cz - s);
    addBlock('wood', s * 2 + 0.3, 0.14, 0.18, cx, yLevel, cz + s);
    addBlock('wood', 0.18, 0.14, s * 2 + 0.3, cx - s, yLevel, cz);
    addBlock('wood', 0.18, 0.14, s * 2 + 0.3, cx + s, yLevel, cz);
  }
  for (let i = 0; i < 6; i++)
    addBlock('wood', s * 2 + 1.0, 0.1, 0.55, cx, legH + 0.1, cz - s - 0.2 + i * 0.68);
  ([[-s, -s], [s, -s], [-s, s], [s, s]] as const).forEach(([lx, lz]) =>
    addBlock('wood', 0.12, 0.9, 0.12, cx + lx, legH + 0.6, cz + lz));
  addBlock('wood', s * 2 + 0.2, 0.09, 0.09, cx, legH + 1.0, cz - s);
  addBlock('wood', s * 2 + 0.2, 0.09, 0.09, cx, legH + 1.0, cz + s);
  addBlock('wood', 0.09, 0.09, s * 2 + 0.2, cx - s, legH + 1.0, cz);
  addBlock('wood', 0.09, 0.09, s * 2 + 0.2, cx + s, legH + 1.0, cz);
  for (let l = 0; l < 3; l++) for (let i = 0; i < 3; i++) {
    addBlock('brick', 0.8, 0.4, 0.4, cx - 0.8 + i * 0.8, legH + 0.4 + l * 0.42, cz - 0.9);
    addBlock('brick', 0.8, 0.4, 0.4, cx - 0.8 + i * 0.8, legH + 0.4 + l * 0.42, cz + 0.9);
  }
  addBlock('wood', 2.8, 0.09, 2.3, cx, legH + 1.75, cz);
}

export function buildSteelFrame(cx: number, cz: number): void {
  const H = 6.5, span = 5;
  ([[-span / 2, -2], [span / 2, -2], [-span / 2, 2], [span / 2, 2]] as const).forEach(([lx, lz]) =>
    addBlock('metal', 0.32, H, 0.32, cx + lx, H / 2, cz + lz));
  addBlock('metal', span + 0.6, 0.3, 0.3, cx, H, cz - 2);
  addBlock('metal', span + 0.6, 0.3, 0.3, cx, H, cz + 2);
  addBlock('metal', 0.3, 0.3, 4.6, cx - span / 2, H, cz);
  addBlock('metal', 0.3, 0.3, 4.6, cx + span / 2, H, cz);
  addBlock('metal', span + 0.6, 0.28, 0.28, cx, H / 2, cz - 2);
  addBlock('metal', span + 0.6, 0.28, 0.28, cx, H / 2, cz + 2);
  for (let l = 0; l < 7; l++) for (let i = 0; i < 5; i++) {
    addBlock('brick', 0.86, 0.45, 0.45, cx - span / 2 + 0.8 + i * 0.9, 0.25 + l * 0.46, cz - 2);
  }
  for (let i = 0; i < 7; i++)
    addBlock('wood', 0.72, 0.09, 4.8, cx - span / 2 + 0.4 + i * 0.75, H + 0.22, cz);
  for (let l = 0; l < 3; l++) for (let i = 0; i < 2; i++)
    addBlock('wood', 0.7, 0.7, 0.7, cx + span / 2 + 1.6 + i * 0.75, 0.36 + l * 0.72, cz + 2.5);
}

export function buildChimney(cx: number, cz: number, courses = 12): void {
  for (let l = 0; l < courses; l++) {
    const y = 0.22 + l * 0.44;
    const off = (l % 2) ? 0.4 : 0;
    addBlock('brick', 0.85, 0.42, 0.42, cx - 0.42, y, cz - 0.42, { rotY: off ? Math.PI / 2 : 0 });
    addBlock('brick', 0.85, 0.42, 0.42, cx + 0.42, y, cz + 0.42, { rotY: off ? Math.PI / 2 : 0 });
    addBlock('brick', 0.42, 0.42, 0.85, cx + 0.42, y, cz - 0.42, { rotY: off ? Math.PI / 2 : 0 });
    addBlock('brick', 0.42, 0.42, 0.85, cx - 0.42, y, cz + 0.42, { rotY: off ? Math.PI / 2 : 0 });
  }
}

export function buildBarrels(cx: number, cz: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const o = addBlock('barrel', 0.62, 0.95, 0.62, cx + rand(-2, 2), 0.5, cz + rand(-1.6, 1.6));
    void o;
  }
}

export function buildTntStack(cx: number, cz: number, layers = 2): void {
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < 2; i++)
      addBlock('tnt', 0.66, 0.66, 0.66, cx + i * 0.7 - 0.35, 0.34 + l * 0.68, cz);
}

export function buildCrates(cx: number, cz: number, cols = 2, layers = 3): void {
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < cols; i++)
      addBlock('wood', 0.7, 0.7, 0.7, cx + i * 0.75, 0.36 + l * 0.72, cz);
}

/* protected site office — damaging it costs money */
export function buildTrailer(cx: number, cz: number): void {
  const opts = { isProtected: true } as const;
  // floor + walls + roof, simple box hut on metal skids
  addBlock('metal', 3.6, 0.18, 2.2, cx, 0.45, cz, opts);
  for (let l = 0; l < 3; l++) {
    const y = 0.75 + l * 0.5;
    addBlock('wood', 3.6, 0.5, 0.14, cx, y, cz - 1.05, opts);
    addBlock('wood', 3.6, 0.5, 0.14, cx, y, cz + 1.05, opts);
    addBlock('wood', 0.14, 0.5, 2.0, cx - 1.75, y, cz, opts);
    if (l > 0) addBlock('wood', 0.14, 0.5, 2.0, cx + 1.75, y, cz, opts);
  }
  addBlock('metal', 3.8, 0.14, 2.4, cx, 2.4, cz, opts);
}

export function buildSilo(cx: number, cz: number): void {
  // ring of bricks approximating a cylinder, 14 courses
  const R = 1.6, N = 10, courses = 14;
  for (let l = 0; l < courses; l++) {
    const y = 0.24 + l * 0.46;
    const phase = (l % 2) * (Math.PI / N);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + phase;
      addBlock('brick', 0.95, 0.44, 0.4, cx + Math.cos(a) * R, y, cz + Math.sin(a) * R, { rotY: -a + Math.PI / 2 });
    }
  }
  // conical-ish wood cap
  addBlock('wood', 3.4, 0.12, 3.4, cx, courses * 0.46 + 0.35, cz);
  addBlock('wood', 2.2, 0.12, 2.2, cx, courses * 0.46 + 0.75, cz);
  addBlock('wood', 1.0, 0.12, 1.0, cx, courses * 0.46 + 1.15, cz);
}

export function buildTowerBlock(cx: number, cz: number, floors = 6): void {
  const W = 6, D = 5, B = { x: 1.0, y: 0.5, z: 0.5 };
  const floorH = 3 * B.y + 0.14;
  for (let f = 0; f < floors; f++) {
    const baseY = f * floorH;
    for (let level = 0; level < 3; level++) {
      const y = baseY + B.y / 2 + level * B.y;
      for (let i = 0; i < W; i++) {
        const x = cx - (W * B.x) / 2 + B.x / 2 + i * B.x;
        const isWin = (i % 2 === 1 && level === 1);
        if (!isWin) {
          addBlock('brick', B.x * 0.98, B.y * 0.96, B.z * 0.98, x, y, cz - (D * B.x) / 2);
          addBlock('brick', B.x * 0.98, B.y * 0.96, B.z * 0.98, x, y, cz + (D * B.x) / 2);
        }
      }
      for (let j = 1; j < D; j++) {
        const z = cz - (D * B.x) / 2 + j * B.x;
        const isWin = (j % 2 === 1 && level === 1);
        if (!isWin) {
          addBlock('brick', B.z * 0.98, B.y * 0.96, B.x * 0.98, cx - (W * B.x) / 2, y, z);
          addBlock('brick', B.z * 0.98, B.y * 0.96, B.x * 0.98, cx + (W * B.x) / 2, y, z);
        }
      }
    }
    // floor slab planks
    for (let i = 0; i < W; i++)
      addBlock('wood', 0.95, 0.12, D * B.x + 0.6, cx - (W * B.x) / 2 + 0.5 + i * B.x, baseY + 3 * B.y + 0.08, cz);
  }
  // steel corner columns, full height
  const colH = floors * floorH + 0.4;
  ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).forEach(([sx, sz]) => {
    addBlock('metal', 0.3, colH, 0.3, cx + sx * ((W * B.x) / 2 + 0.45), colH / 2, cz + sz * ((D * B.x) / 2 + 0.45));
  });
}
