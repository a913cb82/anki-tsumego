'use strict';
// Shipped-stylesheet guards: style.css is pasted into Anki separately from
// the cards, so these pin the rules jsdom layout cannot verify.
// Run: npm test  (node --test test/)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function ruleBody(selector) {
  const m = css.match(new RegExp(selector.replace(/[#.]/g, '\\$&') + '\\s*{([^}]*)}'));
  assert.ok(m, `${selector} rule exists in style.css`);
  return m[1];
}

describe('vertical centering (safe: hugs top when overflowing)', () => {
  it('.besogo-board self-centers in the fixed-height front container', () => {
    const body = ruleBody('.besogo-board');
    assert.ok(body.includes('margin-top: auto'), 'board top margin auto');
    assert.ok(body.includes('margin-bottom: auto'), 'board bottom margin auto');
  });

  it('#frontGo safe-centers in the Anki #qa grid', () => {
    const body = ruleBody('#frontGo');
    assert.ok(body.includes('margin-top: auto'), 'front top margin auto');
    assert.ok(body.includes('margin-bottom: auto'), 'front bottom margin auto');
  });

  it('#frontGo centers a height-fitted board horizontally', () => {
    const body = ruleBody('#frontGo');
    assert.ok(body.includes('align-items: center'), 'narrowed board stays centred');
  });

  it('front control panels hug the message (buttons are hidden there)', () => {
    const body = ruleBody('#frontGo .besogo-panels');
    assert.ok(body.includes('height: auto'), 'no spacer above the board, note stays visible');
  });

  it('#frontGo hugs content instead of forcing viewport height', () => {
    const body = ruleBody('#frontGo');
    assert.ok(!body.includes('height:100vh'), 'no forced viewport height (breaks tall crops)');
  });

  it('#qa safe-centers rows (top when scrolling is needed)', () => {
    const body = ruleBody('#qa');
    assert.ok(body.includes('align-content: safe center'), 'card + message centered, top on overflow');
  });

  it('#backGo safe-centers in the Anki #qa grid', () => {
    const body = ruleBody('#backGo');
    assert.ok(body.includes('margin-top: auto'), 'back top margin auto');
    assert.ok(body.includes('margin-bottom: auto'), 'back bottom margin auto');
  });
});
