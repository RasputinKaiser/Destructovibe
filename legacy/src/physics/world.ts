import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };
export let world: RAPIER.World;
export let eventQueue: RAPIER.EventQueue;

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  eventQueue = new RAPIER.EventQueue(true);

  const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(300, 0.5, 300).setFriction(0.7).setRestitution(0.05), g);
}
