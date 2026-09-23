import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WORKSPACE_HEADER_CLASS,
  WORKSPACE_HEADER_DESCRIPTION_CLASS,
  WORKSPACE_PANEL_HEADER_CLASS,
} from './WorkspaceHeader';
import {
  WORKSPACE_TOOLBAR_BUTTON_ACTIVE_CLASS,
  WORKSPACE_TOOLBAR_BUTTON_CLASS,
  WORKSPACE_TOOLBAR_TRIGGER_CLASS,
} from './WorkspaceToolbarButton';

describe('WorkspaceHeader', () => {
  it('keeps page, overlay and pinned panel rows on one fixed contract', () => {
    const classes = WORKSPACE_HEADER_CLASS.split(' ');
    for (const className of ['h-12', 'shrink-0', 'border-b']) assert(classes.includes(className));
    assert.doesNotMatch(WORKSPACE_HEADER_CLASS, /(?:sm|md|lg|xl):h-/);
  });

  it('keeps the tool panel header shorter than a page header, on its own fixed contract', () => {
    const classes = WORKSPACE_PANEL_HEADER_CLASS.split(' ');
    for (const className of ['h-10', 'shrink-0', 'border-b']) assert(classes.includes(className));
    assert.doesNotMatch(WORKSPACE_PANEL_HEADER_CLASS, /(?:sm|md|lg|xl):h-/);
    assert.notEqual(WORKSPACE_PANEL_HEADER_CLASS, WORKSPACE_HEADER_CLASS);
  });

  it('keeps secondary text out of the constrained mobile row', () => {
    const classes = WORKSPACE_HEADER_DESCRIPTION_CLASS.split(' ');
    for (const className of ['hidden', 'md:block', 'truncate']) assert(classes.includes(className));
  });

  it('defines one button contract for task and inbox toolbars', () => {
    assert.match(WORKSPACE_TOOLBAR_BUTTON_CLASS, /h-7/);
    assert.match(WORKSPACE_TOOLBAR_BUTTON_CLASS, /px-2/);
    assert.match(WORKSPACE_TOOLBAR_BUTTON_CLASS, /\[&_svg\]:size-3\.5/);
    assert.match(WORKSPACE_TOOLBAR_BUTTON_CLASS, /focus-visible:outline-ring/);
    assert.match(WORKSPACE_TOOLBAR_BUTTON_ACTIVE_CLASS, /bg-secondary/);
    assert.match(WORKSPACE_TOOLBAR_TRIGGER_CLASS, /data-\[state=active\]:bg-secondary/);
  });
});
