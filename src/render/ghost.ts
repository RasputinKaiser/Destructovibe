/* Free-play placement preview: box edges drawn through everything (brighter where unoccluded), a faint
   volume with a 0.5 m blueprint grid, and a dashed ground footprint (hazard-striped when invalid). */
import * as THREE from 'three';
import type { Vec3 } from '../types';
import { hazardTex } from './textures';

const BLUE = new THREE.Color(0x4ab2ff), RED = new THREE.Color(0xff3b2f);
let box: THREE.Group | null = null;
let foot: THREE.Mesh;
let lineOver: THREE.LineBasicMaterial, lineIn: THREE.LineBasicMaterial;
let fillU: Record<string, THREE.IUniform>, footU: Record<string, THREE.IUniform>;

const FILL_VS = /* glsl */`
uniform vec3 uSize;
varying vec3 vP;
varying vec3 vN;
void main() {
  vP = ( position + 0.5 ) * uSize;
  vN = abs( normal );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

// grid lines every 0.5 m from the min corner; the axis along the face normal is pushed out of the min
const FILL_FS = /* glsl */`
uniform vec3 uColor;
uniform float uPulse;
varying vec3 vP;
varying vec3 vN;
void main() {
  vec3 g = vP * 2.0;
  vec3 d = abs( fract( g + 0.5 ) - 0.5 ) / max( fwidth( g ), vec3( 1e-4 ) ) + vN * 1e4;
  float line = 1.0 - clamp( min( min( d.x, d.y ), d.z ) - 0.5, 0.0, 1.0 );
  gl_FragColor = vec4( uColor, 0.06 + 0.03 * uPulse + 0.28 * line );
  #include <colorspace_fragment>
}`;

const FOOT_VS = /* glsl */`
uniform vec3 uSize;
varying vec2 vP;
varying vec2 vW;
void main() {
  vP = position.xz * uSize.xz;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// the dash runs along whichever edge is nearer; corners stay solid brackets
const FOOT_FS = /* glsl */`
uniform vec3 uColor;
uniform vec3 uSize;
uniform float uTime;
uniform float uBad;
uniform sampler2D uHaz;
varying vec2 vP;
varying vec2 vW;
void main() {
  vec2 e = uSize.xz * 0.5 - abs( vP );
  float edge = min( e.x, e.y );
  float aa = fwidth( edge );
  float border = 1.0 - smoothstep( 0.08 - aa, 0.08 + aa, edge );
  float s = e.x < e.y ? vP.y : vP.x;
  float dash = step( fract( s / 0.6 - uTime * 0.6 ), 0.55 );
  float corner = 1.0 - step( 0.45, max( e.x, e.y ) );
  float stripe = smoothstep( 0.2, 0.5, texture2D( uHaz, vW * 0.5 ).r );
  gl_FragColor = vec4( uColor, max( border * max( dash, corner ) * 0.9, 0.07 + uBad * 0.13 * stripe ) );
  #include <colorspace_fragment>
}`;

export function initGhost(scene: THREE.Scene): void {
  if (box) {
    if (box.parent !== scene) scene.add(box, foot);
    return;
  }
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  lineOver = new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  lineIn = new THREE.LineBasicMaterial({ color: BLUE, transparent: true, opacity: 1, depthWrite: false, toneMapped: false, fog: false });
  const over = new THREE.LineSegments(edges, lineOver), inner = new THREE.LineSegments(edges, lineIn);
  over.renderOrder = 1001;
  inner.renderOrder = 1002;

  const fillMat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: new THREE.Vector3(1, 1, 1) }, uColor: { value: BLUE.clone() }, uPulse: { value: 0 } },
    vertexShader: FILL_VS, fragmentShader: FILL_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  fillU = fillMat.uniforms;
  const fill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), fillMat);
  fill.renderOrder = 999;

  box = new THREE.Group();
  box.name = 'ghost';
  box.visible = false;
  box.add(fill, over, inner);

  const footMat = new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: new THREE.Vector3(1, 1, 1) }, uColor: { value: BLUE.clone() },
      uTime: { value: 0 }, uBad: { value: 0 }, uHaz: { value: hazardTex() },
    },
    vertexShader: FOOT_VS, fragmentShader: FOOT_FS,
    transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  });
  footU = footMat.uniforms;
  foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), footMat);
  foot.name = 'ghostFootprint';
  foot.renderOrder = 2;
  foot.visible = false;
  scene.add(box, foot);
}

export const ghost = {
  /** `center` is the box centre, `size` its full extents; the footprint lies on the ground (y = 0) */
  show(center: Vec3, size: Vec3, rotY: number, valid: boolean): void {
    if (!box) return;
    const sx = Math.max(size[0], 0.05), sy = Math.max(size[1], 0.05), sz = Math.max(size[2], 0.05);
    const c = valid ? BLUE : RED, t = performance.now() / 1000;
    box.position.set(center[0], center[1], center[2]);
    box.rotation.y = rotY;
    box.scale.set(sx, sy, sz);
    foot.position.set(center[0], 0.01, center[2]);
    foot.rotation.y = rotY;
    foot.scale.set(sx, 1, sz);
    (fillU.uSize.value as THREE.Vector3).set(sx, sy, sz);
    (footU.uSize.value as THREE.Vector3).set(sx, sy, sz);
    lineOver.color.copy(c);
    lineIn.color.copy(c);
    (fillU.uColor.value as THREE.Color).copy(c);
    (footU.uColor.value as THREE.Color).copy(c);
    fillU.uPulse.value = 0.5 + 0.5 * Math.sin(t * 3);
    footU.uTime.value = t;
    footU.uBad.value = valid ? 0 : 1;
    box.visible = true;
    foot.visible = true;
  },

  hide(): void {
    if (!box) return;
    box.visible = false;
    foot.visible = false;
  },
};
