import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
const apps = [
  { name: 'API', directory: 'backend-js' },
  { name: 'Frontend', directory: 'frontend' },
];
const children = [];
let stopping = false;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(command + ' exited with code ' + code));
    });
  });
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  }
  child.kill('SIGTERM');
  return new Promise((resolve) => {
    child.once('exit', resolve);
    setTimeout(resolve, 3000).unref();
  });
}

async function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(stopChild));
  process.exit(exitCode);
}

function startApp(app, npmCli) {
  const args = [npmCli, 'run', 'dev'];
  if (app.name === 'Frontend') args.push('--', '--strictPort');
  const child = spawn(process.execPath, args, {
    cwd: join(root, app.directory),
    stdio: 'inherit',
  });
  children.push(child);
  child.once('error', (error) => {
    console.error('[outpost] ' + app.name + ' failed to start:', error);
    void stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) {
      console.error('[outpost] ' + app.name + ' stopped unexpectedly (code ' + code + ').');
      void stop(code || 1);
    }
  });
}

async function waitUntilReady(url, label) {
  const deadline = Date.now() + 120_000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(label + ' did not become ready within two minutes.');
}

async function main() {
  if (!npmCli || !existsSync(npmCli)) {
    throw new Error('Run this launcher with npm run dev from the repository root.');
  }
  if (!existsSync(join(root, '.env')) || !existsSync(join(root, 'backend-js', '.env'))) {
    throw new Error('Create the root and backend-js .env files from their .env.example files first.');
  }
  for (const app of apps) {
    if (!existsSync(join(root, app.directory, 'node_modules'))) {
      throw new Error('Install ' + app.name + ' dependencies with npm ci in ' + app.directory + '.');
    }
  }

  console.log('[outpost] Starting Docker services...');
  try {
    await run('docker', ['compose', 'up', '--detach', '--wait']);
  } catch {
    throw new Error('Docker services could not start. Start Docker Desktop and run npm run dev again.');
  }

  process.once('SIGINT', () => void stop(0));
  process.once('SIGTERM', () => void stop(0));

  console.log('[outpost] Starting API...');
  startApp(apps[0], npmCli);
  await waitUntilReady('http://127.0.0.1:8000/ready', 'API');

  console.log('[outpost] Starting frontend...');
  startApp(apps[1], npmCli);
  await waitUntilReady('http://localhost:5173/', 'Frontend');

  console.log('[outpost] Ready: http://localhost:5173/ (API: http://127.0.0.1:8000)');
  console.log('[outpost] Press Ctrl+C to stop both apps.');
}

main().catch((error) => {
  console.error('[outpost] ' + error.message);
  void stop(1);
});
