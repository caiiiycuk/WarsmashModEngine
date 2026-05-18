import assert from 'node:assert/strict';
import { parseLaunchConfig } from '../src/lib/launchConfig.ts';

assert.deepEqual(parseLaunchConfig('?mode=single'), { ok: true, config: { mode: 'single' } });
assert.deepEqual(parseLaunchConfig('?mode=webrtc&room=ABCD&role=host&map=Maps%2FFoo.w3x'), {
  ok: true,
  config: { mode: 'webrtc', room: 'ABCD', role: 'host', map: 'Maps/Foo.w3x' },
});
for (const url of [
  '?mode=webrtc&role=host&map=x',
  '?mode=webrtc&room=r&map=x',
  '?mode=webrtc&room=r&role=host',
  '?mode=wat',
  '?mode=webrtc&room=r&role=leader&map=x',
]) {
  assert.equal(parseLaunchConfig(url).ok, false, url);
}
