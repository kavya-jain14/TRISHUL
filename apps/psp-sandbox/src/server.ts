import { buildSandboxApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? process.env.PSP_SANDBOX_PORT ?? '4100', 10);
const host = process.env.PSP_SANDBOX_HOST ?? '0.0.0.0';
const app = buildSandboxApp(undefined, { corsOrigins: corsOriginsFromEnvironment(process.env) });

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

function corsOriginsFromEnvironment(environment: NodeJS.ProcessEnv): true | string[] {
  const raw = environment.TRISHUL_CORS_ORIGINS?.trim();
  if (!raw || raw === '*') return true;
  return raw.split(',').map((value) => {
    const origin = value.trim().replace(/\/$/, '');
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('TRISHUL_CORS_ORIGINS must contain comma-separated HTTP(S) origins.');
    }
    return origin;
  });
}
