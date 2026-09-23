/**
 * Jan-Sankalp AI — Root Orchestrator
 * ------------------------------------------------------------------
 * Spawns both the backend microservice (/server, port 5000) and the
 * frontend SPA static server (/client, port 5500) with a single
 * command:  npm start
 * ------------------------------------------------------------------
 */

const { spawn } = require('child_process');
const path = require('path');

function run(name, cwd, args) {
  const child = spawn('npm', args, {
    cwd: path.join(__dirname, cwd),
    shell: true,
    stdio: 'inherit'
  });
  child.on('error', (err) => {
    console.error(`[orchestrator] Failed to start ${name}:`, err.message);
  });
  child.on('exit', (code) => {
    console.log(`[orchestrator] ${name} exited with code ${code}`);
  });
  return child;
}

console.log('Starting Jan-Sankalp AI (server + client)...');

const server = run('server', 'server', ['start']);
const client = run('client', 'client', ['start']);

function shutdown() {
  console.log('\n[orchestrator] Shutting down...');
  try { server.kill(); } catch (_) {}
  try { client.kill(); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);