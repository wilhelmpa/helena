import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { elementHasName, nodeText } from './accessibleName';

function Icon() {
  return null;
}

describe('nodeText', () => {
  it('reads the words of strings and plain elements, not of components', () => {
    assert.equal(
      nodeText(
        <>
          <Icon /> <span>Neue</span> Aufgabe
        </>,
      ),
      'Neue Aufgabe',
    );
    assert.equal(nodeText(<Icon />), '');
  });
});

describe('elementHasName', () => {
  it('knows an icon-only button needs a name', () => {
    assert.equal(
      elementHasName(
        <button>
          <Icon />
        </button>,
      ),
      false,
    );
  });

  it('takes words or an aria-label as a name', () => {
    assert.equal(elementHasName(<button>Speichern</button>), true);
    assert.equal(
      elementHasName(
        <button aria-label="Löschen">
          <Icon />
        </button>,
      ),
      true,
    );
  });
});
