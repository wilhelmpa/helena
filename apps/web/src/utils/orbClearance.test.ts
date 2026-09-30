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
  it('looks at a grid over the orb, a little inside its edge, corners included', () => {
    const points = orbPoints({ left: 100, top: 200, right: 164, bottom: 264 });
    assert.equal(points.length, 16);
    assert.deepEqual(points[0], [104, 204]);
    assert.deepEqual(points[3], [160, 204]);
    assert.deepEqual(points[15], [160, 260]);
    // Every point lies inside the box.
    for (const [x, y] of points) assert.ok(x >= 100 && x <= 164 && y >= 200 && y <= 264);
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
