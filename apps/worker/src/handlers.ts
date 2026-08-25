import { CaseActionEventPayloadSchema } from '@trishul/contracts';
import type { OutboxJobType, PersistedAlert } from '@trishul/database';
import type { StructuredLogger } from './logger.js';
import type { JobHandler } from './runtime.js';

export interface AlertStore {
  persist(payload: unknown): Promise<{
    status: 'CREATED' | 'IDEMPOTENT_REPLAY';
    alert: PersistedAlert;
  }>;
}

export function createDevelopmentHandlers(
  alerts: AlertStore,
  logger: StructuredLogger,
): Partial<Record<OutboxJobType, JobHandler>> {
  return {
    CASE_ACTION_EVENT: async (payload, context) => {
      if (context.signal.aborted)
        throw new Error('Case action dispatch was aborted after lease loss.');
      const event = CaseActionEventPayloadSchema.parse(payload);
      logger.log('info', 'case_action_event_dispatched', {
        deliveryMode: 'STRUCTURED_LOG_DEVELOPMENT_ADAPTER',
        actionId: event.action.actionId,
        caseId: event.action.caseId,
        action: event.action.action,
        actorRef: event.action.actorRef,
      });
    },
    ALERT_DISPATCH: async (payload, context) => {
      if (context.signal.aborted) throw new Error('Alert dispatch was aborted after lease loss.');
      const result = await alerts.persist(payload);
      logger.log('info', 'alert_dispatched', {
        deliveryMode: 'STRUCTURED_LOG_DEVELOPMENT_ADAPTER',
        alertId: result.alert.alertId,
        caseId: result.alert.caseId,
        persistenceStatus: result.status,
      });
    },
  };
}
