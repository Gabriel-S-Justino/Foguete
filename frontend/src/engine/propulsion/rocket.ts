import { constants } from '../catalog';

export const G0 = constants.parameters.g0?.value ?? 9.80665;

/** Equação de Tsiolkovsky: Δv = Isp·g0·ln(m0/mf). Massas em kg, Isp em s, resultado em m/s. */
export function tsiolkovsky(ispS: number, m0Kg: number, mfKg: number): number {
  if (m0Kg <= 0 || mfKg <= 0) throw new Error('Massas devem ser positivas');
  if (mfKg > m0Kg) throw new Error('Massa final maior que a inicial');
  return ispS * G0 * Math.log(m0Kg / mfKg);
}

/** Propelente necessário para um Δv partindo da massa inicial m0. */
export function propellantForDeltaV(ispS: number, m0Kg: number, dvMS: number): number {
  return m0Kg * (1 - Math.exp(-dvMS / (ispS * G0)));
}

/** Relação empuxo-peso local (adimensional). */
export function thrustToWeight(thrustN: number, massKg: number, gravityMS2 = G0): number {
  return thrustN / (massKg * gravityMS2);
}

/** Tempo de queima para executar Δv com empuxo constante. */
export function burnTime(ispS: number, thrustN: number, m0Kg: number, dvMS: number): number {
  const mdot = thrustN / (ispS * G0);
  return propellantForDeltaV(ispS, m0Kg, dvMS) / mdot;
}

/** Empuxo interpolado linearmente entre nível do mar e vácuo pela pressão ambiente. */
export function thrustAtPressure(thrustSLN: number, thrustVacN: number, pressurePa: number): number {
  const ratio = Math.min(1, Math.max(0, pressurePa / 101325));
  return thrustVacN - (thrustVacN - thrustSLN) * ratio;
}
