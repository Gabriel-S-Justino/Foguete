/**
 * Gerencia o único Engine Babylon.js da aplicação: troca de cenas com descarte de recursos,
 * perda/recuperação de contexto WebGL e redução de qualidade quando a taxa de quadros cai.
 */
import { Engine, type Scene } from '@babylonjs/core';

export interface SceneController {
  scene: Scene;
  /** Chamado a cada quadro antes do render (dt em segundos de relógio real). */
  update?(dtS: number): void;
  /** Ajuste de qualidade (0 = baixo, 1 = médio, 2 = alto). */
  setQuality?(level: number): void;
  dispose(): void;
}

export type SceneFactory<T extends SceneController> = (engine: Engine) => T | Promise<T>;

export interface EngineStatus {
  webgl2: boolean;
  contextLost: boolean;
  fps: number;
  quality: number;
  loading: boolean;
  degraded: boolean;
}

type Listener = (s: EngineStatus) => void;

export function detectWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2'));
  } catch {
    return false;
  }
}

class SceneManagerImpl {
  private engine: Engine | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private current: SceneController | null = null;
  private currentKey = '';
  private listeners = new Set<Listener>();
  private lowFpsTime = 0;
  private loadToken = 0;
  /** Cena pedida antes de o canvas existir (o efeito da tela roda antes do efeito do App que cria o Engine). */
  private pending: { key: string; factory: SceneFactory<SceneController>; resolve: (c: SceneController | null) => void } | null = null;
  status: EngineStatus = { webgl2: true, contextLost: false, fps: 60, quality: 2, loading: false, degraded: false };

  attach(canvas: HTMLCanvasElement): boolean {
    if (this.engine && this.canvas === canvas) return true;
    this.detach();
    if (!detectWebGL2()) {
      this.setStatus({ webgl2: false });
      return false;
    }
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, disableWebGL2Support: false, powerPreference: 'high-performance', useHighPrecisionMatrix: true }, true);
    this.engine.onContextLostObservable.add(() => this.setStatus({ contextLost: true }));
    this.engine.onContextRestoredObservable.add(() => this.setStatus({ contextLost: false }));
    const onResize = () => this.engine?.resize();
    window.addEventListener('resize', onResize);
    this.engine.onDisposeObservable.add(() => window.removeEventListener('resize', onResize));
    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const ctrl = this.current;
      if (!ctrl || this.status.contextLost) return;
      ctrl.update?.(dt);
      ctrl.scene.render();
      this.monitorPerformance(dt);
    });
    this.setStatus({ webgl2: true });
    const queued = this.pending;
    this.pending = null;
    if (queued) void this.show(queued.key, queued.factory).then(queued.resolve, () => queued.resolve(null));
    return true;
  }

  private monitorPerformance(dt: number): void {
    const fps = this.engine?.getFps() ?? 60;
    if (fps < 28 && this.status.quality > 0) {
      this.lowFpsTime += dt;
      if (this.lowFpsTime > 3) {
        const q = this.status.quality - 1;
        this.current?.setQuality?.(q);
        this.lowFpsTime = 0;
        this.setStatus({ quality: q, degraded: true, fps });
      }
    } else {
      this.lowFpsTime = 0;
    }
    if (Math.abs(fps - this.status.fps) > 5) this.setStatus({ fps: Math.round(fps) });
  }

  /** Mostra uma cena; a cena anterior é descartada (sem múltiplos engines ativos). */
  async show<T extends SceneController>(key: string, factory: SceneFactory<T>): Promise<T | null> {
    if (!this.engine) {
      // Sem Engine ainda: guarda o pedido (o mais recente vale) e cria a cena assim que o canvas for ligado
      this.pending?.resolve(null);
      return new Promise<T | null>((resolve) => { this.pending = { key, factory, resolve: resolve as (c: SceneController | null) => void }; });
    }
    if (this.currentKey === key && this.current) return this.current as T;
    const token = ++this.loadToken;
    this.setStatus({ loading: true });
    const previous = this.current;
    this.current = null;
    this.currentKey = key;
    previous?.dispose();
    try {
      const ctrl = await factory(this.engine);
      if (token !== this.loadToken) {
        ctrl.dispose();
        return null;
      }
      ctrl.setQuality?.(this.status.quality);
      // Uma textura ou shader que nunca fica pronto não pode travar a tela: após o limite a cena é exibida
      // mesmo assim (os recursos pendentes aparecem quando terminarem)
      let readyTimer = 0;
      await Promise.race([
        ctrl.scene.whenReadyAsync(),
        new Promise<void>((resolve) => { readyTimer = window.setTimeout(() => {
          const pending = ctrl.scene.meshes.filter((m) => m.isEnabled() && !m.isReady(true)).map((m) => `${m.name}${m.material ? ` (${m.material.name})` : ''}`);
          console.warn(`cena "${key}" exibida com recursos pendentes: ${pending.slice(0, 12).join(', ') || 'texturas/pós-processamento'}`);
          resolve();
        }, 20000); }),
      ]);
      window.clearTimeout(readyTimer);
      this.current = ctrl;
      return ctrl;
    } finally {
      if (token === this.loadToken) this.setStatus({ loading: false });
    }
  }

  get controller(): SceneController | null { return this.current; }
  get key(): string { return this.currentKey; }

  clear(): void {
    this.loadToken++;
    this.current?.dispose();
    this.current = null;
    this.currentKey = '';
  }

  detach(): void {
    this.clear();
    this.engine?.dispose();
    this.engine = null;
    this.canvas = null;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.status);
    return () => this.listeners.delete(l);
  }

  private setStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l(this.status));
  }
}

export const sceneManager = new SceneManagerImpl();
