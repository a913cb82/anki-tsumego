# Anki Go/Tsumego Note Type

A feature-rich Go (Weiqi/Baduk) problem template for Anki, designed for practicing tsumego with modern conventions and automatic board handling.

This project originated from [TowelSniffer/Anki-go](https://github.com/TowelSniffer/Anki-go) and utilizes a modified version of the [besogo](https://yewang.github.io/besogo/) editor.

This works with SGF from [ogs-to-anki](https://github.com/a913cb82/ogs-to-anki).

## Features

- **Automatic Cropping**: Detects stone bounds in the SGF and crops the board to fit, adding 1-intersection padding.
- **Open Edges**: Cropped edges that are not true board boundaries are rendered without lines, following standard tsumego book conventions.
- **Random Transformations**: Supports 8 variations (horizontal/vertical flips and transpositions) to prevent memorizing coordinates.
- **Color Normalization**: Automatically swaps colors if the first move is white, ensuring the problem always starts with black (following standard tsumego conventions).
- **Solution Highlighting**: The analysis tree on the back highlights all paths leading to a correct solution (comments starting with "CORRECT" or "RIGHT"), with a thicker outline for correct leaf nodes.
- **Next Move Indicators**: When exploring on the back board, possible next moves are marked with colored indicators (limegreen for correct paths, red for failures).
- **Interactive Analysis**: Full analysis board on the backside to explore variations.
- **Mistake Tracking**: Changes the board border color to indicate mistakes based on SGF comments ("INCORRECT", "WRONG", "FAIL"). Once red it stays red through completion, and the result carries to the back card.
- **Completion Feedback**: Displays leaf node comments and the total error count upon solving a problem on the front card.
- **Cross-Platform**: Works offline on Anki Desktop and Ankidroid (iOS likely supported).
- **No Addons Required**: Pure HTML/JS/CSS implementation.

## Installation

### 1. Create the Note Type
1. In Anki, go to **Tools** -> **Manage Note Types**.
2. Click **Add** -> **Add: Basic**.
3. Name it.
4. Click **Fields...** and ensure you have a field named `SGF`.

### 2. Populate Templates
1. Select the note type and click **Cards...**.
2. **Front Template**: Paste the content of `front.html`.
3. **Back Template**: Paste the content of `back.html`.
4. **Styling**: Paste the content of `style.css`.

## Customization

You can find these variables near the top of the `<script>` blocks in `front.html` and `back.html`:

- `var randVar = true;`: Enable/disable random variations (flips/rotations).
- `var handicap = 3;`: The number of mistakes allowed before the next correct move is shown automatically.

## Usage

When adding a card, simply paste the raw SGF text of your Go problem into the `SGF` field. Ensure your SGF comments use "CORRECT" or "RIGHT" to mark solution leaves, and "INCORRECT", "WRONG", or "FAIL" to mark failure branches.

## Development (tests + card sources)

The Anki workflow above is unchanged: `front.html` / `back.html` stay
paste-ready, single-file, dependency-free templates. They are **generated**
from `src/` so card logic can be tested:

```
src/shared/persistence.html  # Anki persistence shim (shared by both sides)
src/front/config.html        # front settings + mistake/completion glue
src/front/div.html           # <div id=frontGo>{{text:SGF}}</div>
src/front/main.html          # board engine + front interaction
src/back/div.html            # <div id="backGo">{{SGF}}</div>
src/back/main.html           # board engine + back analysis highlighting
src/core/tsumego.js          # pure, testable mirror of the card rules
                             # (comment markers, auto-crop, probVar flips,
                             # colour normalisation)
```

```sh
npm install   # dev-only (jsdom for card tests); never ships to Anki
npm test        # unit + build + real card flows in a DOM (+ device layout
                # tests if playwright chromium is installed:
                # npx playwright install chromium)
node build.mjs  # regenerate front.html / back.html after editing src/
```

Loop: edit `src/` -> `npm test` -> `node build.mjs` -> paste into Anki and
preview. `node build.mjs --check` fails if the committed html is stale
(use it in CI). The build is byte-identical for unchanged sources, so
diffs on `front.html` / `back.html` always reflect real behaviour changes.

`test/` holds example tsumego SGFs (`test/fixtures/*.sgf`: corner, side,
center, white-to-move, 9x9, full-board) plus three suites:

- `test/core.test.js` — rules in isolation (zero dependencies).
- `test/card-flows.test.js` — user flows through the **real cards**:
  cropped sizes, open edges, stone placement, colour swap, all 8 random
  variations, front solve/mistake flows (real clicks), Persistence
  front-to-back carry-over, back next-move indicators + tree highlighting.
- `test/build.test.js` — generated html stays paste-ready (placeholders
  intact, no modules/externals) and in sync with `src/`.
