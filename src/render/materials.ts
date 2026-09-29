import * as THREE from 'three';
import type { MaterialId, PieceSpec, Quality } from '../types';
import { configureTextures, noiseTex, siteMask, texSet, type SetId, type TexSet } from './textures';
import { setMeshDetail } from '../destruction/polytope';
import { DV_COVER_UV, coverU, dustU, envU, qualU, roomU } from './shared';

type Pair = readonly [THREE.Material, THREE.Material];
type Glassy = 'glass' | 'tempered';

type Shade = 'lamp' | 'machine';
interface Spec { ext: SetId; int: SetId; metal?: boolean; intMetal?: boolean; normal?: number; decal?: 'cyl' | 'box'; shade?: Shade }
const SPEC: Record<Exclude<MaterialId, Glassy>, Spec> = {
  concrete: { ext: 'concrete', int: 'concreteIn' },
  rconcrete: { ext: 'rconcrete', int: 'rconcreteIn', intMetal: true },
  brick: { ext: 'brick', int: 'brickIn' },
  cinderblock: { ext: 'cinderblock', int: 'cinderblockIn' },
  stone: { ext: 'stone', int: 'stoneIn' },
  sandstone: { ext: 'sandstone', int: 'sandstoneIn' },
  marble: { ext: 'marble', int: 'marbleIn' },
  terracotta: { ext: 'terracotta', int: 'terracottaIn' },
  ceramic: { ext: 'ceramic', int: 'ceramicIn' },
  asphalt: { ext: 'asphalt', int: 'asphaltIn' },
  copper: { ext: 'copper', int: 'copperIn', metal: true, intMetal: true },
  adobe: { ext: 'adobe', int: 'adobeIn' },
  plaster: { ext: 'plaster', int: 'plasterIn' },
  drywall: { ext: 'drywall', int: 'drywallIn' },
  wood: { ext: 'wood', int: 'woodIn' },
  oak: { ext: 'oak', int: 'oakIn' },
  plywood: { ext: 'plywood', int: 'plywoodIn' },
  steel: { ext: 'steel', int: 'steelIn', metal: true, intMetal: true },
  castiron: { ext: 'castiron', int: 'castironIn', metal: true, intMetal: true },
  aluminum: { ext: 'aluminum', int: 'aluminumIn', metal: true, intMetal: true },
  metal: { ext: 'metal', int: 'steelIn', metal: true, intMetal: true },
  roof: { ext: 'roof', int: 'roofIn' },
  crate: { ext: 'crate', int: 'woodIn' },
  barrel: { ext: 'barrel', int: 'steelIn', metal: true, intMetal: true, decal: 'cyl' },
  propane: { ext: 'propane', int: 'steelIn', metal: true, intMetal: true, decal: 'cyl' },
  tnt: { ext: 'tnt', int: 'woodIn', decal: 'box' },
  pvc: { ext: 'pvc', int: 'pvcIn' },
  lamp: { ext: 'lamp', int: 'lampIn', metal: true, shade: 'lamp' },
  machine: { ext: 'machine', int: 'castironIn', metal: true, intMetal: true, shade: 'machine' },
  insulation: { ext: 'drywall', int: 'drywallIn' },
  frp: { ext: 'pvc', int: 'pvcIn' },
  cardboard: { ext: 'crate', int: 'plywoodIn' },
  rubber: { ext: 'pvc', int: 'pvcIn' },
};

const pairs = new Map<string, Pair>();
const interiors = new Map<MaterialId, THREE.Material>();
let configured = false;

export function initMaterials(renderer: THREE.WebGLRenderer, quality: Quality): void {
  configureTextures(quality, renderer.capabilities.getMaxAnisotropy());
  setMeshDetail(quality);
  configured = true;
}

export function pbr(s: TexSet, metal = false, normal = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: s.map,
    normalMap: s.normal,
    normalScale: new THREE.Vector2(normal, normal),
    roughnessMap: s.orm,
    aoMap: s.orm,
    metalnessMap: metal ? s.orm : null,
    roughness: 1,
    metalness: metal ? 1 : 0,
  });
}

/* Props that never fracture get their label layout from object-space position instead of the
   world-anchored metre UVs, so stripes and stencils sit centred on the object. */
const CYL_UV = /* glsl */`
  vec2 dUv = abs( normal.y ) > 0.5
    ? vec2( 0.5 + position.x * 0.8, 0.095 + position.z * 0.22 )
    : vec2( uv.x / max( length( position.xz ), 1e-3 ) * 0.3183099, 0.6 + position.y * 0.85 );`;
const BOX_UV = /* glsl */`
  vec3 dAn = abs( normal );
  vec2 dUv = dAn.x >= dAn.y && dAn.x >= dAn.z ? vec2( normal.x > 0.0 ? -position.z : position.z, position.y )
    : dAn.y >= dAn.z ? vec2( position.x, normal.y > 0.0 ? -position.z : position.z )
    : vec2( normal.z > 0.0 ? position.x : -position.x, position.y );
  dUv = dUv * 1.25 + 0.5;`;
const DECAL_APPLY = /* glsl */`
  #ifdef USE_MAP
    vMapUv = ( mapTransform * vec3( dUv, 1.0 ) ).xy;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = ( normalMapTransform * vec3( dUv, 1.0 ) ).xy;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv = ( roughnessMapTransform * vec3( dUv, 1.0 ) ).xy;
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv = ( metalnessMapTransform * vec3( dUv, 1.0 ) ).xy;
  #endif
  #ifdef USE_AOMAP
    vAoMapUv = ( aoMapTransform * vec3( dUv, 1.0 ) ).xy;
  #endif`;

/* Heat rides in the BatchedMesh colour texel's alpha as 1 + heat (three initialises that alpha to 1,
   so untouched instances read as cold). The piece shaders therefore ignore colour alpha for opacity. */
const HEAT_PARS = /* glsl */`
#ifdef USE_COLOR_ALPHA
vec3 dvBlackbody( float h ) {
  float t = clamp( h, 0.0, 1.0 );
  float i = pow( max( t - 0.08, 0.0 ), 2.2 ) * 20.0;
  return vec3( 1.0, 0.16 + 0.64 * t * t, 0.02 + 0.55 * t * t * t * t ) * i;
}
#endif`;
const COLOR_RGB = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= vColor.rgb;
#endif`;
const HEAT_EMIT = /* glsl */`
#ifdef USE_COLOR_ALPHA
  if ( vColor.a > 1.001 ) totalEmissiveRadiance += dvBlackbody( vColor.a - 1.0 );
#endif`;

/* Lamps: the heat channel is the lamp's power (0..1) and the instance tint is the light colour. The
   unlit glass only takes a hint of the tint so a dead fitting reads as dark glass, and the wire guard
   (the metallic texels) stays dark in front of a lit bulb. */
const LAMP_RGB = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, 0.3 );
#endif`;
const LAMP_EMIT = /* glsl */`
#ifdef USE_COLOR_ALPHA
  if ( vColor.a > 1.001 ) totalEmissiveRadiance += vColor.rgb * ( ( vColor.a - 1.0 ) * 9.0 * ( 1.0 - metalnessFactor ) );
#endif`;
/* Machinery: the tint is paint, so worn bare steel (metallic texels) keeps its own colour. */
const MACHINE_RGB = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  diffuseColor.rgb *= mix( vColor.rgb, vec3( 1.0 ), metalnessFactor );
#endif`;

/* Surface breakup shared by the piece materials. Per-instance hash (BatchedMesh instance, or
   InstancedMesh index for scenery) varies tone and roughness so walls of identical blocks don't
   tile; a metre-UV macro noise breaks texture repeats; world height adds base grime and vertical
   rain streaks; the `wear` attribute (1 on bevel strips) chips paint and dusts the arrises. */
const DV_VERT_PARS = /* glsl */`
attribute float wear;
varying float vDvWear;
varying vec3 vDvW;
varying vec3 vDvN;
varying vec2 vDvUv;
varying float vDvId;`;
const DV_VERT = /* glsl */`
  vDvWear = wear;
  vDvUv = uv;
  vec4 dvP = vec4( transformed, 1.0 );
  vec3 dvNo = objectNormal;
  vDvId = 0.0;
  #ifdef USE_BATCHING
    dvP = batchingMatrix * dvP;
    dvNo = mat3( batchingMatrix ) * dvNo;
    vDvId = getIndirectIndex( gl_DrawID );
  #endif
  #ifdef USE_INSTANCING
    dvP = instanceMatrix * dvP;
    dvNo = mat3( instanceMatrix ) * dvNo;
    vDvId = float( gl_InstanceID );
  #endif
  vDvW = ( modelMatrix * dvP ).xyz;
  vDvN = mat3( modelMatrix ) * dvNo;`;
const DV_FRAG_PARS = /* glsl */`
uniform sampler2D uDvNoise;
uniform sampler2D uDvCover;
varying float vDvWear;
varying vec3 vDvW;
varying vec3 vDvN;
varying vec2 vDvUv;
varying float vDvId;
float dvHash( float n ) { return fract( sin( n * 91.3458 + 17.13 ) * 47453.5453 ); }`;
const DV_PRE = /* glsl */`
  float dvId = floor( vDvId + 0.5 );
  float dvR = dvHash( dvId );
  vec3 dvBase = diffuseColor.rgb;
  float dvMac = texture2D( uDvNoise, vDvUv * 0.043 ).r;
  diffuseColor.rgb *= ( 0.93 + 0.14 * dvR ) * ( 0.88 + 0.24 * dvMac )
    * ( 1.0 + vec3( 0.03, 0.0, -0.03 ) * ( dvHash( dvId + 7.0 ) * 2.0 - 1.0 ) );
  #ifdef DV_EXT
    vec3 dvN = normalize( vDvN );
    float dvG = texture2D( uDvNoise, vDvW.xz * 0.11 ).g;
    float dvGrime = ( 1.0 - smoothstep( 0.0, 0.8 + 1.4 * dvG, vDvW.y ) ) * ( 1.0 - 0.6 * max( dvN.y, 0.0 ) );
    float dvStreak = smoothstep( 0.52, 0.8, texture2D( uDvNoise, vec2( vDvUv.x * 0.8, vDvW.y * 0.03 ) ).g ) * ( 1.0 - abs( dvN.y ) );
    diffuseColor.rgb *= 1.0 - 0.26 * dvGrime - 0.12 * dvStreak;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) ) ) * vec3( 1.02, 0.97, 0.9 ), 0.35 * dvGrime );
    float dvWear = vDvWear * smoothstep( 0.3, 0.7, texture2D( uDvNoise, vDvUv * 1.9 ).r + 0.25 );
  #endif`;
const DV_POST = /* glsl */`
  #ifdef DV_EXT
    diffuseColor.rgb = mix( diffuseColor.rgb, dvBase * 1.18, dvWear * 0.55 );
  #endif`;
/* Settled demolition dust from the world coverage map (fx splats it under lingering clouds): mostly on
   up-facing faces, patchy, thinning with height. */
const DV_DUST = /* glsl */`
  vec3 dvNd = normalize( vDvN );
  vec4 dvCov = texture2D( uDvCover, vDvW.xz ${DV_COVER_UV} );
  float dvDust = dvCov.a * ( 0.15 + 0.85 * smoothstep( -0.1, 0.75, dvNd.y ) )
    * smoothstep( 0.25, 0.6, texture2D( uDvNoise, vDvW.xz * 0.37 + vDvW.y * 0.05 ).r + dvCov.a * 0.45 )
    * ( 1.0 - smoothstep( 30.0, 90.0, vDvW.y ) );
  // a film over the brick, greying it, never a white-out: the units still read through
  diffuseColor.rgb = mix( diffuseColor.rgb, dvCov.rgb * 0.85, clamp( dvDust, 0.0, 0.5 ) );`;
const DV_DUST_ROUGH = /* glsl */`
  roughnessFactor = mix( roughnessFactor, 0.95, clamp( dvDust, 0.0, 1.0 ) * 0.8 );
  metalnessFactor *= 1.0 - 0.7 * clamp( dvDust, 0.0, 1.0 );`;
const DV_ROUGH = /* glsl */`
  roughnessFactor *= 0.92 + 0.16 * dvHash( dvId + 3.0 );
  #ifdef DV_EXT
    roughnessFactor += 0.08 * dvWear * ( 1.0 - 2.0 * metalnessFactor ) + 0.06 * dvGrime;
  #endif
  roughnessFactor = clamp( roughnessFactor, 0.03, 1.0 );`;

let dvNoise: THREE.DataTexture | null = null;
const sharedNoise = (): THREE.DataTexture => (dvNoise ??= noiseTex());

/** shared by every piece material: per-instance heat glow, plus object-space label UVs for props */
function patchPiece(m: THREE.MeshStandardMaterial, kind?: 'cyl' | 'box', shade?: Shade, detail?: 'ext' | 'int'): void {
  const rgb = shade === 'lamp' ? LAMP_RGB : shade === 'machine' ? '' : COLOR_RGB;
  const emit = shade === 'lamp' ? LAMP_EMIT : shade === 'machine' ? `${MACHINE_RGB}\n${HEAT_EMIT}` : HEAT_EMIT;
  m.onBeforeCompile = (sh) => {
    if (kind) sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n${kind === 'cyl' ? CYL_UV : BOX_UV}\n${DECAL_APPLY}`);
    let pre = '', post = '';
    if (detail) {
      sh.uniforms.uDvNoise = { value: sharedNoise() };
      Object.assign(sh.uniforms, dustU, coverU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${DV_VERT_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${DV_VERT}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${detail === 'ext' ? '#define DV_EXT\n' : ''}${DV_FRAG_PARS}`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${DV_ROUGH}\n${DV_DUST_ROUGH}`);
      pre = DV_PRE; post = `${DV_POST}\n${DV_DUST}`;
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAT_PARS}`)
      .replace('#include <color_fragment>', `${pre}\n${rgb}\n${post}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emit}`);
  };
  m.customProgramCacheKey = () => `dv-piece-${kind ?? 'plain'}-${shade ?? 'std'}-${detail ?? 'none'}`;
}

const _white = new THREE.Color(1, 1, 1);

/** writes 0..1 heat (~400..1100 °C) for one BatchedMesh instance; cheap to call every frame */
export function setBatchHeat(mesh: THREE.BatchedMesh, instanceId: number, heat: number): void {
  const b = mesh as unknown as { _colorsTexture: THREE.DataTexture | null };
  if (!b._colorsTexture) mesh.setColorAt(instanceId, _white);
  const tex = b._colorsTexture;
  if (!tex) return;
  const data = tex.image.data as Float32Array, i = instanceId * 4 + 3;
  const a = 1 + (heat > 0 ? Math.min(heat, 1) : 0);
  if (a === data[i] || (a > 1 && Math.abs(a - data[i]) < 1 / 512)) return;
  data[i] = a;
  tex.needsUpdate = true;
}

/* Glazing, exterior faces. Transmission falls with Fresnel so grazing panes turn to mirrors of the sky.
   Building glass ('room') shows a fake office behind every pane: the view ray is cast into a world-anchored
   grid of room boxes (3.6 m bays, 3.8 m storeys, per-room depth) and the wall, floor or ceiling it meets is lit
   by window daylight falling off with depth, plus office lights in a hash-picked share of rooms (most at
   night) and the odd lowered blind. The room covers most of what really stands behind the pane, as the dim
   interior of a real building does. Low quality keeps a flat dim interior. Vehicle glass ('smoked') has no
   room; its tint sets how dark it is (untinted = clear windscreen glass). */
const GLASS_PARS = /* glsl */`
uniform vec4 uDvRoom;
uniform float uDvQ;
varying vec3 vDvW;
varying vec3 vDvN;
varying float vDvId;
float dvHash( float n ) { return fract( sin( n * 91.3458 + 17.13 ) * 47453.5453 ); }
vec3 dvRoom( vec2 f, vec2 sz, vec3 rd, float h1, float h2, float hl ) {
  float depth = sz.x * ( 1.1 + 1.3 * h1 );
  float tx = ( rd.x > 0.0 ? sz.x - f.x : f.x ) / max( abs( rd.x ), 1e-4 );
  float ty = ( rd.y > 0.0 ? sz.y - f.y : f.y ) / max( abs( rd.y ), 1e-4 );
  float tz = depth / rd.z;
  float t = min( min( tx, ty ), tz );
  vec3 hp = vec3( f, 0.0 ) + rd * t;
  vec3 alb = vec3( 0.5, 0.48, 0.45 ) * ( 0.8 + 0.4 * h2 );
  float panel = 0.0;
  if ( t == ty ) {
    if ( rd.y > 0.0 ) {
      alb = vec3( 0.72 );
      panel = step( 0.72, fract( hp.x * 0.42 + h1 ) ) * step( 0.55, fract( hp.z * 0.5 ) );
    } else alb = mix( vec3( 0.12, 0.12, 0.13 ), vec3( 0.2, 0.14, 0.09 ), h2 );
  } else if ( t == tz ) alb *= 0.85;
  float lit = step( hl, 0.12 + 0.6 * uDvRoom.a );
  vec3 lamp = mix( vec3( 1.0, 0.8, 0.58 ), vec3( 0.86, 0.93, 1.0 ), step( 0.5, fract( h1 * 5.7 ) ) );
  vec3 c = uDvRoom.rgb * alb * ( 0.05 + 0.45 * exp( - hp.z * 0.35 ) );
  c += lit * lamp * ( alb * ( 0.12 + 0.2 * exp( - t * 0.08 ) ) + panel * 2.5 );
  float blind = step( 0.82, h2 ) * step( sz.y - f.y, sz.y * ( 0.25 + 0.6 * fract( h1 * 13.0 ) ) );
  vec3 slat = vec3( 0.62, 0.58, 0.5 ) * ( 0.8 + 0.2 * step( 0.3, fract( f.y * 22.0 ) ) );
  return mix( c, slat * ( uDvRoom.rgb * 0.35 + lit * lamp * 0.3 ), blind );
}`;
const GLASS_VERT = /* glsl */`
  vec4 dvP = vec4( transformed, 1.0 );
  vec3 dvNo = objectNormal;
  vDvId = 0.0;
  #ifdef USE_BATCHING
    dvP = batchingMatrix * dvP;
    dvNo = mat3( batchingMatrix ) * dvNo;
    vDvId = getIndirectIndex( gl_DrawID );
  #endif
  vDvW = ( modelMatrix * dvP ).xyz;
  vDvN = mat3( modelMatrix ) * dvNo;`;
const GLASS_COLOR = /* glsl */`
  vec3 dvTint = vec3( 1.0 );
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    dvTint = vColor.rgb;
  #endif
  #ifdef DV_SMOKED
    float dvDark = 1.0 - dot( dvTint, vec3( 0.3, 0.55, 0.15 ) );
    diffuseColor.rgb *= mix( vec3( 1.0 ), dvTint, 0.5 ) * ( 1.0 - 0.8 * dvDark );
    diffuseColor.a = mix( diffuseColor.a, 0.9, dvDark );
  #else
    diffuseColor.rgb *= dvTint;
  #endif`;
const GLASS_FRESNEL = /* glsl */`
  float dvFr = pow( 1.0 - saturate( abs( dot( normal, normalize( vViewPosition ) ) ) ), 5.0 );
  diffuseColor.a = mix( diffuseColor.a, 1.0, dvFr );`;
const GLASS_ROOM = /* glsl */`
  #ifdef DV_ROOM
  {
    vec3 dvV = normalize( vDvW - cameraPosition );
    vec3 dvNw = normalize( vDvN );
    dvNw *= dot( dvNw, dvV ) > 0.0 ? - 1.0 : 1.0;
    float dvVert = 1.0 - smoothstep( 0.2, 0.4, abs( dvNw.y ) );
    vec3 dvT = normalize( vec3( - dvNw.z, 0.0, dvNw.x ) + vec3( 1e-5, 0.0, 0.0 ) );
    vec2 dvSz = vec2( 3.6, 3.8 );
    vec2 dvP = vec2( dot( vDvW, dvT ), vDvW.y ) / dvSz;
    vec2 dvCell = floor( dvP );
    float dvH1 = dvHash( dvCell.x * 7.31 + dvCell.y * 131.7 + floor( dot( vDvW, dvNw ) * 0.25 ) * 17.9 );
    float dvH2 = dvHash( dvH1 * 311.0 + 5.0 );
    // lights go on by runs of four bays along a floor (a tenancy), not room by room: per-room coin flips read as a QR code
    float dvHl = dvHash( floor( dvCell.x / 4.0 ) * 3.71 + dvCell.y * 57.1 + floor( dot( vDvW, dvNw ) * 0.25 ) * 17.9 );
    if ( dvHash( dvH1 * 17.0 + 3.0 ) > 0.88 ) dvHl = 1.0 - dvHl;
    vec3 dvIn;
    if ( uDvQ > 0.5 ) dvIn = dvRoom( ( dvP - dvCell ) * dvSz, dvSz, vec3( dot( dvV, dvT ), dvV.y, max( - dot( dvV, dvNw ), 1e-3 ) ), dvH1, dvH2, dvHl );
    else dvIn = uDvRoom.rgb * vec3( 0.07, 0.068, 0.064 ) + step( dvHl, 0.12 + 0.6 * uDvRoom.a ) * vec3( 0.12, 0.1, 0.08 );
    // far off, a pane averages over more of the room than the ray sample shows: pull toward the mean
    float dvFar = smoothstep( 50.0, 240.0, distance( vDvW, cameraPosition ) );
    vec3 dvMean = uDvRoom.rgb * 0.05 + vec3( 1.0, 0.86, 0.66 ) * ( 0.12 + 0.6 * uDvRoom.a ) * 0.09;
    dvIn = mix( dvIn, dvMean, dvFar * 0.55 );
    float dvClear = 1.0;
    #ifdef DV_CURTAIN
    {
      // unitised curtain wall above the ground floor: mullions every 1.2 m (three lights to a bay), a back-painted
      // spandrel over each slab edge, framed by transoms
      float dvCw = dvVert * smoothstep( 3.6, 4.2, vDvW.y );
      vec2 dvM = vec2( dot( vDvW, dvT ), vDvW.y );
      vec2 dvQ = abs( fract( dvM / vec2( 1.2, 3.8 ) + 0.5 ) - 0.5 ) * vec2( 1.2, 3.8 );
      vec2 dvFw = max( fwidth( dvM ), vec2( 1e-4 ) );
      float dvSpan = ( 1.0 - smoothstep( 0.45, 0.45 + dvFw.y, dvQ.y ) ) * dvCw;
      float dvFrame = max( 1.0 - smoothstep( 0.035, 0.035 + dvFw.x, dvQ.x ), 1.0 - smoothstep( 0.03, 0.03 + dvFw.y, abs( dvQ.y - 0.45 ) ) ) * dvCw;
      dvClear = ( 1.0 - dvSpan ) * ( 1.0 - dvFrame );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.018, 0.022, 0.026 ), dvSpan );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.21, 0.22 ), dvFrame );
      roughnessFactor = mix( roughnessFactor, 0.38, dvFrame );
      metalnessFactor = mix( metalnessFactor, 0.85, dvFrame );
      diffuseColor.a = mix( diffuseColor.a, 0.97, dvSpan );
      diffuseColor.a = mix( diffuseColor.a, 1.0, dvFrame );
    }
    #endif
    totalEmissiveRadiance += dvIn * mix( vec3( 1.0 ), dvTint, 0.6 ) * ( 1.0 - dvFr ) * dvVert * dvClear;
    diffuseColor.a = mix( diffuseColor.a, 0.93, dvVert * ( 1.0 - dvFr ) * dvClear );
  }
  #endif`;

function patchGlass(m: THREE.MeshStandardMaterial, mode: 'room' | 'smoked', curtain = false): void {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, roomU, qualU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDvW;\nvarying vec3 vDvN;\nvarying float vDvId;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${GLASS_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n#define ${mode === 'room' ? 'DV_ROOM' : 'DV_SMOKED'}\n${curtain ? '#define DV_CURTAIN\n' : ''}${HEAT_PARS}\n${GLASS_PARS}`)
      .replace('#include <color_fragment>', GLASS_COLOR)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GLASS_FRESNEL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${HEAT_EMIT}\n${GLASS_ROOM}`);
  };
  m.customProgramCacheKey = () => `dv-glass-${mode}${curtain ? '-cw' : ''}`;
}

function glass(tint: number | undefined, interior: boolean, tempered: boolean, smoked = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: smoked ? 0x1a2424 : tempered ? (interior ? 0x2a6664 : 0x16393d) : interior ? 0x2e5c54 : 0x1b3532,
    roughness: interior ? 0.12 : 0.02,
    metalness: 0,
    transparent: true,
    opacity: interior ? 0.6 : smoked ? 0.18 : tempered ? 0.33 : 0.3,
    depthWrite: false,
    envMapIntensity: smoked ? 2 : tempered ? 1.8 : 1.6,
  });
  if (tint !== undefined) m.color.multiply(new THREE.Color(tint));
  // reflections add at full strength while the diffuse body only tints what is behind
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  if (interior) patchPiece(m);
  else patchGlass(m, smoked ? 'smoked' : 'room', tempered && !smoked);
  return m;
}

function interior(mat: MaterialId): THREE.Material {
  let m = interiors.get(mat);
  if (!m) {
    if (mat === 'glass' || mat === 'tempered') m = glass(undefined, true, mat === 'tempered');
    else {
      const s = SPEC[mat], im = pbr(texSet(s.int), s.intMetal);
      patchPiece(im, undefined, s.shade === 'lamp' ? 'lamp' : undefined, s.shade === 'lamp' ? undefined : 'int');
      m = im;
    }
    interiors.set(mat, m);
  }
  return m;
}

export function getPieceMaterials(mat: MaterialId, tint?: number): Pair {
  const key = tint === undefined ? mat : `${mat}:${tint}`;
  let p = pairs.get(key);
  if (p) return p;
  if (!configured) configureTextures('medium', 4);
  let ext: THREE.Material;
  if (mat === 'glass' || mat === 'tempered') ext = glass(tint, false, mat === 'tempered');
  else {
    const s = SPEC[mat];
    const m = pbr(texSet(s.ext), s.metal, s.normal ?? 1);
    if (tint !== undefined) m.color.setHex(tint);
    if (s.shade === 'lamp') m.envMapIntensity = 1.4;
    patchPiece(m, s.decal, s.shade, s.shade === 'lamp' ? undefined : 'ext');
    ext = m;
  }
  p = [ext, interior(mat)] as const;
  pairs.set(key, p);
  return p;
}

/* ---------------- finishes ----------------
   A PieceSpec `finish` replaces the material's exterior look with a surface layer (fracture faces keep the
   material's own interior). One batch per finish whatever the underlying material, the instance tint is the
   paint. 'plate' (plain machine-grey steel) and 'wheel' (rubber tyre on a round piece, with a pressed-steel
   rim on its faces) are derived by the batch layer, not authored. */
export type SurfaceFinish = NonNullable<PieceSpec['finish']> | 'plate' | 'wheel';

const FIN_VERT_PARS = /* glsl */`
#ifdef DV_F_RUBBER
varying vec3 vDvO;
varying vec3 vDvON;
varying float vDvTr;
varying float vDvRo;
#endif`;
/* wheel faces are told apart per vertex: a tread facet's vertices sit about their own distance out along
   its normal, a side face's sit well off it; the side face's vertices are all on the rim, so vDvRo is the
   tyre radius across it */
const FIN_VERT = /* glsl */`
#ifdef DV_F_RUBBER
  vec3 dvOn = normalize( objectNormal );
  vDvO = position;
  vDvON = objectNormal;
  vDvTr = abs( dot( position, dvOn ) ) / max( length( position ), 1e-3 );
  vDvRo = length( position - dot( position, dvOn ) * dvOn );
#endif`;
const FIN_PARS = /* glsl */`
#ifdef DV_F_RUBBER
varying vec3 vDvO;
varying vec3 vDvON;
varying float vDvTr;
varying float vDvRo;
#endif
vec3 dvBump( vec3 n, float h ) {
  vec3 p = - vViewPosition;
  vec3 dx = dFdx( p ), dy = dFdy( p );
  vec3 r1 = cross( dy, n ), r2 = cross( n, dx );
  float det = dot( dx, r1 );
  vec3 g = abs( det ) * n - sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
  // zero on degenerate quads (det == 0): normalize would return NaN and bloom spreads it frame-wide
  float l2 = dot( g, g );
  return l2 > 1e-24 ? g * inversesqrt( l2 ) : n;
}`;
const FIN_COLOR = /* glsl */`
  float dvId = floor( vDvId + 0.5 );
  float dvR = dvHash( dvId );
  vec3 dvN = normalize( vDvN );
  vec3 dvTint = vec3( 1.0 );
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    dvTint = vColor.rgb;
  #endif
  float dvMac = texture2D( uDvNoise, vDvUv * 0.043 ).r;
  float dvLow = ( 1.0 - smoothstep( 0.0, 0.5 + 1.1 * texture2D( uDvNoise, vDvW.xz * 0.11 ).g, vDvW.y ) ) * ( 1.0 - 0.6 * max( dvN.y, 0.0 ) );
  float dvChip = 0.0, dvBare = 0.0, dvCoat = 1.0, dvAge = 0.0, dvFlk = 0.0;
  #ifdef DV_F_PAINT
    dvFlk = step( 0.55, dvHash( dvId + 11.0 ) );
    diffuseColor.rgb *= dvTint * ( 0.97 + 0.06 * dvR );
    diffuseColor.rgb *= 1.0 - 0.45 * vDvWear;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.09, 0.075, 0.06 ), 0.3 * dvLow );
    dvCoat = ( 1.0 - 0.25 * vDvWear ) * ( 1.0 - 0.5 * dvLow );
  #endif
  #if defined( DV_F_SATIN ) || defined( DV_F_DECAL )
    vec3 dvPaint = dvTint;
    #ifdef DV_F_DECAL
      float dvX = ( vDvUv.x + vDvUv.y ) * 2.0;
      float dvFw = max( fwidth( dvX ), 1e-4 );
      float dvS = smoothstep( 0.25 - dvFw, 0.25 + dvFw, abs( fract( dvX ) - 0.5 ) );
      vec3 dvB = all( greaterThan( dvTint, vec3( 0.99 ) ) ) ? vec3( 0.012 ) : dvTint;
      dvPaint = mix( vec3( 0.8, 0.45, 0.005 ), dvB, dvS );
    #endif
    diffuseColor.rgb *= dvPaint * ( 0.95 + 0.1 * dvR ) * ( 0.95 + 0.1 * dvMac );
    float dvCn = texture2D( uDvNoise, vDvUv * 2.3 + dvR ).r;
    dvChip = vDvWear * smoothstep( 0.4, 0.5, dvCn + 0.15 * dvHash( dvId + 2.0 ) );
    dvChip = max( dvChip, smoothstep( 0.8, 0.84, texture2D( uDvNoise, vDvUv * 0.9 + 0.3 ).g ) * dvLow );
    dvBare = dvChip * smoothstep( 0.62, 0.7, dvCn );
    vec3 dvUnder = vec3( 0.3, 0.09, 0.05 );
    #ifdef DV_F_JOINERY
      dvChip = 0.6 * max( vDvWear * smoothstep( 0.66, 0.74, dvCn + 0.1 * dvHash( dvId + 2.0 ) ),
        smoothstep( 0.8, 0.84, texture2D( uDvNoise, vDvUv * 0.9 + 0.3 ).g ) * dvLow );
      dvBare = 0.0;
      dvUnder = vec3( 0.56, 0.54, 0.49 );
    #endif
    diffuseColor.rgb = mix( diffuseColor.rgb, dvUnder, dvChip );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.36, 0.37, 0.38 ), dvBare );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.055, 0.04 ), 0.55 * dvLow * ( 0.5 + 0.5 * texture2D( uDvNoise, vDvUv * 0.5 ).g ) );
  #endif
  #ifdef DV_F_GALV
    diffuseColor.rgb *= mix( vec3( 1.0 ), dvTint, 0.35 ) * ( 0.9 + 0.2 * dvR );
    dvAge = smoothstep( 0.35, 0.75, dvMac * 0.7 + dvHash( dvId + 4.0 ) * 0.5 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.42, 0.43, 0.42 ), 0.5 * dvAge );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.55, 0.52 ), 0.45 * dvLow );
  #endif
  #ifdef DV_F_CHROME
    diffuseColor.rgb *= dvTint * ( 1.0 - 0.3 * dvLow );
  #endif
  #ifdef DV_F_RUBBER
    diffuseColor.rgb *= mix( vec3( 1.0 ), dvTint, 0.25 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.1, 0.085, 0.07 ), 0.3 * dvLow );
    #ifdef DV_F_WHEEL
      vec3 dvON = normalize( vDvON );
      float dvCap = 1.0 - smoothstep( 0.5, 0.75, vDvTr );
      float dvRel = length( vDvO - dot( vDvO, dvON ) * dvON ) / max( vDvRo, 1e-3 );
      vec3 dvB1 = normalize( cross( dvON, abs( dvON.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 ) ) );
      float dvSp = atan( dot( vDvO, cross( dvON, dvB1 ) ), dot( vDvO, dvB1 ) ) * 0.7957747;
      float dvRim = dvCap * ( 1.0 - smoothstep( 0.6, 0.625, dvRel ) );
      float dvHole = dvRim * smoothstep( 0.3, 0.33, dvRel ) * ( 1.0 - smoothstep( 0.51, 0.54, dvRel ) ) * smoothstep( 0.2, 0.26, abs( fract( dvSp ) - 0.5 ) );
      float dvLug = dvRim * ( 1.0 - smoothstep( 0.03, 0.045, length( vec2( dvRel - 0.22, ( fract( dvSp + 0.5 ) - 0.5 ) * 0.2765 ) ) ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.56, 0.57 ), dvRim );
      diffuseColor.rgb *= ( 1.0 - 0.95 * dvHole ) * ( 1.0 - 0.4 * dvLug );
      float dvWh = vDvRo * dvCap * ( 0.02 * smoothstep( 0.62, 0.72, dvRel ) * ( 1.0 - smoothstep( 0.86, 0.99, dvRel ) )
        + 0.012 * ( smoothstep( 0.56, 0.6, dvRel ) - smoothstep( 0.6, 0.64, dvRel ) )
        + 0.03 * smoothstep( 0.18, 0.55, dvRel ) * dvRim - 0.02 * dvHole + 0.01 * dvLug
        + 0.002 * smoothstep( 0.4, 0.6, sin( dvRel * 180.0 ) ) * step( 0.78, dvRel ) * step( dvRel, 0.84 ) );
    #endif
  #endif
  ${DV_DUST}`;
const FIN_RM = /* glsl */`
  roughnessFactor *= 0.94 + 0.12 * dvHash( dvId + 3.0 );
  #ifdef DV_F_PAINT
    metalnessFactor = 0.6 * dvFlk;
    roughnessFactor = mix( 0.42, 0.3, dvFlk );
  #endif
  #if defined( DV_F_SATIN ) || defined( DV_F_DECAL )
    roughnessFactor = mix( roughnessFactor, 0.75, dvChip );
    roughnessFactor = mix( roughnessFactor, 0.32, dvBare ) + 0.3 * dvLow;
    metalnessFactor = 0.9 * dvBare;
  #endif
  #ifdef DV_F_GALV
    roughnessFactor += 0.3 * dvAge + 0.3 * dvLow;
    metalnessFactor *= 1.0 - 0.45 * dvAge - 0.5 * dvLow;
  #endif
  #ifdef DV_F_CHROME
    roughnessFactor += 0.05 * texture2D( uDvNoise, vDvUv * 1.7 ).r + 0.25 * dvLow;
  #endif
  #ifdef DV_F_WHEEL
    roughnessFactor = mix( roughnessFactor, 0.35, dvRim * ( 1.0 - dvHole ) );
    metalnessFactor = mix( metalnessFactor, 0.85, dvRim * ( 1.0 - dvHole ) );
  #endif
  roughnessFactor = clamp( roughnessFactor, 0.03, 1.0 );
  ${DV_DUST_ROUGH}`;
const FIN_NORMAL = /* glsl */`
  #ifdef DV_F_PAINT
    normal = normalize( mix( nonPerturbedNormal, normal, dvFlk ) );
  #endif
  #ifdef DV_F_WHEEL
    normal = dvBump( normalize( mix( nonPerturbedNormal, normal, 1.0 - dvCap ) ), dvWh );
  #elif defined( DV_F_RUBBER )
    normal = normalize( mix( nonPerturbedNormal, normal, 0.2 ) );
  #endif`;
const FIN_COAT = /* glsl */`
  #ifdef USE_CLEARCOAT
    material.clearcoat *= dvCoat * ( 1.0 - 0.85 * clamp( dvDust, 0.0, 1.0 ) );
    material.clearcoatRoughness = min( material.clearcoatRoughness + 0.03 * dvHash( dvId + 5.0 ) + 0.5 * clamp( dvDust, 0.0, 1.0 ), 1.0 );
  #endif`;

function patchFinish(m: THREE.MeshStandardMaterial, f: SurfaceFinish): void {
  const defs = f === 'wheel' ? ['DV_F_RUBBER', 'DV_F_WHEEL'] : f === 'joinery' ? ['DV_F_SATIN', 'DV_F_JOINERY'] : [`DV_F_${f.toUpperCase()}`];
  m.defines = { ...m.defines, ...Object.fromEntries(defs.map(d => [d, ''])) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDvNoise = { value: sharedNoise() };
    Object.assign(sh.uniforms, dustU, coverU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${DV_VERT_PARS}\n${FIN_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${DV_VERT}\n${FIN_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEAT_PARS}\n${DV_FRAG_PARS}`)
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FIN_PARS}`)
      .replace('#include <color_fragment>', FIN_COLOR)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FIN_RM}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FIN_NORMAL}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${FIN_COAT}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${HEAT_EMIT}`);
  };
  m.customProgramCacheKey = () => `dv-finish-${f}`;
}

const finishes = new Map<SurfaceFinish, THREE.Material>();

export function getFinishMaterial(f: SurfaceFinish): THREE.Material {
  let m = finishes.get(f);
  if (m) return m;
  if (!configured) configureTextures('medium', 4);
  if (f === 'smoked') m = glass(undefined, false, true, true);
  else if (f === 'plate') {
    const p = pbr(texSet('plate'), true);
    patchPiece(p, undefined, 'machine', 'ext');
    m = p;
  } else {
    let s: THREE.MeshStandardMaterial;
    if (f === 'paint') {
      const fl = texSet('flake'), pe = texSet('peel');
      s = new THREE.MeshPhysicalMaterial({
        roughness: 0.4, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
        normalMap: fl.normal, normalScale: new THREE.Vector2(0.35, 0.35),
        clearcoatNormalMap: pe.normal, clearcoatNormalScale: new THREE.Vector2(0.15, 0.15),
      });
    } else if (f === 'chrome') s = new THREE.MeshStandardMaterial({ roughness: 0.05, metalness: 1, color: 0xf4f5f7 });
    else if (f === 'galv') s = pbr(texSet('galv'), true);
    else if (f === 'rubber' || f === 'wheel') s = pbr(texSet('tread'));
    else s = pbr(texSet('satin'));
    patchFinish(s, f);
    m = s;
  }
  finishes.set(f, m);
  return m;
}

/* ---------------- projectiles ---------------- */

const projectiles = new Map<string, THREE.MeshStandardMaterial>();
let chargeMat: THREE.MeshStandardMaterial | null = null;
let beaconMat: THREE.MeshStandardMaterial | null = null;

export function getProjectileMaterial(kind: 'iron' | 'rocket' | 'charge' | 'beacon' | 'yellow' | 'cord'): THREE.Material {
  let m = projectiles.get(kind);
  if (m) return m;
  if (!configured) configureTextures('medium', 4);
  if (kind === 'iron') {
    m = pbr(texSet('gunmetal'), true, 0.6);
    m.color.setHex(0x55585d);
  } else if (kind === 'rocket') {
    m = pbr(texSet('olive'), true);
  } else if (kind === 'yellow') {
    m = new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.5, metalness: 0.2 });
  } else if (kind === 'cord') {
    m = new THREE.MeshStandardMaterial({ color: 0xe0661c, roughness: 0.6, metalness: 0 });
  } else if (kind === 'charge') {
    m = new THREE.MeshStandardMaterial({ color: 0x8f8258, roughness: 0.8, metalness: 0, emissive: 0xff2412, emissiveIntensity: 0 });
    chargeMat = m;
  } else {
    m = new THREE.MeshStandardMaterial({ color: 0xc41c14, roughness: 0.45, metalness: 0.1, emissive: 0xff2a18, emissiveIntensity: 0.8 });
    beaconMat = m;
  }
  projectiles.set(kind, m);
  return m;
}

/** armed charges blink, beacon canisters flicker; called from fx.update */
export function animateMaterials(t: number): void {
  if (chargeMat) chargeMat.emissiveIntensity = (t * 1.6) % 1 < 0.12 ? 0.25 : 0;
  if (beaconMat) beaconMat.emissiveIntensity = 0.7 + 0.5 * Math.sin(t * 23) * Math.sin(t * 7.3);
}

/* ---------------- ground ---------------- */

let groundMat: THREE.MeshStandardMaterial | null = null;

/** dirt/gravel for a ground mesh whose UVs are world metres (x, z); darker compacted site with
    tyre tracks and puddles inside ~60 m of the origin, large-scale tone variation beyond */
export function getGroundMaterial(): THREE.MeshStandardMaterial {
  if (groundMat) return groundMat;
  if (!configured) configureTextures('medium', 4);
  const m = pbr(texSet('ground'), false, 1);
  const site = siteMask(), macro = sharedNoise();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSite = { value: site };
    sh.uniforms.uMacro = { value: macro };
    Object.assign(sh.uniforms, dustU, coverU, envU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;\nuniform sampler2D uSite;\nuniform sampler2D uMacro;\nuniform sampler2D uDvCover;\nuniform float uDvWet;')
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        vec4 gSite = texture2D( uSite, vGW.xz / 160.0 + 0.5 );
        vec2 gN = texture2D( uMacro, vGW.xz / 190.0 ).rg;
        float gN2 = texture2D( uMacro, vGW.xz / 53.0 + 0.37 ).g;
        diffuseColor.rgb *= ( 0.78 + 0.44 * gN.r ) * ( 0.9 + 0.2 * gN2 );
        diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.93, 1.0, 0.86 ), smoothstep( 0.45, 0.75, gN.g ) );
        diffuseColor.rgb *= mix( 1.0, 0.8, gSite.r ) * mix( 1.0, 0.7, gSite.g ) * mix( 1.0, 0.5, gSite.b );
        diffuseColor.rgb *= 1.0 - 0.22 * uDvWet;
        vec4 gCov = texture2D( uDvCover, vGW.xz ${DV_COVER_UV} );
        float gDust = clamp( gCov.a * smoothstep( 0.2, 0.55, gN2 + gCov.a * 0.5 ), 0.0, 0.92 );
        diffuseColor.rgb = mix( diffuseColor.rgb, gCov.rgb, gDust );`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.72, gSite.g * 0.6 );
        roughnessFactor = mix( roughnessFactor, 0.05, gSite.b );
        roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.45, uDvWet * ( 1.0 - gDust ) );
        roughnessFactor = mix( roughnessFactor, 0.95, gDust * 0.7 );`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        normal = normalize( mix( normal, normalize( vNormal ), gSite.b * 0.92 ) );`);
  };
  m.customProgramCacheKey = () => 'dv-ground';
  groundMat = m;
  return m;
}
