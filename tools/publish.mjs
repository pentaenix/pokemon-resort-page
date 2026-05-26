import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const branch = process.env.GITHUB_BRANCH || 'main';
const message = process.argv.slice(2).join(' ') || `${process.env.GIT_COMMIT_PREFIX || 'Resort update'}: data changes`;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('node', ['tools/validate-data.mjs']);
run('git', ['add', 'public/data', 'public/assets']);
const status = spawnSync('git', ['status', '--short'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (!status.stdout.trim()) {
  console.log('No changes to publish.');
  process.exit(0);
}
run('git', ['commit', '-m', message]);
run('git', ['push', 'origin', branch]);
