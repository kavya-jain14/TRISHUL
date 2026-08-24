import type { MuleRiskState } from '@trishul/contracts';

type NormalisedSignal = number;

export interface MuleRiskInput {
  behaviour: {
    volumeVelocity: NormalisedSignal;
    fanIn: NormalisedSignal;
    fanOut: NormalisedSignal;
    passThrough: NormalisedSignal;
    balanceDrain: NormalisedSignal;
    behaviourShift: NormalisedSignal;
  };
  network: {
    reportedNetworkProximity: NormalisedSignal;
    repeatedConvergence: NormalisedSignal;
    crossCaseLinkage: NormalisedSignal;
  };
  movement: {
    rapidForwarding: NormalisedSignal;
    splitting: NormalisedSignal;
    cashOutTendency: NormalisedSignal;
  };
  entityLinkage: {
    authorisedSharedIdentifierStrength: NormalisedSignal;
  };
  trustedOutcome: 'NONE' | 'CONFIRMED' | 'CLEARED';
}

export interface MuleRiskResult {
  score: number;
  state: MuleRiskState;
  reasonCodes: string[];
  ruleVersion: 'mule-risk-v1';
}

function checkedAverage(values: number[]): number {
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError('Mule-risk signals must be normalised between 0 and 1');
    }
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function assessMuleRisk(input: MuleRiskInput): MuleRiskResult {
  if (input.trustedOutcome === 'CONFIRMED') {
    return {
      score: 100,
      state: 'CONFIRMED',
      reasonCodes: ['TRUSTED_INSTITUTIONAL_OUTCOME'],
      ruleVersion: 'mule-risk-v1',
    };
  }

  if (input.trustedOutcome === 'CLEARED') {
    return {
      score: 0,
      state: 'NORMAL',
      reasonCodes: ['TRUSTED_CLEARANCE_OUTCOME'],
      ruleVersion: 'mule-risk-v1',
    };
  }

  const behaviour = checkedAverage(Object.values(input.behaviour));
  const network = checkedAverage(Object.values(input.network));
  const movement = checkedAverage(Object.values(input.movement));
  const entityLinkage = checkedAverage(Object.values(input.entityLinkage));
  const score = Math.round(
    (behaviour * 0.35 + network * 0.35 + movement * 0.2 + entityLinkage * 0.1) * 100,
  );

  const reasonCodes: string[] = [];
  if (behaviour >= 0.6) reasonCodes.push('BEHAVIOUR_ANOMALY_CLUSTER');
  if (network >= 0.6) reasonCodes.push('NETWORK_EVIDENCE_CONVERGENCE');
  if (movement >= 0.6) reasonCodes.push('RAPID_ROUTING_PATTERN');
  if (entityLinkage >= 0.6) reasonCodes.push('AUTHORISED_ENTITY_LINKAGE');

  let state: MuleRiskState = 'NORMAL';
  if (score >= 75) state = 'SUSPECTED_MULE';
  else if (score >= 50) state = 'WATCH';
  else if (score >= 30) state = 'ANOMALOUS';

  return {
    score,
    state,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['NO_MATERIAL_MULTI_SIGNAL_EVIDENCE'],
    ruleVersion: 'mule-risk-v1',
  };
}
