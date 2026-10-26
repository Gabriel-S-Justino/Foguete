/**
 * Complexo de lançamento por família de veículo. Cada família tem a arquitetura de solo que a sustenta de
 * verdade (referências em docs/visual-references.md); as cotas são aproximações coerentes com o veículo do
 * jogo, não plantas de engenharia:
 *
 * - `fss-te` (Falcon 9 / Falcon Heavy, LC-39A): torre de serviço fixa (FSS) treliçada com escada e elevador,
 *   braço de acesso da tripulação, transportador-eretor (strongback) que recua alguns graus antes da ignição,
 *   mesa de lançamento com garras, trincheira de chamas com defletor.
 * - `mobile-launcher` (SLS, LC-39B): plataforma móvel com base de 7,6 m sobre pedestais, aberturas de exaustão,
 *   torre umbilical de ~12 m de lado com braços umbilicais e braço da tripulação, postes de apoio dos boosters.
 * - `olm-tower` (Starship, Starbase): mesa orbital (OLM) anelar sobre seis pernas a ~20 m do chão, defletor de
 *   aço refrigerado a água no chão (sem trincheira), torre com os "chopsticks" e braço de desconexão rápida.
 * - `te-heavy` (New Glenn, LC-36): transportador-eretor largo com braços umbilicais, mesa com garras e trincheira.
 * - `soyuz-tulip` (Soyuz): plataforma de concreto sobre o poço de chamas; o foguete fica suspenso pelos quatro
 *   braços de apoio com contrapeso ("tulipa", que abrem na decolagem), dois meios-pórticos de serviço que
 *   tombam para trás e o mastro de cabos.
 *
 * Partes comuns: aterro de concreto, trincheira ou poço, marcações e drenagem, linhas de propelente em
 * suportes, esferas/tanques de propelente, caixa d'água do sistema de supressão acústica e para-raios com
 * cabos de catenária.
 *
 * Tudo é construído num referencial local com a torre em −X e a trincheira em +Z; nos veículos com boosters
 * laterais (no plano X da cena) o conjunto é girado para a torre ficar perpendicular aos boosters, como no SLS.
 * As partes móveis são nós com eixo e ângulo máximo; a cena só interpola o ângulo.
 */
import { DynamicTexture, MeshBuilder, PBRMaterial, type Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { MaterialKey, MaterialLibrary } from '../entities/materials';
import { Members } from './integrationHall';

export type PadFamily = 'fss-te' | 'mobile-launcher' | 'olm-tower' | 'te-heavy' | 'soyuz-tulip';

export const PAD_FAMILY: Record<string, PadFamily> = {
  'falcon-9': 'fss-te', 'falcon-heavy': 'fss-te', sls: 'mobile-launcher', starship: 'olm-tower', 'new-glenn': 'te-heavy', soyuz: 'soyuz-tulip',
};
/** Raio do estágio central (m), para os braços tocarem o casco e não o envelope com os boosters. */
const CORE_R: Record<string, number> = { 'falcon-9': 1.85, 'falcon-heavy': 1.85, sls: 4.2, starship: 4.5, 'new-glenn': 3.5, soyuz: 1.48 };

/** Parte móvel: ângulo = base + fração × max (rad) em torno do eixo local. */
export interface PadMover { node: TransformNode; axis: 'x' | 'y' | 'z'; max: number; base?: number }

export interface PadComplex {
  family: PadFamily;
  root: TransformNode;
  /** Altura (m) da base do foguete acima do terreno. */
  deckY: number;
  /** Altura da torre principal (enquadramento das câmeras). */
  towerH: number;
  /** Recolhem na contagem regressiva (braços de acesso, strongback, pórticos). */
  arms: PadMover[];
  /** Abrem na decolagem (garras, braços de apoio). Nós com o eixo X local apontando para fora. */
  clamps: TransformNode[];
  /** Saída da fumaça da trincheira (emissor de solo da pluma). */
  trenchExit: TransformNode;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Torre treliçada quadrada: montantes, travessas por nível, diagonais em K alternadas e pisos de grade. */
export function lattice(mem: Members, c: Vector3, w: number, d: number, h: number, o: { panel: number; col: number; brace: number; mat: MaterialKey; deckEvery?: number; faces?: ('x-' | 'x+' | 'z-' | 'z+')[] }) {
  const xs = [-w / 2, w / 2], zs = [-d / 2, d / 2];
  for (const x of xs) for (const z of zs) mem.bar(c.add(v(x, 0, z)), c.add(v(x, h, z)), o.col, o.col, o.mat);
  const n = Math.max(1, Math.round(h / o.panel)), p = h / n;
  const faces = o.faces ?? ['x-', 'x+', 'z-', 'z+'];
  for (let k = 0; k <= n; k++) {
    const y = k * p;
    for (const z of zs) mem.bar(c.add(v(-w / 2, y, z)), c.add(v(w / 2, y, z)), o.brace, o.brace * 1.3, o.mat);
    for (const x of xs) mem.bar(c.add(v(x, y, -d / 2)), c.add(v(x, y, d / 2)), o.brace, o.brace * 1.3, o.mat);
    if (o.deckEvery && k > 0 && k < n && k % o.deckEvery === 0) mem.block(c.add(v(0, y + 0.12, 0)), v(w - 0.3, 0.12, d - 0.3), 'grating');
    if (k === n) continue;
    const s = k % 2 ? 1 : -1;
    for (const f of faces) {
      if (f[0] === 'x') {
        const x = f[1] === '-' ? -w / 2 : w / 2;
        mem.bar(c.add(v(x, y, -s * d / 2)), c.add(v(x, y + p, s * d / 2)), o.brace * 0.8, o.brace * 0.8, o.mat);
      } else {
        const z = f[1] === '-' ? -d / 2 : d / 2;
        mem.bar(c.add(v(-s * w / 2, y, z)), c.add(v(s * w / 2, y + p, z)), o.brace * 0.8, o.brace * 0.8, o.mat);
      }
    }
  }
}

/** Treliça horizontal em caixa de a até b (longarinas, montantes e diagonais), com piso e guarda-corpo. */
function trussArm(mem: Members, a: Vector3, b: Vector3, w: number, h: number, mat: MaterialKey, walkway = true) {
  const dir = b.subtract(a), len = dir.length();
  const u = dir.scale(1 / len);
  const side = Vector3.Cross(u, Vector3.Up()).normalize().scale(w / 2);
  const up = v(0, h, 0);
  const corners = [side.scale(-1), side, side.scale(-1).add(up), side.add(up)];
  for (const k of corners) mem.bar(a.add(k), b.add(k), 0.22, 0.22, mat);
  const n = Math.max(2, Math.round(len / Math.max(1.5, h)));
  for (let i = 0; i <= n; i++) {
    const p = a.add(u.scale((len * i) / n));
    mem.bar(p.add(corners[0]!), p.add(corners[2]!), 0.16, 0.16, mat);
    mem.bar(p.add(corners[1]!), p.add(corners[3]!), 0.16, 0.16, mat);
    mem.bar(p.add(corners[2]!), p.add(corners[3]!), 0.14, 0.14, mat);
    if (i < n) {
      const q = a.add(u.scale((len * (i + 1)) / n));
      mem.bar(p.add(corners[i % 2 ? 0 : 2]!), q.add(corners[i % 2 ? 2 : 0]!), 0.12, 0.12, mat);
      mem.bar(p.add(corners[i % 2 ? 1 : 3]!), q.add(corners[i % 2 ? 3 : 1]!), 0.12, 0.12, mat);
    }
  }
  if (walkway) {
    const mid = a.add(b).scale(0.5);
    const yaw = Math.atan2(u.x, u.z);
    mem.block(mid.add(v(0, 0.08, 0)), v(w - 0.2, 0.1, len), 'grating', yaw);
    for (const s of [-0.92, 0.92]) mem.bar(a.add(side.scale(s)).add(v(0, 1.1, 0)), b.add(side.scale(s)).add(v(0, 1.1, 0)), 0.06, 0.06, 'yellowSafety', 'cyl');
  }
}

/** Escada externa em zigue-zague numa face da torre, com patamares e corrimão. */
export function stairs(mem: Members, c: Vector3, h: number, flight = 4) {
  const n = Math.floor(h / flight);
  for (let k = 0; k < n; k++) {
    const s = k % 2 ? 1 : -1;
    const a = c.add(v(-s * 2.2, k * flight, 0)), b = c.add(v(s * 2.2, (k + 1) * flight, 0));
    mem.bar(a, b, 1.1, 0.12, 'grating');
    mem.bar(a.add(v(0, 1, 0.55)), b.add(v(0, 1, 0.55)), 0.05, 0.05, 'yellowSafety', 'cyl');
    mem.block(b.add(v(s * 0.7, -0.05, 0)), v(1.4, 0.1, 1.2), 'grating');
  }
}

/** Tubulação apoiada em cavaletes: segue os pontos (cotovelos retos), com suportes a cada ~8 m. */
function pipeRun(mem: Members, pts: Vector3[], dia: number, mat: MaterialKey) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    mem.bar(a, b, dia, dia, mat, 'cyl');
    if (Math.abs(a.y - b.y) < 0.1 && a.y > 0.5) {
      const len = Vector3.Distance(a, b), n = Math.floor(len / 8);
      for (let k = 1; k <= n; k++) {
        const p = Vector3.Lerp(a, b, k / (n + 1));
        mem.bar(v(p.x, 0, p.z), v(p.x, p.y - dia / 2, p.z), 0.2, 0.2, 'darkSteel');
      }
    }
  }
}

/** Esfera de propelente sobre colunas (LOX/LH2 do LC-39 têm ~20 m de diâmetro). */
function sphereTank(scene: Scene, mats: MaterialLibrary, mem: Members, root: TransformNode, c: Vector3, dia: number, name: string) {
  const s = MeshBuilder.CreateSphere(name, { diameter: dia, segments: 32 }, scene);
  s.position = c.add(v(0, dia * 0.5 + 3, 0));
  s.material = mats.get('paintedWhite');
  s.parent = root;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const top = c.add(v(Math.cos(a) * dia * 0.48, dia * 0.5 + 3, Math.sin(a) * dia * 0.48));
    mem.bar(v(top.x, 0, top.z), top, 0.6, 0.6, 'padGrey', 'cyl');
  }
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
    mem.bar(c.add(v(Math.cos(a0) * dia * 0.48, 2, Math.sin(a0) * dia * 0.48)), c.add(v(Math.cos(a1) * dia * 0.48, dia * 0.5, Math.sin(a1) * dia * 0.48)), 0.25, 0.25, 'padGrey', 'cyl');
  }
  // Escada de acesso ao topo
  mem.bar(c.add(v(dia * 0.52, 0, 0)), c.add(v(dia * 0.52, dia + 3, 0)), 0.5, 0.1, 'galvanized');
}

/** Tanque cilíndrico horizontal sobre selas (RP-1, água, nitrogênio). */
function hTank(scene: Scene, mats: MaterialLibrary, mem: Members, root: TransformNode, c: Vector3, len: number, dia: number, name: string) {
  const t = MeshBuilder.CreateCapsule(name, { height: len, radius: dia / 2, tessellation: 24 }, scene);
  t.rotation.z = Math.PI / 2;
  t.position = c.add(v(0, dia / 2 + 0.8, 0));
  t.material = mats.get('paintedWhite');
  t.parent = root;
  for (const f of [-0.3, 0.3]) mem.block(c.add(v(f * len, 0.6, 0)), v(0.6, 1.2, dia * 0.8), 'concrete');
}

/** Caixa d'água elevada do sistema de supressão acústica (a do LC-39 tem 88,9 m de altura). */
function waterTower(scene: Scene, mats: MaterialLibrary, mem: Members, root: TransformNode, c: Vector3, h: number, dia: number) {
  lattice(mem, c, dia * 0.6, dia * 0.6, h - dia, { panel: 10, col: 1.0, brace: 0.4, mat: 'padGrey' });
  const tank = MeshBuilder.CreateCylinder('waterTank', { diameter: dia, height: dia * 0.9, tessellation: 32 }, scene);
  tank.position = c.add(v(0, h - dia * 0.55, 0));
  tank.material = mats.get('paintedWhite');
  tank.parent = root;
  const cap = MeshBuilder.CreateCylinder('waterTankCap', { diameterBottom: dia, diameterTop: dia * 0.15, height: dia * 0.2, tessellation: 32 }, scene);
  cap.position = c.add(v(0, h, 0));
  cap.material = mats.get('paintedWhite');
  cap.parent = root;
}

/** Para-raios: mastros de fibra/aço com cabos de catenária entre os topos (sistema do LC-39). */
function lightning(mem: Members, tops: Vector3[]) {
  for (const t of tops) {
    mem.bar(v(t.x, 0, t.z), t, 1.4, 1.4, 'padGrey', 'cyl');
    mem.bar(t, t.add(v(0, 8, 0)), 0.35, 0.35, 'padRed', 'cyl');
  }
  for (let i = 0; i < tops.length; i++) {
    const a = tops[i]!.add(v(0, 7.5, 0)), b = tops[(i + 1) % tops.length]!.add(v(0, 7.5, 0));
    // Catenária aproximada por 6 trechos (flecha de ~6 % do vão)
    const sag = Vector3.Distance(a, b) * 0.06;
    let prev = a;
    for (let k = 1; k <= 6; k++) {
      const f = k / 6;
      const p = Vector3.Lerp(a, b, f).add(v(0, -4 * sag * f * (1 - f), 0));
      mem.bar(prev, p, 0.08, 0.08, 'darkSteel', 'cyl');
      prev = p;
    }
  }
}

/**
 * Aterro da plataforma com abertura (trincheira ou poço) e o defletor. A abertura vai de z0 até a borda
 * (+Z) e desce até o terreno.
 */
function padMound(mem: Members, size: number, h: number, open: { w: number; z0: number } | null, deflector: boolean) {
  const S = size / 2;
  if (!open) {
    mem.block(v(0, h / 2, 0), v(size, h, size), 'concrete');
    return;
  }
  const hw = open.w / 2;
  mem.block(v(-(S + hw) / 2, h / 2, 0), v(S - hw, h, size), 'concrete');
  mem.block(v((S + hw) / 2, h / 2, 0), v(S - hw, h, size), 'concrete');
  mem.block(v(0, h / 2, (-S + open.z0) / 2), v(open.w, h, open.z0 + S), 'concrete');
  // Fundo e paredes enegrecidas pela exaustão; defletor de aço em rampa (a chama sai pela trincheira em +Z)
  mem.block(v(0, 0.25, (open.z0 + S) / 2 + 6), v(open.w, 0.5, S - open.z0 + 12), 'sootBlack');
  for (const s of [-1, 1]) mem.block(v(s * (hw - 0.15), h / 2, (open.z0 + S) / 2), v(0.3, h - 0.2, S - open.z0), 'sootBlack');
  if (deflector) {
    mem.bar(v(0, h - 0.6, open.z0 + 0.6), v(0, 0.6, open.z0 + h * 1.6), open.w - 1, 1.2, 'darkSteel');
    // Bicos do dilúvio d'água ao longo do defletor
    for (const s of [-1, 1]) mem.bar(v(s * (hw - 0.8), h - 1, open.z0), v(s * (hw - 0.8), 1, open.z0 + h * 1.6), 0.5, 0.5, 'galvanized', 'cyl');
  }
}

/** Marcações do piso, manchas de exaustão e grelhas de drenagem num único plano transparente. */
function padMarkingsImpl(scene: Scene, root: TransformNode, size: number, top: number, open: { w: number; z0: number } | null, rocketR: number) {
  const px = 1024, s = px / size;
  const tex = new DynamicTexture('padMarks', { width: px, height: px }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, px, px);
  const P = (x: number, z: number): [number, number] => [(x + size / 2) * s, (size / 2 - z) * s];
  // Mancha de fuligem em volta da mesa (gradiente radial)
  const [cu, cv] = P(0, 0);
  const g = ctx.createRadialGradient(cu, cv, rocketR * s, cu, cv, (rocketR + 22) * s);
  g.addColorStop(0, 'rgba(25,23,20,0.55)');
  g.addColorStop(1, 'rgba(25,23,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  // Faixa de borda amarela e linha de segurança em volta da área do veículo
  ctx.strokeStyle = 'rgba(222,176,32,0.9)';
  ctx.lineWidth = 0.5 * s;
  ctx.strokeRect(1.5 * s, 1.5 * s, (size - 3) * s, (size - 3) * s);
  ctx.setLineDash([2 * s, 1.2 * s]);
  ctx.beginPath(); ctx.arc(cu, cv, (rocketR + 16) * s, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // Zebrado ao longo das bordas da trincheira
  if (open) {
    const hw = open.w / 2;
    for (const side of [-1, 1]) {
      for (let z = open.z0; z < size / 2 - 1; z += 1.2) {
        ctx.fillStyle = Math.round(z / 1.2) % 2 ? 'rgba(20,20,20,0.85)' : 'rgba(222,176,32,0.95)';
        const [u, vv] = P(side * (hw + 0.6), z + 1.2);
        ctx.fillRect(u - 0.5 * s, vv, 1 * s, 1.2 * s);
      }
    }
  }
  // Grelhas de drenagem (canaletas escuras) e pontos de amarração
  ctx.fillStyle = 'rgba(30,32,34,0.9)';
  for (const z of [-size / 2 + 4, size / 2 - 4]) { const [u, vv] = P(-size / 2 + 4, z); ctx.fillRect(u, vv, (size - 8) * s, 0.5 * s); }
  for (const x of [-size / 2 + 4, size / 2 - 4]) { const [u, vv] = P(x, size / 2 - 4); ctx.fillRect(u, vv, 0.5 * s, (size - 8) * s); }
  ctx.fillStyle = 'rgba(60,60,60,0.9)';
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; const [u, vv] = P(Math.cos(a) * (rocketR + 12), Math.sin(a) * (rocketR + 12)); ctx.beginPath(); ctx.arc(u, vv, 0.4 * s, 0, Math.PI * 2); ctx.fill(); }
  // A abertura fica transparente
  if (open) { const [u, vv] = P(-open.w / 2, size / 2); ctx.clearRect(u, vv, open.w * s, (size / 2 - open.z0) * s); }
  tex.hasAlpha = true;
  tex.update();
  const plane = MeshBuilder.CreateGround('padMarkings', { width: size, height: size }, scene);
  plane.position.y = top + 0.02;
  plane.parent = root;
  const m = new PBRMaterial('padMarkingsMat', scene);
  m.albedoTexture = tex;
  m.useAlphaFromAlbedoTexture = true;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.metallic = 0; m.roughness = 0.85;
  m.zOffset = -2; m.zOffsetUnits = -4;
  plane.material = m;
  plane.receiveShadows = true;
  plane.isPickable = false;
}

/** Nó móvel com seus próprios membros (as instâncias finas ficam no referencial do nó). */
function movable(scene: Scene, mats: MaterialLibrary, root: TransformNode, name: string, pos: Vector3, yaw = 0): { node: TransformNode; mem: Members } {
  const node = new TransformNode(name, scene);
  node.parent = root;
  node.position = pos;
  node.rotation.y = yaw;
  return { node, mem: new Members(scene, mats) };
}
const attach = (m: Members, node: TransformNode) => m.all().forEach((x) => { x.parent = node; });

/** Garra de fixação com eixo X local tangencial: abrir (+X) tomba a garra para fora. */
function clampAt(scene: Scene, mats: MaterialLibrary, root: TransformNode, at: Vector3, outwardAngle: number, h: number, name: string): TransformNode {
  const yawNode = new TransformNode(`${name}-yaw`, scene);
  yawNode.parent = root;
  yawNode.position = at;
  yawNode.rotation.y = Math.PI / 2 - outwardAngle;
  const n = new TransformNode(name, scene);
  n.parent = yawNode;
  const mem = new Members(scene, mats);
  mem.block(v(0, h / 2, 0.2), v(0.9, h, 0.9), 'yellowSafety');
  mem.block(v(0, h + 0.15, -0.25), v(0.7, 0.3, 1.2), 'darkSteel');
  mem.bar(v(0, 0.2, 1.1), v(0, h * 0.7, 0.55), 0.3, 0.3, 'steel', 'cyl');
  attach(mem, n);
  return n;
}

export function buildPadComplex(scene: Scene, mats: MaterialLibrary, vehicleId: string, rocket: { height: number; diameter: number }, padH: number, opts: { markings?: boolean } = {}): PadComplex {
  const family = PAD_FAMILY[vehicleId] ?? 'fss-te';
  const coreR = CORE_R[vehicleId] ?? rocket.diameter / 2;
  const envR = rocket.diameter / 2;
  const root = new TransformNode('pad-complex', scene);
  // Boosters laterais ficam no eixo X da cena: a torre vai para −Z (perpendicular a eles)
  const boosters = vehicleId === 'falcon-heavy' || vehicleId === 'sls';
  root.rotation.y = boosters ? -Math.PI / 2 : 0;
  const mem = new Members(scene, mats);
  const arms: PadMover[] = [];
  const clamps: TransformNode[] = [];
  const trenchExit = new TransformNode('trench-exit', scene);
  trenchExit.parent = root;
  let deckY = padH + 6, towerH = rocket.height + 20;
  const size = 120;
  // Marcações em textura de canvas (desligáveis nos testes sem canvas)
  const padMarkings: typeof padMarkingsImpl = (...a) => { if (opts.markings !== false) padMarkingsImpl(...a); };

  // ── Infraestrutura comum: propelente, água, para-raios
  const farm = (lox: number, fuel: 'rp1' | 'lh2' | 'ch4') => {
    sphereTank(scene, mats, mem, root, v(-95, 0, -70), lox, 'loxSphere');
    if (fuel === 'lh2') sphereTank(scene, mats, mem, root, v(-95, 0, 70), lox, 'lh2Sphere');
    else for (const [k, z] of [[0, 55], [1, 70]] as const) hTank(scene, mats, mem, root, v(-90, 0, z), 26, 5, `fuelTank${k}`);
    pipeRun(mem, [v(-95, 1.5, -58), v(-70, 1.5, -58), v(-70, 1.5, -6), v(-size / 2, 1.5, -6)], 0.6, 'steel');
    pipeRun(mem, [v(-80, 1.5, 55), v(-70, 1.5, 55), v(-70, 1.5, 6), v(-size / 2, 1.5, 6)], 0.5, 'galvanized');
    // Rampa da linha até o topo do aterro
    pipeRun(mem, [v(-size / 2, 1.5, -6), v(-size / 2 + 6, padH + 1, -6)], 0.6, 'steel');
    pipeRun(mem, [v(-size / 2, 1.5, 6), v(-size / 2 + 6, padH + 1, 6)], 0.5, 'galvanized');
  };

  if (family === 'olm-tower') {
    // Starbase: laje plana, sem trincheira; o defletor de aço com água fica no chão sob a mesa
    const slab = 1;
    padMound(mem, size, slab, null, false);
    padMarkings(scene, root, size, slab, null, 9);
    deckY = 20;
    towerH = Math.max(146, rocket.height + 25);
    mem.block(v(0, slab + 0.3, 0), v(22, 0.6, 22), 'darkSteel');
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      mem.bar(v(Math.cos(a) * 9, slab, Math.sin(a) * 9), v(Math.cos(a) * 9, deckY - 2.5, Math.sin(a) * 9), 3.2, 3.2, 'concrete', 'cyl');
    }
    // Mesa anelar (24 segmentos) com vigas radiais
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      mem.block(v(Math.cos(a) * 8, deckY - 1.5, Math.sin(a) * 8), v(2.4, 3, 3.6), 'darkSteel', Math.PI / 2 - a);
    }
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      clamps.push(clampAt(scene, mats, root, v(Math.cos(a) * (coreR + 0.9), deckY, Math.sin(a) * (coreR + 0.9)), a, 1.2, `clamp${k}`));
    }
    trenchExit.position = v(0, slab + 1, 14);
    // Torre com chopsticks: treliça de 9 m de lado em seções
    const tx = -(coreR + 16);
    lattice(mem, v(tx, slab, 0), 9, 9, towerH, { panel: 9, col: 1.1, brace: 0.45, mat: 'darkSteel', deckEvery: 2 });
    stairs(mem, v(tx, slab, -6.2), towerH - 10);
    // Carro dos chopsticks e os dois braços (abertos, recolhem mais na contagem)
    const cy = slab + rocket.height * 0.62;
    mem.block(v(tx + 5.2, cy, 0), v(1.6, 8, 11), 'darkSteel');
    for (const s of [-1, 1]) {
      const { node, mem: m } = movable(scene, mats, root, `chopstick${s}`, v(tx + 5.5, cy, s * 4.6));
      trussArm(m, v(0, -1.2, 0), v(22, -1.2, 0), 2, 2.4, 'darkSteel', false);
      m.block(v(21, 0.4, -s * 0.4), v(2, 1, 1.4), 'yellowSafety');
      attach(m, node);
      arms.push({ node, axis: 'y', base: -s * 0.45, max: -s * 0.35 });
    }
    // Braço de desconexão rápida da nave (QD) no topo do booster
    const { node, mem: m } = movable(scene, mats, root, 'shipQD', v(tx + 4.5, slab + rocket.height * 0.66, 0));
    trussArm(m, v(0, 0, 0), v(-tx - 4.5 - coreR - 0.4, 0, 0), 2.2, 2.6, 'padGrey');
    attach(m, node);
    arms.push({ node, axis: 'y', max: 1.4 });
    // Fazenda de tanques verticais (GSE)
    for (let k = 0; k < 6; k++) {
      const t = MeshBuilder.CreateCylinder(`gseTank${k}`, { diameter: 9, height: 30, tessellation: 32 }, scene);
      t.position = v(-90 + (k % 3) * 13, 15, -40 - Math.floor(k / 3) * 14);
      t.material = mats.get('steel');
      t.parent = root;
    }
    pipeRun(mem, [v(-78, 2, -40), v(-40, 2, -40), v(-40, 2, -4), v(tx, 2, -4)], 0.8, 'steel');
    lightning(mem, [v(-55, 60, 55), v(55, 60, 55), v(55, 60, -55)]);
    finish();
    return { family, root, deckY, towerH, arms, clamps, trenchExit };
  }

  if (family === 'soyuz-tulip') {
    // Plataforma sobre o poço: o veículo fica suspenso pelos braços, com os bocais dentro da abertura
    const open = { w: 12, z0: -6.5 };
    padMound(mem, size, padH, open, true);
    padMarkings(scene, root, size, padH, open, 6);
    deckY = padH - 1;
    towerH = rocket.height + 6;
    trenchExit.position = v(0, padH - 2, 20);
    // Quatro braços de apoio com contrapeso, entre os boosters (a 45°)
    const contactY = deckY + 15, R = 9;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const yawNode = new TransformNode(`tulipYaw${k}`, scene);
      yawNode.parent = root;
      yawNode.position = v(Math.cos(a) * R, padH, Math.sin(a) * R);
      yawNode.rotation.y = Math.PI / 2 - a;
      const n = new TransformNode(`tulip${k}`, scene);
      n.parent = yawNode;
      const m = new Members(scene, mats);
      const reach = R - (coreR + 0.75);
      m.bar(v(0, 0.5, 0), v(0, contactY - padH, -reach), 0.9, 0.7, 'padGreen');
      m.bar(v(0.5, 0.5, 0), v(0.3, contactY - padH - 2, -reach + 0.4), 0.25, 0.25, 'padGreen');
      m.bar(v(-0.5, 0.5, 0), v(-0.3, contactY - padH - 2, -reach + 0.4), 0.25, 0.25, 'padGreen');
      m.block(v(0, contactY - padH, -reach - 0.2), v(0.8, 0.6, 0.6), 'darkSteel');
      m.block(v(0, 1.4, 1.6), v(2, 2.4, 2), 'darkSteel');
      m.bar(v(0, 0, 0), v(0, 0.8, 0), 1.1, 1.1, 'steel', 'cyl');
      attach(m, n);
      clamps.push(n);
    }
    // Meios-pórticos de serviço (tombam para fora) e o mastro de cabos (abre na decolagem)
    for (const s of [-1, 1]) {
      const { node, mem: m } = movable(scene, mats, root, `gantry${s}`, v(s * 12.5, padH, 0));
      lattice(m, v(-s * 3, 0, 0), 6, 8, towerH, { panel: 6, col: 0.6, brace: 0.3, mat: 'padGreen', deckEvery: 1 });
      for (let y = 8; y < towerH; y += 6) m.block(v(-s * 6.4, y, 0), v(1, 0.15, 6), 'grating');
      attach(m, node);
      arms.push({ node, axis: 'z', max: s * 1.35 });
    }
    clamps.push(((): TransformNode => {
      const yawNode = new TransformNode('cableMastYaw', scene);
      yawNode.parent = root;
      yawNode.position = v(0, padH, -9);
      yawNode.rotation.y = Math.PI;
      const n = new TransformNode('cableMast', scene);
      n.parent = yawNode;
      const m = new Members(scene, mats);
      lattice(m, v(0, 0, 0.8), 1.4, 1.4, rocket.height * 0.45, { panel: 2.5, col: 0.25, brace: 0.12, mat: 'padRed' });
      m.bar(v(0, rocket.height * 0.45, 0.8), v(0, rocket.height * 0.42, -(9 - coreR - 0.3)), 0.25, 0.25, 'rubber', 'cyl');
      attach(m, n);
      return n;
    })());
    for (const [k, x] of [[0, -95], [1, -80]] as const) hTank(scene, mats, mem, root, v(x, 0, -65), 22, 5, `soyuzTank${k}`);
    pipeRun(mem, [v(-80, 1.5, -58), v(-70, 1.5, -58), v(-70, 1.5, -6), v(-size / 2, 1.5, -6), v(-size / 2 + 6, padH + 1, -6)], 0.5, 'steel');
    lightning(mem, [v(-55, 55, -55), v(55, 55, -55), v(0, 55, 70)]);
    finish();
    return { family, root, deckY, towerH, arms, clamps, trenchExit };
  }

  // ── Famílias com trincheira (Flórida)
  const open = { w: family === 'mobile-launcher' ? 18 : 14, z0: -7 };
  padMound(mem, size, padH, open, true);
  padMarkings(scene, root, size, padH, open, envR);
  trenchExit.position = v(0, padH + 1, 14);

  if (family === 'mobile-launcher') {
    // Plataforma móvel (ficha do Mobile Launcher 1, NASA): base de 165 × 135 ft (50 × 41 m) e 25 ft (7,6 m) de
    // altura sobre seis mecanismos de apoio de 22 ft (6,7 m), deque a 47 ft (14,3 m); abertura de exaustão de
    // 34 × 64 ft (10,4 × 19,5 m); torre de 40 ft (12,2 m) de lado e ~345 ft (105 m) acima do deque
    const mountH = 6.7;
    deckY = padH + mountH + 7.6;
    towerH = 105;
    const bw = 41, bd = 50, hole = { w: 10.4, d: 19.5 };
    for (const [x, z] of [[-15, -18], [15, -18], [-15, 0], [15, 0], [-15, 18], [15, 18]] as const) mem.block(v(x, padH + mountH / 2, z), v(4, mountH, 4), 'darkSteel');
    const by = padH + mountH + 3.8, bh = 7.6;
    mem.block(v(-(bw / 2 + hole.w / 2) / 2, by, 0), v(bw / 2 - hole.w / 2, bh, bd), 'padGrey');
    mem.block(v((bw / 2 + hole.w / 2) / 2, by, 0), v(bw / 2 - hole.w / 2, bh, bd), 'padGrey');
    for (const s of [-1, 1]) mem.block(v(0, by, s * (bd / 2 + hole.d / 2) / 2), v(hole.w, bh, bd / 2 - hole.d / 2), 'padGrey');
    // Postes de apoio dos boosters (garras) e mastros umbilicais da cauda
    for (const z of [-6.3, 6.3]) for (const k of [0, 1, 2, 3]) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      clamps.push(clampAt(scene, mats, root, v(Math.cos(a) * 2.2, deckY, z + Math.sin(a) * 2.2), a, 1.6, `post${z}${k}`));
    }
    for (const s of [-1, 1]) mem.bar(v(-6, deckY, s * 2.5), v(-6, deckY + 10, s * 2.5), 1.2, 1.2, 'padGrey');
    const tx = -(coreR + 12);
    lattice(mem, v(tx, deckY, 0), 12.2, 12.2, towerH, { panel: 6, col: 1.0, brace: 0.4, mat: 'padGrey', deckEvery: 2 });
    mem.block(v(tx, deckY + towerH / 2, 7.6), v(3, towerH, 3), 'padGrey');
    stairs(mem, v(tx, deckY, -7.2), towerH - 6);
    for (const [i, f] of [0.25, 0.45, 0.62, 0.8, 0.9].entries()) {
      const { node, mem: m } = movable(scene, mats, root, `umbilical${i}`, v(tx + 6, deckY + rocket.height * f, 0));
      const len = -tx - 6 - coreR - 0.4;
      trussArm(m, v(0, 0, 0), v(len, 0, 0), i === 4 ? 3 : 2, i === 4 ? 3 : 2.2, i === 4 ? 'paintedWhite' : 'padGrey', i === 4);
      if (i === 4) m.block(v(len - 1.6, 1.5, 0), v(3.2, 3, 3.6), 'paintedWhite');
      attach(m, node);
      arms.push({ node, axis: 'y', max: 1.4 });
    }
    farm(20, 'lh2');
    waterTower(scene, mats, mem, root, v(120, 0, 90), 88.9, 16);
    lightning(mem, [v(-60, towerH + 20, -50), v(60, towerH + 20, -50), v(0, towerH + 20, 75)]);
    finish();
    return { family, root, deckY, towerH: towerH + deckY - padH, arms, clamps, trenchExit };
  }

  // Mesa de lançamento com abertura central sobre a trincheira e garras em volta do(s) núcleo(s)
  const mountH = family === 'te-heavy' ? 8 : 6;
  deckY = padH + mountH;
  const mw = Math.max(18, envR * 2 + 8), hole = Math.max(8, envR * 2 + 1.5);
  const my = padH + mountH / 2;
  for (const s of [-1, 1]) {
    mem.block(v(s * (mw + hole) / 4, my, 0), v((mw - hole) / 2, mountH, mw), 'darkSteel');
    mem.block(v(0, my, s * (mw + hole) / 4), v(hole, mountH, (mw - hole) / 2), 'darkSteel');
  }
  const cores = vehicleId === 'falcon-heavy' ? [-4.1, 0, 4.1] : [0];
  cores.forEach((cz, ci) => {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      clamps.push(clampAt(scene, mats, root, v(Math.cos(a) * (coreR + 0.5), deckY, cz + Math.sin(a) * (coreR + 0.5)), a, 1.4, `holddown${ci}${k}`));
    }
  });

  // Transportador-eretor: treliça junto ao veículo, articulada na base; recua na contagem regressiva
  const teW = family === 'te-heavy' ? 7 : 4, teD = family === 'te-heavy' ? 9 : vehicleId === 'falcon-heavy' ? 12.5 : 5;
  const teX = -(coreR + 1.2 + teW / 2);
  // Pedestal da articulação quando ela fica fora da mesa
  if (teX - teW / 2 < -mw / 2) mem.block(v(teX, padH + (mountH - 1) / 2, 0), v(teW + 1, mountH - 1, teD), 'concrete');
  {
    const { node, mem: m } = movable(scene, mats, root, 'strongback', v(teX - teW / 2, padH + mountH - 1, 0));
    const h = rocket.height * (family === 'te-heavy' ? 0.95 : 0.9);
    lattice(m, v(teW / 2, 0, 0), teW, teD, h, { panel: 4, col: 0.5, brace: 0.22, mat: family === 'te-heavy' ? 'padGrey' : 'galvanized', faces: ['x-', 'z-', 'z+'] });
    for (const f of [0.18, 0.5, 0.8]) {
      for (const cz of cores) {
        m.bar(v(teW, h * f, cz - 0.8), v(teW + 1.0, h * f, cz - 0.6), 0.3, 0.3, 'steel');
        m.bar(v(teW, h * f, cz + 0.8), v(teW + 1.0, h * f, cz + 0.6), 0.3, 0.3, 'steel');
        m.block(v(teW + 1.1, h * f, cz), v(0.3, 0.5, 1.6), 'rubber');
      }
    }
    // Umbilicais: mangueiras ao longo do strongback até a interface do estágio
    m.bar(v(teW - 0.4, 0, -teD / 2 + 0.5), v(teW - 0.4, h * 0.5, -teD / 2 + 0.5), 0.35, 0.35, 'rubber', 'cyl');
    m.bar(v(teW - 0.4, 0, teD / 2 - 0.5), v(teW - 0.4, h * 0.8, teD / 2 - 0.5), 0.3, 0.3, 'rubber', 'cyl');
    attach(m, node);
    arms.push({ node, axis: 'z', max: 0.035 });
  }

  if (family === 'fss-te') {
    // Torre de serviço fixa (FSS) com braço de acesso da tripulação na altura da cápsula/carga
    towerH = rocket.height + 12;
    const tx = teX - teW / 2 - 14;
    lattice(mem, v(tx, padH, 0), 12, 12, towerH, { panel: 6, col: 0.9, brace: 0.35, mat: 'padGrey', deckEvery: 1 });
    mem.block(v(tx, padH + towerH / 2, -7.6), v(3, towerH, 3), 'galvanized');
    stairs(mem, v(tx, padH, 7.2), towerH - 6);
    // Guindaste de topo e mastro do para-raios
    mem.bar(v(tx, padH + towerH, 0), v(tx + 14, padH + towerH + 1, 0), 1.2, 1.2, 'padGrey');
    mem.bar(v(tx, padH + towerH, 0), v(tx, padH + towerH + 24, 0), 0.8, 0.8, 'padRed', 'cyl');
    const { node, mem: m } = movable(scene, mats, root, 'crewAccessArm', v(tx + 6, padH + mountH + rocket.height * 0.92, 0));
    const len = -tx - 6 - coreR - 0.3;
    trussArm(m, v(0, 0, 0), v(len, 0, 0), 2.6, 2.8, 'padGrey');
    m.block(v(len - 1.4, 1.5, 0), v(2.8, 3, 3.2), 'paintedWhite');
    attach(m, node);
    arms.push({ node, axis: 'y', max: 1.4 });
    farm(16, 'rp1');
    waterTower(scene, mats, mem, root, v(120, 0, 90), 88.9, 16);
    lightning(mem, [v(-60, 90, -50), v(60, 90, -50), v(0, 90, 75)]);
  } else {
    // New Glenn: sem torre fixa; quatro mastros de para-raios altos em volta do aterro
    towerH = rocket.height;
    farm(18, 'ch4');
    waterTower(scene, mats, mem, root, v(120, 0, 90), 70, 15);
    lightning(mem, [v(-55, rocket.height + 25, -55), v(55, rocket.height + 25, -55), v(55, rocket.height + 25, 55), v(-55, rocket.height + 25, 55)]);
  }
  finish();
  return { family, root, deckY, towerH, arms, clamps, trenchExit };

  function finish() {
    attach(mem, root);
    for (const m of root.getChildMeshes()) m.receiveShadows = true;
  }
}

/** Aplica a fração de recolhimento a uma parte móvel. */
export function applyMover(m: PadMover, f: number): void {
  m.node.rotation[m.axis] = (m.base ?? 0) + f * m.max;
}

