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

## Autoplay, handballs and reduced teams

The Autoplay switch is off by default. When enabled, each major-event popup remains visible for two seconds before resuming. Opening a review cancels the timer so it remains available until the viewer explicitly resumes. Turning Autoplay off cancels the pending automatic resume.

Two yellows dismiss a player. Direct reds occur on 1% of simulated fouls; yellow-card outcomes occupy the next 35% of the card roll. Handballs can lead to free kicks outside the penalty area or penalties inside it.

After a dismissal, remaining outfield players redistribute across formation rows: attacking slots are sacrificed first to preserve defensive and midfield coverage. Shirt numbers and skill ratings stay fixed. The scoreboard shows the adjusted formation and remaining player count.

The live badge has been removed and the original responsive pitch aspect ratios restored.

## Continuous tackles and animated set pieces

A foul has a single stopping event with offender, victim, disciplinary outcome and awarded restart. Card and award records remain in the event feed and stats but do not trigger additional popups. Tackles remain key events for review without stopping open play; the pitch briefly marks the counterattack location.

Corners can result from a keeper deflecting a shot over the goal line. Corner deliveries, free kicks and penalties use a dedicated run-up state: the ball stays stationary and all other players hold their arranged positions while the taker approaches. At contact, a quick ball flight begins and normal player movement resumes. Penalties place the keeper on the goal line and outfield players outside the area; free kicks use a wall, and corners gather players in the box.

Match stats include fouls committed, tackles won, yellow cards, red cards and corners. A second yellow counts as a yellow plus a dismissal.

## Ball-led incidents and restarts

A foul now requires the current carrier to control the ball and a defender to reach contact distance. A challenge animation closes the remaining gap before the foul or clean tackle is resolved. The free-kick location is the ball's position at that contact (penalties intentionally use the penalty spot).

Throw-ins are generated by a carrier moving into a wide channel and taking a heavy touch. The ball visibly rolls across the touchline before the event is awarded. Keeper deflections similarly travel over the goal line before a corner is awarded. Restart takers approach the dead ball, collect it, carry it to the restart spot when needed, step back, then deliver. Player setup uses bounded movement rather than replacing their positions instantly.

Winning possession after a defended free kick or corner gives a temporary +0.06 open-play scoring estimate, capped at 0.88. The opportunity lasts eight seconds of play and ends on a possession loss, stoppage or expiry. This is a deliberate synthetic transition heuristic, not a calibrated statistical claim.

## Quieter stoppages and continuous kickoff resets

Fouls now occupy 4.5% of an eligible close-contact action roll (including 0.5% for handball), with clean tackles using the remaining contact outcomes. Throw-ins remain restricted to wide positions and actual ball crossings. Their frequency is tuned to stay slightly above the prior version while other stoppages decrease.

On a heavy touch, only the ball rolls toward and over the touchline. The last-touch player stays infield; an opponent then approaches the line, collects the dead ball and throws it to a teammate. Throw-in deliveries have a small airborne arc.

After a goal popup is resumed, all active players walk into kickoff positions in their own halves. The ball moves continuously back to the centre. The conceding side restarts with a short pass only once the reset is complete, then normal movement resumes. Dismissed players do not return.

## Selective set-piece support

Goal kicks preserve every other player's current position; only the keeper collects and takes the kick. Penalties preserve the current spread, move the keeper to the goal line, and minimally clear players who are inside the area, within the spot's exclusion distance, or ahead of the ball.

Attacking corners and dangerous free kicks retain three players behind the attack, favoring centre backs and wide backs. A midfielder covers the edge of the attack, and up to five selected runners move into scoring positions. Opposing midfielders and spare forwards recover to help mark the runners or form a free-kick wall; one forward remains as a counterattacking outlet. Deep free kicks use supporting midfield positions rather than a full penalty-area rush. These targets respect dismissals and are reached through the existing continuous setup animation.
