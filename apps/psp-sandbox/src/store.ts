import type { ProviderEvent } from '@trishul/contracts';
import { SANDBOX_SCENARIOS } from './scenarios.js';

export interface ScenarioStep {
  scenarioId: string;
  cursor: number;
  totalEvents: number;
  done: boolean;
  event: ProviderEvent | null;
}

export class ScenarioStore {
  private readonly cursors = new Map<string, number>();

  list() {
    return SANDBOX_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      expectedOutcome: scenario.expectedOutcome,
      totalEvents: scenario.events.length,
      cursor: this.cursors.get(scenario.id) ?? 0,
    }));
  }

  reset(scenarioId: string): ScenarioStep | null {
    const scenario = SANDBOX_SCENARIOS.find((candidate) => candidate.id === scenarioId);
    if (!scenario) return null;

    this.cursors.set(scenarioId, 0);
    return {
      scenarioId,
      cursor: 0,
      totalEvents: scenario.events.length,
      done: false,
      event: null,
    };
  }

  next(scenarioId: string): ScenarioStep | null {
    const scenario = SANDBOX_SCENARIOS.find((candidate) => candidate.id === scenarioId);
    if (!scenario) return null;

    const cursor = this.cursors.get(scenarioId) ?? 0;
    const event = scenario.events[cursor] ?? null;
    const nextCursor = event ? cursor + 1 : cursor;
    this.cursors.set(scenarioId, nextCursor);

    return {
      scenarioId,
      cursor: nextCursor,
      totalEvents: scenario.events.length,
      done: nextCursor >= scenario.events.length,
      event,
    };
  }
}
