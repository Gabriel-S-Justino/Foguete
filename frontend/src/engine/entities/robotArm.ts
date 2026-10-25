/**
 * Braço robótico articulado (base giratória, ombro, cotovelo, punho e garra) com cinemática inversa
 * de dois elos no plano vertical. Os movimentos são filas de tarefas sincronizadas com a montagem.
 */
import { Color3, MeshBuilder, PointLight, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { MaterialLibrary } from './materials';

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
  private beacon: PointLight;
  private pose: Pose;
  private readonly rest: Pose;
  private queue: Task[] = [];
  private active: { task: Task; from: Pose; t: number } | null = null;
  status = 'em espera';

  constructor(scene: Scene, mats: MaterialLibrary, name: string, position: Vector3, facingYaw: number) {
    this.root = new TransformNode(`${name}-root`, scene);
    this.root.position = position;
    const pedestal = MeshBuilder.CreateBox(`${name}-pedestal`, { width: 1.6, depth: 1.6, height: 0.9 }, scene);
    pedestal.material = mats.get('darkSteel');
    pedestal.position.y = 0.45;
    pedestal.parent = this.root;
    const base = MeshBuilder.CreateCylinder(`${name}-base`, { diameter: 1.1, height: 0.6, tessellation: 32 }, scene);
    base.material = mats.get('paintedWhite');
    base.position.y = 1.2;
    base.parent = this.root;

    this.yawNode = new TransformNode(`${name}-yaw`, scene);
    this.yawNode.parent = this.root;
    this.yawNode.position.y = BASE_H;
    const turret = MeshBuilder.CreateCylinder(`${name}-turret`, { diameter: 0.9, height: 0.5, tessellation: 24 }, scene);
    turret.material = mats.get('robotOrange');
    turret.parent = this.yawNode;

    this.shoulderNode = new TransformNode(`${name}-shoulder`, scene);
    this.shoulderNode.parent = this.yawNode;
    this.shoulderNode.position.y = 0.35;
    const sj = MeshBuilder.CreateCylinder(`${name}-sj`, { diameter: 0.7, height: 0.8, tessellation: 24 }, scene);
    sj.rotation.z = Math.PI / 2;
    sj.material = mats.get('darkSteel');
    sj.parent = this.shoulderNode;
    const upper = MeshBuilder.CreateBox(`${name}-upper`, { width: 0.42, depth: 0.5, height: L1 }, scene);
    upper.position.y = L1 / 2;
    upper.material = mats.get('robotOrange');
    upper.parent = this.shoulderNode;

    this.elbowNode = new TransformNode(`${name}-elbow`, scene);
    this.elbowNode.parent = this.shoulderNode;
    this.elbowNode.position.y = L1;
    const ej = MeshBuilder.CreateCylinder(`${name}-ej`, { diameter: 0.5, height: 0.62, tessellation: 24 }, scene);
    ej.rotation.z = Math.PI / 2;
    ej.material = mats.get('darkSteel');
    ej.parent = this.elbowNode;
    const fore = MeshBuilder.CreateBox(`${name}-fore`, { width: 0.32, depth: 0.38, height: L2 }, scene);
    fore.position.y = L2 / 2;
    fore.material = mats.get('robotOrange');
    fore.parent = this.elbowNode;
    const cable = MeshBuilder.CreateTube(`${name}-cable`, { path: [new Vector3(0.22, 0.2, 0), new Vector3(0.35, L2 / 2, 0.1), new Vector3(0.22, L2 - 0.2, 0)], radius: 0.05 }, scene);
    cable.material = mats.get('rubber');
    cable.parent = this.elbowNode;

    this.wristNode = new TransformNode(`${name}-wrist`, scene);
    this.wristNode.parent = this.elbowNode;
    this.wristNode.position.y = L2;
    const wj = MeshBuilder.CreateSphere(`${name}-wj`, { diameter: 0.38, segments: 12 }, scene);
    wj.material = mats.get('darkSteel');
    wj.parent = this.wristNode;
    const tool = MeshBuilder.CreateCylinder(`${name}-tool`, { diameterTop: 0.22, diameterBottom: 0.3, height: L3 * 0.6, tessellation: 16 }, scene);
    tool.position.y = L3 * 0.3;
    tool.material = mats.get('steel');
    tool.parent = this.wristNode;
    for (const side of [-1, 1]) {
      const f = new TransformNode(`${name}-fingerNode${side}`, scene);
      f.parent = this.wristNode;
      f.position = new Vector3(side * 0.1, L3 * 0.6, 0);
      const finger = MeshBuilder.CreateBox(`${name}-finger${side}`, { width: 0.06, depth: 0.18, height: 0.32 }, scene);
      finger.position.y = 0.16;
      finger.material = mats.get('blackAnodized');
      finger.parent = f;
      this.fingers.push(f);
    }
    this.toolTip = new TransformNode(`${name}-tip`, scene);
    this.toolTip.parent = this.wristNode;
    this.toolTip.position.y = L3;

    this.beacon = new PointLight(`${name}-beacon`, new Vector3(0, 0.4, 0), scene);
    this.beacon.parent = this.yawNode;
    this.beacon.diffuse = new Color3(1, 0.65, 0.15);
    this.beacon.intensity = 0;
    this.beacon.range = 4;

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
    this.fingers.forEach((f, i) => { f.rotation.z = (i === 0 ? 1 : -1) * this.pose.grip; });
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
      if (!next) { this.status = 'em espera'; this.beacon.intensity = 0; return; }
      this.active = { task: next, from: { ...this.pose }, t: 0 };
      this.status = next.label;
      this.beacon.intensity = 0.8;
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
