/**
 * Hangar de integração da sonda (referência visual: imagem do Amazônia-1 fornecida pelo usuário).
 * Mantém o modelo 3D sincronizado com a configuração lógica e anima os braços robóticos a cada montagem.
 */
import { Color3, Color4, type Engine, HighlightLayer, type Mesh, MeshBuilder, PointerEventTypes, type TransformNode, Vector3 } from '@babylonjs/core';
import type { MissionId } from '../../types/catalog';
import type { InstalledComponent } from '../../types/campaign';
import type { SceneController } from '../core/SceneManager';
import { getComponent } from '../catalog';
import { loadNasaModel, REFERENCE_SPACECRAFT, type NasaModelId } from '../entities/nasaModels';
import { ProbeModel } from '../entities/probeModel';
import { RobotArm } from '../entities/robotArm';
import { buildHangar, buildIntegrationEquipment, createBaseScene } from './environment';

export interface ProbeHangarController extends SceneController {
  sync(installed: InstalledComponent[]): void;
  highlight(componentId: string | null): void;
  setView(view: 'overview' | 'inspect' | 'reference'): void;
  /** Expõe no hangar a nave real da NASA equivalente à missão (modelo do NASA 3D Resources). */
  showReference(missionId: MissionId): void;
  /** Modelo de referência exposto e carregado (para testes). */
  referenceInfo(): { id: NasaModelId | null; loaded: boolean };
  onPick(cb: (componentId: string, instanceId: string) => void): void;
  armStatus(): string[];
  /** Quantidade de componentes visíveis no modelo 3D (para testes de consistência). */
  visibleCount(): number;
}

const STAND_H = 1.4;
/** Expositor da nave de referência, à esquerda da área de integração. */
const REF_POS = new Vector3(-14, 0, -6);
const REF_H = 1.1;

export function createProbeHangarScene(engine: Engine): ProbeHangarController {
  const base = createBaseScene(engine, { clear: new Color4(0.06, 0.07, 0.08, 1), target: new Vector3(0, 2.6, 0), radius: 15, alpha: -Math.PI / 2.6, beta: 1.2, exposure: 1.1, environment: 'hangar', environmentIntensity: 0.8 });
  const { scene, mats, camera, shadows } = base;
  buildHangar(base, { width: 46, depth: 60, height: 20, bays: 6, withCrane: true, doorSide: 'back' });
  buildIntegrationEquipment(base, new Vector3(0, 0, 0), 5.5);
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 32;

  // Plataforma central de montagem (dolly laranja como na referência) e suporte da sonda
  const dolly = MeshBuilder.CreateBox('dolly', { width: 4.6, depth: 3.8, height: 0.45 }, scene);
  dolly.position.y = 0.45;
  dolly.material = mats.get('orangePaint');
  for (const [x, z] of [[-1.9, -1.5], [1.9, -1.5], [-1.9, 1.5], [1.9, 1.5]] as const) {
    const w = MeshBuilder.CreateCylinder(`dollyWheel${x}${z}`, { diameter: 0.45, height: 0.22 }, scene);
    w.rotation.z = Math.PI / 2;
    w.position = new Vector3(x, 0.22, z);
    w.material = mats.get('rubber');
  }
  const stand = MeshBuilder.CreateCylinder('stand', { diameterTop: 1.2, diameterBottom: 1.8, height: STAND_H - 0.67 }, scene);
  stand.position.y = 0.67 + (STAND_H - 0.67) / 2;
  stand.material = mats.get('darkSteel');
  const platformRing = MeshBuilder.CreateTorus('platformRing', { diameter: 8, thickness: 0.06, tessellation: 64 }, scene);
  platformRing.position.y = 0.02;
  platformRing.material = mats.get('yellowSafety');

  const probe = new ProbeModel(scene, mats);
  probe.root.position.y = STAND_H;
  const leftArm = new RobotArm(scene, mats, 'armL', new Vector3(-5.2, 0, 1.2), Math.PI / 2);
  const rightArm = new RobotArm(scene, mats, 'armR', new Vector3(5.2, 0, -1.2), -Math.PI / 2);
  const pickupL = new Vector3(-6.5, 1.3, 4.2);
  const pickupR = new Vector3(6.5, 1.3, -4.2);
  for (const p of [pickupL, pickupR]) {
    const table = MeshBuilder.CreateBox(`staging${p.x}`, { width: 1.4, depth: 1.4, height: 1 }, scene);
    table.position = new Vector3(p.x, 0.5, p.z);
    table.material = mats.get('darkSteel');
  }
  shadows?.addShadowCaster(dolly);

  const highlight = new HighlightLayer('hl', scene);
  let highlighted: Mesh[] = [];
  let pickCb: ((componentId: string, instanceId: string) => void) | null = null;
  let current: InstalledComponent[] = [];
  let view: 'overview' | 'inspect' | 'reference' = 'overview';

  // Expositor: pedestal com anel de luz; o modelo da NASA é carregado sob demanda
  const refStand = MeshBuilder.CreateCylinder('refStand', { diameter: 3.4, height: REF_H, tessellation: 48 }, scene);
  refStand.position = REF_POS.add(new Vector3(0, REF_H / 2, 0));
  refStand.material = mats.get('darkSteel');
  const refRing = MeshBuilder.CreateTorus('refRing', { diameter: 3.6, thickness: 0.05, tessellation: 64 }, scene);
  refRing.position = REF_POS.add(new Vector3(0, REF_H + 0.01, 0));
  refRing.material = mats.get('lampEmissive');
  let refId: NasaModelId | null = null;
  let refNode: TransformNode | null = null;
  let refToken = 0;
  let refCenter = REF_POS.add(new Vector3(0, REF_H + 3, 0));
  const pendingRemovals = new Set<string>();
  const inTransit = new Set<string>();

  scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERTAP) return;
    const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => Boolean(m.metadata?.componentId));
    const md = pick?.pickedMesh?.metadata as { componentId?: string; instanceId?: string } | undefined;
    if (md?.componentId && md.instanceId) pickCb?.(md.componentId, md.instanceId);
  });

  const frame = () => {
    const h = probe.height + STAND_H;
    camera.setTarget(new Vector3(0, h * 0.55, 0));
    if (view === 'reference') return;
    if (view === 'overview') camera.radius = Math.max(11, h * 4.2);
  };

  const toWorld = (local: Vector3) => local.add(probe.root.position);

  function animateInstall(inst: InstalledComponent): void {
    const spec = getComponent(inst.componentId);
    const lay = probe.layout(current).get(inst.instanceId)!;
    const part = probe.place(inst, lay.mount, lay.normal);
    if (spec.mount === 'bus' || spec.mount === 'skin' || spec.mount === 'none') {
      // Estrutura e mantas são instaladas sem os braços (ponte rolante / equipe técnica)
      part.node.scaling = new Vector3(0.01, 0.01, 0.01);
      let t = 0;
      const obs = scene.onBeforeRenderObservable.add(() => {
        t += engine.getDeltaTime() / 1000;
        const k = Math.min(1, t / 0.6);
        part.node.scaling.setAll(Math.max(0.01, k));
        if (k >= 1) scene.onBeforeRenderObservable.remove(obs);
      });
      return;
    }
    const mountWorld = toWorld(lay.mount);
    const arm = mountWorld.x < 0 || (mountWorld.x === 0 && mountWorld.z > 0) ? leftArm : rightArm;
    const pickup = arm === leftArm ? pickupL : pickupR;
    const approach = lay.normal.scale(1.4);
    // Componente aguarda na mesa de preparação, viaja na garra e é fixado no ponto de montagem
    part.node.position = pickup.subtract(probe.root.position);
    part.node.setEnabled(false);
    inTransit.add(inst.instanceId);
    let attached = false;
    const follow = scene.onBeforeRenderObservable.add(() => {
      if (attached) part.node.position = arm.tipWorldPosition().subtract(probe.root.position);
    });
    arm.assemble(pickup, mountWorld, approach, {
      onGrab: () => { part.node.setEnabled(true); attached = true; },
      onAligned: () => undefined,
      onRelease: () => {
        attached = false;
        part.node.position = (probe.getPart(inst.instanceId)?.mount ?? lay.mount).clone();
        inTransit.delete(inst.instanceId);
        scene.onBeforeRenderObservable.remove(follow);
      },
    });
  }

  function animateRemoval(instanceId: string): void {
    const part = probe.getPart(instanceId);
    if (!part) return;
    const spec = getComponent(part.componentId);
    if (spec.mount === 'bus' || spec.mount === 'skin' || spec.mount === 'none') { probe.remove(instanceId); return; }
    pendingRemovals.add(instanceId);
    inTransit.add(instanceId);
    const mountWorld = toWorld(part.mount);
    const arm = mountWorld.x < 0 || (mountWorld.x === 0 && mountWorld.z > 0) ? leftArm : rightArm;
    const drop = arm === leftArm ? pickupL : pickupR;
    let attached = false;
    const follow = scene.onBeforeRenderObservable.add(() => {
      if (attached) part.node.position = arm.tipWorldPosition().subtract(probe.root.position);
    });
    arm.disassemble(mountWorld, drop, part.normal.scale(1.4), {
      onGrab: () => { attached = true; },
      onRelease: () => {
        attached = false;
        scene.onBeforeRenderObservable.remove(follow);
        probe.remove(instanceId);
        pendingRemovals.delete(instanceId);
        inTransit.delete(instanceId);
      },
    });
  }

  return {
    scene,
    update(dt) {
      leftArm.update(dt);
      rightArm.update(dt);
    },
    setQuality: base.setQuality,
    sync(installed) {
      const prevIds = new Set(current.map((i) => i.instanceId));
      const nextIds = new Set(installed.map((i) => i.instanceId));
      const first = current.length === 0 && probe.partNodes.length === 0;
      current = installed;
      if (first) {
        // Restauração de campanha: monta tudo sem animação
        probe.rebuild(installed);
      } else {
        for (const id of prevIds) if (!nextIds.has(id)) animateRemoval(id);
        const added = installed.filter((i) => !prevIds.has(i.instanceId));
        // Barramento primeiro, para que os demais tenham onde ser fixados
        added.sort((a, b) => Number(getComponent(b.componentId).mount === 'bus') - Number(getComponent(a.componentId).mount === 'bus'));
        for (const inst of added) animateInstall(inst);
        probe.relayout(installed, inTransit);
        probe.updateSkin(installed);
      }
      for (const p of probe.partNodes) p.node.getChildMeshes().forEach((m) => shadows?.addShadowCaster(m));
      frame();
    },
    highlight(componentId) {
      highlighted.forEach((m) => highlight.removeMesh(m));
      highlighted = [];
      if (!componentId) return;
      for (const p of probe.partNodes) {
        if (p.componentId !== componentId) continue;
        for (const m of p.node.getChildMeshes() as Mesh[]) { highlight.addMesh(m, Color3.FromHexString('#f2a33a')); highlighted.push(m); }
      }
      if (view === 'inspect') {
        const part = probe.partNodes.find((p) => p.componentId === componentId);
        if (part) { camera.setTarget(toWorld(part.mount)); camera.radius = 4.5; }
      }
    },
    setView(v) {
      view = v;
      if (v === 'overview') { camera.alpha = -Math.PI / 2.6; camera.beta = 1.2; frame(); }
      else if (v === 'reference') { camera.setTarget(refCenter.clone()); camera.alpha = -Math.PI / 1.7; camera.beta = 1.3; camera.radius = 12; }
      else { camera.radius = 6; camera.beta = 1.25; }
    },
    showReference(missionId) {
      const id = REFERENCE_SPACECRAFT[missionId];
      if (id === refId) return;
      refId = id;
      refNode?.dispose();
      refNode = null;
      const token = ++refToken;
      void loadNasaModel(scene, id).then((node) => {
        if (!node) return;
        if (token !== refToken) { node.dispose(); return; }
        refNode = node;
        // Apoiada sobre o pedestal: a base do modelo fica 10 cm acima do tampo
        node.position = REF_POS.clone();
        node.computeWorldMatrix(true);
        const { min, max } = node.getHierarchyBoundingVectors(true);
        node.position.y += REF_H + 0.1 - min.y;
        refCenter = REF_POS.add(new Vector3(0, REF_H + 0.1 + (max.y - min.y) / 2, 0));
        if (view === 'reference') camera.setTarget(refCenter.clone());
        node.getChildMeshes().forEach((m) => { m.isPickable = false; shadows?.addShadowCaster(m); });
      });
    },
    referenceInfo() { return { id: refId, loaded: refNode !== null }; },
    onPick(cb) { pickCb = cb; },
    armStatus() { return [`Braço A: ${leftArm.status}`, `Braço B: ${rightArm.status}`]; },
    visibleCount() { return probe.partNodes.filter((p) => !pendingRemovals.has(p.instanceId)).length; },
    dispose() {
      refToken++;
      highlight.dispose();
      probe.dispose();
      scene.dispose();
    },
  };
}
