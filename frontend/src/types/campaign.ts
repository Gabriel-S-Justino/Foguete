import type { AssistanceLevel, MissionId, TestCampaignId } from './catalog';

export interface InstalledComponent { instanceId: string; componentId: string }

export interface SpacecraftConfig {
  installed: InstalledComponent[];
  propellantKg: number;
  testCampaign: TestCampaignId;
}

export interface EarthOrbitPlan {
  kind: 'earth-orbit';
  altitudeKm: number;
  eccentricity: number;
  inclinationMode: 'sso' | 'manual';
  inclinationDeg: number;
  localTimeOfNode: string;
  missionLifeYears: number;
  orbitsBeforeTrim: number;
  launchDate: string;
}

export interface LunarPlan {
  kind: 'lunar';
  parkingOrbitKm: number;
  transfer: 'hohmann' | 'fast';
  lunarAltitudeKm: number;
  inclinationDeg: number;
  tcmCount: number;
  missionLifeMonths: number;
  launchDate: string;
}

export interface JupiterPlan {
  kind: 'interplanetary';
  trajectory: 'dveega' | 'direct';
  departureDate: string;
  perijoveAltitudeKm: number;
  orbitPeriodDays: number;
  inclinationDeg: number;
  tcmCount: number;
  scienceOrbits: number;
}

export type MissionPlan = EarthOrbitPlan | LunarPlan | JupiterPlan;

export type CampaignStage =
  | 'identification' | 'mission-select' | 'hangar' | 'vehicle' | 'planning' | 'briefing'
  | 'launch-pad' | 'flight' | 'science' | 'report';

export type CheckStatus = 'aprovada' | 'aviso' | 'reprovada';
export type CheckGroup = 'financeira' | 'massa' | 'propulsao' | 'subsistemas' | 'orbital';

export interface ValidationCheck {
  id: string;
  group: CheckGroup;
  title: string;
  status: CheckStatus;
  value: string;
  limit: string;
  margin: string;
  explanation: string;
  action: string;
  fixStage: CampaignStage | null;
  sourceId?: string | null;
}

export interface ValidationReport {
  approved: boolean;
  checks: ValidationCheck[];
  blockers: ValidationCheck[];
  warnings: ValidationCheck[];
  computedAt: string;
  engineVersion: string;
}

export type FlightOutcome =
  | 'pending' | 'orbit' | 'pad-abort' | 'flight-abort' | 'flight-terminated' | 'launch-failure';

export interface FlightEventRecord {
  t: number;
  phase: string;
  id: string;
  label: string;
  severity: 'info' | 'aviso' | 'grave' | 'critica';
}

export interface ManeuverRecord {
  id: string;
  label: string;
  plannedDvMS: number;
  executedDvMS: number;
  propellantUsedKg: number;
  success: boolean;
  note: string;
}

export interface CheckpointResult {
  checkpointId: string;
  executed: boolean;
  quality: number;
  dataGb: number;
  factors: Record<string, number>;
  notes: string[];
}

export type MissionClassification =
  | 'sucesso' | 'parcial' | 'limitada' | 'abortada' | 'fracassada';

export interface MissionReport {
  playerName: string;
  missionId: MissionId;
  missionName: string;
  vehicleName: string;
  components: string[];
  budgetUSD: number;
  finalCostUSD: number;
  launchResult: string;
  trajectoryResult: string;
  objectives: { id: string; title: string; score: number; primary: boolean }[];
  dataCollectedGb: number;
  dataReturnedGb: number;
  criticalEvents: FlightEventRecord[];
  failures: string[];
  remainingPropellantKg: number;
  scienceScore: number;
  finalScore: number;
  classification: MissionClassification;
  classificationLabel: string;
  educational: string[];
  recommendations: string[];
  generatedAt: string;
}

export interface Campaign {
  id: string;
  sessionId: string | null;
  playerName: string;
  missionId: MissionId | null;
  assistance: AssistanceLevel;
  stage: CampaignStage;
  spacecraft: SpacecraftConfig;
  vehicleId: string | null;
  plan: MissionPlan | null;
  validation: ValidationReport | null;
  flightOutcome: FlightOutcome;
  flightEvents: FlightEventRecord[];
  maneuvers: ManeuverRecord[];
  propellantRemainingKg: number | null;
  checkpointResults: CheckpointResult[];
  activeEffects: string[];
  insertionState: 'captured' | 'high-orbit' | 'flyby' | 'none';
  finalCostUSD: number | null;
  report: MissionReport | null;
  seed: number;
  attempt: number;
  versions: Record<string, string>;
  updatedAt: string;
}
