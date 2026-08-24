import { buildSandboxApp } from './app.js';

const port = Number.parseInt(process.env.PSP_SANDBOX_PORT ?? '4100', 10);
const host = process.env.PSP_SANDBOX_HOST ?? '0.0.0.0';
const app = buildSandboxApp();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
