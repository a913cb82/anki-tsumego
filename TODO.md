# Next steps

- [ ] **Go-trainer stone animations (front + back).** Transcribe the
  Android animation, not the web one (GobanView has none):
  `BoardView.kt` (`placeFrame`, `shrinkScale`) driven by the
  `GameScreen.kt` fx clock.
  - Appearance / timing (identical constants): 90 ms settle on every
    placement — stone arrives at 1.33x scale, 0.462 cells above the
    point, cubic ease-out to rest; last-move ring fades in over the
    last third (k = 0.65 -> 1). Plus 150 ms capture shrink when stones
    were taken — captured stones sit full-size through the place phase,
    then shrink 1 -> 0 with smoothstep easing at *full opacity* (no
    fade). 90 ms clock plain, 240 ms with captures.
  - Unblocking, adapted (deliberate deviation): go-trainer uses one
    replaceable clock because its bot thinks first, so cutting the old
    animation is invisible. Our opponent replies in the same tick, so
    cutting would eat the player's settle every move. Use concurrent
    per-effect clocks instead: each placement spawns its own 90 ms
    settle on that stone's `<g>` wrapper (shadow rides along), each
    capture set its own shrink on overlay clones, one shared rAF driver,
    no artificial delays — replies stay instant and overlapping
    settles look like real stones landing in succession.
  - Reconcile-by-point rule (keeps it honest): on every
    navigation/redraw an effect continues only if its point still holds
    a stone of the same color, else it is dropped instantly (covers
    undo, sibling jumps, auto-advance — the role of their fx-clearing,
    but surgical). Static last-move ring always follows the latest
    move; in-flight fading rings die with their effect. Hide the static
    ring at the placing point during its settle (we hold the
    `markupLayer` reference) to avoid double-draw.
  - Capture detection is heuristic where theirs is authoritative:
    vanished opponent stones adjacent to the played point, only on
    forward navigation (move number increased). Backward/sideways nav
    snaps with no shrink. Only shrink on normal forward plays so odd
    SGFs (manual AE placements etc.) can't shrink something strange.
  - Respect `prefers-reduced-motion` (one `if`, essentially free).
  - Tests: jsdom needs rAF mocking + frame stepping; pin "overlay
    present mid-animation, rested state after clock, new nav cancels",
    plus the existing suite proving logic untouched. Verify frame cost
    on the Xiaomi (a handful of attribute writes per frame expected).
  - Both files need the hook (front/back have separate engines);
    roughly one small animation module (~150 lines) + capture-diff at
    the nav seam.

- [ ] **Decide remaining cleanup items, if any:** Delete-key
  `cutCurrent` on back, back comment/game-info editing tables.
  (Deferred before; say keep or delete.)

- [ ] **Consider unifying `svgCircle` sizes:** front CR renders at
  r=27, back at r=46 (found while fixing last-move ring precedence).
  Only visible on SGFs with non-last-move CR markup. Deliberately left
  alone — note here so it isn't mistaken for a regression later.
