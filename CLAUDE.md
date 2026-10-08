# Legends Shootout Instant

Instant penalty-shot betting game (NHL Alumni shooter vs goalie). Structure mirrors `../iHockey`: Express static server, SCSS compiled to `public/css/style.css`, classic `<script>` files (global scope, load order matters), no bundler.

## Commands
- `npm start`: compiles SCSS, then serves `public/` on http://localhost:3001 (iHockey uses 3000).
- `npm run dev`: SCSS watch plus server auto-restart.
- `npm run images`: regenerates the player art from `Players_Series_01*/` (needs ImageMagick and cwebp).
- `npm run clips`: re-encodes `public/assets/clips/` from `Video clips/` using the cut points in `scripts/clips.txt` (needs ffmpeg).

## Layout
- `public/index.html` holds all markup. Overlays are toggled with `.visible` / `.active` classes, as in iHockey.
- `<main>` has two columns: `#stageCol` (viewer, in-game matchbar, face-off, selector) and `#betsCol` (markets, live bets, result overlay, betslip).
  - `setView('idle' | 'ingame' | 'result')` in `game.js` puts one `view-*` class on `<main>`. All showing and hiding happens in `scss/_layout.scss`.
  - **Mobile (< 1024px):** one screen at a time, as before.
  - **Desktop (≥ 1024px):**
    - Before Play, the left column is only the versus panel: big players, swapping and the "Choose your matchup" heading. The viewer is collapsed.
    - On Play, `#viewerReveal` opens (`grid-template-rows` 0fr → 1fr) and the panel scales down below it via the animatable `--stage-h` custom property. The reverse happens on New Matchup or Re-bet.
    - On the right are the markets, then the live bets, then the result, with the betslip docked at the bottom of the column.
- `scss/_backdrop.scss` draws the frosted-ice background with rink markings behind the framed layouts (≥ 480px).
- Player figures come in three helpers: `playerHTML` (full cut-out), `miniHTML` (small full body with name and role beneath, used in the matchbar, result bar and banner) and `avatarHTML` (head crop, history only).
- `public/js/`, in load order:
  - `data.js`: roster, labels, markets, `artSrc()`
  - `pricing.js`: odds model and crypto RNG, unchanged from the prototype
  - `audio.js`: Web Audio synthesised SFX (`Sfx`)
  - `scene.js`: canvas shot animation (`ShotScene`)
  - `intro.js`: face-off sting (`Intro`)
  - `clip.js`: the shooter's broadcast clip (`ShotClip`)
  - `fx.js`: result confetti (`ResultFx`)
  - `game.js`: state, round flow, betslip, Auto Play, history
- `scss/style.scss` imports the partials:
  - `_tokens` through `_overlays` are the iHockey shell, split from iHockey's `style.scss`.
  - `_player`, `_faceoff`, `_lg-*` are the Legends layer.

## Conventions
- SCSS is the source of truth. Never edit `public/css/style.css`; run `npm run sass`.
- Bump `?v=N` on the CSS/JS links in `index.html` when deploying.
- Player art lives at `assets/players/<series01|flipped>/<file>.webp` (200px tall) plus `@2x` (400px).
  - Each player's `art` field picks the variant where the shooter faces right and the goalie faces left.
  - Never mirror art with CSS: numbers and crests would read backwards.
  - `head: {x, y}` (% of the image) centres the circular avatar crops.
- Do not change pricing maths in `pricing.js` without the certified OddsGenerator spec. The parameters are placeholders from Working Spec v0.04.
- History and balance persist in `sessionStorage` (`legends_history`, `legends_balance`). The sound preference persists in `localStorage` (`legends_sound`).

## Shot presentation
- The intro sting plays over the shooter's clip (`assets/clips/<shooter file>.mp4`, 960×540, about 4.3s, silent). The clip then flash-cuts to the canvas "net cam" (`ShotScene.start({ quick: true })`), which shows the drawn outcome.
- Every source clip is a goal. Each one is cut in `scripts/clips.txt` just before the deke or release, so the footage never shows the puck crossing the line and a save can't contradict it.
- Cut points were found from the pink goal-light flash on the boards, minus 0.5s, or minus 0.9s for close-in dekes.
- Each clip shows the goalie it was recorded against (listed in `clips.txt`), not the goalie the player picked.
  - The net cam therefore wears the clip's colours. `ShotClip.kitsFor(shooter)` in `clip.js` returns the goalie kit (jersey, trim, pads, padTrim, pants, mask) and the shooter kit (jersey, trim, gloves, tape).
  - These colours were sampled from the footage. If a clip is replaced, update them.
- `scene.js` renders in three layers:
  - **Pre-rendered arena (`buildArena`):** crowd with depth-of-field blur, glass, boards with the same ads as the clips, textured ice, markings and reflections.
  - **Per-frame elements:** a 3D-shaded net with mesh bulge, a volume-shaded goalie (`vol()`, `capsule()`, `drawPad()`), the shooter's out-of-focus gloves and stick, a motion-blurred puck and particles.
  - **Post effects:** haze, slow-mo letterbox, vignette and grain.
- To review canvas frames while the browser tab is hidden, stub `requestAnimationFrame`, step its callback by hand, then read `canvas.toDataURL()`. The tab doesn't run animation frames while hidden.
- If a clip can't start within 2.5s, the full canvas scene runs instead. If it stalls, the net cam takes over at the clip's duration plus 3s.

## Dev hooks
- `?force=<outcome key>` forces every draw, to review animations. Keys: `FTL FTR FBL FBR FFH BTL BTR BBL BBR BFH` for goals, `NG NB NP NS NM` for saves and misses. It is dev-only, so strip it or disable it before certification.

## Deploy
`.github/workflows/deploy.yml` is the Hostinger FTP workflow copied from iHockey. It is manual only (`workflow_dispatch`), and `server-dir` is a TODO. Note that `dangerous-clean-slate` wipes the target folder.
