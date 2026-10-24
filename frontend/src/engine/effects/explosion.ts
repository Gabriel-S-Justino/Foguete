/** Explosão (terminação de voo ou impacto): bola de fogo, fumaça escura, fagulhas e clarão. */
import { Color3, Color4, DynamicTexture, ParticleSystem, PointLight, type Scene, Vector3 } from '@babylonjs/core';

function puffTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture('explosionTex', { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

export function createExplosion(scene: Scene, at: Vector3, scale: number): void {
  const tex = puffTexture(scene);
  const burst = (name: string, count: number, cfg: (p: ParticleSystem) => void) => {
    const p = new ParticleSystem(name, count, scene);
    p.particleTexture = tex;
    p.emitter = at.clone();
    p.manualEmitCount = count;
    p.minInitialRotation = 0;
    p.maxInitialRotation = Math.PI * 2;
    cfg(p);
    p.disposeOnStop = true;
    p.targetStopDuration = p.maxLifeTime + 0.5;
    p.start();
    return p;
  };
  burst('explosion-fire', 400, (p) => {
    p.createSphereEmitter(scale * 0.4);
    p.color1 = new Color4(1, 0.85, 0.5, 1);
    p.color2 = new Color4(1, 0.45, 0.1, 1);
    p.colorDead = new Color4(0.3, 0.05, 0, 0);
    p.addSizeGradient(0, scale * 0.3);
    p.addSizeGradient(1, scale * 1.4);
    p.minLifeTime = 0.6; p.maxLifeTime = 1.8;
    p.minEmitPower = scale * 0.5; p.maxEmitPower = scale * 2;
    p.addVelocityGradient(0, 1); p.addVelocityGradient(1, 0.1);
    p.blendMode = ParticleSystem.BLENDMODE_ADD;
  });
  burst('explosion-smoke', 300, (p) => {
    p.createSphereEmitter(scale * 0.5);
    p.color1 = new Color4(0.25, 0.22, 0.2, 0.8);
    p.color2 = new Color4(0.45, 0.42, 0.4, 0.6);
    p.colorDead = new Color4(0.5, 0.5, 0.5, 0);
    p.addSizeGradient(0, scale * 0.6);
    p.addSizeGradient(1, scale * 3);
    p.minLifeTime = 4; p.maxLifeTime = 9;
    p.minEmitPower = scale * 0.2; p.maxEmitPower = scale * 0.9;
    p.addVelocityGradient(0, 1); p.addVelocityGradient(1, 0.05);
    p.gravity = new Vector3(0, scale * 0.05, 0);
    p.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  });
  burst('explosion-sparks', 500, (p) => {
    p.createSphereEmitter(scale * 0.2);
    p.color1 = new Color4(1, 0.9, 0.6, 1);
    p.color2 = new Color4(1, 0.6, 0.2, 1);
    p.colorDead = new Color4(0.5, 0.1, 0, 0);
    p.minSize = scale * 0.04; p.maxSize = scale * 0.1;
    p.minLifeTime = 1; p.maxLifeTime = 3;
    p.minEmitPower = scale * 2; p.maxEmitPower = scale * 5;
    p.gravity = new Vector3(0, -9.8, 0);
    p.blendMode = ParticleSystem.BLENDMODE_ADD;
  });
  const flash = new PointLight('explosion-flash', at.clone(), scene);
  flash.diffuse = new Color3(1, 0.7, 0.35);
  flash.range = scale * 40;
  flash.intensity = 60;
  let t = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    flash.intensity = Math.max(0, 60 * (1 - t / 2.5));
    if (t > 3) { scene.onBeforeRenderObservable.remove(obs); flash.dispose(); }
  });
}
