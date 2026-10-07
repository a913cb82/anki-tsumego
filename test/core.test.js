'use strict';
// Unit tests for src/core/tsumego.js — the pure card logic.
// Run: npm test  (node --test test/)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyComment,
  charToNum,
  numToChar,
  getCoords,
  findBounds,
  parseSize,
  computeCrop,
  transformCropInfo,
  transformPoint,
  sgfToBoard,
  findFirstMove,
  shouldSwapColors,
} = require('../src/core/tsumego.js');

// Minimal parsed-SGF-like trees: { props: [{id, values}], children: [...] }
function node(props, children = []) {
  return { props, children };
}

describe('classifyComment (solution / failure comment markers)', () => {
  it('marks CORRECT and RIGHT (any case) as solutions', () => {
    assert.equal(classifyComment('CORRECT - kills'), 1);
    assert.equal(classifyComment('Correct - the peep works'), 1);
    assert.equal(classifyComment('RIGHT - captures'), 1);
    assert.equal(classifyComment('right'), 1);
  });

  it('marks INCORRECT, WRONG and FAIL (any case) as failures', () => {
    assert.equal(classifyComment('WRONG - lives'), -1);
    assert.equal(classifyComment('INCORRECT - too loose'), -1);
    assert.equal(classifyComment('fail - White ataris'), -1);
    assert.equal(classifyComment('Fail X'), -1);
  });

  it('returns 0 for neutral, empty or missing comments', () => {
    assert.equal(classifyComment('Black to play'), 0);
    assert.equal(classifyComment(''), 0);
    assert.equal(classifyComment(null), 0);
    assert.equal(classifyComment(undefined), 0);
  });

  it('requires the marker at the start of the comment', () => {
    assert.equal(classifyComment('This is CORRECT'), 0);
    assert.equal(classifyComment('Almost WRONG'), 0);
  });
});

describe('SGF coordinate helpers', () => {
  it('charToNum maps a-z to 1-26 and A-Z to 27-52', () => {
    assert.equal(charToNum('a'), 1);
    assert.equal(charToNum('s'), 19);
    assert.equal(charToNum('z'), 26);
    assert.equal(charToNum('A'), 27);
    assert.equal(charToNum('Z'), 52);
    assert.equal(charToNum(''), 0);
  });

  it('numToChar is the inverse of charToNum', () => {
    assert.equal(numToChar(1), 'a');
    assert.equal(numToChar(19), 's');
    assert.equal(numToChar(27), 'A');
    assert.equal(numToChar(52), 'Z');
    assert.equal(numToChar(0), '');
    assert.equal(numToChar(53), '');
  });

  it('getCoords parses two-letter points, null for pass/empty', () => {
    assert.deepEqual(getCoords('cb'), { x: 3, y: 2 });
    assert.equal(getCoords(''), null);
    assert.equal(getCoords(null), null);
  });

  it('parseSize handles square, rectangular and invalid SZ', () => {
    assert.deepEqual(parseSize('19'), { x: 19, y: 19 });
    assert.deepEqual(parseSize('9'), { x: 9, y: 9 });
    assert.deepEqual(parseSize('5:4'), { x: 5, y: 4 });
    assert.deepEqual(parseSize('bogus'), { x: 19, y: 19 });
    assert.deepEqual(parseSize('99'), { x: 19, y: 19 });
  });
});

describe('findBounds', () => {
  it('finds bounds across setup, moves and the whole tree', () => {
    const root = node(
      [{ id: 'AB', values: ['aa', 'ab'] }, { id: 'AW', values: ['bb'] }],
      [node([{ id: 'B', values: ['cb'] }]), node([{ id: 'W', values: ['db'] }])]
    );
    assert.deepEqual(findBounds(root), { minX: 1, minY: 1, maxX: 4, maxY: 2 });
  });

  it('expands compressed point lists (aa:ac)', () => {
    const root = node([{ id: 'AB', values: ['aa:ac'] }]);
    assert.deepEqual(findBounds(root), { minX: 1, minY: 1, maxX: 1, maxY: 3 });
  });

  it('ignores non-coordinate properties', () => {
    const root = node(
      [{ id: 'SZ', values: ['19'] }, { id: 'C', values: ['CORRECT'] }],
      [node([{ id: 'B', values: ['jj'] }])]
    );
    assert.deepEqual(findBounds(root), { minX: 10, minY: 10, maxX: 10, maxY: 10 });
  });

  it('reports an empty box when there are no coordinates', () => {
    const root = node([{ id: 'C', values: ['hi'] }]);
    const b = findBounds(root);
    assert.ok(b.minX > b.maxX);
  });
});

describe('computeCrop (auto-crop + padding + snap-to-edge)', () => {
  it('crops a top-left corner problem with open right/bottom edges', () => {
    // corner-life.sgf stones+replies: x 1..4, y 1..3
    const root = node(
      [
        { id: 'AB', values: ['aa', 'ab', 'ba'] },
        { id: 'AW', values: ['bb', 'bc'] },
        { id: 'B', values: ['cb'] },
      ],
      [
        node([{ id: 'W', values: ['cc'] }]),
        node([{ id: 'W', values: ['db'] }]),
      ]
    );
    const crop = computeCrop(root, 19, 19);
    assert.deepEqual(
      { minX: crop.minX, minY: crop.minY, maxX: crop.maxX, maxY: crop.maxY },
      { minX: 1, minY: 1, maxX: 5, maxY: 4 }
    );
    assert.equal(crop.newSizeX, 5);
    assert.equal(crop.newSizeY, 4);
    assert.equal(crop.left, true);
    assert.equal(crop.top, true);
    assert.equal(crop.right, false);
    assert.equal(crop.bottom, false);
  });

  it('snaps to the true edge when the padding comes within 3 (side problem)', () => {
    // side-capture.sgf: x 11..15, y 2..3 -> padded 10..16 x 1..4, right snaps to 19
    const root = node([
      { id: 'AB', values: ['kb', 'lb', 'mb', 'nb'] },
      { id: 'AW', values: ['kc', 'mc', 'nc'] },
      { id: 'B', values: ['lc', 'oc'] },
    ]);
    const crop = computeCrop(root, 19, 19);
    assert.deepEqual(
      { minX: crop.minX, minY: crop.minY, maxX: crop.maxX, maxY: crop.maxY },
      { minX: 10, minY: 1, maxX: 19, maxY: 4 }
    );
    assert.equal(crop.left, false);
    assert.equal(crop.right, true);
  });

  it('opens all four edges for a center problem', () => {
    const root = node([
      { id: 'AB', values: ['jj', 'kj'] },
      { id: 'AW', values: ['jk', 'kk'] },
      { id: 'B', values: ['lj', 'jl'] },
    ]);
    const crop = computeCrop(root, 19, 19);
    assert.equal(crop.newSizeX, 5);
    assert.equal(crop.newSizeY, 5);
    assert.deepEqual(
      { l: crop.left, r: crop.right, t: crop.top, b: crop.bottom },
      { l: false, r: false, t: false, b: false }
    );
  });

  it('does not crop a full-board position', () => {
    const root = node([
      { id: 'AB', values: ['aa:ac', 'ss'] },
      { id: 'AW', values: ['as', 'sa'] },
      { id: 'B', values: ['jj', 'pp'] },
    ]);
    const crop = computeCrop(root, 19, 19);
    assert.deepEqual(
      { minX: crop.minX, minY: crop.minY, maxX: crop.maxX, maxY: crop.maxY },
      { minX: 1, minY: 1, maxX: 19, maxY: 19 }
    );
    assert.deepEqual(
      { l: crop.left, r: crop.right, t: crop.top, b: crop.bottom },
      { l: true, r: true, t: true, b: true }
    );
  });

  it('honours non-19 board sizes (9x9)', () => {
    const root = node([
      { id: 'AB', values: ['aa', 'ab', 'ba'] },
      { id: 'AW', values: ['bb'] },
      { id: 'B', values: ['cb', 'bc'] },
    ]);
    const crop = computeCrop(root, 9, 9);
    assert.deepEqual(
      { minX: crop.minX, minY: crop.minY, maxX: crop.maxX, maxY: crop.maxY },
      { minX: 1, minY: 1, maxX: 4, maxY: 4 }
    );
  });

  it('returns null when there is nothing to crop', () => {
    assert.equal(computeCrop(node([{ id: 'C', values: ['hi'] }]), 19, 19), null);
  });
});

describe('probVar transforms (random variations)', () => {
  const crop = {
    left: true, right: false, top: true, bottom: false,
    shiftX: 0, shiftY: 0, originalSizeX: 19, originalSizeY: 19,
  };

  it('flips crop edges horizontally with bit 1', () => {
    const t = transformCropInfo(crop, 1);
    assert.deepEqual([t.left, t.right, t.top, t.bottom], [false, true, true, false]);
  });

  it('flips crop edges vertically with bit 2', () => {
    const t = transformCropInfo(crop, 2);
    assert.deepEqual([t.left, t.right, t.top, t.bottom], [true, false, false, true]);
  });

  it('transposes crop edges with bit 4', () => {
    // left<->top, right<->bottom: {T,F,T,F} is symmetric under transpose
    const t = transformCropInfo(crop, 4);
    assert.deepEqual([t.left, t.right, t.top, t.bottom], [true, false, true, false]);
    // ...but not for an asymmetric crop
    const u = transformCropInfo({ ...crop, top: false, bottom: true }, 4);
    assert.deepEqual([u.left, u.right, u.top, u.bottom], [false, true, true, false]);
  });

  it('round-trips: applying all 8 variations keeps edges consistent', () => {
    for (let v = 0; v < 8; v++) {
      const t = transformCropInfo(crop, v);
      for (const k of ['left', 'right', 'top', 'bottom']) {
        assert.equal(typeof t[k], 'boolean');
      }
      // double application is the identity for flips
      assert.deepEqual(transformCropInfo(transformCropInfo(crop, v & 3), v & 3), crop);
    }
  });

  it('transformPoint shifts, clips and mirrors the hoshi transform', () => {
    // 5x4 crop at origin, no variation
    assert.deepEqual(transformPoint(3, 2, 0, 0, 5, 4, 0), { x: 3, y: 2 });
    // outside the cropped area -> null (hoshi skipped)
    assert.equal(transformPoint(9, 9, 0, 0, 5, 4, 0), null);
    // horizontal flip: x mirrors around the unrotated width
    assert.deepEqual(transformPoint(1, 2, 0, 0, 5, 4, 1), { x: 5, y: 2 });
    // diagonal swap
    assert.deepEqual(transformPoint(3, 2, 0, 0, 5, 4, 4), { x: 2, y: 3 });
  });

  it('sgfToBoard mirrors lettersToCoords for every variation', () => {
    const cropped = { x: 5, y: 4 };
    // loadRootProps stores the size pre-swapped when bit 4 is set
    const stored = (v) => ((v & 4) ? { x: cropped.y, y: cropped.x } : cropped);
    assert.deepEqual(sgfToBoard(1, 1, stored(0), 0), { x: 1, y: 1 });
    assert.deepEqual(sgfToBoard(1, 1, stored(1), 1), { x: 5, y: 1 });
    assert.deepEqual(sgfToBoard(1, 1, stored(2), 2), { x: 1, y: 4 });
    assert.deepEqual(sgfToBoard(1, 2, stored(4), 4), { x: 2, y: 1 });
    // all 8 variations keep coordinates on the displayed board
    for (let v = 0; v < 8; v++) {
      const s = stored(v);
      for (let x = 1; x <= cropped.x; x++) {
        for (let y = 1; y <= cropped.y; y++) {
          const p = sgfToBoard(x, y, s, v);
          assert.ok(p.x >= 1 && p.x <= s.x && p.y >= 1 && p.y <= s.y, `var ${v}`);
        }
      }
    }
  });
});

describe('colour normalisation (White-to-move swap)', () => {
  it('detects the first move anywhere in the tree', () => {
    assert.equal(findFirstMove(node([{ id: 'B', values: ['aa'] }])), 'B');
    assert.equal(
      findFirstMove(node([], [node([{ id: 'W', values: ['aa'] }])])),
      'W'
    );
    assert.equal(findFirstMove(node([{ id: 'C', values: ['x'] }])), null);
  });

  it('requests a swap only when White moves first', () => {
    const whiteFirst = node(
      [{ id: 'AB', values: ['cc'] }],
      [node([{ id: 'W', values: ['ce'] }]), node([{ id: 'B', values: ['ec'] }])]
    );
    const blackFirst = node(
      [{ id: 'AB', values: ['aa'] }],
      [node([{ id: 'B', values: ['cb'] }])]
    );
    assert.equal(shouldSwapColors(whiteFirst), true);
    assert.equal(shouldSwapColors(blackFirst), false);
  });
});
