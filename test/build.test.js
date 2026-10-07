'use strict';
// Build pipeline tests: the generated cards must stay paste-ready and
// functionally identical to the committed templates.
// Run: npm test  (node --test test/)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function assemble(side) {
  const persist = fs.readFileSync(path.join(root, 'src/shared/persistence.html'), 'utf8');
  if (side === 'front') {
    return (
      persist +
      fs.readFileSync(path.join(root, 'src/front/config.html'), 'utf8') +
      fs.readFileSync(path.join(root, 'src/front/div.html'), 'utf8') +
      fs.readFileSync(path.join(root, 'src/front/main.html'), 'utf8')
    );
  }
  return (
    persist +
    fs.readFileSync(path.join(root, 'src/back/div.html'), 'utf8') +
    fs.readFileSync(path.join(root, 'src/back/main.html'), 'utf8')
  );
}

describe('build pipeline (Anki paste-ready output)', () => {
  it('front.html and back.html are up to date with src/ (run node build.mjs)', () => {
    assert.equal(fs.readFileSync(path.join(root, 'front.html'), 'utf8'), assemble('front'));
    assert.equal(fs.readFileSync(path.join(root, 'back.html'), 'utf8'), assemble('back'));
  });

  it('build.mjs --check passes on a clean tree', () => {
    execFileSync('node', ['build.mjs', '--check'], { cwd: root, stdio: 'pipe' });
  });

  it('built cards keep their Anki field placeholders', () => {
    const front = fs.readFileSync(path.join(root, 'front.html'), 'utf8');
    const back = fs.readFileSync(path.join(root, 'back.html'), 'utf8');
    assert.ok(front.includes('{{text:SGF}}'), 'front must render the SGF field');
    assert.ok(back.includes('{{SGF}}'), 'back must render the SGF field');
  });

  it('removed dead code stays out of the built cards', () => {
    // Dead besogo features pruned from src/: file up/download, URL fetch,
    // coordinate labels, style buttons, coord/variant toggles, photo stones.
    // Front additionally lost its unused panels and edit API. If any of
    // these reappear, something regressed (back keeps its analysis panels
    // and variant-letter machinery, which are live there).
    const deadBoth = [
      'makeFilePanel', 'composeSgf', 'saveFile', 'besogo.VERSION',
      'fetchParseLoad', 'navigatePath', 'KanJax', 'besogo.coord',
      'numberToLetter', 'drawCoords', 'drawStyleButtons', 'updateStyleButtons',
      'toggleVariantStyle', 'toggleCoordStyle', 'getCoordStyle', 'setCoordStyle',
      'COORD_MARGIN', 'msg.coord', 'options.coord', 'realstones', 'REAL_STONES', 'goFirst',
      '#0165fc', '#9a0eea', 'besogo.BLUE', 'besogo.PURP',
      'randomizeIndex', 'realStone', 'svgShadow', 'BLACK_STONES',
    ];
    const deadFrontOnly = [
      'markCorrectPaths', 'makeTreePanel', 'makeToolPanel', 'makeCommentPanel',
      'makeNamesPanel', 'checkVariants', 'markRemainingVariants', 'getVariants',
      'variantStyle', 'getGameInfo',
    ];
    const front = fs.readFileSync(path.join(root, 'front.html'), 'utf8');
    const back = fs.readFileSync(path.join(root, 'back.html'), 'utf8');
    for (const name of deadBoth) {
      const pat = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
      assert.ok(!pat.test(front), `front is free of ${name}`);
      assert.ok(!pat.test(back), `back is free of ${name}`);
    }
    for (const name of deadFrontOnly) {
      const pat = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
      assert.ok(!pat.test(front), `front is free of ${name}`);
    }
    // editor-level move editing is solve-flow-dead on front (game-tree
    // internals used by the SGF loader stay); back keeps full editing.
    for (const name of ['playMove', 'placeSetup']) {
      const hits = front.split(name).length - 1;
      const methodHits = (front.match(new RegExp(`\\.${name}`, 'g')) || []).length;
      const stringHits = (front.match(new RegExp(`'${name}'`, 'g')) || []).length;
      assert.equal(hits - methodHits - stringHits, 0, `front has no editor-level ${name}`);
    }
  });

  it('front reserves an invisible border so the leaf signal never shifts layout', () => {
    const front = fs.readFileSync(path.join(root, 'front.html'), 'utf8');
    assert.ok(front.includes('solid transparent'), 'border present but invisible mid-problem');
  });

  it('built cards stay dependency-free (no modules/externals for Anki)', () => {
    for (const file of ['front.html', 'back.html']) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(!html.includes(' type="module"'), `${file}: no modules`);
      assert.ok(!/<script[^>]*\bsrc=/.test(html), `${file}: no external scripts`);
      assert.ok(!/\b(import|export)\s+[{*]/.test(html), `${file}: no ESM syntax`);
      assert.ok(!/\brequire\(/.test(html), `${file}: no CommonJS requires`);
    }
  });

  it('shared persistence shim is identical on both sides', () => {
    const front = fs.readFileSync(path.join(root, 'front.html'), 'utf8');
    const back = fs.readFileSync(path.join(root, 'back.html'), 'utf8');
    const shim = fs.readFileSync(path.join(root, 'src/shared/persistence.html'), 'utf8');
    assert.ok(front.startsWith(shim));
    assert.ok(back.startsWith(shim));
  });
});
