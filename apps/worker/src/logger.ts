export type LogLevel = 'info' | 'warn' | 'error';

export interface StructuredLogger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}

export class JsonStructuredLogger implements StructuredLogger {
  constructor(
    private readonly service: string,
    private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {}

  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    this.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: this.service,
        event,
        ...fields,
      }),
    );
  }
}
