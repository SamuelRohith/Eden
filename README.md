# EDEN — Every match has a story.

A self-contained, browser-based football simulator. A match lasts 90 real seconds, shown as 90 match minutes.

## Run locally

Requires Node.js 18 or later. No dependency installation is needed.

```sh
npm start
```

Open http://127.0.0.1:4173. Choose **Run The Simulation**, name both teams, select their formations and start the match.

## Included

- Five formations: 4–3–3, 4–5–1, 4–4–2, 4–2–3–1 and 3–5–2.
- A lined green pitch with 22 consistently numbered players, a black-and-white football, a score and a clock.
- Continuous player motion, completed passes, interceptions, shots, saves, goals and restarts.
- Possession, completed passes and total shots derived from the same simulation that moves the ball and writes the commentary.
- A final whistle after 90 seconds, confetti, preserved results and a Yes/No rematch choice. Declining keeps a separate rematch button available.
- Responsive layout, keyboard-accessible setup and reduced-motion support for confetti.

## Files

- `dist/index.html`: welcome screen, team setup and match room.
- `dist/styles.css`: blue-and-white design and responsive layouts.
- `dist/simulator.js`: seeded, rule-based synthetic match source; no DOM dependencies.
- `dist/app.js`: pitch drawing, commentary, stats and end-of-match interaction.
- `server.mjs`: minimal local static server.

The simulation records every event and 22-player tracking frames at approximately 5 Hz. `window.eden.match` exposes the current match state, its `events`, `frames` and `seed` for inspection. Each tracking frame contains all 22 player positions and velocities, plus ball position. Coordinates use a 0–100 pitch grid, left-to-right x and top-to-bottom y. Events and tracking share the same clock.

This first prototype uses simple movement and event rules; it does not claim to model real player ability or predict football outcomes. No real match data, player names or external APIs are used. A future live-data adapter can map a licensed event/tracking feed into the same match state used by the UI.

## Source checks

```sh
npm run check
```
