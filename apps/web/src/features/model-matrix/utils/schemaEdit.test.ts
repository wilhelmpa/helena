import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type {
  MatrixSchema,
  MatrixValues,
  ModelMatrix,
  SchemaCatalogModel,
} from '@/lib/api/endpoints/modelMatrix';
import {
  catalogLevels,
  catalogModels,
  catalogRuntimes,
  changeRoleCell,
  missingRoles,
  schemaIdFor,
  schemaUse,
} from './schemaEdit';
import { previewErrorKey } from './previewErrors';

const model = (
  runtime: string,
  id: string,
  levels: string[] = [],
  name = id,
): SchemaCatalogModel => ({
  id,
  name,
  runtime,
  reasoning: levels.length > 0,
  thinkingLevels: levels,
  thinkingDefault: null,
});
const catalog = [
  model('codex', 'gpt-6.1-sol', ['low', 'medium', 'high'], 'GPT-6.1 Sol'),
  model('codex', 'gpt-6.1-luna', ['low'], 'GPT-6.1 Luna'),
  model('claude', 'claude-sonnet-5-5', ['low', 'high'], 'Claude Sonnet 5.5'),
  model('helena', 'halogen-flash', [], 'Flash'),
  model('helena', 'volition-local-default', [], 'Lokales Standardmodell'),
];
const role = (over: Partial<MatrixValues> = {}): MatrixValues => ({
  runtime: 'codex',
  model: 'gpt-6.1-sol',
  reasoning: 'high',
  escalation: {
    target: 'codex',
    model: null,
    afterFailures: 0,
    onResumeLimit: false,
    onRequest: false,
    maxDepth: 0,
  },
  browser: 'standard',
  decision: { backend: 'gpu', threshold: 0.8, fallback: 'gpu', privateData: true },
  device: 'cloud',
  ...over,
});

describe('Katalog der Schemata', () => {
  test('bietet nur Laufzeiten an, für die es Modelle gibt', () => {
    assert.deepEqual(catalogRuntimes(catalog), ['helena', 'claude', 'codex']);
  });

  test('listet die Modelle einer Laufzeit, das lokale Standardmodell zuerst', () => {
    assert.deepEqual(
      catalogModels(catalog, 'helena').map((entry) => entry.id),
      ['volition-local-default', 'halogen-flash'],
    );
    assert.deepEqual(catalogModels(catalog, 'command'), []);
  });

  test('Denktiefen: keine ausdrückliche zuerst, dann die des Modells', () => {
    assert.deepEqual(catalogLevels(catalog, 'codex', 'gpt-6.1-sol'), [
      null,
      'low',
      'medium',
      'high',
    ]);
    assert.deepEqual(catalogLevels(catalog, 'helena', 'halogen-flash'), [null]);
    assert.deepEqual(catalogLevels(catalog, 'codex', 'unbekannt'), [null]);
  });
});

describe('Eine Zelle ändern', () => {
  test('eine neue Laufzeit bringt ein passendes Modell und Gerät mit', () => {
    const next = changeRoleCell(role(), 'runtime', 'helena', catalog);
    assert.equal(next.runtime, 'helena');
    assert.equal(next.model, 'volition-local-default');
    assert.equal(next.reasoning, null);
    assert.equal(next.device, 'gpu');
  });

  test('zurück auf eine Cloud-Laufzeit wird aus GPU wieder Cloud', () => {
    const local = role({
      runtime: 'helena',
      model: 'halogen-flash',
      reasoning: null,
      device: 'gpu',
    });
    const next = changeRoleCell(local, 'runtime', 'claude', catalog);
    assert.equal(next.model, 'claude-sonnet-5-5');
    assert.equal(next.device, 'cloud');
  });

  test('das Modell bleibt, wenn die neue Laufzeit es kennt; die Denktiefe nur, wenn es sie bietet', () => {
    const next = changeRoleCell(role({ reasoning: 'high' }), 'model', 'gpt-6.1-luna', catalog);
    assert.equal(next.model, 'gpt-6.1-luna');
    assert.equal(next.reasoning, null);
    const kept = changeRoleCell(role({ reasoning: 'low' }), 'model', 'gpt-6.1-luna', catalog);
    assert.equal(kept.reasoning, undefined);
  });

  test('andere Spalten ändern nur sich selbst', () => {
    assert.deepEqual(changeRoleCell(role(), 'browser', 'jev', catalog), { browser: 'jev' });
  });
});

describe('Id eines neuen Schemas', () => {
  test('macht aus dem Namen erlaubte Zeichen', () => {
    assert.equal(schemaIdFor('Mein Mix für Größe', []), 'mein-mix-fuer-groesse');
    assert.equal(schemaIdFor('  Spaß & Co.  ', []), 'spass-co');
  });

  test('beginnt mit einem Buchstaben und hat mindestens zwei Zeichen', () => {
    assert.equal(schemaIdFor('123 Test', []), 'test');
    assert.equal(schemaIdFor('X', []), 'x-1');
    assert.equal(schemaIdFor('日本語', []), 'schema');
  });

  test('ist eindeutig unter den vorhandenen', () => {
    assert.equal(schemaIdFor('Gemischt', ['gemischt']), 'gemischt-2');
    assert.equal(schemaIdFor('Gemischt', ['gemischt', 'gemischt-2']), 'gemischt-3');
  });

  test('bleibt unter 64 Zeichen und trifft das Muster des Servers', () => {
    const id = schemaIdFor('a'.repeat(200), ['a'.repeat(56)]);
    assert.match(id, /^[a-z][a-z0-9-]{1,63}$/);
  });
});

describe('Benutzung eines Schemas', () => {
  const matrix = {
    active: 'nur-lokal',
    projects: { '3': 'eigenes', '5': 'gemischt' },
  } as unknown as ModelMatrix;
  test('nennt aktives Schema und Projekte', () => {
    assert.deepEqual(schemaUse(matrix, 'nur-lokal'), { active: true, projects: [] });
    assert.deepEqual(schemaUse(matrix, 'eigenes'), { active: false, projects: [3] });
    assert.deepEqual(schemaUse(matrix, 'frei'), { active: false, projects: [] });
  });

  test('fehlende Rollen in der Reihenfolge der Matrix', () => {
    const schema = { roles: { general: role(), coder: role() } } as unknown as MatrixSchema;
    assert.deepEqual(missingRoles(schema, ['home', 'coder', 'general']), ['home']);
  });
});

describe('Fehler der Vorschau in Worten', () => {
  test('ordnet die Meldungen des Servers zu', () => {
    assert.equal(previewErrorKey('Invalid reasoning for gpt-6.1-luna'), 'errors.reasoning');
    assert.equal(previewErrorKey('Model x is unavailable for codex'), 'errors.modelUnavailable');
    assert.equal(
      previewErrorKey('Schema needs a general role before applying'),
      'errors.needsGeneral',
    );
    assert.equal(previewErrorKey('Schema is still in use'), 'errors.inUse');
    assert.equal(previewErrorKey('Built-in schemas cannot be changed'), 'errors.builtIn');
    assert.equal(previewErrorKey('NPU class triage needs a passed eval'), 'errors.npuClass');
    assert.equal(previewErrorKey('Invalid device'), 'errors.invalid');
    assert.equal(previewErrorKey('Etwas ganz anderes'), 'errors.rejected');
  });
});
