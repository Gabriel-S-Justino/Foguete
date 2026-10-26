/**
 * Modelo 3D modular da sonda, gerado proceduralmente a partir dos componentes instalados.
 * Cada componente vira um nó com metadados (instanceId, componentId) e é posicionado em um ponto de montagem.
 *
 * Referências de engenharia (ver docs/visual-references.md): kit de imprensa da Juno (JPL: corpo de 3,5 m,
 * 3 asas com 11 painéis, cofre de titânio de ~1 m de aresta e 1 cm de parede, motor Leros-1b de 645 N e
 * 12 propulsores em 4 módulos), LRO e Landsat 8 do NASA 3D Resources (exposição no hangar). Dimensões de
 * cada componente vêm do catálogo do jogo; detalhes sem cota pública (nervuras, suportes, abraçadeiras,
 * perfil da tubeira) são aproximações visuais.
 */
import { Color3, Mesh, MeshBuilder, Quaternion, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
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

/** Asa de painel solar: cadeia de dobradiças (0 = raiz do braço, 1..n = painéis). */
interface SolarWing { side: number; hinges: TransformNode[] }

/** Espaço entre camadas da sanfona recolhida (m). */
const STOW_GAP = 0.07;

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
  private arrays = new Map<string, SolarWing[]>();
  private booms = new Map<string, { len: number; truss: Mesh; sensor: Mesh; sensor2: Mesh }>();
  private deployment = 1;

  constructor(private scene: Scene, private mats: MaterialLibrary, parent?: TransformNode) {
    this.root = new TransformNode('probe-root', scene);
    if (parent) this.root.parent = parent;
  }

  get busSize(): [number, number, number] { return this.bus; }
  get height(): number { return this.bus[2]; }
  getPart(instanceId: string): PartNode | undefined { return this.parts.get(instanceId); }
  get partNodes(): PartNode[] { return [...this.parts.values()]; }
  /** Há painéis solares instalados (que precisam ser estendidos em órbita)? */
  get hasSolarArrays(): boolean { return this.arrays.size > 0; }
  /** Há apêndices dobráveis (painéis ou mastro)? */
  get hasDeployables(): boolean { return this.arrays.size > 0 || this.booms.size > 0; }
  get deploymentFraction(): number { return this.deployment; }

  /**
   * Abre (1) ou recolhe (0) os painéis solares. Recolhida, cada asa desce pelo braço junto à lateral e os
   * painéis ficam empilhados em sanfona (dobras alternadas de 180°); a abertura acontece em sequência, do
   * braço para a ponta, como no desdobramento real.
   */
  setDeployment(fraction: number): void {
    this.deployment = Math.max(0, Math.min(1, fraction));
    // Mastro do magnetômetro: estende depois dos painéis (último terço da sequência)
    const b = Math.max(0, Math.min(1, (this.deployment - 0.6) / 0.4));
    const k = 0.06 + 0.94 * b * b * (3 - 2 * b);
    for (const boom of this.booms.values()) {
      boom.truss.scaling.y = k;
      boom.truss.position.z = -boom.len * k / 2;
      boom.sensor.position.z = -Math.max(0.3, boom.len * k);
      boom.sensor2.position.z = -Math.max(0.25, boom.len * 0.7 * k);
    }
    for (const wings of this.arrays.values()) {
      for (const { side, hinges } of wings) {
        const n = hinges.length;
        hinges.forEach((h, k) => {
          // Cada dobradiça abre numa janela do intervalo total (sequencial com sobreposição)
          const start = (k / n) * 0.6, end = start + 0.4;
          const local = Math.max(0, Math.min(1, (this.deployment - start) / (end - start)));
          const e = local * local * (3 - 2 * local);
          const closed = 1 - e;
          if (k === 0) {
            h.rotation.z = -side * (Math.PI / 2) * closed;
          } else {
            h.rotation.z = side * (k % 2 === 1 ? Math.PI : -Math.PI) * closed;
            // Afastamento entre as camadas da pilha (no referencial do segmento anterior)
            h.position.y = (k % 2 === 1 ? STOW_GAP : -STOW_GAP) * closed;
          }
        });
      }
    }
  }

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
    /** Sólido de revolução em torno de Y a partir de um perfil (x = raio, y = altura). */
    const lathe = (name: string, profile: [number, number][], mat: Parameters<MaterialLibrary['get']>[0], pos = Vector3.Zero(), tess = 32) => {
      const l = add(MeshBuilder.CreateLathe(`${instanceId}-${name}`, { shape: profile.map(([x, y]) => new Vector3(x, y, 0)), tessellation: tess, sideOrientation: Mesh.DOUBLESIDE }, s));
      l.material = m.get(mat); l.position = pos; return l;
    };
    /** Peça pequena: some além de 80 m (nível de detalhe), onde teria menos de um pixel. */
    const detail = <T extends Mesh>(mesh: T): T => { mesh.addLODLevel(80, null); return mesh; };
    /** Barra entre dois pontos (suportes, treliças, linhas de propelente retas). */
    const strut = (name: string, a: Vector3, b: Vector3, dia: number, mat: Parameters<MaterialLibrary['get']>[0]) => {
      const d = b.subtract(a);
      const c = cyl(name, dia, d.length(), mat, a.add(b).scale(0.5));
      const axis = d.normalize();
      // Alinha o eixo Y do cilindro à direção a→b
      const up = new Vector3(0, 1, 0);
      const ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, axis))));
      const ax = Vector3.Cross(up, axis);
      if (ax.length() > 1e-6) c.rotationQuaternion = Quaternion.RotationAxis(ax.normalize(), ang);
      else if (axis.y < 0) c.rotation.x = Math.PI;
      return c;
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
      case 'radiators': {
        // Radiador com persianas térmicas (lâminas que abrem com a temperatura) sobre o painel branco
        box('panel', 0.05, 1.0, 1.0, 'radiatorWhite', new Vector3(0.05, 0, 0));
        box('louverFrame', 0.04, 0.5, 0.9, 'aluminum', new Vector3(0.1, -0.2, 0));
        for (let k = 0; k < 8; k++) {
          const blade = detail(box(`louver${k}`, 0.012, 0.05, 0.86, 'aluminum', new Vector3(0.13, -0.42 + k * 0.06, 0)));
          blade.rotation.z = 0.5;
        }
        break;
      }
      case 'solar-gaas': case 'solar-articulated': case 'solar-giant': {
        // Asas em sanfona: braço (yoke) + painéis ligados por dobradiças. Recolhidas, as asas ficam dobradas
        // contra a lateral do barramento (cabem na coifa); estendidas, abrem em linha reta para fora.
        const span = dx, width = dz;
        const panels = spec.id === 'solar-giant' ? 4 : 3;
        const pw = span / panels;
        const yokeLen = 0.9;
        const wings: SolarWing[] = [];
        for (const side of [1, -1]) {
          const wing = new TransformNode(`${instanceId}-wing${side}`, s);
          wing.parent = node;
          // Mesma geometria espelhada: o ponto de montagem é o lado +x; o lado −x fica no outro lado do barramento
          wing.position.x = side === 1 ? 0 : -this.bus[0];
          const hinges: TransformNode[] = [];
          const root = new TransformNode(`${instanceId}-hinge${side}-0`, s);
          root.parent = wing;
          hinges.push(root);
          // Braço em V (yoke) de tubos de carbono, da articulação de raiz até os dois cantos internos do painel
          for (const dz of [-1, 1]) {
            const y = strut(`yoke${side}${dz}`, new Vector3(side * 0.12, 0, 0), new Vector3(side * yokeLen, 0, dz * width * 0.42), 0.05, 'carbon');
            y.parent = root;
          }
          const yokeBar = cyl(`yokeBar${side}`, 0.05, width * 0.84, 'carbon', new Vector3(side * yokeLen, 0, 0), Math.PI / 2);
          yokeBar.parent = root;
          // Acionamento do painel (SADA) na lateral do corpo: carcaça e flange
          const drive = cyl(`drive${side}`, spec.id === 'solar-articulated' ? 0.26 : 0.2, 0.18, 'darkSteel', new Vector3(side * 0.06, 0, 0));
          drive.rotation.z = Math.PI / 2;
          drive.parent = wing;
          let prev = root, prevLen = yokeLen;
          for (let p = 0; p < panels; p++) {
            const hinge = new TransformNode(`${instanceId}-hinge${side}-${p + 1}`, s);
            hinge.parent = prev;
            hinge.position.x = side * prevLen;
            // Substrato em colmeia de alumínio com faces de carbono (2,5 cm) e células só na face ativa
            const frame = add(MeshBuilder.CreateBox(`${instanceId}-f${side}${p}`, { width: pw - 0.02, height: 0.025, depth: width + 0.03 }, s));
            frame.material = m.get('carbon');
            frame.parent = hinge;
            frame.position = new Vector3(side * pw / 2, -0.0125, 0);
            const panel = add(MeshBuilder.CreateBox(`${instanceId}-p${side}${p}`, { width: pw - 0.07, height: 0.006, depth: width - 0.03 }, s));
            panel.material = m.get('solarCell');
            panel.parent = hinge;
            panel.position = new Vector3(side * pw / 2, 0.003, 0);
            // Dobradiças com mola entre painéis (duas por linha de dobra)
            for (const dz of [-0.36, 0.36]) {
              const pin = detail(add(MeshBuilder.CreateCylinder(`${instanceId}-hp${side}${p}${dz}`, { diameter: 0.045, height: 0.14, tessellation: 10 }, s)));
              pin.material = m.get('titanium');
              pin.parent = hinge;
              pin.rotation.x = Math.PI / 2;
              pin.position = new Vector3(0, -0.01, dz * width);
            }
            hinges.push(hinge);
            prev = hinge;
            prevLen = pw;
          }
          wings.push({ side, hinges });
        }
        this.arrays.set(instanceId, wings);
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
        // Cabeça óptica num suporte inclinado e defletor (baffle) cônico contra a luz do Sol
        box('bracket', 0.24, 0.04, 0.24, 'titanium', new Vector3(0, 0.02, 0));
        box('head', 0.18, 0.18, 0.18, 'blackAnodized', new Vector3(0, 0.13, 0));
        cyl('baffle', 0.14, 0.3, 'blackAnodized', new Vector3(0, 0.37, 0), 0, 0.26);
        detail(cyl('baffleRing', 0.27, 0.015, 'aluminum', new Vector3(0, 0.52, 0)));
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
        // Quatro módulos nos cantos inferiores, cada um com 3 tubeiras em direções diferentes (para baixo e
        // tangenciais), como os 4 módulos de 3 propulsores da Juno; tanque de hidrazina e linhas até os módulos
        const [w, , d] = this.bus;
        for (let k = 0; k < 4; k++) {
          const sx = k % 2 ? 1 : -1, sz = k > 1 ? 1 : -1;
          const c = new Vector3(sx * (w / 2 + 0.02), 0.12, sz * (d / 2 + 0.02));
          box(`rem${k}`, 0.16, 0.14, 0.16, 'mliSilver', c);
          // Bocais: um para baixo e dois tangenciais (±x / ±z), com a saída para fora do corpo
          const down = cyl(`nd${k}`, 0.035, 0.1, 'darkSteel', c.add(new Vector3(0, -0.11, 0)), 0, 0.012);
          down.rotation.x = Math.PI;
          const nx = cyl(`nx${k}`, 0.035, 0.1, 'darkSteel', c.add(new Vector3(sx * 0.12, 0, 0)), 0, 0.012);
          nx.rotation.z = sx * Math.PI / 2;
          const nz = cyl(`nz${k}`, 0.035, 0.1, 'darkSteel', c.add(new Vector3(0, 0, sz * 0.12)), 0, 0.012);
          nz.rotation.x = -sz * Math.PI / 2;
          detail(strut(`line${k}`, new Vector3(0, 0.12, 0), c.add(new Vector3(-sx * 0.08, 0, -sz * 0.08)), 0.018, 'titanium'));
        }
        lathe('tank', Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + (i / 12) * Math.PI; return [Math.cos(a) * 0.19 + 1e-4, 0.25 + Math.sin(a) * 0.19 + (a > 0 ? 0.06 : 0)] as [number, number]; }), 'titanium', Vector3.Zero(), 24);
        break;
      }
      case 'electric-thruster-small': {
        cyl('body', 0.25, 0.2, 'darkSteel', new Vector3(0, -0.1, 0));
        const ring = add(MeshBuilder.CreateTorus(`${instanceId}-ring`, { diameter: 0.2, thickness: 0.03, tessellation: 24 }, s));
        const glow = m.variant('lampEmissive', `${instanceId}-glow`);
        glow.emissiveColor = new Color3(0.4, 0.6, 1);
        ring.material = glow;
        ring.position.y = -0.21;
        break;
      }
      case 'biprop-main': case 'main-engine-large': {
        // Motor bipropelente: placa de montagem, válvulas, câmara e tubeira em sino (perfil parabólico de
        // Rao, razão de áreas ~150 como nos motores de apogeu da classe Leros); tubeira em nióbio escurecido
        const k = spec.id === 'main-engine-large' ? 1.25 : 1;
        cyl('mount', 0.5 * k, 0.06, 'aluminum', new Vector3(0, -0.03, 0));
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          detail(strut(`leg${i}`, new Vector3(Math.cos(a) * 0.2 * k, -0.06, Math.sin(a) * 0.2 * k), new Vector3(Math.cos(a) * 0.07 * k, -0.2 * k, Math.sin(a) * 0.07 * k), 0.025, 'titanium'));
        }
        box('valves', 0.16 * k, 0.08 * k, 0.1 * k, 'aluminum', new Vector3(0.1 * k, -0.12 * k, 0));
        cyl('chamber', 0.12 * k, 0.14 * k, 'titanium', new Vector3(0, -0.22 * k, 0));
        const throatY = -0.3 * k, exitY = -0.85 * k, rExit = 0.27 * k, rThroat = 0.035 * k;
        const bell: [number, number][] = [[0.06 * k, -0.27 * k], [rThroat, throatY]];
        for (let i = 1; i <= 10; i++) { const u = i / 10; bell.push([rThroat + (rExit - rThroat) * Math.sqrt(u), throatY + (exitY - throatY) * u]); }
        lathe('bell', bell, 'sootBlack', Vector3.Zero(), 32);
        lathe('bellLip', [[rExit, exitY], [rExit + 0.012 * k, exitY], [rExit + 0.012 * k, exitY + 0.025 * k], [rExit - 0.002, exitY + 0.03 * k]], 'titanium', Vector3.Zero(), 32);
        break;
      }
      case 'xband-tx': cyl('helix', 0.1, 0.3, 'aluminum', new Vector3(0, 0, 0.15), Math.PI / 2); box('amp', 0.2, 0.15, 0.08, 'darkSteel', new Vector3(0, -0.15, 0.04)); break;
      case 'sband-ttc': cyl('whip', 0.03, 0.6, 'aluminum', new Vector3(0, 0.3, 0)); cyl('base', 0.12, 0.05, 'darkSteel', new Vector3(0, 0.03, 0)); break;
      case 'gnss-receiver': cyl('patch', 0.18, 0.04, 'paintedWhite', new Vector3(0, 0.02, 0)); break;
      case 'hga-sx': case 'hga-large': {
        // Refletor parabólico (f/D = 0,35) em compósito com pintura branca térmica, borda reforçada, nervuras
        // radiais no verso, subrefletor Cassegrain em tripé e corneta de alimentação no centro. Montado no
        // deck por uma estrutura cônica de 6 barras (antena fixa, apontada pela atitude da sonda, como na Juno)
        const dia = dx, R = dia / 2, f = 0.35 * dia;
        const base = 0.4; // altura do vértice do refletor sobre o deck
        const depth = (R * R) / (4 * f);
        const prof: [number, number][] = [];
        for (let i = 0; i <= 16; i++) { const r = (i / 16) * R; prof.push([r + 1e-4, base + (r * r) / (4 * f)]); }
        lathe('dish', prof, 'radiatorWhite', Vector3.Zero(), 48);
        // Verso (casca de carbono 2 cm abaixo) e borda
        lathe('dishBack', prof.map(([r, y]) => [r, y - 0.02] as [number, number]), 'carbon', Vector3.Zero(), 48);
        const rim = add(MeshBuilder.CreateTorus(`${instanceId}-rim`, { diameter: dia, thickness: 0.035, tessellation: 64 }, s));
        rim.material = m.get('carbon'); rim.position.y = base + depth - 0.01;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rib: [number, number][] = [];
          for (let j = 0; j <= 6; j++) { const r = 0.1 + (j / 6) * (R - 0.12); rib.push([r, base + (r * r) / (4 * f) - 0.05]); }
          for (let j = 0; j + 1 < rib.length; j++) {
            const a0 = rib[j]!, a1 = rib[j + 1]!;
            detail(strut(`rib${i}-${j}`, new Vector3(Math.cos(a) * a0[0], a0[1], Math.sin(a) * a0[0]), new Vector3(Math.cos(a) * a1[0], a1[1], Math.sin(a) * a1[0]), 0.03, 'carbon'));
          }
        }
        // Suporte cônico: 6 barras de titânio do deck ao anel de montagem no verso do refletor
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2, a2 = a + Math.PI / 6;
          strut(`mount${i}`, new Vector3(Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5), new Vector3(Math.cos(a2) * 0.18, base - 0.03, Math.sin(a2) * 0.18), 0.04, 'titanium');
        }
        cyl('mountRing', 0.42, 0.05, 'titanium', new Vector3(0, base - 0.03, 0));
        // Subrefletor no tripé (a ~0,8·f do vértice) e corneta de alimentação
        const subY = base + 0.82 * f;
        cyl('subreflector', dia * 0.12, 0.03, 'aluminum', new Vector3(0, subY, 0), 0, dia * 0.09);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.3;
          strut(`tripod${i}`, new Vector3(Math.cos(a) * R * 0.92, base + depth - 0.01, Math.sin(a) * R * 0.92), new Vector3(Math.cos(a) * dia * 0.05, subY, Math.sin(a) * dia * 0.05), 0.025, 'carbon');
        }
        cyl('horn', 0.1, 0.22, 'aluminum', new Vector3(0, base + 0.11, 0), 0, 0.2);
        break;
      }
      case 'magnetometer-boom': {
        // Mastro extensível (tipo "coilable"): recolhido dentro do cilindro da base durante o lançamento,
        // estende-se em órbita levando os magnetômetros para longe do campo da própria sonda
        const len = dz;
        cyl('canister', 0.22, 0.45, 'paintedWhite', new Vector3(0, 0, -0.2), Math.PI / 2);
        const truss = cyl('truss', 0.08, len, 'carbon', new Vector3(0, 0, -len / 2), Math.PI / 2);
        const sensor = box('sensor', 0.2, 0.2, 0.2, 'paintedWhite', new Vector3(0, 0, -len));
        const sensor2 = box('sensor2', 0.16, 0.16, 0.16, 'paintedWhite', new Vector3(0, 0, -len * 0.7));
        this.booms.set(instanceId, { len, truss, sensor, sensor2 });
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
          const mat = m.variant('paintedWhite', `${instanceId}-seal`);
          mat.emissiveColor = new Color3(0.2, 0.7, 0.4);
          plate.material = mat;
        } else {
          const marker = box('mli-tag', 0.001, 0.001, 0.001, 'mliGold');
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
    // Interface com o lançador: anel de separação com cinta de fixação (tipo Marman) sob o deck inferior
    const ringDia = Math.min(w, d) * 0.7;
    const ring = MeshBuilder.CreateCylinder(`${instanceId}-adapter`, { diameterTop: ringDia, diameterBottom: ringDia * 1.04, height: 0.08, tessellation: 48 }, s);
    ring.position.y = -0.04;
    ring.material = this.mats.get('aluminum');
    tag(ring, instanceId, spec.id).parent = node;
    const band = MeshBuilder.CreateTorus(`${instanceId}-clampBand`, { diameter: ringDia * 1.05, thickness: 0.03, tessellation: 48 }, s);
    band.position.y = -0.06;
    band.material = this.mats.get('steel');
    tag(band, instanceId, spec.id).parent = node;
    // Canaletas de chicote elétrico nas arestas verticais das faces ±X (ligam os painéis eletrônicos)
    for (const sx of [-1, 1]) {
      const tray = MeshBuilder.CreateBox(`${instanceId}-tray${sx}`, { width: 0.05, depth: 0.08, height: h * 0.8 }, s);
      tray.position = new Vector3(sx * (w / 2 + 0.03), h / 2, -d / 2 + 0.12);
      tray.material = this.mats.get('darkSteel');
      tray.addLODLevel(80, null);
      tag(tray, instanceId, spec.id).parent = node;
    }
    if (spec.id === 'bus-large-tank') {
      // Tanques de propelente dentro do cilindro central (não visíveis); por fora ficam o tubo de empuxo sob o
      // deck inferior e o painel de propulsão na face −Z: dois tanques de pressurização (hélio), linhas e válvulas
      const tube = MeshBuilder.CreateCylinder(`${instanceId}-thrustTube`, { diameter: Math.min(w, d) * 0.5, height: 0.12, tessellation: 40 }, s);
      tube.position.y = -0.02;
      tube.material = this.mats.get('carbon');
      tag(tube, instanceId, spec.id).parent = node;
      for (const sx of [-1, 1]) {
        const copv = MeshBuilder.CreateCapsule(`${instanceId}-copv${sx}`, { radius: 0.2, height: 0.75, tessellation: 20 }, s);
        copv.position = new Vector3(sx * 0.42, h * 0.32, -d / 2 - 0.24);
        copv.material = this.mats.get('carbon');
        tag(copv, instanceId, spec.id).parent = node;
        for (const y of [-0.22, 0.22]) {
          const strap = MeshBuilder.CreateTorus(`${instanceId}-strap${sx}${y}`, { diameter: 0.42, thickness: 0.025, tessellation: 24 }, s);
          strap.position = copv.position.add(new Vector3(0, y, 0));
          strap.material = this.mats.get('titanium');
          strap.addLODLevel(80, null);
          tag(strap, instanceId, spec.id).parent = node;
        }
        const pipe = MeshBuilder.CreateTube(`${instanceId}-feed${sx}`, { path: [copv.position.add(new Vector3(0, 0.38, 0)), new Vector3(sx * 0.42, h * 0.62, -d / 2 - 0.1), new Vector3(0, h * 0.62, -d / 2 - 0.06)], radius: 0.014, tessellation: 8 }, s);
        pipe.material = this.mats.get('titanium');
        pipe.addLODLevel(80, null);
        tag(pipe, instanceId, spec.id).parent = node;
      }
      const valves = MeshBuilder.CreateBox(`${instanceId}-valvePanel`, { width: 0.5, height: 0.3, depth: 0.08 }, s);
      valves.position = new Vector3(0, h * 0.62, -d / 2 - 0.05);
      valves.material = this.mats.get('aluminum');
      tag(valves, instanceId, spec.id).parent = node;
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
    this.arrays.delete(instanceId);
    this.booms.delete(instanceId);
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
    this.setDeployment(this.deployment);
  }

  updateSkin(installed: InstalledComponent[]): void {
    const ids = installed.map((i) => i.componentId);
    this.setSkin(ids.includes('mli') ? 'gold' : ids.includes('thermal-shield') ? 'silver' : 'none');
  }

  dispose(): void {
    this.root.dispose(false, false);
    this.parts.clear();
    this.arrays.clear();
    this.booms.clear();
  }
}
