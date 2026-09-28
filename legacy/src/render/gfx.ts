import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export let renderer: THREE.WebGLRenderer;
export let scene: THREE.Scene;
export let camera: THREE.PerspectiveCamera;
export let sun: THREE.DirectionalLight;

export function initGfx(): void {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc3d4e0, 70, 380);

  // metals need something to reflect or they render black
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 600);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7f66, 0.25);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff2dd, 2.8);
  sun.position.set(-70, 85, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0001; sun.shadow.normalBias = 0.05;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(480, 24, 14),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x4f8fd6) }, mid: { value: new THREE.Color(0xa8c8e8) },
        bot: { value: new THREE.Color(0xe8ddc8) }, sunDir: { value: new THREE.Vector3(-70, 85, 40).normalize() },
      },
      vertexShader: `varying vec3 vP; void main(){vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top,mid,bot,sunDir;
        void main(){ float h=clamp(vP.y,0.,1.);
          vec3 c=mix(bot, mix(mid,top,pow(h,0.85)), smoothstep(0.,0.35,h));
          float s=pow(max(dot(vP,sunDir),0.),350.)*1.4 + pow(max(dot(vP,sunDir),0.),8.)*.18;
          c+=vec3(1.,.92,.75)*s; gl_FragColor=vec4(c,1.);}`,
    }));
  scene.add(sky);
}

export function setQuality(q: 'high' | 'low'): void {
  renderer.shadowMap.enabled = q === 'high';
  renderer.setPixelRatio(q === 'high' ? Math.min(devicePixelRatio, 1.75) : 1);
  sun.castShadow = q === 'high';
  scene.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) m.needsUpdate = true;
  });
}
