# Anki Go/Tsumego Note Type

A feature-rich Go (Weiqi/Baduk) problem template for Anki, designed for practicing tsumego with modern conventions and automatic board handling.

This project originated from [TowelSniffer/Anki-go](https://github.com/TowelSniffer/Anki-go) and utilizes a modified version of the [besogo](https://yewang.github.io/besogo/) editor.

## Features

- **Automatic Cropping**: Detects stone bounds in the SGF and crops the board to fit, adding 1-intersection padding.
- **Open Edges**: Cropped edges that are not true board boundaries are rendered without lines, following standard tsumego book conventions.
- **Random Transformations**: Supports 8 variations (horizontal/vertical flips and transpositions) to prevent memorizing coordinates.
- **Solution Highlighting**: The analysis tree on the back highlights all paths leading to a correct solution (comments starting with "CORRECT" or "RIGHT").
- **Interactive Analysis**: Full analysis board on the backside to explore variations.
- **Mistake Tracking**: Changes the board border color to indicate mistakes based on SGF comments ("INCORRECT", "WRONG", "FAIL").
- **Cross-Platform**: Works offline on Anki Desktop and Ankidroid (iOS likely supported).
- **No Addons Required**: Pure HTML/JS/CSS implementation.

## Installation

### 1. Create the Note Type
1. In Anki, go to **Tools** -> **Manage Note Types**.
2. Click **Add** -> **Add: Basic**.
3. Name it "Tsumego (Besogo)".
4. Click **Fields...** and ensure you have a field named `SGF`.

### 2. Populate Templates
1. Select the note type and click **Cards...**.
2. **Front Template**: Paste the content of `front.html`.
3. **Back Template**: Paste the content of `back.html`.
4. **Styling**: Paste the content of `style.css`.

### 3. Media Files (Optional)
If you want to use realistic stone images:
1. Set `var realstones = true;` in the scripts.
2. Download the media assets from the original [TowelSniffer/Anki-go](https://github.com/TowelSniffer/Anki-go) repository.
3. Place the images in your Anki `collection.media` folder.

## Customization

You can find these variables near the top of the `<script>` blocks in `front.html` and `back.html`:

- `var randVar = true;`: Enable/disable random variations (flips/rotations).
- `var goFirst = true;`: Set to `true` to start from the first move of the SGF, or `false` to start after the first move (often useful to see the opponent's "last" move).
- `var realstones = false;`: Toggle between SVG stones and realistic stone images.
- `var handicap = 3;`: The number of mistakes allowed before the next correct move is shown automatically.

## Usage

When adding a card, simply paste the raw SGF text of your Go problem into the `SGF` field. Ensure your SGF comments use "CORRECT" or "RIGHT" to mark solution leaves, and "INCORRECT", "WRONG", or "FAIL" to mark failure branches.
