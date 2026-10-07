'use strict';
// tsumego core: pure, testable mirror of the custom card logic embedded in
// front.html / back.html (checkComment, autoCropSgf bounds/padding rules,
// probVar transforms, colour normalisation).
//
// Kept dependency-free and browser-safe (no require/import at top level) so
// the same file can later be inlined into the Anki templates by build.mjs.
// In Node it exports via module.exports (guarded).

// --- comment classification (mirrors checkComment, minus the front-only
// (The card glue also records failures in the board border via
// solvedColour/Persistence; that side effect stays there.) ---
// Returns 1 for solution leaves, -1 for failure leaves, 0 otherwise.
function classifyComment(comment) {
  const goodAnswers = ['CORRECT', 'RIGHT'];
  const badAnswers = ['INCORRECT', 'WRONG', 'FAIL'];
  if (!comment) return 0;
  const upper = String(comment).toUpperCase();
  for (const answer of goodAnswers) {
    if (upper.startsWith(answer)) return 1;
  }
  for (const answer of badAnswers) {
    if (upper.startsWith(answer)) return -1;
  }
  return 0;
}

// --- SGF coordinate helpers (mirror the helpers inside autoCropSgf) ---
function charToNum(c) {
  if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 96;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 38;
  return 0;
}

function numToChar(n) {
  if (n >= 1 && n <= 26) return String.fromCharCode(n + 96);
  if (n >= 27 && n <= 52) return String.fromCharCode(n + 38);
  return '';
}

function getCoords(str) {
  if (!str || str.length < 2) return null;
  return { x: charToNum(str.charAt(0)), y: charToNum(str.charAt(1)) };
}

// Property ids that carry board coordinates (mirrors findBounds/shiftCoords).
const COORD_PROPS = ['B', 'W', 'AB', 'AW', 'AE', 'CR', 'SQ', 'TR', 'MA', 'M', 'SL', 'LB', 'L'];

// Walk a parsed-SGF-like tree { props: [{id, values}], children: [] } and
// find the bounding box of all coordinates. Faithful to the embedded
// findBounds, including quirks: no validity filtering (e.g. a pass encoded
// as 'tt' widens the box; '' values are skipped via getCoords -> null).
function findBounds(root) {
  let minX = 53, minY = 53, maxX = 0, maxY = 0;
  (function visit(node) {
    for (const p of node.props || []) {
      if (COORD_PROPS.indexOf(p.id) === -1) continue;
      for (const v of p.values || []) {
        for (const part of String(v).split(':')) {
          const c = getCoords(part.substring(0, 2));
          if (c) {
            if (c.x < minX) minX = c.x;
            if (c.x > maxX) maxX = c.x;
            if (c.y < minY) minY = c.y;
            if (c.y > maxY) maxY = c.y;
          }
        }
      }
    }
    for (const child of node.children || []) visit(child);
  })(root);
  return { minX, minY, maxX, maxY };
}

// Parse an SZ value like '19' or '5:4' (mirrors besogo.parseSize).
function parseSize(input) {
  const s = String(input).replace(/\s/g, '');
  let m = s.match(/^(\d+):(\d+)$/);
  let x, y;
  if (m) {
    x = +m[1]; y = +m[2];
  } else if (/^\d+$/.test(s)) {
    x = +s; y = +s;
  } else {
    x = y = 19;
  }
  if (x > 52 || x < 1 || y > 52 || y < 1) x = y = 19;
  return { x, y };
}

// Compute the crop for a parsed SGF root ({props, children}) given its
// original board size. Mirrors autoCropSgf's padding + snap-to-edge rules:
// 1-intersection padding, then any side within 3 of the true edge snaps out
// to that edge. Returns null when there is nothing to crop (no coordinates).
function computeCrop(root, originalSizeX, originalSizeY) {
  const { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY } = findBounds(root);
  if (bMinX > bMaxX || bMinY > bMaxY) return null;

  let minX = Math.max(1, bMinX - 1);
  let minY = Math.max(1, bMinY - 1);
  let maxX = Math.min(originalSizeX, bMaxX + 1);
  let maxY = Math.min(originalSizeY, bMaxY + 1);

  if (minX - 1 < 4) minX = 1;
  if (minY - 1 < 4) minY = 1;
  if (originalSizeX - maxX < 4) maxX = originalSizeX;
  if (originalSizeY - maxY < 4) maxY = originalSizeY;

  return {
    minX, minY, maxX, maxY,
    newSizeX: Math.max(1, maxX - minX + 1),
    newSizeY: Math.max(1, maxY - minY + 1),
    shiftX: minX - 1,
    shiftY: minY - 1,
    // true = this side IS the real board edge (line drawn); false = cropped
    // open edge (line omitted, per tsumego book conventions).
    left: minX === 1,
    right: maxX === originalSizeX,
    top: minY === 1,
    bottom: maxY === originalSizeY,
    originalSizeX,
    originalSizeY,
  };
}

// Apply the probVar flips/transposition to crop-edge info so it matches the
// displayed orientation (mirrors the probVar & 1/2/4 block in autoCropSgf).
function transformCropInfo(crop, probVar) {
  const out = { ...crop };
  if (probVar & 1) {
    const t = out.left; out.left = out.right; out.right = t;
  }
  if (probVar & 2) {
    const t = out.top; out.top = out.bottom; out.bottom = t;
  }
  if (probVar & 4) {
    let t = out.left; out.left = out.top; out.top = t;
    t = out.right; out.right = out.bottom; out.bottom = t;
  }
  return out;
}

// Map an original-board point to displayed (cropped + flipped) coordinates.
// unrotW/unrotH are the cropped dimensions BEFORE diagonal flip, mirroring
// the hoshi/redraw transform: shift, bounds-check, then probVar flips.
function transformPoint(x, y, shiftX, shiftY, unrotW, unrotH, probVar) {
  let tx = x - shiftX;
  let ty = y - shiftY;
  if (tx < 1 || tx > unrotW || ty < 1 || ty > unrotH) return null;
  if (probVar & 1) tx = unrotW + 1 - tx;
  if (probVar & 2) ty = unrotH + 1 - ty;
  if (probVar & 4) {
    const t = tx; tx = ty; ty = t;
  }
  return { x: tx, y: ty };
}

// Map an SGF coordinate to game-board coordinates under a probVar variation
// (mirrors lettersToCoords in besogo.loadSgf). size is the POST-crop size as
// stored on the node tree ({x, y}); the width/height inputs are pre-swap so
// flips apply in the SGF's own coordinate frame.
function sgfToBoard(x, y, size, probVar) {
  const width = (probVar & 4) ? size.y : size.x;
  const height = (probVar & 4) ? size.x : size.y;
  let rx = x, ry = y;
  if (probVar & 1) rx = width + 1 - rx;
  if (probVar & 2) ry = height + 1 - ry;
  if (probVar & 4) {
    const t = rx; rx = ry; ry = t;
  }
  return { x: rx, y: ry };
}

// Colour normalisation: problems whose first move is White get bit 8 set so
// Black/White swap and the problem always starts with Black (tsumego
// convention). Mirrors `if (findFirstMove(sgf) === 'W') probVar ^= 8`.
function findFirstMove(root) {
  for (const p of root.props || []) {
    if (p.id === 'B') return 'B';
    if (p.id === 'W') return 'W';
  }
  for (const child of root.children || []) {
    const first = findFirstMove(child);
    if (first) return first;
  }
  return null;
}

function shouldSwapColors(root) {
  return findFirstMove(root) === 'W';
}

const api = {
  classifyComment,
  charToNum,
  numToChar,
  getCoords,
  COORD_PROPS,
  findBounds,
  parseSize,
  computeCrop,
  transformCropInfo,
  transformPoint,
  sgfToBoard,
  findFirstMove,
  shouldSwapColors,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
