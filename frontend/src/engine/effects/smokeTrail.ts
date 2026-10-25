/**
 * Rastro de fumaça ao longo da trajetória: partículas no espaço do mundo, distribuídas entre a posição do
 * bocal no quadro anterior e a atual (sem falhas mesmo a milhares de m/s). O rastro é denso na baixa
 * atmosfera, afina com a altitude e deixa de ser emitido acima de uma altitude limite, onde o ar é rarefeito
 * demais para formar a coluna visível. As partículas envelhecem com o relógio da simulação, então a
 * aceleração de tempo também acelera a dispersão.
 */
import { Color4, type DynamicTexture, ParticleSystem, type Scene, Vector3 } from '@babylonjs/core';

export interface SmokeTrailOptions {
  texture: DynamicTexture;
  color: Color4;
  /** Altitude (m) até a qual o rastro é denso. */
  denseAltM?: number;
  /** Altitude (m) acima da qual não há mais emissão. */
  maxAltM?: number;
}

export interface SmokeTrail {
  readonly system: ParticleSystem;
  /** nozzle: posição do bocal no mundo; plumeDia: diâmetro do conjunto de motores (m). */
  update(nozzle: Vector3, altM: number, emitting: boolean, simDt: number, plumeDia: number, quality: number): void;
  /** Desloca o rastro inteiro (mudança de origem flutuante). */
  shift(delta: Vector3): void;
  dispose(): void;
}

export function createSmokeTrail(scene: Scene, opts: SmokeTrailOptions): SmokeTrail {
  const denseAlt = opts.denseAltM ?? 15000;
  const maxAlt = opts.maxAltM ?? 45000;
  const ps = new ParticleSystem('trajectory-smoke', 9000, scene);
  ps.particleTexture = opts.texture;
  ps.emitter = Vector3.Zero();
  ps.emitRate = 0;
  ps.manualEmitCount = 0;
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.minLifeTime = 120;
  ps.maxLifeTime = 240;
  ps.minEmitPower = 1;
  ps.maxEmitPower = 1;
  ps.minAngularSpeed = -0.02;
  ps.maxAngularSpeed = 0.02;
  ps.minInitialRotation = 0;
  ps.maxInitialRotation = Math.PI * 2;
  // Tamanho relativo ao longo da vida (a escala absoluta depende da altitude na emissão)
  ps.addSizeGradient(0, 1);
  ps.addSizeGradient(0.15, 2.2);
  ps.addSizeGradient(1, 4.5);
  ps.colorDead = new Color4(opts.color.r * 0.9, opts.color.g * 0.9, opts.color.b * 0.92, 0);

  const prev = new Vector3();
  const cur = new Vector3();
  let hasPrev = false;
  let jitter = 1;
  ps.startPositionFunction = (_m, pos) => {
    Vector3.LerpToRef(prev, cur, Math.random(), pos);
    pos.x += (Math.random() - 0.5) * jitter;
    pos.y += (Math.random() - 0.5) * jitter;
    pos.z += (Math.random() - 0.5) * jitter;
  };
  // Deriva lenta (vento e expansão da coluna)
  ps.startDirectionFunction = (_m, dir) => {
    dir.set((Math.random() - 0.5) * 3 + 2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3);
  };
  ps.start();

  return {
    system: ps,
    update(nozzle, altM, emitting, simDt, plumeDia, quality) {
      // Envelhece com o tempo simulado: o Babylon avança updateSpeed × (razão de animação) por quadro
      ps.updateSpeed = Math.max(0, simDt) / Math.max(0.05, scene.getAnimationRatio());
      if (!emitting || altM > maxAlt || simDt <= 0) {
        hasPrev = false;
        ps.manualEmitCount = 0;
        return;
      }
      if (!hasPrev) { prev.copyFrom(nozzle); cur.copyFrom(nozzle); hasPrev = true; return; }
      prev.copyFrom(cur);
      cur.copyFrom(nozzle);
      // A coluna se alarga com a altitude (ar mais rarefeito) e fica mais transparente acima da faixa densa
      const spread = 1 + altM / 6000;
      const size = Math.max(4, plumeDia * 2.6) * spread;
      jitter = size * 0.25;
      const thin = altM < denseAlt ? 1 : 1 - (altM - denseAlt) / (maxAlt - denseAlt);
      const a = opts.color.a * Math.max(0, thin) ** 1.5;
      ps.color1 = new Color4(opts.color.r, opts.color.g, opts.color.b, a);
      ps.color2 = new Color4(opts.color.r * 0.93, opts.color.g * 0.93, opts.color.b * 0.95, a * 0.8);
      ps.minScaleX = ps.minScaleY = size * 0.8;
      ps.maxScaleX = ps.maxScaleY = size * 1.2;
      const dist = Vector3.Distance(prev, cur);
      const perFrame = quality === 0 ? 40 : quality === 1 ? 80 : 140;
      ps.manualEmitCount = Math.min(perFrame, Math.ceil(dist / (size * 0.45)));
    },
    shift(delta) {
      for (const p of ps.particles) p.position.subtractInPlace(delta);
      prev.subtractInPlace(delta);
      cur.subtractInPlace(delta);
    },
    dispose() { ps.dispose(false); },
  };
}
