export const WORKER_CAPABILITIES = [
  'TRACE_GRAPH_EXPANSION',
  'EXPOSURE_RECOMPUTE',
  'RISK_REASSESSMENT',
  'FORECAST_REFRESH',
  'ALERT_DISPATCH',
] as const;

if (process.env.NODE_ENV !== 'test') {
  process.stdout.write(
    `${JSON.stringify({ service: 'trishul-worker', status: 'ready', capabilities: WORKER_CAPABILITIES })}\n`,
  );
}
