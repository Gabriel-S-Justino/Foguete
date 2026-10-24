/**
 * Efeitos de propulsão: pluma de exaustão, fumaça/poeira na plataforma e luz da exaustão.
 * Intensidade e expansão da pluma acompanham o empuxo e a pressão ambiente vindos da simulação.
 */
import { Color3, Color4, DynamicTexture, ParticleSystem, PointLight, type Scene, type TransformNode, Vector3 } from '@babylonjs/core';

let flameTexture: DynamicTexture | null = null;
let smokeTexture: DynamicTexture | null = null;

function radialTexture(scene: Scene, name: string, inner: string, outer: string): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

export interface ExhaustEffect {
  /** throttle 0..1, ambientPressureRatio 0 (vácuo) .. 1 (nível do mar), groundProximity 0..1 */
  set(throttle: number, ambientPressureRatio: number, groundProximity: number): void;
  setQuality(level: number): void;
  stop(): void;
  dispose(): void;
}

export function createExhaust(scene: Scene, emitter: TransformNode, scale: number, groundEmitter?: TransformNode): ExhaustEffect {
  if (!flameTexture || flameTexture.getScene() !== scene) flameTexture = radialTexture(scene, 'flameTex', 'rgba(255,255,255,1)', 'rgba(255,140,40,0)');
  if (!smokeTexture || smokeTexture.getScene() !== scene) smokeTexture = radialTexture(scene, 'smokeTex', 'rgba(230,230,230,0.9)', 'rgba(200,200,200,0)');

  const flame = new ParticleSystem('flame', 4000, scene);
  flame.particleTexture = flameTexture;
  flame.emitter = emitter as unknown as Vector3;
  flame.minEmitBox = new Vector3(-0.3 * scale, 0, -0.3 * scale);
  flame.maxEmitBox = new Vector3(0.3 * scale, 0, 0.3 * scale);
  flame.direction1 = new Vector3(-0.15, -1, -0.15);
  flame.direction2 = new Vector3(0.15, -1, 0.15);
  flame.color1 = new Color4(1, 0.9, 0.6, 1);
  flame.color2 = new Color4(1, 0.55, 0.15, 1);
  flame.colorDead = new Color4(0.4, 0.15, 0.05, 0);
  flame.minLifeTime = 0.08;
  flame.maxLifeTime = 0.22;
  flame.blendMode = ParticleSystem.BLENDMODE_ADD;
  flame.emitRate = 0;
  flame.minEmitPower = 30 * scale;
  flame.maxEmitPower = 60 * scale;
  flame.updateSpeed = 0.016;
  flame.start();

  const smoke = new ParticleSystem('smoke', 3000, scene);
  smoke.particleTexture = smokeTexture;
  smoke.emitter = (groundEmitter ?? emitter) as unknown as Vector3;
  smoke.minEmitBox = new Vector3(-3 * scale, 0, -3 * scale);
  smoke.maxEmitBox = new Vector3(3 * scale, 0, 3 * scale);
  smoke.direction1 = new Vector3(-1, 0.15, -1);
  smoke.direction2 = new Vector3(1, 0.4, 1);
  smoke.color1 = new Color4(0.85, 0.85, 0.85, 0.5);
  smoke.color2 = new Color4(0.7, 0.68, 0.65, 0.4);
  smoke.colorDead = new Color4(0.6, 0.6, 0.6, 0);
  smoke.minSize = 6 * scale;
  smoke.maxSize = 16 * scale;
  smoke.minLifeTime = 3;
  smoke.maxLifeTime = 7;
  smoke.minEmitPower = 8;
  smoke.maxEmitPower = 25;
  smoke.emitRate = 0;
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  smoke.gravity = new Vector3(0, 1.5, 0);
  smoke.start();

  const light = new PointLight('exhaust-light', new Vector3(0, -3, 0), scene);
  light.parent = emitter;
  light.diffuse = new Color3(1, 0.62, 0.25);
  light.intensity = 0;
  light.range = 250 * scale;

  let quality = 2;
  return {
    set(throttle, pressure, ground) {
      const q = quality === 0 ? 0.35 : quality === 1 ? 0.65 : 1;
      flame.emitRate = throttle * 2600 * q;
      // Pluma se expande com a queda da pressão ambiente (sobre-expansão relativa no vácuo)
      const expansion = 1 + (1 - pressure) * 3.5;
      flame.minSize = 1.2 * scale * expansion;
      flame.maxSize = 3.0 * scale * expansion;
      flame.minLifeTime = 0.08 + 0.12 * throttle;
      flame.maxLifeTime = 0.2 + 0.35 * throttle;
      smoke.emitRate = throttle * ground * 260 * q;
      light.intensity = throttle * (8 + 30 * pressure) * scale;
    },
    setQuality(level) { quality = level; },
    stop() { flame.emitRate = 0; smoke.emitRate = 0; light.intensity = 0; },
    dispose() { flame.dispose(); smoke.dispose(); light.dispose(); },
  };
}
