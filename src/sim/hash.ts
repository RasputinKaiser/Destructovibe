/* Counting-sort spatial hash over particle indices; cells one interaction range wide, queried 3×3×3. */

const BUCKETS = 1 << 14;
const MASK = BUCKETS - 1;

export function hashKey(ix: number, iy: number, iz: number): number {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & MASK;
}

export class SpatialHash {
  inv = 4;
  /** bucket h holds items[start[h] .. start[h + 1]) */
  start = new Int32Array(BUCKETS + 2);
  items = new Int32Array(1024);
  private keys = new Int32Array(1024);

  build(ids: Int32Array, n: number, x: Float64Array, cell: number): void {
    this.inv = 1 / cell;
    if (this.items.length < n) { this.items = new Int32Array(n * 2); this.keys = new Int32Array(n * 2); }
    const st = this.start, inv = this.inv, keys = this.keys, items = this.items;
    st.fill(0);
    for (let k = 0; k < n; k++) {
      const i = ids[k] * 3;
      const h = hashKey(Math.floor(x[i] * inv), Math.floor(x[i + 1] * inv), Math.floor(x[i + 2] * inv));
      keys[k] = h;
      st[h + 2]++;
    }
    for (let b = 2; b < BUCKETS + 2; b++) st[b] += st[b - 1];
    for (let k = 0; k < n; k++) items[st[keys[k] + 1]++] = ids[k];
  }
}
