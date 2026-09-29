/* Dev-only photo helper for evidence shots: pose the (flying) player, hide the HUD, aim overlay and viewmodel, and
   post the canvas as a PNG to a local receiver. Installed by main.ts in dev builds; does nothing until called. */

type Dv = {
  state: string; player: { fly: boolean }; scene: { traverse(f: (o: { isGroup?: boolean; children: { material?: { depthTest?: boolean } }[]; visible: boolean }) => void): void };
  gfx: { renderer: { domElement: HTMLCanvasElement } };
  sandbox(): void; setPlaying(): void; teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void;
  vm(id: string, pos?: number[], rot?: number[], scale?: number): unknown;
};

export function installPhoto(): void {
  const w = window as unknown as { __dv?: Dv; __photo?: unknown };
  const dv = () => w.__dv!;
  const clean = () => {
    for (const el of document.querySelectorAll<HTMLElement>('body *')) if (el.tagName !== 'CANVAS' && !el.querySelector('canvas')) el.style.visibility = 'hidden';
    dv().scene.traverse((o) => { if (o.isGroup && o.children.length >= 3 && o.children.every((c) => c.material && c.material.depthTest === false)) o.visible = false; });
    try { dv().vm('hammer', [0, -50, 0], undefined, 0.001); } catch { /* no viewmodel yet */ }
  };
  w.__photo = {
    start: () => { const d = dv(); if (d.state === 'title' || d.state === 'loading') d.sandbox(); return d.state; },
    go: (x: number, y: number, z: number, yaw: number, pitch: number) => { const d = dv(); d.setPlaying(); clean(); d.player.fly = true; d.teleport(x, y, z, yaw, pitch); return d.state; },
    snap: (name: string, port = 5199) => new Promise<string>((res) => requestAnimationFrame(() => {
      const c = dv().gfx.renderer.domElement;
      fetch(`http://127.0.0.1:${port}/${name}`, { method: 'POST', body: c.toDataURL('image/png') })
        .then((r) => r.text()).then((t) => res(`${name} ${c.width}x${c.height} ${t}`)).catch((e) => res(`ERR ${e}`));
    })),
  };
}
