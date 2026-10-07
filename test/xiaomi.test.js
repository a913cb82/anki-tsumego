'use strict';
// Xiaomi 15 Ultra portrait repro on a faithful AnkiDroid mock.
// AnkiDroid reviewer facts (verified against AnkiDroid source): card HTML
// goes in <div id="content"> (there is NO #qa), no viewport meta is
// honoured (useWideViewPort unset), night_mode drives the background.
// Needs a real layout engine: `npm i -D playwright` then
// `npx playwright install chromium`. Skips without it, so `npm test`
// stays green everywhere.
// Run: npm test  (node --test test/)
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let playwright = null;
try {
  playwright = require('playwright');
} catch {
  // Skip below: no layout engine installed.
}

const root = path.join(__dirname, '..');
const FRONT = fs.readFileSync(path.join(root, 'front.html'), 'utf8');
const BACK = fs.readFileSync(path.join(root, 'back.html'), 'utf8');
const CSS = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
let http = null;
try {
  http = require('node:http');
} catch {
  // Skip below: no local server available.
}
// Minimal AnkiDroid reviewer shell (flashcard.css relevant rules first,
// card styling ::style:: second, exactly like the device cascade).
const DROID_CSS =
  'body{margin:0;padding:0}body.night_mode{color:white;background-color:black}' +
  '#content{margin:0.5em}';

function fixture(name) {
  return fs.readFileSync(path.join(root, 'test', 'fixtures', `${name}.sgf`), 'utf8').trim();
}

function ankidroidPage(cardHtml) {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    DROID_CSS +
    '</style><style>' +
    CSS +
    '</style></head><body class="night_mode"><div id="content" dir="auto">' +
    cardHtml +
    '</div></body></html>'
  );
}

describe('xiaomi 15 ultra portrait (ankidroid mock, 412x915)', () => {
  let browser = null;
  let server = null;
  let baseUrl = null;

  before(async () => {
    if (!playwright || !http) return;
    try {
      browser = await playwright.chromium.launch();
    } catch {
      browser = null; // No browser binaries: tests skip below.
      return;
    }
    // localhost origin so the card's sessionStorage seeding works.
    server = http.createServer((req, res) => {
      const params = new URL(req.url, 'http://x').searchParams;
      const name = params.get('fixture') || 'corner-life';
      const sgf = fixture(name);
      const card =
        params.get('side') === 'back'
          ? BACK.replace('{{SGF}}', sgf)
          : FRONT.replace('{{text:SGF}}', sgf).replace('{{SGF}}', sgf);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(ankidroidPage(card));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/`;
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // Seed the session like a device where the front ran first (it stores
  // rnd=true and the orientation var the back then reuses).
  async function seedSession(page, seedVar) {
    await page.addInitScript((v) => {
      sessionStorage.setItem('github.com/SimonLammer/anki-persistence/rnd', 'true');
      sessionStorage.setItem('github.com/SimonLammer/anki-persistence/var', String(v));
    }, seedVar);
  }

  async function load(t, sgfName, seedVar) {
    if (!browser) return t.skip('playwright chromium not installed');
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    if (seedVar !== undefined) await seedSession(page, seedVar);
    await page.goto(`${baseUrl}?fixture=${sgfName}`);
    await page.waitForTimeout(600);
    return page;
  }

  async function boardBox(page, goId = '#frontGo') {
    return page.evaluate((sel) => {
      const board = document.querySelector(`${sel} .besogo-board`);
      const r = board.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        viewport: window.innerHeight,
      };
    }, goId);
  }

  async function loadBack(t, sgfName, seedVar) {
    if (!browser) return t.skip('playwright chromium not installed');
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    if (seedVar !== undefined) await seedSession(page, seedVar);
    await page.goto(`${baseUrl}?side=back&fixture=${sgfName}`);
    await page.waitForTimeout(600);
    return page;
  }

  it('tall crop fits on screen: no top gap, no scroll needed', async (t) => {
    // 13x5-class problem: rows are the limiting factor.
    let page = null;
    let box = null;
    for (let v = 0; v < 8; v++) {
      const p = await load(t, 'side-capture', v);
      if (!p) return; // skipped
      const b = await boardBox(p);
      if (b.height > b.viewport * 0.9) {
        page = p;
        box = b;
        break;
      }
      await p.close();
    }
    assert.ok(page, 'found a tall orientation');
    assert.ok(box.top >= -1, `board starts at top, got ${box.top}`);
    assert.ok(box.top <= 120, `no big empty space above, got ${box.top}`);
    assert.ok(
      box.bottom <= box.viewport + 1,
      `whole board visible without scrolling, bottom=${box.bottom} viewport=${box.viewport}`
    );
    await page.close();
  });

  it('back zoom matches front zoom on the same tall crop', async (t) => {
    let seed = null;
    let frontBox = null;
    for (let v = 0; v < 8; v++) {
      const p = await load(t, 'side-capture', v);
      if (!p) return; // skipped
      const b = await boardBox(p);
      if (b.height > b.viewport * 0.9) {
        seed = v;
        frontBox = b;
        await p.close();
        break;
      }
      await p.close();
    }
    assert.ok(seed !== null, 'found a tall orientation');
    const back = await loadBack(t, 'side-capture', seed);
    if (!back) return; // skipped
    const backBox = await boardBox(back, '#backGo');
    assert.ok(
      Math.abs(backBox.width - frontBox.width) <= 2,
      `same zoom, front w=${frontBox.width} back w=${backBox.width}`
    );
    assert.ok(
      Math.abs(backBox.height - frontBox.height) <= 2,
      `same zoom, front h=${frontBox.height} back h=${backBox.height}`
    );
    await back.close();
  });

  it('front leaf note stays visible under the board', async (t) => {
    const page = await load(t, 'corner-life', 0);
    if (!page) return; // skipped
    await page.evaluate(() => {
      const svg = document.querySelector('#frontGo svg');
      const d = svg.querySelector('path.besogo-svg-lines').getAttribute('d');
      const nums = d.match(/[\d.]+/g).map(Number);
      const ys = [...new Set(nums.filter((_, i) => i % 2 === 1))].sort((a, b) => a - b);
      const rects = [...svg.children].filter(
        (el) => el.tagName.toLowerCase() === 'rect' && el.getAttribute('opacity') === '0'
      );
      rects[(3 - 1) * ys.length + (2 - 1)].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    await page.waitForTimeout(500);
    const note = await page.evaluate(() => {
      const m = document.querySelector('#content .besogo-comment');
      const r = m.getBoundingClientRect();
      return { text: m.innerText, height: r.height };
    });
    assert.ok(note.text.includes('CORRECT'), `verdict shows, got ${note.text}`);
    assert.ok(note.text.includes('Total Errors'), `error count shows, got ${note.text}`);
    assert.ok(note.height > 0, 'note takes space (visible, not display:none)');
    await page.close();
  });

  it('back leaf note shows in the comment box', async (t) => {
    const page = await loadBack(t, 'corner-life', 0);
    if (!page) return; // skipped
    await page.evaluate(() => {
      const svg = document.querySelector('#backGo svg');
      const d = svg.querySelector('path.besogo-svg-lines').getAttribute('d');
      const nums = d.match(/[\d.]+/g).map(Number);
      const ys = [...new Set(nums.filter((_, i) => i % 2 === 1))].sort((a, b) => a - b);
      const rects = [...svg.children].filter(
        (el) => el.tagName.toLowerCase() === 'rect' && el.getAttribute('opacity') === '0'
      );
      rects[(3 - 1) * ys.length + (2 - 1)].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    await page.waitForTimeout(500);
    const note = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('#backGo .besogo-comment div')];
      return boxes.map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent, height: r.height };
      });
    });
    const shown = note.find((n) => n.text.includes('CORRECT'));
    assert.ok(shown, `note shows, got ${JSON.stringify(note)}`);
    assert.ok(shown.height > 0, 'note takes space (visible)');
    await page.close();
  });

  it('back panels hug content (no dead space below the tree)', async (t) => {
    const page = await loadBack(t, 'corner-life', 0);
    if (!page) return; // skipped
    await page.evaluate(() => {
      const svg = document.querySelector('#backGo svg');
      const d = svg.querySelector('path.besogo-svg-lines').getAttribute('d');
      const nums = d.match(/[\d.]+/g).map(Number);
      const ys = [...new Set(nums.filter((_, i) => i % 2 === 1))].sort((a, b) => a - b);
      const rects = [...svg.children].filter(
        (el) => el.tagName.toLowerCase() === 'rect' && el.getAttribute('opacity') === '0'
      );
      rects[(3 - 1) * ys.length + (2 - 1)].dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });
    await page.waitForTimeout(500);
    const panels = await page.evaluate(() => {
      const p = document.querySelector('#backGo .besogo-panels');
      const pr = p.getBoundingClientRect();
      const kids = [...p.children].map((n) => n.getBoundingClientRect().height);
      return { height: pr.height, kids };
    });
    const content = panels.kids.reduce((a, b) => a + b, 0);
    assert.ok(
      panels.height - content <= 12,
      `panels hug content, dead=${panels.height - content}`
    ); // 3px kid margins only, no forced-height dead space
    await page.close();
  });

  it('short crop is vertically centred', async (t) => {
    const page = await load(t, 'corner-life', 0);
    if (!page) return; // skipped
    const box = await boardBox(page);
    const center = (box.top + box.bottom) / 2;
    assert.ok(
      Math.abs(center - box.viewport / 2) <= 60,
      `board centred, center=${center} viewport=${box.viewport}`
    );
    await page.close();
  });
});
