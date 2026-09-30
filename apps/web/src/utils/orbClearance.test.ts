import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ORB_CLEAR_ATTRIBUTE, ORB_CLEAR_PX, orbPoints, overflowsUnderOrb } from './orbClearance';

// The desktop orb floats over the bottom right corner (owner 30.09.: "Orb verdeckt nichts"): the
// scrollers that reach it and overflow get an empty end, the ones that do not overflow stay as
// they are - an end must never make a short page scroll.
const scroller = (scrollHeight: number, clientHeight: number, marked = false) => ({
  scrollHeight,
  clientHeight,
  hasAttribute: (name: string) => marked && name === ORB_CLEAR_ATTRIBUTE,
});

describe('orb clearance', () => {
  it('looks at the middle and the four corners of the orb, a little inside', () => {
    const points = orbPoints({ left: 100, top: 200, right: 164, bottom: 264 });
    assert.equal(points.length, 5);
    assert.deepEqual(points[0], [132, 232]);
    assert.deepEqual(points[1], [108, 208]);
    assert.deepEqual(points[4], [156, 256]);
  });

  it('marks a scroller that overflows and not one that fits', () => {
    const long = scroller(1400, 600);
    const short = scroller(600, 600);
    assert.deepEqual(
      overflowsUnderOrb([long, short], () => true),
      [long],
    );
  });

  it('ignores elements that do not scroll', () => {
    const fixed = scroller(1400, 600);
    assert.deepEqual(
      overflowsUnderOrb([fixed], () => false),
      [],
    );
  });

  it('does not count its own empty end as content', () => {
    // A page that fits, with the end it was given: 600 + the end is not an overflow.
    assert.deepEqual(
      overflowsUnderOrb([scroller(600 + ORB_CLEAR_PX, 600, true)], () => true),
      [],
    );
    // One that really overflows keeps its mark.
    const long = scroller(1400 + ORB_CLEAR_PX, 600, true);
    assert.deepEqual(
      overflowsUnderOrb([long], () => true),
      [long],
    );
  });
});
