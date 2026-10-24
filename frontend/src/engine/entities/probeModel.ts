/**
 * Modelo 3D modular da sonda, gerado proceduralmente a partir dos componentes instalados.
 * Cada componente vira um nó com metadados (instanceId, componentId) e é posicionado em um ponto de montagem.
 */
import { Color3, Mesh, MeshBuilder, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { ComponentSpec } from '../../types/catalog';
import type { InstalledComponent } from '../../types/campaign';
import { getComponent } from '../catalog';
import type { MaterialLibrary } from './materials';

export interface PartNode {
  instanceId: string;
  componentId: string;
  node: TransformNode;
  mount: Vector3;
  /** Direção normal da face de montagem (para aproximação do braço). */
  normal: Vector3;
}

const DEFAULT_BUS: [number, number, number] = [1.6, 1.6, 2.0];

function tag(mesh: Mesh, instanceId: string, componentId: string): Mesh {
  mesh.metadata = { instanceId, componentId };
  mesh.isPickable = true;
  return mesh;
}

export class ProbeModel {
  readonly root: TransformNode;
  private parts = new Map<string, PartNode>();
  private busNode: TransformNode | null = null;
  private busMeshes: Mesh[] = [];
  private bus: [number, number, number] = DEFAULT_BUS;
  private skin: 'none' | 'gold' | 'silver' = 'none';

  constructor(private scene: Scene, private mats: MaterialLibrary, parent?: TransformNode) {
    this.root = new TransformNode('probe-root', scene);
    if (parent) this.root.parent = parent;
  }

  get busSize(): [number, number, number] { return this.bus; }
  get height(): number { return this.bus[2]; }
  getPart(instanceId: string): PartNode | undefined { return this.parts.get(instanceId); }
  get partNodes(): PartNode[] { return [...this.parts.values()]; }

  /** Calcula a posição de montagem de cada componente instalado (determinística). */
  layout(installed: InstalledComponent[]): Map<string, { mount: Vector3; normal: Vector3 }> {
    const busSpec = installed.map((i) => getComponent(i.componentId)).find((c) => c.mount === 'bus');
    const [w, d, h] = busSpec?.dimensionsM ?? DEFAULT_BUS;
    const out = new Map<string, { mount: Vector3; normal: Vector3 }>();
    const counters: Record<string, number> = {};
    const next = (k: string) => (counters[k] = (counters[k] ?? -1) + 1);
    const grid = (i: number, cols: number, spanA: number, spanB: number) => {
      const col = i % cols, row = Math.floor(i / cols);
      return [(-0.5 + (col + 0.5) / cols) * spanA, (0.5 - (row + 0.5) / 3) * spanB] as const;
    };
    for (const inst of installed) {
      const c = getComponent(inst.componentId);
      let mount = new Vector3(0, h / 2, 0);
      let normal = new Vector3(0, 1, 0);
      switch (c.mount) {
        case 'bus': mount = Vector3.Zero(); break;
        case 'nadir': { const [a, b] = grid(next('nadir'), 3, w * 0.9, h * 0.9); mount = new Vector3(a, h / 2 + b, d / 2); normal = new Vector3(0, 0, 1); break; }
        case 'internal': { const [a, b] = grid(next('internal'), 3, w * 0.9, h * 0.9); mount = new Vector3(a, h / 2 + b, -d / 2); normal = new Vector3(0, 0, -1); break; }
        case 'side-panel': { const i = next('side'); const side = i % 2 === 0 ? 1 : -1; mount = new Vector3(side * w / 2, h * 0.28, 0); normal = new Vector3(side, 0, 0); break; }
        case 'wing': { mount = new Vector3(w / 2, h * 0.72, 0); normal = new Vector3(1, 0, 0); break; }
        case 'top': { const i = next('top'); const ang = (i / 5) * Math.PI * 2 + 0.6; mount = new Vector3(Math.cos(ang) * w * 0.36, h, Math.sin(ang) * d * 0.36); break; }
        case 'dish': mount = new Vector3(0, h + 0.15, 0); break;
        case 'vault': mount = new Vector3(0, h, 0); break;
        case 'boom': { const i = next('boom'); const side = i % 2 === 0 ? -1 : 1; mount = new Vector3(side * w * 0.45, h * 0.9, -d * 0.45); normal = new Vector3(side, 0.3, -1).normalize(); break; }
        case 'bottom': { const i = next('bottom'); mount = i === 0 ? new Vector3(0, 0, 0) : new Vector3((i % 2 ? 1 : -1) * w * 0.35, 0.05, (i > 2 ? 1 : -1) * d * 0.35); normal = new Vector3(0, -1, 0); break; }
        case 'skin': case 'none': mount = new Vector3(0, h / 2, d / 2); normal = new Vector3(0, 0, 1); break;
      }
      out.set(inst.instanceId, { mount, normal });
    }
    // Antena sobe se houver cofre de radiação
    const hasVault = installed.some((i) => getComponent(i.componentId).mount === 'vault');
    if (hasVault) for (const inst of installed) if (getComponent(inst.componentId).mount === 'dish') out.get(inst.instanceId)!.mount.y += 0.9;
    return out;
  }

  /** Cria a geometria de um componente (nó não posicionado). */
  build(spec: ComponentSpec, instanceId: string): TransformNode {
    const s = this.scene, m = this.mats;
    const node = new TransformNode(`part-${instanceId}`, s);
    node.parent = this.root;
    const add = (mesh: Mesh) => { tag(mesh, instanceId, spec.id); mesh.parent = node; return mesh; };
    const [dx, dy, dz] = spec.dimensionsM;
    const box = (name: string, w: number, h: number, d: number, mat: Parameters<MaterialLibrary['get']>[0], pos = Vector3.Zero()) => {
      const b = add(MeshBuilder.CreateBox(`${instanceId}-${name}`, { width: w, height: h, depth: d }, s));
      b.material = m.get(mat); b.position = pos; return b;
    };
    const cyl = (name: string, dia: number, h: number, mat: Parameters<MaterialLibrary['get']>[0], pos = Vector3.Zero(), rotX = 0, diaTop?: number) => {
      const c = add(MeshBuilder.CreateCylinder(`${instanceId}-${name}`, { diameterBottom: dia, diameterTop: diaTop ?? dia, height: h, tessellation: 24 }, s));
      c.material = m.get(mat); c.position = pos; c.rotation.x = rotX; return c;
    };
    switch (spec.id) {
      case 'bus-aluminum': case 'bus-large-tank': {
        this.buildBus(spec, instanceId, node);
        break;
      }
      case 'imager-multispectral': case 'hires-camera': case 'context-camera': {
        const sc = spec.id === 'context-camera' ? 0.5 : 1;
        box('body', 0.55 * sc, 0.45 * sc, 0.4 * sc, 'blackAnodized', new Vector3(0, 0, 0.2 * sc));
        cyl('barrel', 0.32 * sc, 0.5 * sc, 'aluminum', new Vector3(0, 0, 0.6 * sc), Math.PI / 2);
        cyl('baffle', 0.36 * sc, 0.25 * sc, 'blackAnodized', new Vector3(0, 0, 0.92 * sc), Math.PI / 2, 0.46 * sc);
        cyl('lens', 0.26 * sc, 0.02, 'glass', new Vector3(0, 0, 1.05 * sc), Math.PI / 2);
        break;
      }
      case 'sounder-ir-mw': case 'radiometer-erb': case 'nir-spectrometer': case 'neutron-spectrometer': case 'gamma-spectrometer': case 'laser-altimeter': {
        box('body', dx * 0.8, dy * 0.8, 0.35, 'mliSilver', new Vector3(0, 0, 0.18));
        cyl('aperture', Math.min(dx, dy) * 0.45, 0.25, 'blackAnodized', new Vector3(0, 0, 0.45), Math.PI / 2);
        for (let k = -1; k <= 1; k++) box(`fin${k}`, 0.02, dy * 0.7, 0.25, 'radiatorWhite', new Vector3(k * dx * 0.25 + dx * 0.42, 0, 0.18));
        if (spec.id === 'sounder-ir-mw') cyl('scan', 0.4, 0.3, 'aluminum', new Vector3(0, dy * 0.35, 0.4), 0);
        break;
      }
      case 'sar-sl': case 'microwave-radiometer': {
        const panel = box('panel', 0.08, dz, dx, 'solarCell', new Vector3(0.1, 0, 0));
        panel.rotation.z = 0;
        box('frame', 0.12, dz + 0.08, dx + 0.08, 'darkSteel', new Vector3(0.04, 0, 0));
        break;
      }
      case 'radiators': box('panel', 0.05, 1.0, 1.0, 'radiatorWhite', new Vector3(0.05, 0, 0)); break;
      case 'solar-gaas': case 'solar-articulated': case 'solar-giant': {
        const span = dx, width = dz;
        const panels = spec.id === 'solar-giant' ? 4 : 3;
        for (const side of [1, -1]) {
          const wing = new TransformNode(`${instanceId}-wing${side}`, s);
          wing.parent = node;
          // Mesma geometria espelhada: o ponto de montagem é o lado +x; o lado −x fica no outro lado do barramento
          wing.position.x = side === 1 ? 0 : -this.bus[0];
          cyl(`yoke${side}`, 0.06, 0.9, 'aluminum', new Vector3(wing.position.x + side * 0.45, 0, 0), 0).rotation.z = Math.PI / 2;
          if (spec.id === 'solar-articulated') cyl(`drive${side}`, 0.22, 0.2, 'darkSteel', new Vector3(wing.position.x + side * 0.1, 0, 0)).rotation.z = Math.PI / 2;
          for (let p = 0; p < panels; p++) {
            const pw = span / panels;
            const panel = add(MeshBuilder.CreateBox(`${instanceId}-p${side}${p}`, { width: pw - 0.05, height: 0.04, depth: width }, s));
            panel.material = m.get('solarCell');
            panel.position = new Vector3(wing.position.x + side * (0.9 + pw * p + pw / 2), 0, 0);
            const frame = add(MeshBuilder.CreateBox(`${instanceId}-f${side}${p}`, { width: pw, height: 0.03, depth: width + 0.04 }, s));
            frame.material = m.get('aluminum');
            frame.position = panel.position.add(new Vector3(0, -0.025, 0));
          }
        }
        break;
      }
      case 'rtg': {
        cyl('core', 0.4, 1.0, 'darkSteel', new Vector3(0, 0, 0));
        for (let k = 0; k < 8; k++) {
          const fin = box(`fin${k}`, 0.02, 1.0, 0.25, 'darkSteel');
          const a = (k / 8) * Math.PI * 2;
          fin.position = new Vector3(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
          fin.rotation.y = -a;
        }
        cyl('strut', 0.06, 1.2, 'titanium', new Vector3(0.5, -0.2, 0), 0).rotation.z = Math.PI / 2.6;
        break;
      }
      case 'battery-liion': {
        box('case', 0.45, 0.32, 0.18, 'darkSteel', new Vector3(0, 0, -0.09));
        for (let k = 0; k < 4; k++) cyl(`cell${k}`, 0.08, 0.24, 'copper', new Vector3(-0.15 + k * 0.1, 0, -0.2), Math.PI / 2);
        break;
      }
      case 'star-tracker': {
        box('head', 0.18, 0.18, 0.18, 'blackAnodized', new Vector3(0, 0.09, 0));
        cyl('baffle', 0.14, 0.3, 'blackAnodized', new Vector3(0, 0.33, 0), 0, 0.26);
        break;
      }
      case 'reaction-wheels': {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          const w = cyl(`wheel${k}`, 0.26, 0.09, 'aluminum', new Vector3(Math.cos(a) * 0.17, Math.sin(a) * 0.17, -0.12));
          w.rotation.x = Math.PI / 2; w.rotation.z = a;
        }
        box('plate', 0.55, 0.55, 0.04, 'darkSteel', new Vector3(0, 0, -0.02));
        break;
      }
      case 'magnetorquers': {
        for (let k = 0; k < 3; k++) cyl(`rod${k}`, 0.05, 0.6, 'copper', new Vector3(-0.2 + k * 0.2, 0, -0.06), 0).rotation.z = Math.PI / 2;
        break;
      }
      case 'sun-sensor': box('s', 0.1, 0.05, 0.1, 'glass', new Vector3(0, 0.03, 0)); break;
      case 'gyroscopes': case 'obc-moderate': case 'obc-radhard': case 'ranging-transponder': case 'heaters': case 'gravity-transponder': {
        box('box', dx, dy, 0.18, spec.id === 'obc-radhard' ? 'titanium' : 'darkSteel', new Vector3(0, 0, -0.09));
        for (let k = 0; k < 5; k++) box(`rib${k}`, dx * 0.9, 0.012, 0.03, 'aluminum', new Vector3(0, -dy / 2 + (k + 1) * dy / 6, -0.19));
        cyl('conn', 0.05, 0.08, 'copper', new Vector3(dx * 0.35, dy * 0.3, -0.2), Math.PI / 2);
        break;
      }
      case 'hydrazine-thrusters': case 'rcs-control-thrusters': {
        const [w, , d] = this.bus;
        for (let k = 0; k < 4; k++) {
          const sx = k % 2 ? 1 : -1, sz = k > 1 ? 1 : -1;
          cyl(`n${k}`, 0.1, 0.18, 'darkSteel', new Vector3(sx * w * 0.42, 0.05, sz * d * 0.42), 0, 0.04);
        }
        cyl('tank', 0.35, 0.35, 'titanium', new Vector3(0, 0.25, 0));
        break;
      }
      case 'electric-thruster-small': {
        cyl('body', 0.25, 0.2, 'darkSteel', new Vector3(0, -0.1, 0));
        const ring = add(MeshBuilder.CreateTorus(`${instanceId}-ring`, { diameter: 0.2, thickness: 0.03, tessellation: 24 }, s));
        const glow = m.get('lampEmissive').clone(`${instanceId}-glow`);
        glow.emissiveColor = new Color3(0.4, 0.6, 1);
        ring.material = glow;
        ring.position.y = -0.21;
        break;
      }
      case 'biprop-main': case 'main-engine-large': {
        const k = spec.id === 'main-engine-large' ? 1.25 : 1;
        cyl('chamber', 0.18 * k, 0.3 * k, 'darkSteel', new Vector3(0, -0.15 * k, 0));
        cyl('bell', 0.55 * k, 0.6 * k, 'sootBlack', new Vector3(0, -0.6 * k, 0), 0, 0.2 * k);
        cyl('mount', 0.5 * k, 0.12, 'aluminum', new Vector3(0, -0.02, 0));
        break;
      }
      case 'xband-tx': cyl('helix', 0.1, 0.3, 'aluminum', new Vector3(0, 0, 0.15), Math.PI / 2); box('amp', 0.2, 0.15, 0.08, 'darkSteel', new Vector3(0, -0.15, 0.04)); break;
      case 'sband-ttc': cyl('whip', 0.03, 0.6, 'aluminum', new Vector3(0, 0.3, 0)); cyl('base', 0.12, 0.05, 'darkSteel', new Vector3(0, 0.03, 0)); break;
      case 'gnss-receiver': cyl('patch', 0.18, 0.04, 'paintedWhite', new Vector3(0, 0.02, 0)); break;
      case 'hga-sx': case 'hga-large': {
        const dia = dx;
        cyl('mast', 0.12, 0.35, 'aluminum', new Vector3(0, 0.17, 0));
        const dish = add(MeshBuilder.CreateSphere(`${instanceId}-dish`, { diameter: dia * 1.6, slice: 0.22, sideOrientation: Mesh.DOUBLESIDE, segments: 32 }, s));
        dish.material = m.get('paintedWhite');
        dish.rotation.x = Math.PI;
        dish.position.y = 0.35 + dia * 0.8;
        cyl('feed', 0.04, dia * 0.45, 'aluminum', new Vector3(0, 0.35 + dia * 0.38, 0));
        cyl('horn', 0.12, 0.12, 'copper', new Vector3(0, 0.35 + dia * 0.6, 0), 0, 0.05);
        break;
      }
      case 'magnetometer-boom': {
        const len = dz;
        const truss = cyl('truss', 0.08, len, 'carbon', new Vector3(0, 0, -len / 2), Math.PI / 2);
        truss.rotation.y = 0;
        box('sensor', 0.2, 0.2, 0.2, 'paintedWhite', new Vector3(0, 0, -len));
        box('sensor2', 0.16, 0.16, 0.16, 'paintedWhite', new Vector3(0, 0, -len * 0.7));
        break;
      }
      case 'particles-plasma': {
        box('box', 0.35, 0.25, 0.35, 'mliGold', new Vector3(0, 0.12, 0));
        for (let k = 0; k < 3; k++) {
          const dome = add(MeshBuilder.CreateSphere(`${instanceId}-dome${k}`, { diameter: 0.14, slice: 0.5 }, s));
          dome.material = m.get('aluminum'); dome.position = new Vector3(-0.1 + k * 0.1, 0.25, 0.1);
        }
        break;
      }
      case 'radiation-vault': box('vault', 1.0, 0.9, 1.0, 'titanium', new Vector3(0, 0.45, 0)); box('lid', 1.05, 0.06, 1.05, 'steel', new Vector3(0, 0.92, 0)); break;
      case 'mli': case 'thermal-shield': case 'planetary-protection': {
        // Mantas e processos não têm geometria própria: alteram o revestimento do barramento ou exibem um selo.
        if (spec.id === 'planetary-protection') {
          const plate = box('seal', 0.3, 0.12, 0.01, 'lampEmissive', new Vector3(0.55, -0.6, 0.01));
          const mat = m.get('paintedWhite').clone(`${instanceId}-seal`);
          mat.emissiveColor = new Color3(0.2, 0.7, 0.4);
          plate.material = mat;
        } else {
          const marker = box('marker', 0.001, 0.001, 0.001, 'mliGold');
          marker.isVisible = false;
        }
        break;
      }
      default:
        box('generic', Math.max(0.2, dx), Math.max(0.2, dy), Math.max(0.2, dz), 'darkSteel');
    }
    return node;
  }

  private buildBus(spec: ComponentSpec, instanceId: string, node: TransformNode): void {
    const s = this.scene;
    const [w, d, h] = spec.dimensionsM;
    this.bus = [w, d, h];
    const body = MeshBuilder.CreateBox(`${instanceId}-body`, { width: w, depth: d, height: h }, s);
    body.position.y = h / 2;
    body.material = this.mats.get(this.skin === 'gold' ? 'mliGold' : this.skin === 'silver' ? 'mliSilver' : 'aluminum');
    tag(body, instanceId, spec.id).parent = node;
    this.busMeshes = [body];
    // Painéis estruturais, bordas e anel adaptador
    for (const y of [0.02, h - 0.02]) {
      const deck = MeshBuilder.CreateBox(`${instanceId}-deck${y}`, { width: w + 0.06, depth: d + 0.06, height: 0.05 }, s);
      deck.position.y = y;
      deck.material = this.mats.get('paintedWhite');
      tag(deck, instanceId, spec.id).parent = node;
    }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const edge = MeshBuilder.CreateBox(`${instanceId}-edge${sx}${sz}`, { width: 0.06, depth: 0.06, height: h }, s);
      edge.position = new Vector3((sx * w) / 2, h / 2, (sz * d) / 2);
      edge.material = this.mats.get('darkSteel');
      tag(edge, instanceId, spec.id).parent = node;
    }
    const ring = MeshBuilder.CreateTorus(`${instanceId}-adapter`, { diameter: Math.min(w, d) * 0.7, thickness: 0.08, tessellation: 40 }, s);
    ring.position.y = -0.02;
    ring.material = this.mats.get('steel');
    tag(ring, instanceId, spec.id).parent = node;
    if (spec.id === 'bus-large-tank') {
      for (const sx of [-1, 1]) {
        const tank = MeshBuilder.CreateSphere(`${instanceId}-tank${sx}`, { diameter: 0.9, segments: 20 }, s);
        tank.position = new Vector3(sx * 0.45, h * 0.35, -d / 2 - 0.05);
        tank.scaling.z = 0.3;
        tank.material = this.mats.get('titanium');
        tag(tank, instanceId, spec.id).parent = node;
      }
    }
    this.busNode = node;
  }

  /** Atualiza o revestimento térmico do barramento conforme MLI/blindagem instalados. */
  setSkin(skin: 'none' | 'gold' | 'silver'): void {
    this.skin = skin;
    const body = this.busMeshes[0];
    if (body) body.material = this.mats.get(skin === 'gold' ? 'mliGold' : skin === 'silver' ? 'mliSilver' : 'aluminum');
  }

  /** Adiciona um componente diretamente na posição final (sem animação). */
  place(inst: InstalledComponent, mount: Vector3, normal: Vector3): PartNode {
    const spec = getComponent(inst.componentId);
    const node = this.build(spec, inst.instanceId);
    node.position = mount.clone();
    this.orient(node, spec, normal);
    const part = { instanceId: inst.instanceId, componentId: inst.componentId, node, mount, normal };
    this.parts.set(inst.instanceId, part);
    return part;
  }

  private orient(node: TransformNode, spec: ComponentSpec, normal: Vector3): void {
    if (spec.mount === 'internal') node.rotation.y = 0;
    if (spec.mount === 'side-panel' && normal.x < 0) node.rotation.y = Math.PI;
    if (spec.mount === 'boom') node.rotation.y = normal.x < 0 ? 0.6 : -0.6;
  }

  remove(instanceId: string): void {
    const part = this.parts.get(instanceId);
    if (!part) return;
    if (part.node === this.busNode) { this.busNode = null; this.busMeshes = []; }
    part.node.dispose(false, false);
    this.parts.delete(instanceId);
  }

  /** Reposiciona componentes existentes após mudança de layout. */
  relayout(installed: InstalledComponent[], inTransit: Set<string> = new Set()): void {
    const lay = this.layout(installed);
    for (const [id, part] of this.parts) {
      const l = lay.get(id);
      if (!l) continue;
      part.mount = l.mount;
      part.normal = l.normal;
      if (!inTransit.has(id)) part.node.position = l.mount.clone();
    }
  }

  /** Reconstrói tudo de uma vez (usado no briefing e em cenas sem animação). */
  rebuild(installed: InstalledComponent[]): void {
    for (const id of [...this.parts.keys()]) this.remove(id);
    const lay = this.layout(installed);
    const ordered = [...installed].sort((a, b) => Number(getComponent(b.componentId).mount === 'bus') - Number(getComponent(a.componentId).mount === 'bus'));
    for (const inst of ordered) {
      const l = lay.get(inst.instanceId)!;
      this.place(inst, l.mount, l.normal);
    }
    this.updateSkin(installed);
  }

  updateSkin(installed: InstalledComponent[]): void {
    const ids = installed.map((i) => i.componentId);
    this.setSkin(ids.includes('mli') ? 'gold' : ids.includes('thermal-shield') ? 'silver' : 'none');
  }

  dispose(): void {
    this.root.dispose(false, false);
    this.parts.clear();
  }
}
