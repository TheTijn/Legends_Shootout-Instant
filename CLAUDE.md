# Legends Shootout Instant

Instant penalty-shot betting game (NHL Alumni shooter vs goalie). Structure mirrors `../iHockey`: Express static server, SCSS compiled to `public/css/style.css`, classic `<script>` files (global scope, load order matters), no bundler.

## Commands
- `npm start`: compiles SCSS, then serves `public/` on http://localhost:3001 (iHockey uses 3000).
- `npm run dev`: SCSS watch plus server auto-restart.
- `npm run images`: regenerates the player art from `Players_Series_01*/` and the trading cards from `PLAYERS_CARDS/` (needs ImageMagick and cwebp). `npm run images -- cards` rebuilds the cards only.
- `npm run clips [-- <slug> ...]`: re-encodes `public/assets/clips/` from `LegendShootout_MP4/` using the cut points in `scripts/clips.txt` (needs ffmpeg): the cut `<slug>.mp4` and the full-length `<slug>-full.mp4`. Pass slugs to rebuild only those clips.

## Layout
- `public/index.html` holds all markup. Overlays are toggled with `.visible` / `.active` classes, as in iHockey.
- `<main>` has two columns: `#stageCol` (viewer, in-game matchbar, face-off, selector) and `#betsCol` (markets, live bets, result overlay, betslip).
  - `setView('idle' | 'ingame' | 'result')` in `game.js` puts one `view-*` class on `<main>`. All showing and hiding happens in `scss/_layout.scss`.
  - **Mobile (< 1024px):** one screen at a time, as before.
  - **Desktop (≥ 1024px):**
    - Before Play, the left column is only the versus panel: big players, swapping and the "Choose your matchup" heading. The viewer is collapsed.
    - On Play, `#viewerReveal` opens (`grid-template-rows` 0fr → 1fr) and the panel scales down below it via the animatable `--stage-h` custom property. The reverse happens on New Matchup or Re-bet.
    - On the right are the markets, then the live bets, then the result, with the betslip docked at the bottom of the column.
- **Betslip** (`#betslip`, `scss/_betslip.scss`): the layout and stake system from Instant Racing (`../iRacing`).
  - Every bet carries its own `stake`. The "Stake per bet" chips ($1–$50, `STAKE_CHIPS`) and the Other field set all of them, and `state.stake` is the stake for new bets. Each ticket's − / + walks the chips (`stepStake()`), and its middle takes a typed amount, clamped to `MIN_STAKE`–`MAX_STAKE`.
  - The foot shows Max return (the best single outcome, `maxPayout()`), Auto and Place bet with the slip cost.
  - Phones: a bottom sheet. The bar (count, total) and foot stay up; tapping the bar opens the panel over a scrim (`setSlipOpen()`). `--slip-h` pads the markets clear of it.
  - Open, the tickets scroll at the top of the panel and the "Stake per bet" chips sit at its bottom, just above the foot.
  - Desktop: docked at the bottom of the bets column, expanded by default. The bar collapses and expands it there too, and a collapse is remembered for the session (`legends_slip_open` in `sessionStorage`). With no bets only the bar and the foot show.
- `scss/_backdrop.scss` draws the frosted-ice background with rink markings behind the framed layouts (≥ 480px).
- Player figures come in three helpers: `playerHTML` (full cut-out), `miniHTML` (small full body with name and role beneath, used in the matchbar, result bar and banner) and `avatarHTML` (head crop, history only).
- The outcome card shows the deciding player as their trading card instead (`cardSrc()` in `data.js`, `.lgo-card`): the shooter on the left for goals and misses, the goalie on the right for saves.
- `public/js/`, in load order:
  - `data.js`: roster, labels, markets, `artSrc()`
  - `pricing.js`: odds model and crypto RNG, unchanged from the prototype
  - `audio.js`: Web Audio synthesised SFX (`Sfx`)
  - `intro.js`: face-off sting (`Intro`)
  - `outcome.js`: the animated outcome card shown when the clip ends (`Outcome`)
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
- Trading cards live at `assets/players/cards/<file>.webp` (480px tall) plus `@2x` (960px), built from `PLAYERS_CARDS/<First Last>.jpg`. Skip `CARDS.jpg`: it is the contact sheet, and its names have typos.
  - Each player's `art` field picks the variant where the shooter faces right and the goalie faces left.
  - Never mirror art with CSS: numbers and crests would read backwards.
  - `head: {x, y}` (% of the image) centres the circular avatar crops.
- Do not change pricing maths in `pricing.js` without the certified OddsGenerator spec. The parameters are placeholders from Working Spec v0.04.
- History and balance persist in `sessionStorage` (`legends_history`, `legends_balance`). The sound and results-mode preferences persist in `localStorage` (`legends_sound`, `legends_results_mode`).

## Shot presentation
- The shot is video only, and every clip has commentary. The intro sting plays over the shooter's clip (`assets/clips/<file>.mp4`).
  - Clips come from `LegendShootout_MP4/`: 640×360, 5.5–7.2s from the first word of the call, stereo AAC at -18 LUFS.
  - Only Messier, Yzerman, Clarke, Savard and Sundin have their own clip. The other shooters borrow the clip whose kit looks closest (`BORROW` in `clip.js`).
  - Clips play with sound when the sound toggle is on, and fall back to muted if autoplay with sound is refused. The clip's own arena sound carries the build-up (there is no synthesised crowd bed).
  - The old silent clips (`Video clips/`) are no longer used.
  - Source names are `<shooter id>_<goalie id>_<take><result>.mp4`, using the roster ids in `data.js`.
- When the clip ends, the frame freezes with a flash and `Outcome.show()` (`outcome.js` + `scss/_lg-outcome.scss`) sweeps an animated card over the viewer:
  - **Goal:** the shooter and GOAL! on the left; on the right an SVG goal with the five target areas, where the puck flies in and lands in the scored area, which lights up with a net ripple.
  - **Miss:** the same goal with the puck going wide or over, or ringing off the post or crossbar with sparks (`variant: 'post'`).
  - **Save:** SAVE! with the goalie and the save type.
  - Outcome sounds are timed to the puck landing (`Outcome.IMPACT_MS`). The result screen follows after `REVEAL_HOLD`.
- **Real results (prototype):** each clip is tagged with the outcome its full source really shows (last column of `clips.txt`, `LIBRARY` in `clip.js`): Messier `FTL`, Yzerman `BBR`, Clarke `NM` (wide), Savard and Sundin `NP`.
  - In **Video** results mode (the default, see Dev hooks) the video dictates the result: `ShotClip.pick()` chooses a clip at random, never the same one twice in a row, and its tagged outcome settles the bets.
  - In the other modes the outcome is drawn first. `drawRoundOutcome()` then looks for footage of it (`ShotClip.match()`, which prefers the shooter's own or borrowed kit). Either way it returns `{ outcome, clip }`, and the clip is stored as `round.clip`.
  - With a match, the full 12s clip (`<slug>-full.mp4`) plays through the finish, the commentator's call and the aftermath, then the outcome card follows as usual. A miss with footage keeps the footage's variant (no random post).
  - Without a match, the cut clip plays and the card shows the drawn result, as below.
  - The full set of renders (every outcome, per shooter) is planned: they only need rows in `clips.txt` and `LIBRARY`. Goal areas come from the producer's file codes (`glo` = goal left top, `grb` = goal right bottom) and the commentary; they have not been checked frame by frame.
- Each cut clip stops in `scripts/clips.txt` just before the deke or release, so the footage never shows the result and the drawn outcome can't be contradicted.
  - The sources are goals, saves and misses, and the commentator calls the shot type and the result ("on the backhand", "shoots it wide"). Each cut also sits in the silent gap before the first such word; the safe last words are listed in `clips.txt`.
  - The commentary never names a player, so a borrowed clip never names the wrong one.
- Each clip shows the goalie it was recorded against (listed in `clips.txt`), not the goalie the player picked.
- If a clip can't start within 2.5s, the outcome card runs over its poster frame. If it stalls, the reveal happens 3s after the clip should have ended (its real duration once the metadata loads, 12s for a full clip before that).
- All round timing is timer-driven, so a round still settles in a background tab.

## Dev hooks
- **Settings menu** (gear, next to sound): switches results between **Video** (the default), **Maths** (correct maths, drawn from the priced odds) and **Forced**.
  - In video mode every round plays a full clip and the clip's real result settles the bets (see Real results above). With five clips that is 2 goals, 1 miss and 2 saves in every 5 rounds, whatever the matchup. Wins pay the priced odds, so it is prototype only and must be removed or disabled before certification.
  - In forced mode, rounds alternate goal, save, goal…, starting with a goal whenever the mode is switched on. Within each, the shot type and area (or the save type) is drawn from the priced odds, renormalised, from the outcomes with real footage: the shooter's own kit first, then any clip, then all outcomes if none has footage. So every forced round currently plays a full clip. Misses never come up.
  - Wins still pay the normal odds, so it is a demo mode only and must be removed or disabled before certification.
  - The mode persists in `localStorage` (`legends_results_mode`; no stored value means video), the alternation in `sessionStorage` (`legends_forced_next`). `drawRoundOutcome()` in `game.js` applies it; `pricing.js` is untouched.
  - A gold dot on the gear shows forced mode is on.
- `?dev` shows the **Pricing model** panel (Σ in the header), where RTP and the log5 baseline can be changed live. Without the flag the button is hidden and unbound. Strip it before certification.
- `?force=<outcome key>` overrides both modes and forces every draw, to review animations. Keys: `FTL FTR FBL FBR FFH BTL BTR BBL BBR BFH` for goals, `NG NB NP NS NM` for saves and misses. It is dev-only, so strip it or disable it before certification.

## Deploy
`.github/workflows/deploy.yml` is the Hostinger FTP workflow copied from iHockey. It is manual only (`workflow_dispatch`), and `server-dir` is a TODO. Note that `dangerous-clean-slate` wipes the target folder.
