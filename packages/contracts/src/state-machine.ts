import { z } from 'zod';

export const CaseStateSchema = z.enum([
  'NORMAL',
  'ANOMALOUS',
  'WATCH',
  'REPORTED',
  'ACTIVE',
  'TRACE',
  'EXPOSURE',
  'RISK_ASSESSED',
  'EXIT_MODE',
  'EVIDENCE_GATE',
  'PREDICT',
  'ABSTAIN',
  'INTERVENTION',
  'MONITORING',
  'OUTCOME',
  'CLOSED',
]);

export type CaseState = z.infer<typeof CaseStateSchema>;

export const CASE_TRANSITIONS = {
  NORMAL: ['ANOMALOUS', 'WATCH', 'REPORTED'],
  ANOMALOUS: ['NORMAL', 'WATCH', 'REPORTED'],
  WATCH: ['NORMAL', 'ANOMALOUS', 'REPORTED'],
  REPORTED: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['TRACE', 'MONITORING', 'CLOSED'],
  TRACE: ['EXPOSURE', 'MONITORING'],
  EXPOSURE: ['TRACE', 'RISK_ASSESSED', 'MONITORING'],
  RISK_ASSESSED: ['TRACE', 'EXIT_MODE', 'MONITORING'],
  EXIT_MODE: ['TRACE', 'EVIDENCE_GATE', 'MONITORING'],
  EVIDENCE_GATE: ['TRACE', 'PREDICT', 'ABSTAIN'],
  PREDICT: ['INTERVENTION', 'MONITORING', 'OUTCOME', 'TRACE'],
  ABSTAIN: ['MONITORING', 'OUTCOME', 'TRACE'],
  INTERVENTION: ['TRACE', 'MONITORING', 'OUTCOME'],
  MONITORING: ['TRACE', 'OUTCOME', 'CLOSED'],
  OUTCOME: ['CLOSED'],
  CLOSED: [],
} as const satisfies Record<CaseState, readonly CaseState[]>;

export function canTransitionCase(from: CaseState, to: CaseState): boolean {
  return (CASE_TRANSITIONS[from] as readonly CaseState[]).includes(to);
}

export function assertCaseTransition(from: CaseState, to: CaseState): void {
  if (!canTransitionCase(from, to)) {
    throw new Error(`Invalid TRISHUL case transition: ${from} -> ${to}`);
  }
}
