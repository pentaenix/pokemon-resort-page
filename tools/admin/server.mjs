import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');
const dataDir = path.join(root, 'public/data');
const adminDir = path.join(__dirname, 'public');
const port = Number(process.env.SITE_ADMIN_PORT || 8787);
const branch = process.env.GITHUB_BRANCH || 'main';
const allowedFiles = new Set(['site', 'homepage', 'theme', 'research-pois', 'compatibility', 'features', 'bugs']);

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(adminDir));

function safeFile(name) {
  if (!allowedFiles.has(name)) throw new Error(`Unknown data file: ${name}`);
  return path.join(dataDir, `${name}.json`);
}

async function readJson(name) {
  const file = safeFile(name);
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text);
}

async function writeJson(name, data) {
  const file = safeFile(name);
  const pretty = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(file, pretty, 'utf8');
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, shell: process.platform === 'win32', ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

app.get('/api/files', async (_req, res) => {
  const files = [];
  for (const name of allowedFiles) {
    const filePath = safeFile(name);
    const stat = await fs.stat(filePath);
    files.push({ name, path: `public/data/${name}.json`, modified: stat.mtime.toISOString() });
  }
  res.json({ files: files.sort((a, b) => a.name.localeCompare(b.name)) });
});

app.get('/api/data/:name', async (req, res) => {
  try {
    const data = await readJson(req.params.name);
    res.json({ name: req.params.name, data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/data/:name', async (req, res) => {
  try {
    await writeJson(req.params.name, req.body);
    res.json({ ok: true, saved: `public/data/${req.params.name}.json` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/validate', async (_req, res) => {
  const result = await run('node', ['tools/validate-data.mjs', '--json']);
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    res.status(result.code === 0 ? 200 : 422).json(parsed);
  } catch {
    res.status(500).json({ ok: false, errors: [result.stderr || result.stdout || 'Validation failed without JSON output.'] });
  }
});

app.get('/api/status', async (_req, res) => {
  const status = await run('git', ['status', '--short']);
  res.json({ ok: status.code === 0, status: status.stdout, error: status.stderr });
});

app.post('/api/publish', async (req, res) => {
  const message = (req.body?.message || `${process.env.GIT_COMMIT_PREFIX || 'Resort update'}: data changes`).trim();
  const validation = await run('node', ['tools/validate-data.mjs', '--json']);
  if (validation.code !== 0) {
    return res.status(422).json({ ok: false, step: 'validate', output: validation.stdout, error: validation.stderr });
  }

  const isRepo = await run('git', ['rev-parse', '--is-inside-work-tree']);
  if (isRepo.code !== 0) {
    return res.status(422).json({ ok: false, step: 'git', error: 'This folder is not a Git repository yet. Run git init and connect it to GitHub first.' });
  }

  await run('git', ['add', 'public/data', 'public/assets']);
  const status = await run('git', ['status', '--short']);
  if (!status.stdout.trim()) {
    return res.json({ ok: true, step: 'nothing-to-publish', output: 'No changes to commit.' });
  }

  const commit = await run('git', ['commit', '-m', message]);
  if (commit.code !== 0) {
    return res.status(422).json({ ok: false, step: 'commit', output: commit.stdout, error: commit.stderr });
  }

  const push = await run('git', ['push', 'origin', branch]);
  if (push.code !== 0) {
    return res.status(422).json({ ok: false, step: 'push', output: push.stdout, error: push.stderr });
  }

  res.json({ ok: true, step: 'published', output: `${commit.stdout}\n${push.stdout}`, error: push.stderr });
});

app.use((_req, res) => {
  res.sendFile(path.join(adminDir, 'index.html'));
});

if (!existsSync(dataDir)) {
  console.error(`Data directory not found: ${dataDir}`);
  process.exit(1);
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Resort Operations Desk running at http://127.0.0.1:${port}`);
  console.log('This admin tool is local-only. It edits JSON files in public/data.');
});
