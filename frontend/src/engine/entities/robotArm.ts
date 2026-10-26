/**
 * Braço robótico industrial de 4 eixos motorizados visíveis (giro da base, ombro, cotovelo e punho) mais a
 * garra paralela, com cinemática inversa de dois elos no plano vertical. Os movimentos são filas de tarefas
 * sincronizadas com a montagem.
 *
 * Modelagem (referência: robôs articulados de pórtico baixo usados em integração e manipuladores como o
 * Canadarm2, cujas juntas são rotativas com motor e redutor em cada eixo): cada elo é uma peça fundida com
 * cantos arredondados; cada articulação tem a carcaça do redutor centrada no eixo de rotação, com o motor
 * acoplado ao lado; os cabos de energia e sinal correm por uma esteira presa ao elo, com abraçadeiras, e
 * cruzam as juntas pelo lado do eixo (por isso não se esticam com o movimento). Toda peça fica presa ao nó
 * da articulação de que depende: a hierarquia é base → giro → ombro → cotovelo → punho → garra.
 */
import { Color3, type Mesh, MeshBuilder, type PBRMaterial, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { MaterialKey, MaterialLibrary } from './materials';

interface Pose { yaw: number; shoulder: number; elbow: number; wrist: number; grip: number }
interface Task { target: Pose; duration: number; label: string; onDone?: () => void }

const L1 = 2.4;
const L2 = 2.1;
const L3 = 0.7;
const BASE_H = 1.5;

export class RobotArm {
  readonly root: TransformNode;
  private yawNode: TransformNode;
  private shoulderNode: TransformNode;
  private elbowNode: TransformNode;
  private wristNode: TransformNode;
  readonly toolTip: TransformNode;
  private fingers: TransformNode[] = [];
  private lamp: PBRMaterial;
  private pose: Pose;
  private readonly rest: Pose;
  private queue: Task[] = [];
  private active: { task: Task; from: Pose; t: number } | null = null;
  status = 'em espera';

  constructor(scene: Scene, mats: MaterialLibrary, name: string, position: Vector3, facingYaw: number) {
    this.root = new TransformNode(`${name}-root`, scene);
    this.root.position = position;
    const part = (mesh: Mesh, parent: TransformNode, mat: MaterialKey, pos?: Vector3, rot?: Vector3) => {
      mesh.material = mats.get(mat);
      mesh.parent = parent;
      if (pos) mesh.position.copyFrom(pos);
      if (rot) mesh.rotation.copyFrom(rot);
      return mesh;
    };
    const cyl = (n: string, dia: number, h: number, parent: TransformNode, mat: MaterialKey, pos?: Vector3, rot?: Vector3, tess = 28) =>
      part(MeshBuilder.CreateCylinder(`${name}-${n}`, { diameter: dia, height: h, tessellation: tess }, scene), parent, mat, pos, rot);
    const box = (n: string, w: number, h: number, d: number, parent: TransformNode, mat: MaterialKey, pos?: Vector3, rot?: Vector3) =>
      part(MeshBuilder.CreateBox(`${name}-${n}`, { width: w, height: h, depth: d }, scene), parent, mat, pos, rot);
    /** Elo fundido: cápsula achatada de comprimento útil len ao longo de +Y. */
    const link = (n: string, len: number, w: number, d: number, parent: TransformNode, y0: number) => {
      const m = MeshBuilder.CreateCapsule(`${name}-${n}`, { radius: 0.5, height: 2, tessellation: 16, capSubdivisions: 5 }, scene);
      m.scaling.set(w, (len + Math.min(w, d)) / 2, d);
      return part(m, parent, 'robotOrange', new Vector3(0, y0 + len / 2, 0));
    };
    const X = new Vector3(0, 0, Math.PI / 2);

    // ── Base: placa ancorada ao piso (4 chumbadores), pedestal com flanges e caixa de conectores
    box('plate', 1.3, 0.05, 1.3, this.root, 'darkSteel', new Vector3(0, 0.025, 0));
    for (const [x, z] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]] as const) {
      cyl(`bolt${x}${z}`, 0.07, 0.06, this.root, 'steel', new Vector3(x, 0.07, z), undefined, 8);
    }
    cyl('pedestal', 0.7, 0.95, this.root, 'paintedWhite', new Vector3(0, 0.525, 0));
    cyl('flangeLow', 0.9, 0.06, this.root, 'darkSteel', new Vector3(0, 0.08, 0));
    cyl('flangeTop', 0.92, 0.07, this.root, 'darkSteel', new Vector3(0, 1.03, 0));
    box('connectors', 0.32, 0.36, 0.14, this.root, 'darkSteel', new Vector3(0, 0.5, -0.4));
    // Estrutura do giro (eixo 1): carrossel, redutor e motor vertical na traseira
    cyl('j1Housing', 0.86, 0.42, this.root, 'darkSteel', new Vector3(0, BASE_H - 0.25, 0));

    this.yawNode = new TransformNode(`${name}-yaw`, scene);
    this.yawNode.parent = this.root;
    this.yawNode.position.y = BASE_H;
    cyl('turret', 0.95, 0.3, this.yawNode, 'robotOrange', new Vector3(0, 0, 0));
    box('turretArm', 0.62, 0.42, 0.7, this.yawNode, 'robotOrange', new Vector3(0, 0.2, 0.05));
    cyl('j1Motor', 0.24, 0.42, this.yawNode, 'blackAnodized', new Vector3(0, 0.2, -0.42));
    cyl('j1MotorCap', 0.26, 0.05, this.yawNode, 'steel', new Vector3(0, 0.43, -0.42));
    // Lâmpada de estado (âmbar com o braço em movimento), no lugar da antiga luz pontual
    this.lamp = mats.variant('lampEmissive', `${name}-lampMat`);
    this.lamp.emissiveColor = new Color3(0.05, 0.25, 0.08);
    this.lamp.emissiveIntensity = 1;
    cyl('lampBody', 0.08, 0.1, this.yawNode, 'darkSteel', new Vector3(0.24, 0.47, -0.25), undefined, 12);
    const lampHead = cyl('lamp', 0.07, 0.07, this.yawNode, 'darkSteel', new Vector3(0.24, 0.55, -0.25), undefined, 12);
    lampHead.material = this.lamp;

    // ── Ombro (eixo 2, horizontal em X): carcaça do redutor no eixo, motor ao lado
    this.shoulderNode = new TransformNode(`${name}-shoulder`, scene);
    this.shoulderNode.parent = this.yawNode;
    this.shoulderNode.position.y = 0.35;
    cyl('j2Housing', 0.66, 0.6, this.shoulderNode, 'robotOrange', Vector3.Zero(), X);
    cyl('j2Gear', 0.52, 0.08, this.shoulderNode, 'darkSteel', new Vector3(0.34, 0, 0), X);
    cyl('j2Motor', 0.24, 0.42, this.shoulderNode, 'blackAnodized', new Vector3(0.57, 0, 0), X);
    cyl('j2MotorCap', 0.26, 0.05, this.shoulderNode, 'steel', new Vector3(0.79, 0, 0), X);
    link('upper', L1 - 0.35, 0.36, 0.46, this.shoulderNode, 0.18);
    // Esteira de cabos ao longo do elo (lado −X), com abraçadeiras
    const hose = (n: string, parent: TransformNode, x: number, z: number, y0: number, y1: number) => {
      const t = MeshBuilder.CreateTube(`${name}-${n}`, { path: [new Vector3(x, y0, z), new Vector3(x - 0.04, (y0 + y1) / 2, z), new Vector3(x, y1, z)], radius: 0.035, tessellation: 10 }, scene);
      part(t, parent, 'rubber');
      for (const y of [y0 + 0.05, (y0 + y1) / 2, y1 - 0.05]) box(`${n}clamp${y.toFixed(2)}`, 0.1, 0.05, 0.1, parent, 'darkSteel', new Vector3(x + 0.02, y, z));
    };
    hose('hoseUpper', this.shoulderNode, -0.26, -0.1, 0.25, L1 - 0.3);

    // ── Cotovelo (eixo 3): carcaça no eixo, motor e contrapeso traseiro com o pacote de motores do punho
    this.elbowNode = new TransformNode(`${name}-elbow`, scene);
    this.elbowNode.parent = this.shoulderNode;
    this.elbowNode.position.y = L1;
    cyl('j3Housing', 0.5, 0.5, this.elbowNode, 'robotOrange', Vector3.Zero(), X);
    cyl('j3Motor', 0.2, 0.36, this.elbowNode, 'blackAnodized', new Vector3(0.38, 0, 0), X);
    cyl('j3MotorCap', 0.22, 0.04, this.elbowNode, 'steel', new Vector3(0.57, 0, 0), X);
    box('wristMotors', 0.34, 0.5, 0.34, this.elbowNode, 'darkSteel', new Vector3(0, -0.32, 0));
    link('fore', L2 - 0.3, 0.26, 0.3, this.elbowNode, 0.12);
    // Anel do eixo de rolagem do antebraço (eixo 4, não animado: a garra trabalha sempre no plano vertical)
    cyl('j4Ring', 0.3, 0.07, this.elbowNode, 'darkSteel', new Vector3(0, 0.55, 0));
    hose('hoseFore', this.elbowNode, -0.19, -0.08, 0.2, L2 - 0.25);

    // ── Punho (eixos 5 e 6) e flange da ferramenta
    this.wristNode = new TransformNode(`${name}-wrist`, scene);
    this.wristNode.parent = this.elbowNode;
    this.wristNode.position.y = L2;
    cyl('j5Housing', 0.26, 0.32, this.wristNode, 'darkSteel', Vector3.Zero(), X);
    cyl('j6Flange', 0.2, 0.08, this.wristNode, 'steel', new Vector3(0, 0.17, 0));
    // Garra paralela: corpo, trilhos, dedos com sapatas e câmera de inspeção
    box('gripBody', 0.3, 0.14, 0.16, this.wristNode, 'blackAnodized', new Vector3(0, 0.28, 0));
    box('gripRail', 0.34, 0.03, 0.05, this.wristNode, 'steel', new Vector3(0, 0.36, 0));
    cyl('gripCam', 0.05, 0.08, this.wristNode, 'blackAnodized', new Vector3(0, 0.28, 0.12), new Vector3(Math.PI / 2, 0, 0), 12);
    for (const side of [-1, 1]) {
      const f = new TransformNode(`${name}-fingerNode${side}`, scene);
      f.parent = this.wristNode;
      f.position = new Vector3(side * 0.1, 0.36, 0);
      box(`finger${side}`, 0.04, 0.3, 0.12, f, 'aluminum', new Vector3(0, 0.15, 0));
      box(`pad${side}`, 0.015, 0.12, 0.1, f, 'rubber', new Vector3(-side * 0.026, 0.24, 0));
      this.fingers.push(f);
    }
    this.toolTip = new TransformNode(`${name}-tip`, scene);
    this.toolTip.parent = this.wristNode;
    this.toolTip.position.y = L3;

    this.rest = { yaw: facingYaw, shoulder: -0.25, elbow: 1.9, wrist: 0.9, grip: 0.3 };
    this.pose = { ...this.rest };
    this.apply();
  }

  get busy(): boolean { return this.active !== null || this.queue.length > 0; }

  private apply(): void {
    this.yawNode.rotation.y = this.pose.yaw;
    this.shoulderNode.rotation.x = this.pose.shoulder;
    this.elbowNode.rotation.x = this.pose.elbow;
    this.wristNode.rotation.x = this.pose.wrist;
    // Garra paralela: os dedos deslizam no trilho (grip 0 = fechada, 0,35 = aberta)
    this.fingers.forEach((f, i) => { f.position.x = (i === 0 ? -1 : 1) * (0.045 + this.pose.grip * 0.3); });
  }

  /** Cinemática inversa: pose que leva a ponta da ferramenta ao ponto (coordenadas do mundo), apontando para baixo/frente. */
  solve(world: Vector3, grip: number): Pose {
    const local = world.subtract(this.root.position);
    const yaw = Math.atan2(local.x, local.z);
    const horiz = Math.hypot(local.x, local.z);
    const shoulderH = BASE_H + 0.35;
    // Ponto do punho recuado pelo comprimento da ferramenta (ferramenta horizontal)
    const wx = Math.max(0.3, horiz - L3);
    const wy = local.y - shoulderH;
    const d = Math.min(L1 + L2 - 0.05, Math.max(0.4, Math.hypot(wx, wy)));
    const cosElbow = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    const elbow = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
    const phi = Math.atan2(wx, wy);
    const psi = Math.atan2(L2 * Math.sin(elbow), L1 + L2 * Math.cos(elbow));
    const shoulder = phi - psi;
    const wrist = Math.PI / 2 - shoulder - elbow;
    return { yaw, shoulder, elbow, wrist, grip };
  }

  private enqueue(target: Pose, duration: number, label: string, onDone?: () => void): void {
    this.queue.push({ target, duration, label, onDone });
  }

  /**
   * Sequência completa de montagem: orientação → aproximação → alinhamento → fixação → retorno.
   * onGrab/onRelease permitem acoplar o componente à garra durante o transporte.
   */
  assemble(pickup: Vector3, mount: Vector3, approachOffset: Vector3, callbacks: { onGrab: () => void; onAligned: () => void; onRelease: () => void }): void {
    const orient = { ...this.solve(pickup, 0.35) };
    this.enqueue({ ...this.pose, yaw: orient.yaw }, 0.5, 'orientação para o componente');
    this.enqueue(orient, 0.8, 'aproximação', callbacks.onGrab);
    this.enqueue({ ...this.solve(pickup, 0.05) }, 0.25, 'fechamento da garra');
    const pre = mount.add(approachOffset);
    this.enqueue(this.solve(pre, 0.05), 1.0, 'transporte e alinhamento', callbacks.onAligned);
    this.enqueue(this.solve(mount, 0.05), 0.6, 'fixação');
    this.enqueue(this.solve(mount, 0.35), 0.25, 'liberação', callbacks.onRelease);
    this.enqueue(this.solve(pre, 0.35), 0.5, 'afastamento');
    this.enqueue(this.rest, 0.9, 'retorno à posição de espera');
  }

  /** Sequência inversa: busca o componente montado e o leva para fora. */
  disassemble(mount: Vector3, dropOff: Vector3, approachOffset: Vector3, callbacks: { onGrab: () => void; onRelease: () => void }): void {
    const pre = mount.add(approachOffset);
    this.enqueue({ ...this.pose, yaw: this.solve(pre, 0.35).yaw }, 0.5, 'orientação para o componente');
    this.enqueue(this.solve(pre, 0.35), 0.8, 'aproximação');
    this.enqueue(this.solve(mount, 0.35), 0.5, 'alinhamento');
    this.enqueue(this.solve(mount, 0.05), 0.25, 'fixação da garra', callbacks.onGrab);
    this.enqueue(this.solve(pre, 0.05), 0.6, 'remoção');
    this.enqueue(this.solve(dropOff, 0.05), 0.9, 'transporte');
    this.enqueue(this.solve(dropOff, 0.35), 0.25, 'liberação', callbacks.onRelease);
    this.enqueue(this.rest, 0.9, 'retorno à posição de espera');
  }

  update(dt: number): void {
    if (!this.active) {
      const next = this.queue.shift();
      if (!next) { this.status = 'em espera'; this.lamp.emissiveColor.set(0.05, 0.25, 0.08); return; }
      this.active = { task: next, from: { ...this.pose }, t: 0 };
      this.status = next.label;
      this.lamp.emissiveColor.set(1, 0.55, 0.08);
    }
    const a = this.active;
    a.t += dt;
    const k = Math.min(1, a.t / a.task.duration);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // easeInOutQuad
    const lerp = (x: number, y: number) => x + (y - x) * e;
    let dyaw = a.task.target.yaw - a.from.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.pose = {
      yaw: a.from.yaw + dyaw * e,
      shoulder: lerp(a.from.shoulder, a.task.target.shoulder),
      elbow: lerp(a.from.elbow, a.task.target.elbow),
      wrist: lerp(a.from.wrist, a.task.target.wrist),
      grip: lerp(a.from.grip, a.task.target.grip),
    };
    this.apply();
    if (k >= 1) {
      this.active = null;
      a.task.onDone?.();
    }
  }

  tipWorldPosition(): Vector3 {
    this.toolTip.computeWorldMatrix(true);
    return this.toolTip.getAbsolutePosition().clone();
  }
}
