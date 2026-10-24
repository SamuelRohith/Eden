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

## Event reviews and player probabilities

Players receive a formation-based role and an individual finishing rating (role baseline plus seeded variation). Open-play scoring estimates include finishing, goal distance, lateral angle and nearby opponents. Penalties use a separate estimate. These are demo heuristics, not calibrated football probabilities or xG.

Fouls can lead to free kicks, penalties, yellows, direct reds or second-yellow dismissals. Dismissed players remain in the match record but are excluded from movement and selection. Throw-ins and goal kicks stop play and resume from the restart location.

Key events appear green with a Review moment button. The match clock and player motion freeze until Play is pressed. The review panel preserves the event's positions and shows estimated shooting, passing and dribbling options (penalties only offer the penalty attempt). These options do not execute an alternate timeline. Shot and goal reviews share the pre-shot decision snapshot.

The match lasts 90 seconds of playing time, plus as much review time as you need. All logic and commentary remain browser-local and rule based; no AI service or API keys are used.

## Broadcast pause and review

Major events pause after they complete (shots finish travelling before their goal or restart outcome stops play). A small pitch overlay offers Resume or Review. Green commentary cards are clickable and keyboard accessible without a separate review button.

The large review dialog uses two symmetric sections for attacking build-up and defending context, derived from recorded passes, carries and saved positions. It offers at most four actions with at most two green choices and a red possession-reset choice. Percentages estimate scoring directly or through a hypothetical follow-up shot; they are uncalibrated heuristics, not real-world probabilities. Penalties only offer the valid penalty action.

Reviews are cached by event ID and remain accessible during and after the match, until another match starts or the page is refreshed. Closing review leaves play paused with a separate Resume control. There is no duplicate pitch in the review.
