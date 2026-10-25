import { describe, expect, it } from 'vitest';
import { ARRAYS_EVENT, powerState } from '../entities/power';
import type { FlightEventRecord, InstalledComponent } from '../../types/campaign';

const inst = (...ids: string[]): InstalledComponent[] => ids.map((componentId, k) => ({ instanceId: `i${k}`, componentId } as InstalledComponent));
const deployed: FlightEventRecord[] = [{ t: 0, phase: 'orbit', id: ARRAYS_EVENT, label: '', severity: 'info' }];

describe('energia e painéis solares em voo', () => {
  it('painéis dobrados bloqueiam manobras e ciência', () => {
    const s = powerState(inst('bus-aluminum', 'solar-gaas'), []);
    expect(s.needsDeploy).toBe(true);
    expect(s.blocked).toBe(true);
  });
  it('depois de estendidos a sonda opera normalmente', () => {
    const s = powerState(inst('bus-aluminum', 'solar-articulated'), deployed);
    expect(s.arraysDeployed).toBe(true);
    expect(s.blocked).toBe(false);
  });
  it('sonda com RTG não depende dos painéis', () => {
    expect(powerState(inst('bus-aluminum', 'rtg'), []).blocked).toBe(false);
    expect(powerState(inst('bus-aluminum', 'rtg', 'solar-gaas'), []).blocked).toBe(false);
  });
});
