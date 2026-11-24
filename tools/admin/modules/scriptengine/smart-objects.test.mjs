import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleScriptEngineApi } from './server-api.mjs';

const scriptPath = new URL('../../../../../pokemon-resort/config/gameplay/world3d/scripts/objects/ball_balance.json', import.meta.url);
async function validate(script) {
  let result;
  await handleScriptEngineApi({
    req: { method: 'POST' }, res: {}, url: new URL('http://localhost/api/script-engine/validate'),
    repoRoot: new URL('../../../../..', import.meta.url).pathname,
    readBody: async () => JSON.stringify({ script }),
    json: (_res, status, data) => { result = { status, ...data }; },
  });
  return result;
}
test('real ball script is editable and validates through Operations Desk API', async () => {
  const script = JSON.parse(await readFile(scriptPath, 'utf8'));
  const result = await validate(script);
  assert.equal(result.status, 200);
  assert.deepEqual(result.issues, []);
  assert.equal(script.actions[0].action, 'APPROACH_OBJECT');
  assert.ok(script.actions.some(a => a.action === 'PLACE_OBJECT'));
});
test('smart-object scripts reject actions lacking an object adapter', async () => {
  const script = JSON.parse(await readFile(scriptPath, 'utf8'));
  script.actions.push({ action: 'TELEPORT_TO_LINK' });
  assert.match((await validate(script)).issues.join(' '), /Smart objects support/);
});
test('door scripts keep their move-toward validation', async () => {
  const result = await validate({ id: 'door_test', kind: 'door', trigger: 'AUTONOMOUS', actions: [{ action: 'WAIT' }] });
  assert.match(result.issues.join(' '), /MOVE_TOWARD/);
});
test('real chair rest script exposes editable enter/exit actions', async () => {
  const script = JSON.parse(await readFile(new URL('beach_chair_rest.json',scriptPath), 'utf8'));
  assert.deepEqual((await validate(script)).issues, []);
  assert.ok(script.actions.some(a => a.action === 'ENTER_OBJECT'));
  assert.ok(script.actions.some(a => a.action === 'EXIT_OBJECT'));
});
