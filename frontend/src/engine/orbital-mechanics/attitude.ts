/**
 * Atitude da espaçonave: para onde o corpo aponta, independentemente do movimento. A atitude não altera
 * posição nem velocidade (são calculadas pela mecânica orbital); só define a rotação do modelo 3D.
 *
 * Eixos do corpo da sonda montada (ProbeModel): +Y sai do adaptador para o topo (antena de alto ganho; é
 * também a normal da face ativa dos painéis abertos), +Z é a face dos instrumentos de observação ("nadir"
 * na montagem) e ±X são as laterais de onde saem os braços dos painéis solares.
 *
 * As funções trabalham com vetores de qualquer referencial (inclusive o da cena, que é espelhado em
 * relação ao físico): a base devolvida é sempre uma rotação própria (X × Y = Z) nesse referencial.
 * No conjunto estágio superior + sonda, +Y é o eixo do foguete (sentido do empuxo).
 *
 * Modos, conforme a fase e o objetivo da missão:
 * - `nadir`: instrumentos (+Z) para o centro do corpo observado e o eixo dos painéis (±X, eixo do mecanismo de
 *   giro dos painéis) na normal do plano da órbita; +Y fica no sentido do movimento. É o apontamento de
 *   satélites de observação como o Landsat 8 e o LRO: a sonda gira uma vez por órbita para acompanhar o
 *   planeta (escolha de missão, não consequência da gravidade) e os painéis giram em torno de X para o Sol.
 * - `prograde`: eixo +Y no vetor velocidade (conjunto com o estágio superior antes de uma queima de partida).
 * - `retrograde`: eixo +Y contra a velocidade (queima de inserção em órbita: o motor principal, na base, freia
 *   a sonda).
 * - `sun`: topo (+Y, face ativa dos painéis abertos e antena de alto ganho) para o Sol, instrumentos (+Z)
 *   o mais perto possível da Terra (cruzeiro com painéis solares; a Juno mantém o eixo apontado para o Sol
 *   e a Terra).
 * - `inertial`: atitude fixa no espaço (sem controle ativo ou em espera).
 */
import { cross, dot, norm, scale, sub, unit, type V3 } from './kepler';

export type AttitudeMode = 'nadir' | 'prograde' | 'retrograde' | 'sun' | 'inertial';

export interface AttitudeInput {
  /** Posição da sonda em relação ao corpo central e velocidade (inerciais). */
  r: V3;
  v: V3;
  /** Direção da sonda para o Sol e para a Terra (unitárias). */
  toSun: V3;
  toEarth: V3;
}

/** Base ortonormal do corpo no referencial inercial: colunas X, Y, Z (mão direita). */
export interface Basis { x: V3; y: V3; z: V3 }

/** Constrói uma base mão-direita com o eixo `primary` exato e o eixo `secondary` o mais próximo possível. */
function triad(primary: V3, secondary: V3, primaryAxis: 'y' | 'z'): Basis {
  const p = unit(primary);
  // Componente de `secondary` perpendicular ao primário (se forem paralelos, usa um eixo auxiliar)
  let s = sub(secondary, scale(p, dot(secondary, p)));
  if (norm(s) < 1e-9 * Math.max(1, norm(secondary))) {
    const aux: V3 = Math.abs(p[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    s = sub(aux, scale(p, dot(aux, p)));
  }
  s = unit(s);
  if (primaryAxis === 'y') {
    // Y = primário, Z = secundário, X = Y × Z
    return { x: cross(p, s), y: p, z: s };
  }
  // Z = primário, Y = secundário, X = Y × Z
  return { x: cross(s, p), y: s, z: p };
}

export function attitudeBasis(mode: AttitudeMode, input: AttitudeInput, inertial?: Basis): Basis {
  const nadir = scale(input.r, -1);
  switch (mode) {
    case 'nadir': {
      const z = unit(nadir);
      const h = cross(input.r, input.v);
      const x = unit(sub(h, scale(z, dot(h, z))));
      return { x, y: cross(z, x), z };
    }
    case 'prograde':
      return triad(input.v, nadir, 'y');
    case 'retrograde':
      return triad(scale(input.v, -1), nadir, 'y');
    case 'sun':
      return triad(input.toSun, input.toEarth, 'y');
    case 'inertial':
    default:
      return inertial ?? { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  }
}

/** Ângulo (graus) entre um eixo do corpo e uma direção, para testes e telemetria de apontamento. */
export function pointingErrorDeg(axis: V3, target: V3): number {
  return (Math.acos(Math.max(-1, Math.min(1, dot(unit(axis), unit(target))))) * 180) / Math.PI;
}
