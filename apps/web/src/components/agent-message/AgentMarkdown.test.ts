import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pluginsNeeded } from './AgentMarkdown';

describe('pluginsNeeded', () => {
  it('loads nothing for prose', () => {
    assert.deepEqual(pluginsNeeded('Two things are left: `a` and **b**.'), {
      code: false,
      mermaid: false,
    });
  });

  it('loads the highlighter for any fenced block, and Mermaid only for a diagram', () => {
    assert.deepEqual(pluginsNeeded('Look:\n\n```ts\nconst a = 1;\n```'), {
      code: true,
      mermaid: false,
    });
    assert.deepEqual(pluginsNeeded('Flow:\n  ~~~ mermaid\nflowchart LR\n~~~'), {
      code: true,
      mermaid: true,
    });
  });
});
