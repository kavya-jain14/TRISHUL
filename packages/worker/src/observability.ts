export type LogLevel = "INFO" | "WARN" | "ERROR";
export type LogFields = Record<string, unknown>;

export interface StructuredLogger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
}

export class JsonStructuredLogger implements StructuredLogger {
  readonly #write: (line: string) => void;
  readonly #service: string;

  constructor(service = "trishul-worker", write: (line: string) => void = console.log) {
    this.#service = service;
    this.#write = write;
  }

  log(level: LogLevel, event: string, fields: LogFields = {}): void {
    this.#write(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: this.#service,
      event,
      ...fields
    }));
  }
}
