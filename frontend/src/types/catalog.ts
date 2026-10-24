/** Tipos dos catálogos versionados em /data. Os JSON são a fonte única de verdade. */

export type ValidationStatus = 'validado' | 'derivado' | 'aproximado' | 'didático' | 'pendente';
export type MissionId = 'leo-climate' | 'lunar-he3' | 'jupiter-system';
export type AssistanceLevel = 'iniciante' | 'intermediario' | 'avancado';
export type LaunchProfileId = 'leo-polar' | 'tli' | 'jupiter-ga' | 'jupiter-direct';

export interface ScientificSource {
  id: string;
  title: string;
  institution: string;
  url: string;
  identifier?: string;
  published?: string;
  kind: string;
  verified: boolean;
  notes: string;
}

export interface SourceCatalog {
  version: string;
  accessedOn: string;
  sources: ScientificSource[];
}

export interface BodyConstants {
  name: string;
  mu: number;
  radius: number;
  J2?: number;
  rotationRate?: number;
  siderealYear?: number;
  semiMajorAxisSun?: number;
  semiMajorAxisEarth?: number;
  soiRadius?: number;
  sourceId: string;
  status: ValidationStatus;
}

export interface ConstantsCatalog {
  version: string;
  parameters: Record<string, { value: number; unit: string; sourceId: string; status: ValidationStatus }>;
  bodies: Record<'sun' | 'earth' | 'moon' | 'jupiter', BodyConstants>;
}

export interface StageSpec {
  name: string;
  parallel?: boolean;
  dryMassKg: number;
  propMassKg: number;
  thrustSLkN: number;
  thrustVackN: number;
  ispSL: number;
  ispVac: number;
  recoverable?: boolean;
}

export interface CapacityEntry {
  massKg: number | null;
  status: ValidationStatus;
  sourceId: string | null;
  notes: string;
}

export interface LaunchVehicle {
  id: string;
  name: string;
  provider: string;
  typeFromDocument: string;
  reusability: string;
  cost: {
    reportedText: string;
    minUSD: number;
    maxUSD: number;
    usedUSD: number;
    classification: string;
    sourceId: string;
    documentNote: string;
  };
  heightM: number;
  diameterM: number;
  stages: StageSpec[];
  fairingMassKg: number;
  capacities: Record<LaunchProfileId, CapacityEntry>;
  limitations: string[];
  referenceContext: string;
}

export interface LaunchVehicleCatalog {
  version: string;
  profiles: Record<LaunchProfileId, { name: string; c3KmS2: number | null }>;
  vehicles: LaunchVehicle[];
}

export type ComponentCategory =
  | 'estrutura' | 'carga-util' | 'energia' | 'atitude' | 'propulsao' | 'computacao'
  | 'comunicacao' | 'navegacao' | 'termico' | 'protecao';

export type MountKind =
  | 'bus' | 'nadir' | 'top' | 'side-panel' | 'wing' | 'bottom' | 'internal' | 'boom' | 'dish' | 'skin' | 'vault' | 'none';

export interface Requirement {
  anyOf: string[];
  reason: string;
}

export interface ScienceEffect {
  measures: string[];
  dataGbPerDay: number;
  optimalAltitudeKm: [number, number];
  needsFinePointing: boolean;
  needsIllumination: boolean;
}

export interface ComponentEffects {
  tankCapacityKg?: number;
  maxTotalMassKg?: number;
  science?: ScienceEffect;
  solarW1AU?: number;
  rtgW?: number;
  batteryWh?: number;
  storageGb?: number;
  comm?: { rateMbps: number; refRangeKm: number; band: string };
  propulsion?: { ispS: number; thrustN: number; kind: string; peakPowerW?: number };
  vaultDoseFactor?: number;
}

export interface ComponentSpec {
  id: string;
  name: string;
  category: ComponentCategory;
  documentedFor: MissionId[];
  documentRow: string;
  massKg: number;
  costUSD: number;
  powerW: number;
  mount: MountKind;
  maxInstances: number;
  dimensionsM: [number, number, number];
  radiationToleranceKrad?: number;
  electronics?: boolean;
  provides: string[];
  effects: ComponentEffects;
  requires: Requirement[];
  description: string;
  limitations: string;
  absenceConsequence: string;
}

export interface ComponentCatalog {
  version: string;
  currency: string;
  provenance: string;
  components: ComponentSpec[];
}

export interface RangeParam { min: number; max: number; default: number }

export interface MissionObjective {
  id: string;
  title: string;
  measures: string[];
  weight: number;
  primary: boolean;
}

export interface Checkpoint {
  id: string;
  name: string;
  objectiveId: string;
  latitudeDeg: number;
  measures: string[];
  needsIllumination: boolean;
}

export interface MissionRequirement {
  id: string;
  anyOf: string[];
  severity: 'obrigatoria' | 'recomendada';
  reason: string;
}

export interface TrajectoryOption {
  id: 'dveega' | 'direct';
  label: string;
  launchProfile: LaunchProfileId;
  dsmMS: number;
  dsmStatus: ValidationStatus;
  loopYears: number;
}

export interface MissionPlanningSpec {
  type: 'earth-orbit' | 'lunar' | 'interplanetary';
  altitudeKm?: RangeParam;
  eccentricity?: RangeParam;
  inclinationMode?: string;
  inclinationDeg?: RangeParam;
  localTimeOfNode?: { options: string[]; default: string };
  missionLifeYears?: RangeParam;
  orbitsBeforeTrim?: RangeParam;
  parkingOrbitKm?: RangeParam;
  transferOptions?: { id: 'hohmann' | 'fast'; label: string; apogeeFactor: number }[];
  tcmCount?: RangeParam;
  missionLifeMonths?: RangeParam;
  trajectoryOptions?: TrajectoryOption[];
  departureDate?: { min: string; max: string; default: string };
  windowToleranceDays?: number;
  perijoveAltitudeKm?: RangeParam;
  orbitPeriodDays?: RangeParam;
  scienceOrbits?: RangeParam;
}

export interface MissionEnvironment {
  centralBody: 'earth' | 'moon' | 'jupiter';
  sunDistanceAU: number;
  earthRangeKm: number;
  contactHoursPerDay: number;
  radiationKradPerYear: number;
  magneticMomentumDumping: boolean;
  gnssAvailable: boolean;
  atmosphericDrag: boolean;
  solarActivity: string;
}

export interface MissionSpec {
  id: MissionId;
  code: string;
  name: string;
  difficulty: string;
  summary: string;
  description: string;
  scienceContext: string[];
  bodies: string[];
  launchProfile: LaunchProfileId;
  budget: { availableUSD: number; contingencyPct: number; operationsCostUSD: number; status: ValidationStatus };
  massGuidelineKg: [number, number];
  environment: MissionEnvironment;
  planning: MissionPlanningSpec;
  deltaVPolicy: {
    injectionTrimMS?: number;
    deorbitTargetPerigeeKm?: number;
    tcmBaseMS?: number;
    tcmNoRadioNavPenaltyMS?: number;
    stationKeepingMSPerMonthAt50km?: number;
    marginPct: Record<AssistanceLevel, number>;
  };
  requirements: MissionRequirement[];
  objectives: MissionObjective[];
  checkpoints: Checkpoint[];
  scienceDays: number;
  sources: string[];
  knownLimitations: string[];
}

export interface TestCampaign { label: string; costFactor: number; failureFactor: number; description: string }
export type TestCampaignId = 'minimal' | 'standard' | 'extensive';

export interface MissionCatalog {
  version: string;
  currencyPolicy: { baseCurrency: string; displayAlternatives: { code: string; ratePerUSD: number; status: ValidationStatus; label: string }[] };
  budgetNotice: string;
  testCampaigns: Record<TestCampaignId, TestCampaign>;
  missions: MissionSpec[];
}

export interface FailureEventSpec {
  id: string;
  category: string;
  subsystem: string;
  phase: 'pad' | 'ignition' | 'ascent' | 'staging' | 'cruise' | 'science';
  baseProbability: number;
  factors: string[];
  severity: 'aviso' | 'bloqueante' | 'aborto-automatico' | 'grave' | 'catastrofica';
  effect: string;
  responses: string[];
  recovery: string;
  scienceImpact: string;
}

export interface SimulationConfig {
  version: string;
  physics: {
    ascentTimeStepS: number;
    orbitTimeStepS: number;
    dragCoefficient: number;
    parkingOrbitKm: number;
    batteryDepthOfDischarge: number;
    solarArrayDegradationPerYear: number;
    maxDynamicPressurePa: number;
  };
  vibration: { unit: string; classes: { max: number; label: string }[]; phaseBaseG: Record<string, number> };
  assistance: Record<AssistanceLevel, {
    label: string; showFormulas: boolean; suggestComponents: boolean; detailedAlerts: boolean;
    guidedTrajectory: boolean; payloadMarginPct: number; manualManeuvers: boolean;
  }>;
  failures: FailureEventSpec[];
}
