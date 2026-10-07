// Build: assembles paste-ready Anki templates from src/ parts.
//
//   node build.mjs          write front.html / back.html (+ style.css untouched)
//   node build.mjs --check  fail (exit 1) if the committed html is stale
//
// The parts are verbatim slices of the card files, so the Anki workflow is
// unchanged: copy front.html / back.html into Tools -> Manage Note Types ->
// Cards and preview exactly as before. No bundler, no modules, no external
// files land in the output: a single self-contained file per side.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));

const read = (p) => readFileSync(join(root, p), 'utf8');

function assemble(side) {
  const persist = read('src/shared/persistence.html');
  if (side === 'front') {
    return persist + read('src/front/config.html') + read('src/front/div.html') + read('src/front/main.html');
  }
  return persist + read('src/back/div.html') + read('src/back/main.html');
}

function sha(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
}

const targets = { 'front.html': assemble('front'), 'back.html': assemble('back') };

if (process.argv.includes('--check')) {
  let stale = false;
  for (const [file, generated] of Object.entries(targets)) {
    const committed = read(file);
    if (committed !== generated) {
      console.error(
        `${file} is stale (committed ${sha(committed)} vs generated ${sha(generated)}). Run: node build.mjs`
      );
      stale = true;
    } else {
      console.log(`${file} up to date (${sha(generated)})`);
    }
  }
  process.exit(stale ? 1 : 0);
} else {
  for (const [file, generated] of Object.entries(targets)) {
    writeFileSync(join(root, file), generated);
    console.log(`wrote ${file} (${sha(generated)})`);
  }
}
