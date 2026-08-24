import { describe, expect, test } from 'vitest';
import { createDevelopmentHandlers, type AlertStore } from '../src/handlers.js';
import type { StructuredLogger } from '../src/logger.js';

const actionPayload = {
  action: {
    actionId: 'action-worker-1',
    caseId: 'case-worker-1',
    action: 'ALERT_BANK',
    actorRef: 'analyst-worker',
    actorRole: 'INVESTIGATOR',
    purpose: 'FRAUD_INVESTIGATION',
    rationale: 'Trace evidence requires bank review.',
    evidenceAnchorIds: ['anchor:worker-1'],
    sourceUrls: ['https://example.test/evidence/worker-1'],
    occurredAt: '2026-08-24T14:00:00.000Z',
    recordedAt: '2026-08-24T14:00:01.000Z',
  },
};

describe('development job handlers', () => {
  test('validates and dispatches a case action event without exposing evidence content', async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger: StructuredLogger = {
      log(_level, event, fields = {}) {
        events.push({ event, fields });
      },
    };
    const alerts = {
      persist: async () => {
        throw new Error('not used');
      },
    } as AlertStore;
    const handler = createDevelopmentHandlers(alerts, logger).CASE_ACTION_EVENT!;

    await handler(actionPayload, {
      signal: new AbortController().signal,
      heartbeat: async () => undefined,
    });

    expect(events).toEqual([
      {
        event: 'case_action_event_dispatched',
        fields: {
          deliveryMode: 'STRUCTURED_LOG_DEVELOPMENT_ADAPTER',
          actionId: 'action-worker-1',
          caseId: 'case-worker-1',
          action: 'ALERT_BANK',
          actorRef: 'analyst-worker',
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(actionPayload.action.rationale);
    expect(JSON.stringify(events)).not.toContain(actionPayload.action.sourceUrls[0]);
  });

  test('rejects an invalid action payload before dispatch', async () => {
    const logger: StructuredLogger = { log() {} };
    const alerts = {
      persist: async () => {
        throw new Error('not used');
      },
    } as AlertStore;
    const handler = createDevelopmentHandlers(alerts, logger).CASE_ACTION_EVENT!;

    await expect(
      handler(
        { action: { ...actionPayload.action, evidenceAnchorIds: [] } },
        { signal: new AbortController().signal, heartbeat: async () => undefined },
      ),
    ).rejects.toThrow();
  });
});
