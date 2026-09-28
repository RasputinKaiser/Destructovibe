import * as THREE from 'three';
import { renderer, scene } from './gfx';
import { rand } from '../util';

export type BlockType = 'brick' | 'wood' | 'metal' | 'rubble' | 'barrel' | 'tnt';

export const mats = {} as {
  brick: THREE.MeshStandardMaterial; brickCr: THREE.MeshStandardMaterial;
  rubble: THREE.MeshStandardMaterial; wood: THREE.MeshStandardMaterial;
  woodRaw: THREE.MeshStandardMaterial; metal: THREE.MeshStandardMaterial;
  metalHit: THREE.MeshStandardMaterial; ball: THREE.MeshStandardMaterial;
  rocket: THREE.MeshStandardMaterial; nade: THREE.MeshStandardMaterial;
  c4: THREE.MeshStandardMaterial; barrel: THREE.MeshStandardMaterial;
  tnt: THREE.MeshStandardMaterial;
};

export function makeCanvas(w: number, h: number, fn: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  fn(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function brickPattern(ctx: CanvasRenderingContext2D, cracked: boolean): void {
  const W = 256, H = 256;
  ctx.fillStyle = '#8f8a82'; ctx.fillRect(0, 0, W, H); // mortar
  const bh = 32, bw = 64;
  for (let y = 0; y < H / bh; y++) {
    const off = (y % 2) * bw / 2;
    for (let x = -1; x < W / bw + 1; x++) {
      const r = 150 + rand(-26, 26), g = 64 + rand(-16, 16), b = 48 + rand(-12, 12);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x * bw + off + 2, y * bh + 2, bw - 4, bh - 4);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(${rand(0, 60) | 0},${rand(0, 30) | 0},${rand(0, 20) | 0},${rand(.04, .14)})`;
        ctx.fillRect(x * bw + off + rand(2, bw - 4), y * bh + rand(2, bh - 4), rand(1, 3), rand(1, 3));
      }
    }
  }
  if (cracked) {
    ctx.strokeStyle = 'rgba(20,14,10,0.9)'; ctx.lineWidth = 2.2;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      let x = rand(20, 236), y = rand(0, 40); ctx.moveTo(x, y);
      for (let s = 0; s < 9; s++) { x += rand(-26, 26); y += rand(14, 34); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,240,220,0.28)'; ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      let x = rand(20, 236), y = rand(0, 40); ctx.moveTo(x + 2, y);
      for (let s = 0; s < 8; s++) { x += rand(-24, 24); y += rand(14, 34); ctx.lineTo(x + 2, y); }
      ctx.stroke();
    }
  }
}

export function initMaterials(): void {
  const texBrick = makeCanvas(256, 256, c => brickPattern(c, false));
  const texBrickCr = makeCanvas(256, 256, c => brickPattern(c, true));

  const texWood = makeCanvas(256, 256, ctx => {
    ctx.fillStyle = '#9c7a4e'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(${70 + rand(0, 50) | 0},${45 + rand(0, 30) | 0},${20 + rand(0, 18) | 0},${rand(.15, .5)})`;
      ctx.lineWidth = rand(.6, 2.6); ctx.beginPath();
      const y = rand(0, 256); ctx.moveTo(0, y);
      for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x * .05 + i) * rand(1, 4));
      ctx.stroke();
    }
    for (let k = 0; k < 5; k++) {
      const x = rand(20, 236), y = rand(20, 236);
      ctx.strokeStyle = 'rgba(60,38,18,.55)';
      for (let r = 2; r < 10; r += 2) { ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, 0, 0, 7); ctx.stroke(); }
    }
  });

  const texMetal = makeCanvas(256, 256, ctx => {
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    g.addColorStop(0, '#8d9499'); g.addColorStop(.5, '#b4bcc2'); g.addColorStop(1, '#878e93');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rand(.02, .07)})`;
      ctx.fillRect(rand(0, 256), rand(0, 256), rand(6, 60), 1);
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(40,44,48,${rand(.03, .1)})`;
      ctx.fillRect(rand(0, 256), rand(0, 256), rand(4, 40), 1);
    }
    for (let x = 16; x < 256; x += 48) for (let y = 16; y < 256; y += 48) {
      ctx.fillStyle = 'rgba(50,55,60,.7)'; ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(230,235,240,.5)'; ctx.beginPath(); ctx.arc(x - 1, y - 1, 1.4, 0, 7); ctx.fill();
    }
  });

  const texBarrel = makeCanvas(128, 128, ctx => {
    ctx.fillStyle = '#a33325'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = `rgba(${rand(30, 80) | 0},${rand(10, 30) | 0},${rand(5, 15) | 0},${rand(.05, .25)})`;
      ctx.fillRect(rand(0, 128), rand(0, 128), rand(1, 6), rand(1, 3));
    }
    ctx.fillStyle = 'rgba(255,220,120,.85)';
    ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('☠', 64, 74);
    ctx.strokeStyle = 'rgba(60,20,10,.8)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(128, 22); ctx.moveTo(0, 106); ctx.lineTo(128, 106); ctx.stroke();
  });

  const texTnt = makeCanvas(128, 128, ctx => {
    ctx.fillStyle = '#b8442e'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(${rand(60, 110) | 0},${rand(15, 35) | 0},${rand(5, 20) | 0},${rand(.06, .2)})`;
      ctx.fillRect(rand(0, 128), rand(0, 128), rand(2, 8), rand(1, 4));
    }
    ctx.strokeStyle = 'rgba(40,20,12,.9)'; ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 120, 120);
    ctx.fillStyle = '#f5e9c8';
    ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('TNT', 64, 76);
  });

  mats.brick = new THREE.MeshStandardMaterial({ map: texBrick, roughness: .92, metalness: .02 });
  mats.brickCr = new THREE.MeshStandardMaterial({ map: texBrickCr, roughness: .95, metalness: .02 });
  mats.rubble = new THREE.MeshStandardMaterial({ color: 0x9c5a44, roughness: .98, metalness: .01 });
  mats.wood = new THREE.MeshStandardMaterial({ map: texWood, roughness: .85, metalness: 0 });
  mats.woodRaw = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: .9 });
  mats.metal = new THREE.MeshStandardMaterial({ map: texMetal, roughness: .42, metalness: .85 });
  mats.metalHit = new THREE.MeshStandardMaterial({ map: texMetal, roughness: .62, metalness: .8, color: 0x9aa0a4 });
  mats.ball = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: .35, metalness: .9 });
  mats.rocket = new THREE.MeshStandardMaterial({ color: 0xb8412c, roughness: .5, metalness: .4 });
  mats.nade = new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: .6, metalness: .5 });
  mats.c4 = new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: .7, metalness: .1 });
  mats.barrel = new THREE.MeshStandardMaterial({ map: texBarrel, roughness: .55, metalness: .5 });
  mats.tnt = new THREE.MeshStandardMaterial({ map: texTnt, roughness: .85, metalness: 0 });
}

export function initGround(): void {
  const texGround = makeCanvas(512, 512, ctx => {
    ctx.fillStyle = '#7b6f57'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4200; i++) {
      const v = rand(-24, 24);
      ctx.fillStyle = `rgba(${110 + v | 0},${98 + v | 0},${74 + v | 0},${rand(.25, .7)})`;
      ctx.fillRect(rand(0, 512), rand(0, 512), rand(1, 4), rand(1, 4));
    }
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = `rgba(90,110,60,${rand(.08, .2)})`;
      ctx.beginPath(); ctx.arc(rand(0, 512), rand(0, 512), rand(8, 44), 0, 7); ctx.fill();
    }
  });
  texGround.repeat.set(28, 28);
  const texPad = makeCanvas(256, 256, ctx => {
    ctx.fillStyle = '#9b9890'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2000; i++) {
      const v = rand(-16, 16);
      ctx.fillStyle = `rgba(${150 + v | 0},${147 + v | 0},${140 + v | 0},.5)`;
      ctx.fillRect(rand(0, 256), rand(0, 256), 1.6, 1.6);
    }
    ctx.strokeStyle = 'rgba(60,60,58,.5)'; ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, 252, 252);
    ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256);
    ctx.moveTo(0, 128); ctx.lineTo(256, 128); ctx.stroke();
  });
  texPad.repeat.set(6, 6);

  const gMesh = new THREE.Mesh(new THREE.PlaneGeometry(560, 560),
    new THREE.MeshStandardMaterial({ map: texGround, roughness: 1 }));
  gMesh.rotation.x = -Math.PI / 2; gMesh.receiveShadow = true; scene.add(gMesh);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(64, 44),
    new THREE.MeshStandardMaterial({ map: texPad, roughness: .95 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.02, -16); pad.receiveShadow = true; scene.add(pad);
}

const geoCache: Record<string, THREE.BoxGeometry> = {};
export function boxGeo(x: number, y: number, z: number): THREE.BoxGeometry {
  const k = `${x}|${y}|${z}`;
  if (!geoCache[k]) geoCache[k] = new THREE.BoxGeometry(x, y, z);
  return geoCache[k];
}
