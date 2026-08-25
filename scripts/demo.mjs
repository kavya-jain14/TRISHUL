import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = (name) =>
  join(root, 'node_modules', '.bin', `${name}${process.platform === 'win32' ? '.cmd' : ''}`);
const services = [
  ['API', process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts'], root],
  ['PSP sandbox', process.execPath, ['--import', 'tsx', 'apps/psp-sandbox/src/server.ts'], root],
  ['Web', executable('vite'), [], join(root, 'apps/web')],
];
const children = services.map(([label, command, args, cwd]) => {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      PSP_SANDBOX_HOST: '127.0.0.1',
    },
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`[TRISHUL demo] ${label} failed to start:`, error.message);
  });
  return child;
});

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (code !== 0) {
      console.error(
        `[TRISHUL demo] A service stopped unexpectedly (${signal ?? `exit ${String(code)}`}).`,
      );
      stop();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

console.log('[TRISHUL demo] Starting API :4000, PSP sandbox :4100, and web :5173');
console.log('[TRISHUL demo] Open http://localhost:5173 when Vite reports ready.');
