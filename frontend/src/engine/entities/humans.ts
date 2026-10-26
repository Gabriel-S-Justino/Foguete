/**
 * Técnicos e engenheiros em escala humana, procedurais (sem modelo externo: não há modelo humano com licença
 * compatível alcançável deste ambiente; ver docs/visual-references.md).
 *
 * Proporções: comprimentos dos segmentos como fração da estatura H, pela tabela de Drillis & Contini (1966),
 * reproduzida em Winter, "Biomechanics and Motor Control of Human Movement" (pé 0,152 H, perna 0,246 H, coxa
 * 0,245 H, braço 0,186 H, antebraço 0,146 H, mão 0,108 H, ombro a 0,818 H, quadril a 0,530 H, largura dos
 * ombros 0,259 H). A estatura de referência é 1,75 m, com variação de 1,62 m a 1,86 m entre os personagens.
 * Tudo em metros, na mesma escala da cena (1 unidade = 1 m), sem ajuste para "aparecer na câmera".
 *
 * Esqueleto: nós de transformação por articulação (quadril, joelho, tornozelo, ombro, cotovelo, punho,
 * pescoço); cada segmento é uma instância de uma malha-modelo compartilhada (poucas chamadas de desenho).
 * As poses e animações movem só as articulações; não há deformação de malha.
 *
 * Vestimenta (referência: sala limpa do High Bay 1 do JPL, classe 10.000): macacão branco "bunny suit",
 * capuz, máscara, luvas de nitrila e propés; fora da sala limpa, macacão, capacete e botas de segurança.
 */
import { Color3, type InstancedMesh, type Mesh, MeshBuilder, PBRMaterial, type Scene, TransformNode, Vector3 } from '@babylonjs/core';

export type Outfit = 'cleanroom' | 'coverall';
export type Activity = 'stand' | 'inspect' | 'clipboard' | 'console' | 'crouch' | 'reach-up' | 'walk' | 'point';

/** Proporções de Drillis & Contini (fração da estatura). */
export const BODY = {
  ankle: 0.039, shank: 0.246, thigh: 0.245, hip: 0.53, shoulder: 0.818, upperArm: 0.186, forearm: 0.146, hand: 0.108,
  foot: 0.152, shoulderHalf: 0.115, hipHalf: 0.05, headTop: 1.0, chin: 0.87,
} as const;

interface Joint { node: TransformNode; rest: Vector3 }

export interface WorkerOptions {
  height?: number;
  outfit?: Outfit;
  activity?: Activity;
  position: Vector3;
  /** Direção para onde o personagem olha (rad, em torno de Y; 0 = +Z). */
  yaw?: number;
  /** Ponto de interesse (cabeça e tronco se orientam para ele). */
  lookAt?: Vector3;
  /** Caminho em laço (atividade "walk"). */
  path?: Vector3[];
  skin?: number;
  /** Cor do capacete (fora da sala limpa). */
  helmet?: 'white' | 'yellow' | 'blue';
  prop?: 'clipboard' | 'tablet' | 'flashlight' | 'wrench' | null;
  seed?: number;
}

export interface Worker {
  root: TransformNode;
  height: number;
  activity: Activity;
  update(dt: number): void;
  dispose(): void;
}

const SKIN = [new Color3(0.86, 0.68, 0.56), new Color3(0.62, 0.44, 0.32), new Color3(0.42, 0.29, 0.21), new Color3(0.93, 0.78, 0.67), new Color3(0.76, 0.57, 0.43)];

/** Malhas-modelo e materiais compartilhados por todos os personagens da cena. */
export class CrewKit {
  private templates = new Map<string, Mesh>();
  private materials = new Map<string, PBRMaterial>();
  constructor(private scene: Scene) {}

  material(key: string, color: Color3, roughness = 0.85, metallic = 0): PBRMaterial {
    let m = this.materials.get(key);
    if (!m) {
      m = new PBRMaterial(`crew-${key}`, this.scene);
      m.albedoColor = color;
      m.roughness = roughness;
      m.metallic = metallic;
      this.materials.set(key, m);
    }
    return m;
  }

  /** Instância de uma malha-modelo (cápsula, esfera, caixa) com o material dado. */
  part(shape: 'capsule' | 'sphere' | 'box' | 'hood' | 'cyl', matKey: string, name: string): InstancedMesh {
    const key = `${shape}|${matKey}`;
    let t = this.templates.get(key);
    if (!t) {
      const s = this.scene;
      if (shape === 'capsule') t = MeshBuilder.CreateCapsule(`crew-t-${key}`, { radius: 0.5, height: 2, tessellation: 12, capSubdivisions: 4 }, s);
      else if (shape === 'sphere') t = MeshBuilder.CreateSphere(`crew-t-${key}`, { diameter: 1, segments: 12 }, s);
      else if (shape === 'hood') t = MeshBuilder.CreateSphere(`crew-t-${key}`, { diameter: 1, segments: 12, arc: 0.72, sideOrientation: 2 }, s);
      else if (shape === 'cyl') t = MeshBuilder.CreateCylinder(`crew-t-${key}`, { diameter: 1, height: 1, tessellation: 14 }, s);
      else t = MeshBuilder.CreateBox(`crew-t-${key}`, { size: 1 }, s);
      t.material = this.materials.get(matKey) ?? null;
      t.isVisible = false;
      t.isPickable = false;
      this.templates.set(key, t);
    }
    const inst = t.createInstance(name);
    inst.isPickable = false;
    return inst;
  }

  /** Malhas-modelo (para registrar sombras: as instâncias projetam sombra junto com o modelo). */
  get meshes(): Mesh[] { return [...this.templates.values()]; }
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/** Cria um personagem articulado, de pé com os pés no chão (y da posição). */
export function createWorker(scene: Scene, kit: CrewKit, o: WorkerOptions): Worker {
  const H = o.height ?? 1.75;
  const outfit = o.outfit ?? 'cleanroom';
  let seed = o.seed ?? Math.round(o.position.x * 131 + o.position.z * 71);
  const rnd = () => ((seed = (seed * 16807 + 11) % 2147483647) / 2147483647);
  const id = `crew${Math.abs(seed) % 100000}`;
  const skinColor = SKIN[(o.skin ?? Math.floor(rnd() * SKIN.length)) % SKIN.length]!;
  const skinKey = `skin${SKIN.indexOf(skinColor)}`;
  kit.material(skinKey, skinColor, 0.6);
  // Tecidos e EPIs: albedo de tecido (rugosidade alta, sem metal)
  const suitKey = outfit === 'cleanroom' ? 'suitWhite' : 'suitNavy';
  kit.material('suitWhite', new Color3(0.86, 0.88, 0.9), 0.9);
  kit.material('suitNavy', new Color3(0.08, 0.12, 0.22), 0.9);
  kit.material('nitrile', new Color3(0.36, 0.33, 0.62), 0.55);
  kit.material('workGlove', new Color3(0.42, 0.36, 0.25), 0.9);
  kit.material('bootie', new Color3(0.8, 0.83, 0.86), 0.8);
  kit.material('boot', new Color3(0.08, 0.07, 0.06), 0.7);
  kit.material('mask', new Color3(0.92, 0.94, 0.95), 0.95);
  kit.material('hair', new Color3(0.08, 0.06, 0.05), 0.7);
  kit.material('helmet-white', new Color3(0.9, 0.9, 0.88), 0.35);
  kit.material('helmet-yellow', new Color3(0.85, 0.65, 0.08), 0.35);
  kit.material('helmet-blue', new Color3(0.1, 0.25, 0.6), 0.35);
  kit.material('hivis', new Color3(0.85, 0.82, 0.1), 0.8);
  kit.material('reflective', new Color3(0.75, 0.75, 0.75), 0.3, 0.6);
  kit.material('propDark', new Color3(0.06, 0.06, 0.07), 0.5);
  kit.material('propPaper', new Color3(0.9, 0.9, 0.86), 0.9);
  kit.material('propScreen', new Color3(0.1, 0.25, 0.35), 0.2);
  kit.material('propMetal', new Color3(0.6, 0.6, 0.62), 0.35, 0.9);

  const root = new TransformNode(`${id}-root`, scene);
  root.position.copyFrom(o.position);
  root.rotation.y = o.yaw ?? 0;
  const joints: Record<string, Joint> = {};
  const joint = (name: string, parent: TransformNode, pos: Vector3): TransformNode => {
    const n = new TransformNode(`${id}-${name}`, scene);
    n.parent = parent;
    n.position.copyFrom(pos);
    joints[name] = { node: n, rest: pos.clone() };
    return n;
  };
  /** Segmento entre a articulação e o próximo ponto (eixo −Y local), como cápsula de raio r. */
  const limb = (parent: TransformNode, len: number, r: number, mat: string, name: string, r2 = r) => {
    const m = kit.part('capsule', mat, `${id}-${name}`);
    m.parent = parent;
    const rr = (r + r2) / 2;
    // Cápsula-modelo: raio 0,5 e altura 2 (com as calotas); escala para o comprimento útil + calotas
    m.scaling.set(rr * 2, (len + rr * 2) / 2, rr * 2 * (r2 / r > 1 ? 1 : 0.92));
    m.position.y = -len / 2;
    return m;
  };
  const box = (parent: TransformNode, size: Vector3, pos: Vector3, mat: string, name: string) => {
    const m = kit.part('box', mat, `${id}-${name}`);
    m.parent = parent; m.scaling.copyFrom(size); m.position.copyFrom(pos);
    return m;
  };
  const ball = (parent: TransformNode, size: Vector3, pos: Vector3, mat: string, name: string, shape: 'sphere' | 'hood' = 'sphere') => {
    const m = kit.part(shape, mat, `${id}-${name}`);
    m.parent = parent; m.scaling.copyFrom(size); m.position.copyFrom(pos);
    return m;
  };

  // Pelve e tronco
  const pelvis = joint('pelvis', root, new Vector3(0, BODY.hip * H, 0));
  const hipsW = BODY.hipHalf * H;
  ball(pelvis, new Vector3(0.36 * H * 0.5, 0.12 * H, 0.2 * H * 0.55), new Vector3(0, 0.01 * H, 0), suitKey, 'hips');
  const spine = joint('spine', pelvis, new Vector3(0, 0.04 * H, 0));
  // Tronco: cápsula achatada (largura 0,19 H, profundidade 0,12 H) do quadril aos ombros
  const torso = kit.part('capsule', suitKey, `${id}-torso`);
  torso.parent = spine;
  torso.scaling.set(0.19 * H, 0.165 * H, 0.12 * H);
  torso.position.y = 0.13 * H;
  if (outfit === 'coverall') {
    // Colete de alta visibilidade com faixas refletivas
    box(spine, new Vector3(0.2 * H, 0.15 * H, 0.125 * H), new Vector3(0, 0.15 * H, 0), 'hivis', 'vest');
    box(spine, new Vector3(0.205 * H, 0.012 * H, 0.128 * H), new Vector3(0, 0.12 * H, 0), 'reflective', 'band1');
    box(spine, new Vector3(0.205 * H, 0.012 * H, 0.128 * H), new Vector3(0, 0.18 * H, 0), 'reflective', 'band2');
  }
  const neck = joint('neck', spine, new Vector3(0, (BODY.shoulder - BODY.hip - 0.04 + 0.01) * H, 0));
  limb(neck, 0.05 * H, 0.03 * H, outfit === 'cleanroom' ? suitKey : skinKey, 'neckSeg').position.y = 0.025 * H;
  const head = joint('head', neck, new Vector3(0, 0.07 * H, 0.005 * H));
  const headC = new Vector3(0, 0.045 * H, 0);
  ball(head, new Vector3(0.082 * H, 0.118 * H, 0.1 * H), headC, skinKey, 'head');
  // Nariz discreto (dá leitura de direção do rosto)
  ball(head, new Vector3(0.016 * H, 0.025 * H, 0.02 * H), new Vector3(0, 0.04 * H, 0.05 * H), skinKey, 'nose');
  if (outfit === 'cleanroom') {
    // Capuz com abertura para o rosto (arco de 72%, abertura voltada para a frente), máscara e óculos
    const hood = ball(head, new Vector3(0.1 * H, 0.135 * H, 0.118 * H), headC.add(new Vector3(0, 0.004 * H, -0.004 * H)), 'suitWhite', 'hood', 'hood');
    hood.rotation.y = Math.PI / 2 + (1 - 0.72) * Math.PI;
    ball(head, new Vector3(0.07 * H, 0.04 * H, 0.04 * H), new Vector3(0, 0.012 * H, 0.04 * H), 'mask', 'mask');
    box(head, new Vector3(0.07 * H, 0.014 * H, 0.012 * H), new Vector3(0, 0.055 * H, 0.05 * H), 'propDark', 'glasses');
  } else {
    ball(head, new Vector3(0.086 * H, 0.06 * H, 0.104 * H), headC.add(new Vector3(0, 0.03 * H, -0.004 * H)), 'hair', 'hair');
    const helmetKey = `helmet-${o.helmet ?? 'white'}`;
    const shell = ball(head, new Vector3(0.112 * H, 0.075 * H, 0.13 * H), headC.add(new Vector3(0, 0.045 * H, 0)), helmetKey, 'helmet');
    shell.scaling.y = 0.075 * H;
    box(head, new Vector3(0.11 * H, 0.006 * H, 0.05 * H), headC.add(new Vector3(0, 0.03 * H, 0.06 * H)), helmetKey, 'brim');
    box(head, new Vector3(0.07 * H, 0.014 * H, 0.012 * H), new Vector3(0, 0.055 * H, 0.05 * H), 'propDark', 'glasses');
  }

  // Braços (direito = +X)
  const glove = outfit === 'cleanroom' ? 'nitrile' : 'workGlove';
  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'R' : 'L';
    const sh = joint(`shoulder${s}`, spine, new Vector3(side * BODY.shoulderHalf * H, (BODY.shoulder - BODY.hip - 0.04 - 0.02) * H, 0));
    ball(sh, new Vector3(0.075 * H, 0.07 * H, 0.075 * H), Vector3.Zero(), suitKey, `delt${s}`);
    limb(sh, BODY.upperArm * H, 0.034 * H, suitKey, `upperArm${s}`, 0.03 * H);
    const el = joint(`elbow${s}`, sh, new Vector3(0, -BODY.upperArm * H, 0));
    limb(el, BODY.forearm * H, 0.029 * H, suitKey, `forearm${s}`, 0.024 * H);
    const wr = joint(`wrist${s}`, el, new Vector3(0, -BODY.forearm * H, 0));
    const hand = kit.part('capsule', glove, `${id}-hand${s}`);
    hand.parent = wr;
    hand.scaling.set(0.045 * H, 0.05 * H, 0.025 * H);
    hand.position.y = -0.045 * H;
  }
  // Pernas
  for (const side of [1, -1] as const) {
    const s = side === 1 ? 'R' : 'L';
    const hp = joint(`hip${s}`, pelvis, new Vector3(side * hipsW, 0, 0));
    limb(hp, BODY.thigh * H, 0.06 * H, suitKey, `thigh${s}`, 0.045 * H);
    const kn = joint(`knee${s}`, hp, new Vector3(0, -BODY.thigh * H, 0));
    limb(kn, BODY.shank * H, 0.042 * H, suitKey, `shank${s}`, 0.033 * H);
    const an = joint(`ankle${s}`, kn, new Vector3(0, -BODY.shank * H, 0));
    // Pé: do tornozelo ao chão (0,039 H) e da ponta ao calcanhar (0,152 H)
    const foot = box(an, new Vector3(0.058 * H, BODY.ankle * H * 1.05, BODY.foot * H * 1.04), new Vector3(0, -BODY.ankle * H * 0.5, BODY.foot * H * 0.3), outfit === 'cleanroom' ? 'bootie' : 'boot', `foot${s}`);
    foot.scaling.y = BODY.ankle * H * 1.05;
  }

  // Objetos na mão direita
  const prop = o.prop === undefined ? null : o.prop;
  if (prop) {
    const wr = joints.wristR!.node;
    if (prop === 'clipboard' || prop === 'tablet') {
      const board = box(wr, new Vector3(0.23, 0.31, 0.012), new Vector3(0, -0.09, 0.05), prop === 'tablet' ? 'propDark' : 'propDark', 'board');
      board.rotation.x = -0.3;
      if (prop === 'clipboard') box(wr, new Vector3(0.2, 0.26, 0.002), new Vector3(0, -0.09, 0.058), 'propPaper', 'paper').rotation.x = -0.3;
      else box(wr, new Vector3(0.2, 0.27, 0.002), new Vector3(0, -0.09, 0.058), 'propScreen', 'screen').rotation.x = -0.3;
    } else if (prop === 'flashlight') {
      const f = kit.part('cyl', 'propDark', `${id}-torch`);
      f.parent = wr; f.scaling.set(0.03, 0.18, 0.03); f.position.set(0, -0.08, 0.03); f.rotation.x = Math.PI / 2;
    } else if (prop === 'wrench') {
      const w = kit.part('cyl', 'propMetal', `${id}-wrench`);
      w.parent = wr; w.scaling.set(0.022, 0.38, 0.022); w.position.set(0, -0.09, 0.12); w.rotation.x = Math.PI / 2.4;
    }
  }

  // ── Poses: ângulos por articulação (rad). Convenções: rotation.x negativo leva o membro para a frente.
  type Pose = Partial<Record<string, [number, number, number]>>;
  const apply = (p: Pose) => {
    for (const [name, j] of Object.entries(joints)) {
      const a = p[name];
      j.node.rotation.set(a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0);
    }
  };
  const activity = o.activity ?? 'stand';
  const phase = rnd() * 10;
  const tempo = 0.8 + rnd() * 0.4;
  // Postura de pé relaxada: braços levemente afastados e cotovelos um pouco dobrados
  const base: Pose = {
    shoulderR: [0, 0, 0.08], shoulderL: [0, 0, -0.08], elbowR: [-0.15, 0, 0], elbowL: [-0.15, 0, 0],
  };
  // Direção do olhar: yaw relativo do ponto de interesse
  const lookYaw = () => {
    if (!o.lookAt) return 0;
    const d = o.lookAt.subtract(root.position);
    let a = Math.atan2(d.x, d.z) - root.rotation.y;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.max(-0.9, Math.min(0.9, a));
  };
  const lookPitch = () => {
    if (!o.lookAt) return 0.1;
    const d = o.lookAt.subtract(root.position.add(new Vector3(0, 0.93 * H, 0)));
    return Math.max(-0.6, Math.min(0.7, -Math.atan2(d.y, Math.hypot(d.x, d.z))));
  };

  let t = 0;
  let pathS = 0;
  const pathLen = (() => {
    if (!o.path || o.path.length < 2) return 0;
    let L = 0;
    for (let i = 0; i < o.path.length; i++) L += Vector3.Distance(o.path[i]!, o.path[(i + 1) % o.path.length]!);
    return L;
  })();

  const update = (dt: number) => {
    t += dt * tempo;
    const breathe = Math.sin(t * 1.6 + phase) * 0.012;
    // Olhar com pequenas mudanças lentas (sem movimento aleatório brusco)
    const glance = Math.sin(t * 0.21 + phase) * 0.18 + Math.sin(t * 0.09 + phase * 2) * 0.1;
    const yawH = lookYaw();
    const pitchH = lookPitch();
    const p: Pose = { ...base };
    switch (activity) {
      case 'stand':
        p.spine = [breathe, 0, 0];
        p.neck = [pitchH * 0.4, yawH * 0.5 + glance * 0.5, 0];
        p.head = [pitchH * 0.5, yawH * 0.5 + glance * 0.5, 0];
        break;
      case 'inspect': {
        // Inclinado sobre o componente, uma mão apoiada/apontando a lanterna, a outra no quadril
        const reach = 0.5 + 0.5 * smooth(0.5 + 0.5 * Math.sin(t * 0.35 + phase));
        p.spine = [0.32 + breathe, yawH * 0.3, 0];
        p.neck = [0.15, yawH * 0.3 + glance * 0.3, 0];
        p.head = [Math.max(-0.2, pitchH - 0.35), yawH * 0.3, 0];
        p.shoulderR = [-0.9 - 0.35 * reach, 0, 0.12];
        p.elbowR = [-0.5 + 0.25 * reach, 0, 0];
        p.wristR = [0.2, 0, 0];
        p.shoulderL = [-0.2, 0, -0.25];
        p.elbowL = [-1.2, 0, 0];
        p.hipR = [-0.12, 0, 0]; p.hipL = [-0.08, 0, 0]; p.kneeR = [0.15, 0, 0]; p.kneeL = [0.12, 0, 0];
        p.ankleR = [-0.03, 0, 0]; p.ankleL = [-0.04, 0, 0];
        break;
      }
      case 'clipboard': {
        // Prancheta à frente do peito; anota de tempos em tempos e olha para a sonda
        const writing = smooth(Math.max(0, Math.sin(t * 0.25 + phase)));
        p.spine = [0.05 + breathe, 0, 0];
        p.shoulderR = [-0.45, 0, 0.1]; p.elbowR = [-1.55, 0.2, 0]; p.wristR = [0.15, 0, 0];
        p.shoulderL = [-0.35, 0, -0.15]; p.elbowL = [-1.45 - 0.08 * Math.sin(t * 6) * writing, -0.2, 0];
        p.neck = [0.25 + 0.3 * writing, yawH * (1 - writing) * 0.5, 0];
        p.head = [0.2 + 0.25 * writing + (1 - writing) * (pitchH - 0.1), yawH * (1 - writing) * 0.5, 0];
        break;
      }
      case 'console': {
        // Diante de um terminal: mãos sobre a bancada, digitando
        const typing = Math.sin(t * 9 + phase) * 0.04;
        p.spine = [0.12 + breathe, 0, 0];
        p.shoulderR = [-0.75, 0, 0.18]; p.elbowR = [-0.85 + typing, 0, 0]; p.wristR = [0.35, 0, 0];
        p.shoulderL = [-0.75, 0, -0.18]; p.elbowL = [-0.85 - typing, 0, 0]; p.wristL = [0.35, 0, 0];
        p.neck = [0.12, glance * 0.25, 0]; p.head = [0.18, glance * 0.2, 0];
        break;
      }
      case 'crouch': {
        // Agachado para trabalhar perto do piso (joelhos ~110°)
        const work = Math.sin(t * 1.3 + phase) * 0.12;
        p.hipR = [-1.75, 0, 0.1]; p.hipL = [-1.6, 0, -0.12]; p.kneeR = [2.1, 0, 0]; p.kneeL = [2.2, 0, 0];
        p.ankleR = [-0.35, 0, 0]; p.ankleL = [-0.55, 0, 0];
        p.spine = [0.45, 0, 0];
        p.shoulderR = [-1.0 + work, 0, 0.15]; p.elbowR = [-0.7, 0, 0];
        p.shoulderL = [-0.8 - work, 0, -0.15]; p.elbowL = [-0.8, 0, 0];
        p.neck = [0.2, glance * 0.3, 0]; p.head = [0.2, 0, 0];
        break;
      }
      case 'reach-up': {
        // Numa plataforma, mãos acima da cabeça trabalhando num ponto alto
        const work = Math.sin(t * 1.1 + phase) * 0.1;
        p.spine = [-0.08 + breathe, 0, 0];
        p.shoulderR = [-2.55 + work, 0, 0.1]; p.elbowR = [-0.45, 0, 0];
        p.shoulderL = [-2.35 - work, 0, -0.15]; p.elbowL = [-0.6, 0, 0];
        p.neck = [-0.3, 0, 0]; p.head = [-0.35, glance * 0.2, 0];
        break;
      }
      case 'point': {
        // Explica algo apontando (braço estendido em direção ao ponto de interesse)
        const k = smooth(0.5 + 0.5 * Math.sin(t * 0.3 + phase));
        p.spine = [0.03 + breathe, yawH * 0.25, 0];
        p.shoulderR = [-1.2 * k - 0.1, 0, 0.15]; p.elbowR = [-0.25 - (1 - k) * 0.4, 0, 0];
        p.neck = [pitchH * 0.4, yawH * 0.4, 0]; p.head = [pitchH * 0.4, yawH * 0.35, 0];
        break;
      }
      case 'walk': {
        if (pathLen > 0 && o.path) {
          const speed = 1.15 * (H / 1.75);
          pathS = (pathS + speed * dt) % pathLen;
          // Posição e direção ao longo do laço
          let s = pathS;
          for (let i = 0; i < o.path.length; i++) {
            const a = o.path[i]!, b = o.path[(i + 1) % o.path.length]!;
            const L = Vector3.Distance(a, b);
            if (s <= L) {
              const k = s / L;
              root.position.set(a.x + (b.x - a.x) * k, a.y, a.z + (b.z - a.z) * k);
              const target = Math.atan2(b.x - a.x, b.z - a.z);
              let d = target - root.rotation.y;
              d = Math.atan2(Math.sin(d), Math.cos(d));
              root.rotation.y += d * Math.min(1, dt * 4);
              break;
            }
            s -= L;
          }
          // Ciclo de marcha: um passo por ~0,55 m (cadência ~105 passos/min)
          const g = (pathS / (0.55 * (H / 1.75))) * Math.PI;
          const sw = Math.sin(g);
          p.hipR = [-0.42 * sw, 0, 0]; p.hipL = [0.42 * sw, 0, 0];
          p.kneeR = [0.6 * Math.max(0, Math.sin(g + 1.2)) + 0.05, 0, 0]; p.kneeL = [0.6 * Math.max(0, -Math.sin(g + 1.2)) + 0.05, 0, 0];
          p.ankleR = [0.12 * Math.cos(g), 0, 0]; p.ankleL = [-0.12 * Math.cos(g), 0, 0];
          p.shoulderR = [0.3 * sw, 0, 0.07]; p.shoulderL = [-0.3 * sw, 0, -0.07];
          p.elbowR = [-0.3 - 0.15 * Math.max(0, -sw), 0, 0]; p.elbowL = [-0.3 - 0.15 * Math.max(0, sw), 0, 0];
          p.spine = [0.05, 0.08 * sw, 0];
          p.neck = [0.05, glance * 0.3, 0];
          // Sobe e desce o quadril com a passada (pernas estendidas no meio do apoio)
          pelvis.position.y = BODY.hip * H * (1 - 0.012 * (1 - Math.abs(Math.cos(g))));
        }
        break;
      }
    }
    apply(p);
    if (activity === 'crouch') pelvis.position.y = BODY.hip * H * 0.58;
  };
  update(0);
  return {
    root, height: H, activity,
    update,
    dispose() { root.dispose(false, false); },
  };
}

/** Altura do topo da cabeça (m) medida na geometria (para testes de escala). */
export function measuredHeight(w: Worker): number {
  w.root.computeWorldMatrix(true);
  const { min, max } = w.root.getHierarchyBoundingVectors(true);
  return max.y - min.y;
}
