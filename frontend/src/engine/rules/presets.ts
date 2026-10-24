/**
 * Sugestões de configuração (modo iniciante) derivadas da arquitetura de referência de componentes-sondas.md.
 * Também usadas como casos de teste de referência.
 */
import type { MissionId, TestCampaignId } from '../../types/catalog';
import type { SpacecraftConfig } from '../../types/campaign';

export const REFERENCE_ARCHITECTURES: Record<MissionId, { components: string[]; propellantKg: number; vehicleId: string; testCampaign: TestCampaignId }> = {
  'leo-climate': {
    components: ['bus-aluminum', 'imager-multispectral', 'sounder-ir-mw', 'radiometer-erb', 'solar-gaas', 'battery-liion', 'star-tracker', 'reaction-wheels', 'magnetorquers', 'sun-sensor', 'gyroscopes', 'hydrazine-thrusters', 'obc-moderate', 'xband-tx', 'sband-ttc', 'gnss-receiver', 'mli', 'radiators', 'heaters'],
    propellantKg: 70,
    vehicleId: 'falcon-9',
    testCampaign: 'standard',
  },
  'lunar-he3': {
    components: ['bus-large-tank', 'neutron-spectrometer', 'gamma-spectrometer', 'sar-sl', 'nir-spectrometer', 'hires-camera', 'laser-altimeter', 'biprop-main', 'rcs-control-thrusters', 'solar-articulated', 'battery-liion', 'battery-liion', 'star-tracker', 'reaction-wheels', 'gyroscopes', 'hga-sx', 'ranging-transponder', 'obc-moderate', 'mli', 'radiators', 'heaters'],
    propellantKg: 650,
    vehicleId: 'falcon-9',
    testCampaign: 'standard',
  },
  'jupiter-system': {
    components: ['bus-large-tank', 'magnetometer-boom', 'gravity-transponder', 'microwave-radiometer', 'particles-plasma', 'context-camera', 'radiation-vault', 'main-engine-large', 'rcs-control-thrusters', 'solar-giant', 'battery-liion', 'star-tracker', 'reaction-wheels', 'gyroscopes', 'obc-radhard', 'hga-large', 'mli', 'heaters', 'thermal-shield', 'planetary-protection'],
    propellantKg: 1500,
    vehicleId: 'falcon-heavy',
    testCampaign: 'standard',
  },
};

export function referenceConfig(missionId: MissionId): SpacecraftConfig {
  const ref = REFERENCE_ARCHITECTURES[missionId];
  return {
    installed: ref.components.map((componentId, i) => ({ instanceId: `${componentId}-${i}`, componentId })),
    propellantKg: ref.propellantKg,
    testCampaign: ref.testCampaign,
  };
}
