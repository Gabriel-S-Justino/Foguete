/**
 * Sala limpa de integração da sonda ("high bay"). Referências (docs/visual-references.md): High Bay 1 do
 * Spacecraft Assembly Facility do JPL (classe 10.000, piso epóxi dissipativo, ponte rolante de 13,6 t com
 * guarda-chuva branco no cabo para reter graxa, macacões "bunny suit", pulseiras antiestáticas), a foto do
 * Amazônia-1 no INPE fornecida pelo usuário (dolly laranja) e fotos do NASA Image Library de integração.
 *
 * Dimensões adotadas (aproximações coerentes com a sonda de ~2–4 m e o pé-direito de um high bay; não são as
 * cotas de uma instalação específica): 40 m × 50 m em planta, 18 m até o banzo inferior das treliças,
 * ponte rolante a 14 m, portão de 10 m × 12 m, mezanino de observação a 4,5 m.
 *
 * Organização funcional: célula robotizada no centro (zona demarcada no piso), área de testes elétricos
 * (EGSE) à direita, inspeção de painéis solares à frente-direita, exposição da nave de referência à
 * esquerda, corredor de circulação junto ao portão e antecâmara com chuveiro de ar.
 */
import {
  Color3, DynamicTexture, type Material, Matrix, Mesh, MeshBuilder, PBRMaterial, Quaternion, type Scene, Vector3,
} from '@babylonjs/core';
import type { MaterialKey, MaterialLibrary } from '../entities/materials';

export const HALL = { width: 40, depth: 50, height: 18, craneY: 14, doorW: 10, doorH: 12 } as const;

/** Lote de peças repetidas desenhadas com instâncias finas (uma chamada de desenho por tipo). */
export class Members {
  private meshes = new Map<string, Mesh>();
  constructor(private scene: Scene, private mats: MaterialLibrary) {}
  private get(kind: 'box' | 'cyl', mat: MaterialKey): Mesh {
    const key = `${kind}|${mat}`;
    let m = this.meshes.get(key);
    if (!m) {
      m = kind === 'box' ? MeshBuilder.CreateBox(`members-${key}`, { size: 1 }, this.scene) : MeshBuilder.CreateCylinder(`members-${key}`, { diameter: 1, height: 1, tessellation: 12 }, this.scene);
      m.material = this.mats.get(mat);
      m.isPickable = false;
      this.meshes.set(key, m);
    }
    return m;
  }
  /** Barra de seção w × d entre os pontos a e b. */
  bar(a: Vector3, b: Vector3, w: number, d: number, mat: MaterialKey, kind: 'box' | 'cyl' = 'box'): void {
    const dir = b.subtract(a);
    const len = dir.length();
    if (len < 1e-6) return;
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir.scale(1 / len), q);
    this.get(kind, mat).thinInstanceAdd(Matrix.Compose(new Vector3(w, len, d), q, a.add(b).scale(0.5)));
  }
  /** Caixa alinhada aos eixos (centro e tamanho), com giro opcional em Y. */
  block(center: Vector3, size: Vector3, mat: MaterialKey, yaw = 0): void {
    this.get('box', mat).thinInstanceAdd(Matrix.Compose(size, Quaternion.RotationYawPitchRoll(yaw, 0, 0), center));
  }
  all(): Mesh[] { return [...this.meshes.values()]; }
}

/** Marcações do piso desenhadas numa única textura transparente sobre o piso. */
function floorMarkings(scene: Scene, robotZones: Vector3[], robotR: number): Mesh {
  const W = HALL.width, D = HALL.depth, px = 2048, py = Math.round((px * D) / W);
  const tex = new DynamicTexture('floorMarks', { width: px, height: py }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, px, py);
  const sx = px / W, sy = py / D;
  // Coordenadas do mundo (x, z) → canvas (u, v)
  const P = (x: number, z: number): [number, number] => [(x + W / 2) * sx, (D / 2 - z) * sy];
  const line = (pts: [number, number][], color: string, widthM: number, dash?: number[]) => {
    ctx.strokeStyle = color; ctx.lineWidth = widthM * sx; ctx.setLineDash(dash ? dash.map((d) => d * sx) : []);
    ctx.beginPath(); pts.forEach(([x, z], i) => { const [u, v] = P(x, z); if (i) ctx.lineTo(u, v); else ctx.moveTo(u, v); }); ctx.stroke();
  };
  // Corredor de circulação (verde) junto ao portão e ao longo da parede direita
  ctx.fillStyle = 'rgba(46,140,88,0.55)';
  { const [u, v] = P(-W / 2 + 1, 13); ctx.fillRect(u, v, (W - 2) * sx, 3 * sy); }
  line([[-W / 2 + 1, 13], [W / 2 - 1, 13]], 'rgba(240,240,240,0.9)', 0.08);
  line([[-W / 2 + 1, 10], [W / 2 - 1, 10]], 'rgba(240,240,240,0.9)', 0.08);
  // Zonas dos robôs: círculos com faixa zebrada amarela e preta (alcance máximo do braço)
  for (const c of robotZones) {
    const [u, v] = P(c.x, c.z);
    for (let k = 0; k < 72; k++) {
      ctx.strokeStyle = k % 2 ? 'rgba(20,20,20,0.85)' : 'rgba(226,182,34,0.95)';
      ctx.lineWidth = 0.15 * sx; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(u, v, robotR * sx, (k / 72) * Math.PI * 2, ((k + 1) / 72) * Math.PI * 2); ctx.stroke();
    }
  }
  // Área de integração: retângulo branco tracejado em volta do dolly
  line([[-3.4, -3], [3.4, -3], [3.4, 3], [-3.4, 3], [-3.4, -3]], 'rgba(245,245,245,0.85)', 0.07, [0.4, 0.25]);
  // Áreas de trabalho: EGSE e inspeção de painéis (contorno amarelo)
  line([[10, -10], [17, -10], [17, -1.5], [10, -1.5], [10, -10]], 'rgba(226,182,34,0.9)', 0.1);
  line([[8, 3.5], [17, 3.5], [17, 9], [8, 9], [8, 3.5]], 'rgba(226,182,34,0.9)', 0.1);
  // Pontos de aterramento ESD (círculos verdes)
  ctx.fillStyle = 'rgba(40,150,80,0.9)';
  for (const [x, z] of [[-2.8, -2.6], [2.8, 2.6], [11, -2.5], [9, 4.5]] as const) { const [u, v] = P(x, z); ctx.beginPath(); ctx.arc(u, v, 0.18 * sx, 0, Math.PI * 2); ctx.fill(); }
  // Textos de piso
  ctx.fillStyle = 'rgba(30,30,30,0.75)';
  ctx.font = `bold ${Math.round(0.45 * sx)}px sans-serif`;
  const label = (s: string, x: number, z: number) => { const [u, v] = P(x, z); ctx.fillText(s, u, v); };
  label('EGSE / TESTES ELÉTRICOS', 10.3, -9.4);
  label('INSPEÇÃO DE PAINÉIS SOLARES', 8.3, 8.4);
  label('CIRCULAÇÃO', -18, 11.2);
  tex.hasAlpha = true;
  tex.update();
  const plane = MeshBuilder.CreateGround('floorMarkings', { width: W, height: D }, scene);
  plane.position.y = 0.006;
  const m = new PBRMaterial('floorMarkingsMat', scene);
  m.albedoTexture = tex;
  m.useAlphaFromAlbedoTexture = true;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.metallic = 0; m.roughness = 0.6;
  m.zOffset = -2; m.zOffsetUnits = -2;
  plane.material = m;
  plane.receiveShadows = true;
  plane.isPickable = false;
  return plane;
}

export interface Hall { floor: Mesh; members: Members; craneHook: Vector3; shadowCasters: Mesh[] }

/** Estrutura do high bay: piso, paredes, treliças, pilares, ponte rolante, portão, mezanino e utilidades. */
export function buildIntegrationHall(scene: Scene, mats: MaterialLibrary, robotZones: Vector3[], robotR: number): Hall {
  const { width: W, depth: D, height: H } = HALL;
  const mem = new Members(scene, mats);
  const floor = MeshBuilder.CreateGround('floor', { width: W, height: D }, scene);
  floor.material = mats.get('floorTile');
  floor.receiveShadows = true;
  floorMarkings(scene, robotZones, robotR);

  // Paredes: painel de sala limpa branco até 6 m, painel metálico acima; parede do fundo com o portão
  const wallLow = mats.get('cleanroomPanel'), wallHigh = mats.get('wallPanel');
  const wall = (name: string, w: number, h: number, y: number, pos: Vector3, rotY: number, mat: Material) => {
    const p = MeshBuilder.CreatePlane(name, { width: w, height: h, sideOrientation: Mesh.DOUBLESIDE }, scene);
    p.position = new Vector3(pos.x, y, pos.z); p.rotation.y = rotY; p.material = mat; p.isPickable = false;
    return p;
  };
  const sides: [string, number, Vector3, number][] = [
    ['N', W, new Vector3(0, 0, -D / 2), Math.PI], ['W', D, new Vector3(-W / 2, 0, 0), -Math.PI / 2], ['E', D, new Vector3(W / 2, 0, 0), Math.PI / 2],
  ];
  for (const [n, w, pos, r] of sides) {
    wall(`wallLow${n}`, w, 6, 3, pos, r, wallLow);
    wall(`wallHigh${n}`, w, H - 6, 6 + (H - 6) / 2, pos, r, wallHigh);
  }
  // Parede do portão (+Z): dois painéis laterais e uma verga sobre o vão
  const sideW = (W - HALL.doorW) / 2;
  for (const s of [-1, 1]) {
    wall(`wallDoorLow${s}`, sideW, 6, 3, new Vector3(s * (HALL.doorW / 2 + sideW / 2), 0, D / 2), 0, wallLow);
    wall(`wallDoorHigh${s}`, sideW, H - 6, 6 + (H - 6) / 2, new Vector3(s * (HALL.doorW / 2 + sideW / 2), 0, D / 2), 0, wallHigh);
  }
  wall('wallLintel', HALL.doorW, H - HALL.doorH, HALL.doorH + (H - HALL.doorH) / 2, new Vector3(0, 0, D / 2), 0, wallHigh);
  // Portão vertical de painéis (fechado, vedado), batentes e guias
  for (let k = 0; k < 8; k++) mem.block(new Vector3(0, 0.75 + k * 1.5, D / 2 - 0.15), new Vector3(HALL.doorW, 1.45, 0.18), 'doorPanel');
  for (const s of [-1, 1]) mem.block(new Vector3(s * (HALL.doorW / 2 + 0.25), HALL.doorH / 2, D / 2 - 0.2), new Vector3(0.5, HALL.doorH, 0.5), 'darkSteel');
  mem.block(new Vector3(0, HALL.doorH + 0.3, D / 2 - 0.2), new Vector3(HALL.doorW + 1, 0.6, 0.5), 'darkSteel');
  // Teto
  const roof = MeshBuilder.CreatePlane('roof', { width: W, height: D, sideOrientation: Mesh.DOUBLESIDE }, scene);
  roof.rotation.x = Math.PI / 2; roof.position.y = H + 2.2; roof.material = mats.get('wallPanel'); roof.isPickable = false;

  // Parede de filtros HEPA (fluxo horizontal): módulos de 1,2 m na parede oeste, de 0,5 m a 6 m
  for (let z = -D / 2 + 3; z < D / 2 - 3; z += 1.25) for (let y = 0.9; y < 6; y += 1.25) mem.block(new Vector3(-W / 2 + 0.06, y, z), new Vector3(0.08, 1.18, 1.18), 'hepaFilter');
  // Grelhas de retorno junto ao piso na parede leste
  for (let z = -D / 2 + 4; z < D / 2 - 4; z += 3) mem.block(new Vector3(W / 2 - 0.04, 0.35, z), new Vector3(0.05, 0.5, 2.2), 'grating');

  // Pilares (perfil H) a cada 8,3 m nas paredes laterais e treliças de cobertura (Pratt) apoiadas neles
  const bays = 6, bay = D / bays;
  for (let b = 0; b <= bays; b++) {
    const z = -D / 2 + b * bay;
    for (const s of [-1, 1]) {
      const x = s * (W / 2 - 0.5);
      mem.block(new Vector3(x, H / 2, z), new Vector3(0.5, H, 0.08), 'steel');
      mem.block(new Vector3(x - s * 0.21, H / 2, z), new Vector3(0.06, H, 0.5), 'steel');
      mem.block(new Vector3(x + s * 0.21, H / 2, z), new Vector3(0.06, H, 0.5), 'steel');
      // Consola da viga de rolamento da ponte
      mem.block(new Vector3(x - s * 0.6, HALL.craneY - 0.6, z), new Vector3(0.9, 0.5, 0.45), 'steel');
    }
    // Treliça: banzos superior (inclinado) e inferior, montantes e diagonais
    const yb = H, panels = 10;
    const top = (x: number) => H + 2 - Math.abs(x) / (W / 2) * 1.6;
    mem.bar(new Vector3(-W / 2 + 0.5, yb, z), new Vector3(W / 2 - 0.5, yb, z), 0.22, 0.22, 'galvanized');
    mem.bar(new Vector3(-W / 2 + 0.5, top(-W / 2 + 0.5), z), new Vector3(0, top(0), z), 0.22, 0.22, 'galvanized');
    mem.bar(new Vector3(0, top(0), z), new Vector3(W / 2 - 0.5, top(W / 2 - 0.5), z), 0.22, 0.22, 'galvanized');
    for (let i = 0; i <= panels; i++) {
      const x = -W / 2 + 0.5 + (i / panels) * (W - 1);
      mem.bar(new Vector3(x, yb, z), new Vector3(x, top(x), z), 0.12, 0.12, 'galvanized');
      if (i < panels) {
        const x2 = -W / 2 + 0.5 + ((i + 1) / panels) * (W - 1);
        // Diagonais tracionadas apontando para o centro (Pratt)
        if (x2 <= 0.01) mem.bar(new Vector3(x, top(x), z), new Vector3(x2, yb, z), 0.1, 0.1, 'galvanized');
        else mem.bar(new Vector3(x, yb, z), new Vector3(x2, top(x2), z), 0.1, 0.1, 'galvanized');
      }
    }
    // Luminárias LED de alta baia penduradas sob o banzo inferior
    if (b < bays) for (let i = -3; i <= 3; i++) {
      const p = new Vector3(i * (W / 7.5), yb - 1.2, z + bay / 2);
      mem.bar(p.add(new Vector3(0, 0.25, 0)), new Vector3(p.x, yb, p.z), 0.02, 0.02, 'darkSteel', 'cyl');
      mem.block(p, new Vector3(0.6, 0.1, 0.6), 'lampEmissive');
      mem.block(p.add(new Vector3(0, 0.12, 0)), new Vector3(0.66, 0.14, 0.66), 'darkSteel');
    }
  }
  // Terças longitudinais
  for (let i = -4; i <= 4; i++) mem.bar(new Vector3(i * (W / 9), H + 2 - Math.abs(i * (W / 9)) / (W / 2) * 1.6 - 0.2, -D / 2), new Vector3(i * (W / 9), H + 2 - Math.abs(i * (W / 9)) / (W / 2) * 1.6 - 0.2, D / 2), 0.15, 0.25, 'galvanized');

  // Ponte rolante: vigas de rolamento, viga-caixão da ponte, carro, cabos, moitão com gancho e guarda-chuva
  for (const s of [-1, 1]) mem.block(new Vector3(s * (W / 2 - 1.2), HALL.craneY - 0.1, 0), new Vector3(0.5, 0.9, D - 1), 'yellowSafety');
  const bridgeZ = -6;
  for (const s of [-1, 1]) mem.block(new Vector3(0, HALL.craneY + 0.6, bridgeZ + s * 0.9), new Vector3(W - 2.6, 1.3, 0.5), 'yellowSafety');
  for (const s of [-1, 1]) mem.block(new Vector3(s * (W / 2 - 1.6), HALL.craneY + 0.5, bridgeZ), new Vector3(1, 0.9, 2.6), 'yellowSafety');
  const trolleyX = -4;
  mem.block(new Vector3(trolleyX, HALL.craneY + 1.45, bridgeZ), new Vector3(2.2, 0.8, 2.4), 'darkSteel');
  const hookY = 8.5;
  for (const dx of [-0.15, 0.15]) mem.bar(new Vector3(trolleyX + dx, HALL.craneY + 1, bridgeZ), new Vector3(trolleyX + dx, hookY + 0.5, bridgeZ), 0.03, 0.03, 'steel', 'cyl');
  mem.block(new Vector3(trolleyX, hookY + 0.25, bridgeZ), new Vector3(0.5, 0.6, 0.3), 'yellowSafety');
  const hook = MeshBuilder.CreateTorus('craneHook', { diameter: 0.4, thickness: 0.09, tessellation: 20 }, scene);
  hook.position = new Vector3(trolleyX, hookY - 0.25, bridgeZ); hook.rotation.x = Math.PI / 2; hook.material = mats.get('steel');
  const parasol = MeshBuilder.CreateCylinder('craneParasol', { diameterTop: 0.15, diameterBottom: 1.6, height: 0.35, tessellation: 24 }, scene);
  parasol.position = new Vector3(trolleyX, hookY + 1.2, bridgeZ); parasol.material = mats.get('paintedWhite');

  // Mezanino de observação na parede norte: laje, pilares, guarda-corpo e escada
  const mezY = 4.5, mezD = 3;
  mem.block(new Vector3(0, mezY, -D / 2 + mezD / 2), new Vector3(W - 4, 0.25, mezD), 'grating');
  for (let x = -W / 2 + 3; x <= W / 2 - 3; x += 5) mem.block(new Vector3(x, mezY / 2, -D / 2 + mezD), new Vector3(0.25, mezY, 0.25), 'steel');
  mem.bar(new Vector3(-W / 2 + 2, mezY + 1.1, -D / 2 + mezD), new Vector3(W / 2 - 2, mezY + 1.1, -D / 2 + mezD), 0.05, 0.05, 'yellowSafety', 'cyl');
  mem.bar(new Vector3(-W / 2 + 2, mezY + 0.55, -D / 2 + mezD), new Vector3(W / 2 - 2, mezY + 0.55, -D / 2 + mezD), 0.04, 0.04, 'yellowSafety', 'cyl');
  for (let x = -W / 2 + 2; x <= W / 2 - 2; x += 1.5) mem.bar(new Vector3(x, mezY + 0.12, -D / 2 + mezD), new Vector3(x, mezY + 1.1, -D / 2 + mezD), 0.04, 0.04, 'yellowSafety', 'cyl');
  // Escada de acesso ao mezanino (degraus de 18 cm × 28 cm)
  const steps = Math.ceil(mezY / 0.18);
  for (let k = 0; k < steps; k++) mem.block(new Vector3(W / 2 - 3, 0.09 + k * 0.18, -D / 2 + mezD + 0.6 + (steps - k) * 0.28), new Vector3(1.2, 0.05, 0.3), 'grating');
  for (const s of [-1, 1]) mem.bar(new Vector3(W / 2 - 3 + s * 0.62, 1, -D / 2 + mezD + 0.6 + steps * 0.28), new Vector3(W / 2 - 3 + s * 0.62, mezY + 1, -D / 2 + mezD + 0.6), 0.05, 0.05, 'yellowSafety', 'cyl');
  // Janela de observação no fundo do mezanino (vidro)
  const glass = MeshBuilder.CreatePlane('mezWindow', { width: W - 8, height: 2 }, scene);
  glass.position = new Vector3(0, mezY + 1.6, -D / 2 + 0.05); glass.rotation.y = Math.PI; glass.material = mats.get('glass');

  // Antecâmara com chuveiro de ar (entrada de pessoas) ao lado do portão
  mem.block(new Vector3(-W / 2 + 3, 1.3, D / 2 - 1.6), new Vector3(2.4, 2.6, 3), 'cleanroomPanel');
  mem.block(new Vector3(-W / 2 + 3, 1.1, D / 2 - 3.12), new Vector3(1.0, 2.1, 0.06), 'glass');

  // Calhas de cabos e tubulações nas paredes leste e oeste a 7 m (energia, rede, nitrogênio, ar comprimido)
  for (const s of [-1, 1]) {
    mem.block(new Vector3(s * (W / 2 - 0.5), 7, 0), new Vector3(0.6, 0.12, D - 2), 'galvanized');
    for (const [dy, mat] of [[0.35, 'paintedWhite'], [0.55, 'blueWall']] as const) mem.bar(new Vector3(s * (W / 2 - 0.4), 7 + dy, -D / 2 + 1), new Vector3(s * (W / 2 - 0.4), 7 + dy, D / 2 - 1), 0.12, 0.12, mat, 'cyl');
  }
  // Pontos de energia e gases descendo da calha leste para a área de testes
  for (const z of [-8, -4]) {
    mem.bar(new Vector3(W / 2 - 0.5, 7, z), new Vector3(W / 2 - 0.5, 1.2, z), 0.12, 0.08, 'galvanized');
    mem.block(new Vector3(W / 2 - 0.55, 1.1, z), new Vector3(0.25, 0.5, 0.4), 'paintedWhite');
  }
  const shadowCasters = [...mem.all(), hook, parasol];
  return { floor, members: mem, craneHook: hook.position.clone(), shadowCasters };
}

/** Equipamentos de integração e teste, posicionados por área de trabalho. Devolve as malhas (para sombras). */
export function buildHallEquipment(scene: Scene, mats: MaterialLibrary, mem: Members): Mesh[] {
  const out: Mesh[] = [];
  const screenMat = (name: string, c: Color3) => {
    const m = mats.variant('blackAnodized', name);
    m.emissiveColor = c;
    m.emissiveIntensity = 0.8;
    return m;
  };
  const screenA = screenMat('egseScreenA', new Color3(0.12, 0.32, 0.45));
  const screenB = screenMat('egseScreenB', new Color3(0.1, 0.38, 0.22));
  const screen = (p: Vector3, yaw: number, w: number, h: number, mat: PBRMaterial) => {
    const s = MeshBuilder.CreatePlane(`screen${p.x.toFixed(1)}${p.z.toFixed(1)}${p.y.toFixed(1)}`, { width: w, height: h }, scene);
    s.position = p; s.rotation.y = yaw; s.material = mat; s.isPickable = false;
    out.push(s);
  };

  // ── EGSE: 4 racks de 19" (0,6 × 1,0 × 2,0 m) com telas e painéis, bancada com monitores, cadeira
  for (let k = 0; k < 4; k++) {
    const z = -9 + k * 0.65;
    mem.block(new Vector3(16.3, 1.0, z), new Vector3(1.0, 2.0, 0.6), 'rackGrey');
    mem.block(new Vector3(15.78, 1.0, z), new Vector3(0.04, 1.9, 0.56), 'blackAnodized');
    screen(new Vector3(15.75, 1.45, z), -Math.PI / 2, 0.48, 0.32, k % 2 ? screenA : screenB);
    for (let u = 0; u < 5; u++) mem.block(new Vector3(15.74, 0.35 + u * 0.18, z), new Vector3(0.02, 0.12, 0.5), u % 2 ? 'aluminum' : 'darkSteel');
  }
  // Bancada de controle com dois monitores e teclado
  mem.block(new Vector3(13, 0.74, -5.2), new Vector3(2.4, 0.05, 0.8), 'paintedWhite');
  for (const dx of [-1.1, 1.1]) mem.block(new Vector3(13 + dx, 0.37, -5.2), new Vector3(0.06, 0.74, 0.7), 'darkSteel');
  for (const dx of [-0.5, 0.5]) {
    mem.block(new Vector3(13 + dx, 0.9, -5.45), new Vector3(0.08, 0.3, 0.08), 'darkSteel');
    mem.block(new Vector3(13 + dx, 1.12, -5.45), new Vector3(0.62, 0.38, 0.04), 'blackAnodized');
    screen(new Vector3(13 + dx, 1.12, -5.425), Math.PI, 0.58, 0.34, dx < 0 ? screenA : screenB);
  }
  mem.block(new Vector3(13, 0.78, -5.05), new Vector3(0.45, 0.02, 0.15), 'darkSteel');
  // Cabos do EGSE até a sonda, em protetores de piso
  mem.block(new Vector3(8.2, 0.03, -3.6), new Vector3(9.5, 0.05, 0.3), 'rubber', 0.18);

  // ── Inspeção de painel solar: mesa de granito com um painel deitado, luminária de inspeção
  mem.block(new Vector3(12.5, 0.45, 6.4), new Vector3(3.4, 0.9, 1.6), 'darkSteel');
  mem.block(new Vector3(12.5, 0.93, 6.4), new Vector3(3.3, 0.06, 1.5), 'concrete');
  const panel = MeshBuilder.CreateBox('inspectionPanel', { width: 2.6, height: 0.03, depth: 1.1 }, scene);
  panel.position = new Vector3(12.5, 0.975, 6.4); panel.material = mats.get('solarCell'); out.push(panel);
  const lampArm = MeshBuilder.CreateCylinder('inspectionLampArm', { diameter: 0.05, height: 1.4 }, scene);
  lampArm.position = new Vector3(14.1, 1.6, 7.1); lampArm.material = mats.get('aluminum');
  mem.block(new Vector3(13.6, 2.3, 6.8), new Vector3(1.0, 0.06, 0.25), 'lampEmissive');
  // Suporte vertical de painéis (aguardando instalação)
  for (let k = 0; k < 2; k++) {
    const p = MeshBuilder.CreateBox(`storedPanel${k}`, { width: 0.03, height: 1.1, depth: 2.4 }, scene);
    p.position = new Vector3(9.4 + k * 0.25, 1.05, 6.3); p.material = mats.get('carbon'); out.push(p);
  }
  mem.block(new Vector3(9.5, 0.25, 6.3), new Vector3(0.9, 0.5, 2.6), 'orangePaint');

  // ── Carrinho de purga de nitrogênio (cilindros de gás) com mangueira até a sonda
  mem.block(new Vector3(3.6, 0.35, -4.2), new Vector3(1.0, 0.5, 0.6), 'blueWall');
  for (const dx of [-0.25, 0.25]) {
    const cyl = MeshBuilder.CreateCylinder(`n2bottle${dx}`, { diameter: 0.23, height: 1.45, tessellation: 18 }, scene);
    cyl.position = new Vector3(3.6 + dx, 1.3, -4.2); cyl.material = mats.get('darkSteel'); out.push(cyl);
  }
  const hose = MeshBuilder.CreateTube('n2hose', { path: [new Vector3(3.6, 2.05, -4.2), new Vector3(3.0, 1.2, -3.6), new Vector3(1.6, 0.05, -2.6), new Vector3(1.0, 0.6, -1.4)], radius: 0.02, tessellation: 8 }, scene);
  hose.material = mats.get('blueWall'); out.push(hose);

  // ── Carrinhos de ferramentas e bancadas na borda da célula
  const cart = (x: number, z: number, yaw: number) => {
    mem.block(new Vector3(x, 0.55, z), new Vector3(0.9, 0.85, 0.55), 'robotOrange', yaw);
    mem.block(new Vector3(x, 1.0, z), new Vector3(0.95, 0.04, 0.6), 'darkSteel', yaw);
    for (let k = 0; k < 4; k++) mem.block(new Vector3(x, 0.32 + k * 0.17, z + 0.28 * Math.cos(yaw)), new Vector3(0.8, 0.02, 0.02), 'aluminum', yaw);
  };
  cart(-7.8, -6.5, 0.2);
  cart(7.5, 2.8, -0.3);
  // Bancada de preparação com microscópio/estereoscópio e tela
  mem.block(new Vector3(-9.5, 0.88, 6.2), new Vector3(2.4, 0.05, 0.9), 'paintedWhite');
  for (const dx of [-1.1, 1.1]) mem.block(new Vector3(-9.5 + dx, 0.44, 6.2), new Vector3(0.06, 0.88, 0.8), 'darkSteel');
  mem.block(new Vector3(-9.9, 1.12, 6.0), new Vector3(0.25, 0.4, 0.25), 'paintedWhite');
  mem.block(new Vector3(-8.9, 1.15, 6.4), new Vector3(0.5, 0.35, 0.04), 'blackAnodized');
  screen(new Vector3(-8.9, 1.15, 6.42), 0, 0.46, 0.3, screenA);

  // ── Plataforma elevatória tesoura (diante da face frontal da sonda, fora do dolly) com guarda-corpo: piso a 2,4 m
  const lift = new Vector3(-1.2, 0, -3.25), liftH = 2.4;
  mem.block(lift.add(new Vector3(0, 0.35, 0)), new Vector3(1.2, 0.5, 2.2), 'orangePaint');
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const y0 = 0.6 + (k * (liftH - 0.6)) / 3, y1 = 0.6 + ((k + 1) * (liftH - 0.6)) / 3;
    mem.bar(new Vector3(lift.x + s * 0.5, y0, lift.z - 0.9), new Vector3(lift.x + s * 0.5, y1, lift.z + 0.9), 0.08, 0.06, 'darkSteel');
    mem.bar(new Vector3(lift.x + s * 0.5, y0, lift.z + 0.9), new Vector3(lift.x + s * 0.5, y1, lift.z - 0.9), 0.08, 0.06, 'darkSteel');
  }
  mem.block(lift.add(new Vector3(0, liftH, 0)), new Vector3(1.2, 0.08, 2.2), 'grating');
  for (const [dx, dz, w, d] of [[0.58, 0, 0.04, 2.2], [-0.58, 0, 0.04, 2.2], [0, 1.08, 1.2, 0.04], [0, -1.08, 1.2, 0.04]] as const) {
    mem.block(lift.add(new Vector3(dx, liftH + 1.1, dz)), new Vector3(w, 0.04, d), 'yellowSafety');
    mem.block(lift.add(new Vector3(dx, liftH + 0.55, dz)), new Vector3(w, 0.03, d), 'yellowSafety');
  }
  for (const dx of [-0.58, 0.58]) for (const dz of [-1.08, 1.08]) mem.block(lift.add(new Vector3(dx, liftH + 0.55, dz)), new Vector3(0.04, 1.1, 0.04), 'yellowSafety');

  // ── Escada de plataforma móvel (atrás da sonda) com degraus e corrimão
  const st = new Vector3(2.2, 0, 4.6);
  for (let k = 0; k < 8; k++) mem.block(st.add(new Vector3(0, 0.2 + k * 0.22, -k * 0.25)), new Vector3(0.8, 0.04, 0.26), 'grating');
  mem.block(st.add(new Vector3(0, 1.82, -2.2)), new Vector3(0.9, 0.06, 0.9), 'grating');
  for (const s of [-1, 1]) {
    mem.bar(st.add(new Vector3(s * 0.43, 0, 0.1)), st.add(new Vector3(s * 0.43, 1.85, -1.9)), 0.05, 0.08, 'aluminum');
    mem.bar(st.add(new Vector3(s * 0.43, 1.0, 0.1)), st.add(new Vector3(s * 0.43, 2.85, -1.9)), 0.04, 0.04, 'yellowSafety', 'cyl');
    mem.bar(st.add(new Vector3(s * 0.45, 0, -2.65)), st.add(new Vector3(s * 0.45, 1.85, -2.65)), 0.06, 0.06, 'aluminum');
  }
  return out;
}
