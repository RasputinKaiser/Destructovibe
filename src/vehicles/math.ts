import type { Vec3, Quat } from '../types';

export function rot(out: Vec3, q: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  const x = q[0], y = q[1], z = q[2], w = q[3], vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  out[0] = vx + w * tx + y * tz - z * ty;
  out[1] = vy + w * ty + z * tx - x * tz;
  out[2] = vz + w * tz + x * ty - y * tx;
  return out;
}

export function invRot(out: Vec3, q: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  return rot(out, [-q[0], -q[1], -q[2], q[3]], v);
}

export function qmul(out: Quat, a: ArrayLike<number>, b: ArrayLike<number>): Quat {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function axisAngle(out: Quat, a: ArrayLike<number>, ang: number): Quat {
  const s = Math.sin(ang / 2);
  out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; out[3] = Math.cos(ang / 2);
  return out;
}

/** Rotation taking unit vector a onto unit vector b. */
export function between(a: Vec3, b: Vec3): Quat {
  const d = dot(a, b);
  if (d < -0.999999) {
    const t: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const c = norm(cross([0, 0, 0], a, t));
    return [c[0], c[1], c[2], 0];
  }
  const c = cross([0, 0, 0], a, b);
  const q: Quat = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function cross(out: Vec3, a: ArrayLike<number>, b: ArrayLike<number>): Vec3 {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

export function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}

/** q advanced by angular velocity w (world) over dt */
export function integrate(out: Quat, q: ArrayLike<number>, w: ArrayLike<number>, dt: number): Quat {
  const h = dt / 2, x = q[0], y = q[1], z = q[2], s = q[3];
  out[0] = x + h * (w[0] * s + w[1] * z - w[2] * y);
  out[1] = y + h * (w[1] * s + w[2] * x - w[0] * z);
  out[2] = z + h * (w[2] * s + w[0] * y - w[1] * x);
  out[3] = s - h * (w[0] * x + w[1] * y + w[2] * z);
  const l = Math.hypot(out[0], out[1], out[2], out[3]);
  out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l;
  return out;
}
