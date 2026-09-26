import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parsePeople } from './rememberedPeople';

it('keeps bounded display names only and never treats stored privileges or tokens as identity', () => {
  assert.deepEqual(
    parsePeople(
      JSON.stringify([
        { name: 'Elli', email: 'elli@example.test', role: 'god', token: 'must-not-survive' },
      ]),
    ),
    [{ name: 'Elli', email: 'elli@example.test' }],
  );
  for (const raw of ['', '{}', 'null', '[{"name":"broken"}]'])
    assert.deepEqual(parsePeople(raw), []);
  assert.equal(
    parsePeople(JSON.stringify(Array(10).fill({ name: 'Person', email: 'person@example.test' })))
      .length,
    4,
  );
});
