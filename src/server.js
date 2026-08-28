// Minimal local dashboard server (no dependencies — built-in http only).
// Exists so the "Refresh" button on the dashboard has something to POST
// to — a static HTML file opened via file:// can't execute shell commands,
// browsers don't allow that. This serves the dashboard over http://localhost
// and re-runs the pipeline on demand when asked.
//
// Usage:
//   npm run serve
//   -> open http://localhost:4173

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { OUTPUT_DIR, ROOT_DIR } from './config.js';

const PORT = Number(process.env.PORT) || 4173;
const DASHBOARD_PATH = path.join(OUTPUT_DIR, 'dashboard.html');
const SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'weekly-run.sh');

let refreshInProgress = false;

function serveDashboard(res) {
  if (!fs.existsSync(DASHBOARD_PATH)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<p style="font-family:sans-serif;padding:40px">No dashboard yet. Click below, or run ' +
        '<code>npm run weekly</code> first, then reload.</p>' +
        '<button onclick="fetch(\'/refresh\',{method:\'POST\'}).then(()=>location.reload())">' +
        'Generate now</button>'
    );
    return;
  }
  const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleRefresh(res) {
  if (refreshInProgress) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'A refresh is already running — wait for it to finish.' }));
    return;
  }
  refreshInProgress = true;

  const child = spawn('bash', [SCRIPT_PATH], { cwd: ROOT_DIR });
  let output = '';
  child.stdout.on('data', (d) => (output += d.toString()));
  child.stderr.on('data', (d) => (output += d.toString()));

  child.on('close', (code) => {
    refreshInProgress = false;
    res.writeHead(code === 0 ? 200 : 500, { 'Content-Type': 'application/json' });
    // Trim to the tail — the full log is in logs/ if more detail is needed.
    res.end(JSON.stringify({ ok: code === 0, exitCode: code, output: output.slice(-4000) }));
  });

  child.on('error', (err) => {
    refreshInProgress = false;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    serveDashboard(res);
  } else if (req.method === 'POST' && req.url === '/refresh') {
    handleRefresh(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log('Click "Refresh trends" on the page to re-scrape, re-rank, and reload.');
});
