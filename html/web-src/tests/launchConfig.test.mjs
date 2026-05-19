import assert from 'node:assert/strict';
import { parseLaunchConfig } from '../src/lib/launchConfig.ts';
import { getPlayerNameFromSearch } from '../src/lib/playerName.ts';

assert.deepEqual(parseLaunchConfig('?mode=single'), { ok: true, config: { mode: 'single' } });
assert.deepEqual(parseLaunchConfig('?mode=webrtc&room=ABCD&role=host&map=Maps%2FFoo.w3x'), {
  ok: true,
  config: { mode: 'webrtc', room: 'ABCD', role: 'host', map: 'Maps/Foo.w3x' },
});
assert.deepEqual(parseLaunchConfig('?mode=webrtc&room=ABCD&role=client'), {
  ok: true,
  config: { mode: 'webrtc', room: 'ABCD', role: 'client' },
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

assert.equal(getPlayerNameFromSearch('?name=Arthas'), 'Arthas');
assert.equal(getPlayerNameFromSearch('?mode=webrtc&name=Jaina%20Proudmoore'), 'Jaina Proudmoore');
assert.equal(getPlayerNameFromSearch('?name=%20%20'), '');
assert.equal(getPlayerNameFromSearch('?name=One%0ATwo'), 'One Two');
