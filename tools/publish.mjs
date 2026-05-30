import { spawnSync } from 'node:child_process';

const message = process.argv.slice(2).join(' ') || 'Update resort data';
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);
};
run('node', ['tools/validate-data.mjs']);
run('git', ['add', 'public/data', 'public/assets']);
const commit = spawnSync('git', ['commit', '-m', message], { stdio: 'inherit', shell: process.platform === 'win32' });
if (commit.status !== 0) console.log('No commit was created. There may be no changes.');
else run('git', ['push', 'origin', 'main']);
