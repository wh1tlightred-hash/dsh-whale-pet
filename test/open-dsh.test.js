import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { dshLaunch } = createRequire(import.meta.url)('../desktop/open-dsh.cjs');

test('Ctrl + click starts DSH again with a clean environment', () => {
  const env = {
    DSH_WHALE_DSH_EXE: 'C:\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe',
    DSH_WHALE_TOKEN: 'secret', DSH_WHALE_PIPE: '\\\\.\\pipe\\x', DSH_DESKTOP_DEV_APP: '1',
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', CHROME_CRASHPAD_PIPE_NAME: 'p',
    PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me',
  };
  const launch = dshLaunch(env, () => true);
  assert.equal(launch.command, env.DSH_WHALE_DSH_EXE);
  assert.deepEqual(launch.env, { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me' });
});

test('without a known DSH executable nothing is started', () => {
  assert.equal(dshLaunch({}, () => true), null);
  assert.equal(dshLaunch({ DSH_WHALE_DSH_EXE: 'C:\\gone.exe' }, () => false), null);
});
