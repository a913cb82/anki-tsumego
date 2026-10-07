'use strict';
// Card-level integration tests: load the REAL front.html / back.html in a
// browser-like DOM (jsdom), feed them example tsumego SGFs the same way Anki
// does ({{SGF}} field substitution), and verify user-facing behaviour:
// board size after auto-crop, stones placed, open edges, solution/failure
// flows on the front, and analysis highlighting on the back.
// Run: npm test  (node --test test/)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const FRONT = fs.readFileSync(path.join(root, 'front.html'), 'utf8');
const BACK = fs.readFileSync(path.join(root, 'back.html'), 'utf8');

function fixture(name) {
  return fs.readFileSync(path.join(root, 'test', 'fixtures', `${name}.sgf`), 'utf8').trim();
}

// Load a card the way Anki serves it: SGF text substituted into the field,
// scripts running. randomValue pins Math.random before any script runs, so
// probVar (Math.floor(random()*8)) is deterministic.
function loadCard(side, sgf, { randomValue = 0, seedPersistence = null } = {}) {
  const template = side === 'front' ? FRONT : BACK;
  const html = template.replace('{{text:SGF}}', sgf).replace('{{SGF}}', sgf);
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => jsdomErrors.push(String(e && e.stack || e)));
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
    url: 'https://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.Math.random = () => randomValue;
      if (seedPersistence) {
        for (const [k, v] of Object.entries(seedPersistence)) {
          window.sessionStorage.setItem(
            `github.com/SimonLammer/anki-persistence/${k}`,
            JSON.stringify(v)
          );
        }
      }
      window.addEventListener('error', (e) => jsdomErrors.push(String(e.message)));
    },
  });
  return { window: dom.window, document: dom.window.document, jsdomErrors };
}

// --- DOM readers (board geometry is the observable crop result) ---

function boardSvg(document, boardId) {
  const svg = document.querySelector(`#${boardId} svg`);
  assert.ok(svg, `board svg rendered in #${boardId}`);
  return svg;
}

// viewBox "0 0 W H" with W = 12 + sizeX*88 (coord:none margin), same for H.
function boardSize(svg) {
  const parts = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  return { x: Math.round((parts[2] - 12) / 88), y: Math.round((parts[3] - 12) / 88) };
}

// Open (cropped) edges omit their outer line: horizontals carry 'h',
// verticals carry 'v' in the board-lines path.
function lineCounts(svg) {
  const d = svg.querySelector('path.besogo-svg-lines').getAttribute('d');
  return { h: (d.match(/h/g) || []).length, v: (d.match(/v/g) || []).length };
}

// Only count placed stones: the hover layer (g[opacity], the translucent move
// preview) also renders stones, and the hovered one is visibility=visible --
// exactly as in a real browser. The stone layer is the group without opacity.
function stoneCounts(svg) {
  // Placed stones are grouped wrappers (shadow + base + sheen); the hover
  // layer's translucent previews live under g[opacity] and are excluded.
  return {
    black: svg.querySelectorAll('g:not([opacity]) > g.besogo-svg-blackStone').length,
    white: svg.querySelectorAll('g:not([opacity]) > g.besogo-svg-whiteStone').length,
  };
}

// go-trainer geometry on the 88-unit cell: radius 0.44, shadow 0.46 offset
// (+4.7, +7), sheen spot 0.3r up-left by 0.28r. All values as rendered.
const STONE_R = '38.72';
const SHADOW_R = '40.48';
const SHEEN_R = '11.6';

function stoneWrappers(svg, color) {
  return Array.from(svg.querySelectorAll(`g:not([opacity]) > g.besogo-svg-${color}Stone`));
}

function wrapperCircle(wrapper, r) {
  const found = Array.from(wrapper.querySelectorAll('circle')).find(
    (c) => c.getAttribute('r') === r
  );
  assert.ok(found, `stone has an r=${r} circle`);
  return found;
}

function eventTargets(svg) {
  return Array.from(svg.children).filter(
    (el) => el.tagName.toLowerCase() === 'rect' && el.getAttribute('opacity') === '0'
  );
}

function frontMessage(document) {
  return document.querySelector('#frontGo .besogo-comment');
}

// The cards write the status line via innerText (needs layout, so jsdom does
// not mirror it into textContent -- the assignment just lands on an expando
// there). In real browsers innerText renders normally, so tests read the
// property the card actually writes.
function frontMessageText(document) {
  return frontMessage(document).innerText;
}

// Board labels the user sees: variant letters (A, B, ...) plus SGF labels
// (LB). Coordinate labels are never drawn (coord is pinned to 'none').
function boardTexts(svg) {
  return Array.from(svg.querySelectorAll('g:not([opacity]) text')).map((el) => el.textContent);
}

function hoshiCount(svg) {
  const hoshi = svg.querySelector('path.besogo-svg-hoshi');
  if (!hoshi) return 0;
  return (hoshi.getAttribute('d').match(/M/g) || []).length;
}

// Back analysis comment box: the static div inside the comment panel.
function backCommentText(document) {
  return document.querySelector('#backGo .besogo-comment div').textContent;
}

// Board background: wood path with rounded corners ONLY on true board
// edges (cropped edges stay sharp). 'A' occurs in the path solely for arcs.
function bgPath(svg) {
  const bg = Array.from(svg.children).find(
    (el) => el.tagName.toLowerCase() === 'path' && el.getAttribute('class') === 'besogo-svg-board'
  );
  assert.ok(bg, 'wood background path rendered');
  return bg;
}

function arcCount(svg) {
  const d = bgPath(svg).getAttribute('d');
  return (d.match(/A/g) || []).length;
}

function boardChrome(document, boardId) {
  return document.querySelector(`#${boardId} .besogo-board`);
}

async function clickPoint(window, boardId, x, y) {
  const svg = boardSvg(window.document, boardId);
  const size = boardSize(svg);
  const rects = eventTargets(svg);
  assert.equal(rects.length, size.x * size.y, 'event grid covers the board');
  rects[(x - 1) * size.y + (y - 1)].dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true })
  );
  await new Promise((r) => setTimeout(r, 350)); // let handicap/nextMove timers settle
}

describe('front card renders cropped problems', () => {
  // { size, h/v line segments, setup stones } derived from the crop rules:
  // 1-pt padding, snap-to-edge within 3. probVar pinned to 0.
  const cases = [
    {
      name: 'corner-life', size: { x: 5, y: 4 }, lines: { h: 3, v: 4 },
      stones: { black: 3, white: 2 }, note: 'open right/bottom edges',
    },
    {
      name: 'side-capture', size: { x: 10, y: 4 }, lines: { h: 3, v: 9 },
      stones: { black: 4, white: 3 }, note: 'right snaps to true edge, open left/bottom',
    },
    {
      name: 'center-fight', size: { x: 5, y: 5 }, lines: { h: 3, v: 3 },
      stones: { black: 2, white: 2 }, note: 'all four edges open',
    },
    {
      name: 'white-to-move', size: { x: 6, y: 6 }, lines: { h: 5, v: 5 },
      stones: { black: 2, white: 3 }, note: 'colours swapped so Black starts',
    },
    {
      name: 'small-9x9', size: { x: 4, y: 4 }, lines: { h: 3, v: 3 },
      stones: { black: 3, white: 1 }, note: 'non-19 SZ honoured',
    },
    {
      name: 'full-board', size: { x: 19, y: 19 }, lines: { h: 19, v: 19 },
      stones: { black: 4, white: 2 }, note: 'no crop, all edges drawn',
    },
  ];

  for (const c of cases) {
    it(`${c.name}: ${c.size.x}x${c.size.y} board, ${c.note}`, () => {
      const { document, jsdomErrors } = loadCard('front', fixture(c.name));
      assert.deepEqual(jsdomErrors, [], 'no script errors on load');
      const svg = boardSvg(document, 'frontGo');
      assert.deepEqual(boardSize(svg), c.size);
      assert.deepEqual(lineCounts(svg), c.lines);
      assert.deepEqual(stoneCounts(svg), c.stones);
    });
  }
});

describe('front card solving flow (corner problem)', () => {
  it('correct move solves: completion message + Total Errors', async () => {
    const { window, document, jsdomErrors } = loadCard('front', fixture('corner-life'));
    assert.deepEqual(jsdomErrors, [], 'no script errors on load');
    await clickPoint(window, 'frontGo', 3, 2); // B[cb] CORRECT leaf
    assert.deepEqual(jsdomErrors, [], 'no script errors while solving');
    assert.equal(window.Persistence.getItem('solvedColour'), 'limegreen');
    const board = boardChrome(document, 'frontGo');
    assert.equal(board.style.borderColor, 'limegreen', 'solved: green border');
    assert.ok(board.style.boxShadow.includes('limegreen'), 'solved: green glow');
    const msg = frontMessageText(document);
    assert.ok(msg.includes('CORRECT'), `shows leaf comment, got: ${msg}`);
    assert.ok(msg.includes('Total Errors: 0'), `counts errors, got: ${msg}`);
  });

  it('listed wrong move marks failure (red) without error total', async () => {
    const { window, document } = loadCard('front', fixture('corner-life'));
    await clickPoint(window, 'frontGo', 4, 2); // B[db] WRONG leaf
    const msg = frontMessageText(document);
    assert.ok(msg.includes('WRONG'), `shows leaf comment, got: ${msg}`);
    assert.ok(!msg.includes('Total Errors'), `no error total on failure, got: ${msg}`);
    assert.equal(window.Persistence.getItem('solvedColour'), '#b31010');
    const board = boardChrome(document, 'frontGo');
    assert.equal(board.style.borderColor, 'rgb(179, 16, 16)', 'wrong leaf shows the red failure border');
  });

  it('unlisted move counts as a mistake and stays on the problem', async () => {
    const { window, document } = loadCard('front', fixture('corner-life'));
    await clickPoint(window, 'frontGo', 5, 4); // empty point, no variation
    assert.equal(frontMessageText(document), '', 'still on the problem');
    assert.equal(window.Persistence.getItem('solvedColour'), '#b31010');
    // board unchanged: still the setup stones
    assert.deepEqual(stoneCounts(boardSvg(document, 'frontGo')), { black: 3, white: 2 });
  });
});

describe('front card random variations', () => {
  it('all 8 probVar orientations render the same stones', () => {
    for (let v = 0; v < 8; v++) {
      const { document, jsdomErrors } = loadCard('front', fixture('corner-life'), {
        randomValue: (v + 0.5) / 8, // Math.floor(rand*8) === v
      });
      assert.deepEqual(jsdomErrors, [], `no script errors for variation ${v}`);
      const svg = boardSvg(document, 'frontGo');
      const size = boardSize(svg);
      // 5x4 crop, transposed to 4x5 when bit 4 is set
      assert.deepEqual(size, (v & 4) ? { x: 4, y: 5 } : { x: 5, y: 4 }, `var ${v} size`);
      const stones = stoneCounts(svg);
      assert.equal(stones.black + stones.white, 5, `var ${v} keeps all stones`);
      assert.equal(eventTargets(svg).length, size.x * size.y, `var ${v} grid covers board`);
    }
  });
});

describe('back card analysis board', () => {
  const seed = { solvedColour: 'limegreen', rnd: true, var: 0 };

  it('renders the same cropped position as the front', () => {
    const { document, jsdomErrors } = loadCard('back', fixture('corner-life'), {
      seedPersistence: seed,
    });
    assert.deepEqual(jsdomErrors, [], 'no script errors on load');
    const svg = boardSvg(document, 'backGo');
    assert.deepEqual(boardSize(svg), { x: 5, y: 4 });
    assert.deepEqual(lineCounts(svg), { h: 3, v: 4 });
    assert.deepEqual(stoneCounts(svg), { black: 3, white: 2 });
  });

  it('marks next moves: limegreen on the correct path, red off it', () => {
    const { document } = loadCard('back', fixture('corner-life'), { seedPersistence: seed });
    const svg = boardSvg(document, 'backGo');
    assert.equal(svg.querySelectorAll('circle[fill="limegreen"]').length, 1, 'one correct reply');
    assert.equal(svg.querySelectorAll('circle[fill="red"]').length, 1, 'one wrong reply');
  });

  it('highlights the solution path in the tree, thicker at the leaf', () => {
    const { document } = loadCard('back', fixture('corner-life'), { seedPersistence: seed });
    const tree = document.querySelector('#backGo .besogo-tree');
    assert.ok(tree, 'tree panel rendered');
    const marks = tree.querySelectorAll('circle[stroke="limegreen"]');
    assert.ok(marks.length >= 2, `path + leaf highlighted, got ${marks.length}`);
    assert.equal(tree.querySelectorAll('circle[stroke="limegreen"][stroke-width="16"]').length, 1);
  });

  it('carries the front result over via Persistence (green border)', () => {
    const { document } = loadCard('back', fixture('corner-life'), { seedPersistence: seed });
    assert.deepEqual(boardSize(boardSvg(document, 'backGo')), { x: 5, y: 4 });
    const border = document.querySelector('#backGo .besogo-board').style.border;
    assert.ok(border.includes('limegreen'), `border shows result, got: ${border}`);
  });

  it('works with no stored Persistence (first visit)', () => {
    const { document, jsdomErrors } = loadCard('back', fixture('side-capture'));
    assert.deepEqual(jsdomErrors, [], 'no script errors without Persistence');
    assert.deepEqual(boardSize(boardSvg(document, 'backGo')), { x: 10, y: 4 });
  });
});

describe('front card multi-move solve and handicap (deeper tree)', () => {
  it('solves over two clicks with the reply auto-shown in between', async () => {
    const { window, document } = loadCard('front', fixture('deeper-tree'));
    await clickPoint(window, 'frontGo', 3, 2); // B[cb]: correct, White replies
    // auto-advance showed W[cc]; still mid-problem, no completion message
    assert.equal(frontMessageText(document), '');
    assert.deepEqual(stoneCounts(boardSvg(document, 'frontGo')), { black: 4, white: 3 });
    await clickPoint(window, 'frontGo', 4, 2); // B[db]: CORRECT leaf
    const msg = frontMessageText(document);
    assert.ok(msg.includes('CORRECT'), `shows leaf comment, got: ${msg}`);
    assert.ok(msg.includes('Total Errors: 0'), `counts errors, got: ${msg}`);
  });

  it('finishing after mistakes keeps the red failure border', async () => {
    const { window, document } = loadCard('front', fixture('corner-life'));
    await clickPoint(window, 'frontGo', 5, 4); // mistake 1: empty point
    await clickPoint(window, 'frontGo', 5, 3); // mistake 2
    await clickPoint(window, 'frontGo', 5, 1); // mistake 3 -> auto-reveals B[cb] leaf
    const msg = frontMessageText(document);
    assert.ok(msg.includes('Total Errors: 3'), `counts all mistakes, got: ${msg}`);
    const board = boardChrome(document, 'frontGo');
    assert.equal(board.style.borderColor, 'rgb(179, 16, 16)', 'failure recorded despite correct finish');
    assert.equal(window.Persistence.getItem('solvedColour'), '#b31010');
  });

  it('three mistakes trigger the handicap auto-reveal', async () => {
    const { window, document } = loadCard('front', fixture('corner-life'));
    await clickPoint(window, 'frontGo', 5, 4); // mistake 1: empty point
    assert.equal(frontMessageText(document), '', 'still on the problem');
    await clickPoint(window, 'frontGo', 5, 3); // mistake 2
    await clickPoint(window, 'frontGo', 5, 1); // mistake 3 -> auto-reveal
    const msg = frontMessageText(document);
    assert.ok(msg.includes('CORRECT'), `reveals the move, got: ${msg}`);
    assert.ok(msg.includes('Total Errors: 3'), `counts all mistakes, got: ${msg}`);
  });

  it('opens on the problem position (no auto-advance on load)', async () => {
    const { document, jsdomErrors } = loadCard('front', fixture('corner-life'));
    await new Promise((r) => setTimeout(r, 450)); // longer than any load timer
    assert.deepEqual(jsdomErrors, [], 'no script errors');
    assert.equal(frontMessageText(document), '', 'still on the problem');
    assert.deepEqual(stoneCounts(boardSvg(document, 'frontGo')), { black: 3, white: 2 });
  });

  it('mid-problem board carries no to-move border', () => {
    const { document, jsdomErrors } = loadCard('front', fixture('corner-life'));
    assert.deepEqual(jsdomErrors, [], 'no script errors');
    const board = boardChrome(document, 'frontGo');
    assert.equal(board.style.borderColor, '', 'no black/white move indicator');
    assert.equal(board.style.boxShadow, '', 'no mid-problem glow');
  });
});

describe('what the user sees on the board', () => {
  it('back shows reply letters (variantStyle 0), front shows none (style 2)', () => {
    const back = loadCard('back', fixture('corner-life'));
    assert.deepEqual(boardTexts(boardSvg(back.document, 'backGo')).sort(), ['A', 'B']);
  });

  it('front shows no reply letters and no coordinate labels', () => {
    // variantStyle is pinned >= 2 (toggle hidden) so getVariants() is always
    // empty; coord is pinned to 'none'. Replies stay invisible until played.
    const { document } = loadCard('front', fixture('corner-life'));
    assert.deepEqual(boardTexts(boardSvg(document, 'frontGo')), []);
  });

  it('front renders SGF markup (circles, labels) on the problem', () => {
    const { document, jsdomErrors } = loadCard('front', fixture('markup-labels'));
    assert.deepEqual(jsdomErrors, [], 'no script errors');
    const svg = boardSvg(document, 'frontGo');
    assert.deepEqual(boardSize(svg), { x: 4, y: 4 });
    assert.deepEqual(boardTexts(svg), ['A'], 'only the SGF LB label renders');
    assert.deepEqual(stoneCounts(svg), { black: 3, white: 1 });
    const rings = svg.querySelectorAll('g:not([opacity]) circle[r="27"][fill="none"]');
    assert.equal(rings.length, 1, 'CR markup ring renders outside the stone groups');
    assert.equal(svg.querySelectorAll('g:not([opacity]) rect[opacity="0.85"]').length, 1, 'LB backer');
  });

  it('board viewport follows the crop aspect (no square letterbox)', () => {
    for (const side of ['front', 'back']) {
      const boardId = side === 'front' ? 'frontGo' : 'backGo';
      const { document } = loadCard(side, fixture('corner-life'));
      const svg = boardSvg(document, boardId);
      assert.equal(svg.getAttribute('viewBox'), '0 0 452 364');
      assert.equal(svg.style.height, 'auto', `${side} viewport height follows the crop`);
      const board = document.querySelector(`#${boardId} .besogo-board`);
      assert.ok(board.style.height !== '', `${side} board div owns its cropped height`);
      if (side === 'back') {
        assert.equal(board.style.width, '0px', 'back board width refit from the true crop');
      }
      if (side === 'front') {
        assert.ok(board.style.width !== '', 'front board div owns its fitted width');
        // No #qa wrapper (AnkiDroid): the card pads itself vertically.
        assert.equal(document.body.style.paddingTop, '384px', 'self-centering engages');
      }
    }
  });

  it('wood, grid and hoshi match the go-trainer palette', () => {
    for (const side of ['front', 'back']) {
      const boardId = side === 'front' ? 'frontGo' : 'backGo';
      const { document } = loadCard(side, fixture('corner-life'));
      const svg = boardSvg(document, boardId);
      assert.equal(bgPath(svg).getAttribute('fill'), '#E8C07A', `${side} wood`);
      assert.equal(svg.querySelector('path.besogo-svg-lines').getAttribute('stroke'), '#3E2B15', `${side} grid`);
    }
    const { document } = loadCard('front', fixture('full-board'));
    const hoshi = boardSvg(document, 'frontGo').querySelector('path.besogo-svg-hoshi');
    assert.equal(hoshi.getAttribute('stroke'), '#3E2B15', 'hoshi follows the grid');
  });

  it('only true board-edge corners are rounded (cropped edges stay sharp)', () => {
    // [fixture, board size, rounded corners, path start]
    const cases = [
      ['corner-life', { x: 5, y: 4 }, 1, 'M9.1,0'], // TL only
      ['side-capture', { x: 10, y: 4 }, 1, 'M0,0'], // TR only
      ['center-fight', { x: 5, y: 5 }, 0, 'M0,0'], // all cropped
      ['full-board', { x: 19, y: 19 }, 4, 'M42.1,0'], // all true edges
    ];
    for (const side of ['front', 'back']) {
      const boardId = side === 'front' ? 'frontGo' : 'backGo';
      for (const [name, size, arcs, start] of cases) {
        const { document } = loadCard(side, fixture(name));
        const svg = boardSvg(document, boardId);
        assert.deepEqual(boardSize(svg), size, `${side} ${name} size`);
        assert.equal(arcCount(svg), arcs, `${side} ${name} rounded corners`);
        assert.ok(bgPath(svg).getAttribute('d').startsWith(start), `${side} ${name} path start`);
      }
    }
  });

  it('black stones: offset shadow, #111111 base, sheen spot', () => {
    for (const side of ['front', 'back']) {
      const boardId = side === 'front' ? 'frontGo' : 'backGo';
      const { document } = loadCard(side, fixture('corner-life'));
      const blacks = stoneWrappers(boardSvg(document, boardId), 'black');
      assert.equal(blacks.length, 3, `${side} black count`);
      for (const w of blacks) {
        assert.equal(w.querySelectorAll('circle').length, 3, 'shadow + base + sheen');
        const base = wrapperCircle(w, STONE_R);
        assert.equal(base.getAttribute('fill'), '#111111');
        assert.equal(base.getAttribute('stroke'), 'none');
        const shadow = wrapperCircle(w, SHADOW_R);
        assert.equal(shadow.getAttribute('opacity'), '0.25');
        assert.ok(Math.abs(+shadow.getAttribute('cx') - +base.getAttribute('cx') - 4.7) < 1e-9);
        assert.ok(Math.abs(+shadow.getAttribute('cy') - +base.getAttribute('cy') - 7) < 1e-9);
        const sheen = wrapperCircle(w, SHEEN_R);
        assert.equal(sheen.getAttribute('fill'), '#3A3A3A');
        assert.ok(Math.abs(+base.getAttribute('cx') - +sheen.getAttribute('cx') - 10.8) < 1e-9);
        assert.ok(Math.abs(+base.getAttribute('cy') - +sheen.getAttribute('cy') - 10.8) < 1e-9);
      }
    }
  });

  it('white stones: offset shadow, cream base, brown rim, no sheen', () => {
    for (const side of ['front', 'back']) {
      const boardId = side === 'front' ? 'frontGo' : 'backGo';
      const { document } = loadCard(side, fixture('corner-life'));
      const whites = stoneWrappers(boardSvg(document, boardId), 'white');
      assert.equal(whites.length, 2, `${side} white count`);
      for (const w of whites) {
        assert.equal(w.querySelectorAll('circle').length, 2, 'shadow + base only');
        const base = wrapperCircle(w, STONE_R);
        assert.equal(base.getAttribute('fill'), '#FDF8EC');
        assert.equal(base.getAttribute('stroke'), '#8A7040');
        const shadow = wrapperCircle(w, SHADOW_R);
        assert.equal(shadow.getAttribute('opacity'), '0.25');
      }
    }
  });

  it('last move wears the go-trainer contrast ring, not a blue plus', async () => {
    const { window, document } = loadCard('front', fixture('deeper-tree'));
    const svg = () => boardSvg(document, 'frontGo');
    const ring = () => svg().querySelector('circle[r="17.6"]');
    assert.equal(ring(), null, 'no ring on the problem position');
    await clickPoint(window, 'frontGo', 3, 2); // B[cb]: correct, White replies W[cc]
    let r = ring();
    assert.ok(r, 'ring appears on the reply');
    assert.equal(r.getAttribute('fill'), 'none');
    assert.equal(r.getAttribute('stroke'), '#000000', 'black ring on the white reply');
    assert.equal(r.getAttribute('stroke-width'), '9.3');
    await clickPoint(window, 'frontGo', 4, 2); // B[db]: CORRECT leaf, black stone
    r = ring();
    assert.ok(r, 'ring follows to the solving move');
    assert.equal(r.getAttribute('stroke'), '#FFFFFF', 'white ring on the black stone');
    const onStone = stoneWrappers(svg(), 'black').some((w) => {
      const base = wrapperCircle(w, STONE_R);
      return base.getAttribute('cx') === r.getAttribute('cx') &&
        base.getAttribute('cy') === r.getAttribute('cy');
    });
    assert.ok(onStone, 'ring sits on the played stone');
    assert.equal(svg().querySelectorAll('path[stroke="#0165fc"]').length, 0, 'no blue plus');
  });

  it('back board rings the navigated move', async () => {
    const { window, document, jsdomErrors } = loadCard('back', fixture('corner-life'), {
      seedPersistence: { rnd: true, var: 0 },
    });
    await clickPoint(window, 'backGo', 3, 2); // navigate to B[cb]
    assert.deepEqual(jsdomErrors, [], 'no script errors');
    const r = boardSvg(document, 'backGo').querySelector('circle[r="17.6"]');
    assert.ok(r, 'ring on the navigated move');
    assert.equal(r.getAttribute('stroke'), '#FFFFFF', 'white ring on black');
  });

  it('tree background stays transparent (never the wood fill)', () => {
    const { document } = loadCard('back', fixture('corner-life'), { seedPersistence: { rnd: true, var: 0 } });
    const tree = document.querySelector('#backGo .besogo-tree');
    const bg = tree.querySelector('rect');
    assert.ok(bg, 'tree paints a background rect');
    assert.notEqual(bg.getAttribute('class'), 'besogo-svg-board', 'tree bg must not share the board paint');
    assert.equal(bg.getAttribute('fill'), 'none', 'tree bg transparent like the original');
  });

  it('grey tree icons stay flat discs', () => {
    const { document } = loadCard('back', fixture('corner-life'), { seedPersistence: { rnd: true, var: 0 } });
    const tree = document.querySelector('#backGo .besogo-tree');
    const grey = tree.querySelectorAll('circle.besogo-svg-greyStone');
    assert.ok(grey.length > 0, 'setup/empty tree nodes rendered');
    for (const c of grey) {
      assert.equal(c.getAttribute('r'), '42');
      assert.equal(c.tagName.toLowerCase(), 'circle', 'bare circle, not a group');
    }
  });

  it('star points appear on full boards, not on cropped ones', () => {
    const full = loadCard('front', fixture('full-board'));
    assert.equal(hoshiCount(boardSvg(full.document, 'frontGo')), 9);
    const corner = loadCard('front', fixture('corner-life'));
    assert.equal(hoshiCount(boardSvg(corner.document, 'frontGo')), 0);
  });

  it('each side shows exactly its own panels', () => {
    const front = loadCard('front', fixture('corner-life')).document;
    assert.ok(front.querySelector('#frontGo .besogo-control'), 'front has controls');
    assert.equal(front.querySelector('#frontGo .besogo-tree'), null);
    assert.equal(front.querySelector('#frontGo .besogo-tool'), null);
    assert.equal(front.querySelector('#frontGo .besogo-names'), null);
    assert.equal(front.querySelectorAll('#frontGo .besogo-comment').length, 1, 'only the message line');
    assert.ok(front.querySelector('[title="Next node"]'), 'automation buttons exist');
    const back = loadCard('back', fixture('corner-life')).document;
    for (const panel of ['comment', 'tree']) {
      assert.ok(back.querySelector(`#backGo .besogo-${panel}`), `back keeps ${panel}`);
    }
    for (const panel of ['control', 'names', 'tool']) {
      assert.equal(back.querySelector(`#backGo .besogo-${panel}`), null, `back drops ${panel}`);
    }
    assert.equal(back.querySelector('#backGo input[value="Pass"]'), null, 'no Pass button');
    assert.equal(back.querySelector('#backGo input[value="Cut"]'), null, 'no Cut button');
  });
});

describe('back card deeper analysis', () => {
  it('indicators follow navigation into the tree', async () => {
    const { window, document } = loadCard('back', fixture('deeper-tree'));
    const svg = () => boardSvg(document, 'backGo');
    const dots = () => ({
      good: svg().querySelectorAll('circle[fill="limegreen"]').length,
      bad: svg().querySelectorAll('circle[fill="red"]').length,
    });
    assert.deepEqual(dots(), { good: 1, bad: 1 }, 'root replies');
    await clickPoint(window, 'backGo', 3, 2); // B[cb]: one correct continuation
    assert.deepEqual(dots(), { good: 1, bad: 0 }, 'after Black');
    await clickPoint(window, 'backGo', 3, 3); // W[cc]: correct vs wrong reply
    assert.deepEqual(dots(), { good: 1, bad: 1 }, 'after White');
  });

  it('variant letters render bare (no backing squares)', () => {
    const { document, jsdomErrors } = loadCard('back', fixture('deeper-tree'));
    assert.deepEqual(jsdomErrors, [], 'no script errors');
    const svg = boardSvg(document, 'backGo');
    const letters = Array.from(svg.querySelectorAll('g:not([opacity]) text')).map(
      (el) => el.textContent
    );
    assert.ok(letters.length > 0, `variant letters render, got: ${letters}`);
    assert.equal(
      svg.querySelectorAll('g:not([opacity]) rect[opacity="0.85"]').length,
      0,
      'letters only, no backers'
    );
  });

  it('CR on the last move yields to the contrast ring (front)', async () => {
    const { window, document, jsdomErrors } = loadCard('front', fixture('cr-lastmove'), {
      seedPersistence: { rnd: true, var: 0 },
    });
    assert.deepEqual(jsdomErrors, [], 'no script errors on load');
    document
      .querySelector('[title="Next node"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(jsdomErrors, [], 'no script errors while navigating');
    const svg = boardSvg(document, 'frontGo');
    assert.equal(
      svg.querySelectorAll('g:not([opacity]) circle[r="17.6"]').length,
      1,
      'go-trainer ring marks the last move'
    );
    assert.equal(
      svg.querySelectorAll('g:not([opacity]) circle[r="27"]').length,
      0,
      'no CR circle on the last move'
    );
  });

  it('CR on the last move yields to the contrast ring (back)', async () => {
    const { window, document, jsdomErrors } = loadCard('back', fixture('cr-lastmove'), {
      seedPersistence: { rnd: true, var: 0 },
    });
    assert.deepEqual(jsdomErrors, [], 'no script errors on load');
    const evt = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'keyCode', { value: 39 }); // right: next node
    document.querySelector('#backGo').dispatchEvent(evt);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(jsdomErrors, [], 'no script errors while navigating');
    const svg = boardSvg(document, 'backGo');
    assert.equal(
      svg.querySelectorAll('g:not([opacity]) circle[r="17.6"]').length,
      1,
      'go-trainer ring marks the last move'
    );
    assert.equal(
      svg.querySelectorAll('g:not([opacity]) circle[r="46"]').length,
      0,
      'no CR circle on the last move'
    );
  });

  it('comment box shows the current node comment', async () => {
    const { window, document } = loadCard('back', fixture('corner-life'));
    assert.equal(backCommentText(document), '', 'setup has no comment');
    await clickPoint(window, 'backGo', 3, 2); // B[cb] CORRECT leaf
    assert.ok(backCommentText(document).includes('CORRECT'));
  });

  it('keeps the front random variation (transposed boards match)', () => {
    const { document } = loadCard('back', fixture('corner-life'), {
      seedPersistence: { rnd: true, var: 4 },
    });
    assert.deepEqual(boardSize(boardSvg(document, 'backGo')), { x: 4, y: 5 });
  });

  it('full front-to-back journey carries variation and result', async () => {
    const front = loadCard('front', fixture('corner-life'));
    await clickPoint(front.window, 'frontGo', 3, 2); // solve on the front
    const seed = {
      solvedColour: front.window.Persistence.getItem('solvedColour'),
      rnd: front.window.Persistence.getItem('rnd'),
      var: front.window.Persistence.getItem('var'),
    };
    assert.equal(seed.solvedColour, 'limegreen');
    const back = loadCard('back', fixture('corner-life'), { seedPersistence: seed });
    assert.deepEqual(boardSize(boardSvg(back.document, 'backGo')), { x: 5, y: 4 });
    const border = back.document.querySelector('#backGo .besogo-board').style.border;
    assert.ok(border.includes('limegreen'), `border shows result, got: ${border}`);
  });
});

describe('smoke: every fixture loads cleanly on both sides', () => {
  const names = ['corner-life', 'side-capture', 'center-fight', 'white-to-move', 'small-9x9', 'full-board', 'deeper-tree', 'markup-labels'];
  for (const name of names) {
    for (const side of ['front', 'back']) {
      it(`${side}: ${name}`, () => {
        const boardId = side === 'front' ? 'frontGo' : 'backGo';
        const { document, jsdomErrors } = loadCard(side, fixture(name));
        assert.deepEqual(jsdomErrors, [], 'no script errors');
        assert.ok(boardSvg(document, boardId), 'board rendered');
      });
    }
  }
});
