# EDEN — Every match has a story.

Eden turns a synthetic football match into short commentary, answers and broadcast scripts backed by recorded events. Its browser simulator creates the match input: 22 numbered players, ball movement, events and statistics. A complete match runs for 90 seconds of playing time, representing 90 football minutes; review pauses add wall-clock time.

The simulator and statistics use deterministic code with seeded randomness. Optional AI explains the recorded action and writes analysis for broadcasters. AI does not control the match or invent its statistics.

## Current status

| Component | Status |
| --- | --- |
| Match simulator, stats, event reviews and autoplay | Implemented locally |
| Qwen3 4B through Microsoft Agent Framework | Implemented and exercised with the local model |
| BGE-small embeddings + persistent Chroma cosine retrieval | Implemented and exercised with real local embeddings |
| Direct answers and draft/edit workflow | Implemented and exercised locally |
| Browser speech controls | Implemented and exercised locally; voices depend on the device |
| Foundry / Azure OpenAI, Azure AI Search and Azure Speech | Adapters implemented and tested with simulated service responses; live verification requires your resources and credentials |
| Azure Functions and Application Insights | Optional host/export integration provided; cloud deployment and telemetry ingestion are not verified |

No live match feed is connected. Match inputs are synthetic, with fictional teams and numbered players. This is a prototype; scoring estimates and tactical interpretations are not validated real-world football predictions.

## Run locally

Requires **Node.js 22 or later**. From the repository root:

```powershell
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). Choose **Run The Simulation**, name both teams, select formations and start the match. The simulator and calculated summaries can run without a language model.

Keep the terminal open while using Eden. Press **Ctrl+C** in that terminal to stop its server. If `EADDRINUSE` reports port `4173`, another server already occupies that address. Open the existing Eden page if that is the running instance; do not launch another copy. For a different port, change `PORT` in `.env` and restart, or use another terminal:

```powershell
$env:PORT = '4174'
npm start
```

Then open [http://127.0.0.1:4174](http://127.0.0.1:4174). Restart the active server after changing backend code or `.env`; refresh the browser after frontend changes. A page refresh starts a new browser session and clears that page's match/review history.

## Enable free local AI

Install and start **Ollama**, then download the configured model:

```powershell
ollama pull qwen3:4b
```

The default storyteller uses **Microsoft Agent Framework** with Qwen. Local semantic memory also uses Python for BGE and Chroma. Install **Python 3.11+** and the pinned dependencies, then prepare the embedding model once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run setup:rag
```

On macOS/Linux, use `.venv/bin/python` instead of `.venv/Scripts/python.exe`. The application itself still starts with `npm start`; it manages the local retrieval worker automatically. `setup:rag` downloads the pinned BGE revision once. Normal app runs use its cached files. No separate Chroma server is required.

Alternatively, set `EDEN_AGENT_RUNTIME=direct` in `.env` to call the same Ollama model without the Agent Framework worker. BGE/Chroma still uses its separate Python worker. Restart Eden after changing this setting. Local inference needs sufficient computer resources and may take longer on a cold model load. No Azure credentials are needed for the local path.

## Match room features

- Five formations: **4–3–3, 4–5–1, 4–4–2, 4–2–3–1 and 3–5–2**.
- Green pitch with proper markings, red/blue numbered players, a black-and-white ball, scoreboard and clock.
- Animated passes, carries, interceptions, shots, saves, goals, fouls, handballs, free kicks, penalties, throw-ins, goal kicks and corners.
- Possession, completed passes, shots, fouls, tackles, yellow cards, red cards and corners derived from the same event simulation.
- Second-yellow dismissals, low-probability direct reds, removal from active play and adjusted formation coverage.
- Corners, free kicks, goal kicks, throw-ins and goals use one-second white-text animations without a large popup. The match pauses for the side Play button and commentary review. Fouls leading to free kicks share that presentation; penalties retain the detailed popup. Clean tackles remain reviewable without stopping play.
- **Autoplay**, off by default, resumes animated stoppages after one second and detailed popup stoppages after two seconds. Opening a review holds the pause for explicit resumption.
- Full-time confetti, preserved results and a Yes/No rematch choice. **No** keeps the match available to review.

## Ask Eden and broadcast stories

Use **Tell the story**, **Match recap**, a typed question or **Ask Eden** inside an event review. **Automatic stories** requests updates at stoppages, half-time and full-time. Requests are coalesced while another story runs; the match animation does not wait for AI.

Replies lead with a direct answer or short, ready-to-read paragraph. Choose Fan or Broadcaster on the landing screen before starting. Fan stories use shorter, everyday explanations; broadcaster scripts include a chronological match arc, supported player contributions and disciplinary context. Questions and match-wide stories use the entire time-filtered match history, not only the last minute. English, Arabic and Spanish responses are available, with an optional team focus. The pitch interface remains English. Player-focus selection is not implemented.

**Listen** uses only the clean reply. Copy buttons have been removed. Internal timestamps, actor labels and scoring-estimate boilerplate are removed from spoken copy. Supporting events, match figures, definitions and provider diagnostics are collapsed under **Evidence & details**.

The pipeline is:

1. Ingest synthetic events with stable IDs and timestamps.
2. Calculate statistics and supported question-specific facts from the whole match up to the requested moment.
3. Retrieve relevant events and possession sequences through BGE + Chroma cosine search, then construct a chronological match arc plus full-history player/team totals. The model receives a bounded evidence bundle, not an unlimited dump of the entire log.
4. Ask the active model to draft the answer or story.
5. Check its references and numbers, then run a second model pass to edit the spoken copy.
6. Check the edit and display it with evidence links. If editing fails, retain a supported draft or short factual script.

Local retrieval uses BGE-small-en-v1.5 embeddings and persistent Chroma cosine search, alongside event times, text matching and structured calculations. It does not fine-tune Qwen. An old event review excludes later events and full-time totals.

### Player questions and missing evidence

Supported rankings include recorded dribbles, recorded mistakes, possession losses, committed fouls, completed passes, shots and goals. Rankings use the full time-filtered event history, rather than only the few snippets sent to the model. Ties are explicit.

**Mistakes** is a defined proxy: recorded possession losses plus committed fouls. Cards and missed shots are not counted again as separate mistakes. This is not an overall player-performance rating. Missing attribution is disclosed; Eden does not guess who was responsible.

Supported English count/comparison questions (including translated Arabic/Spanish questions) return immediately as **Match analysis**, without waiting for the model to recalculate a known answer. Other responses use the AI draft/editor path, with a calculated answer available when model wording fails. **Match summary** identifies a factual script fallback. If a generic question cannot be answered reliably, Eden explains that limitation instead of replacing the answer with unrelated recent events. The checks reduce common errors, but do not prove every tactical interpretation correct. Small-model wording still needs human review.

## Microsoft configuration and backups

All local settings and credentials belong in the repository-root **`.env`**, which is ignored by Git and kept outside the served `dist/` directory. Use `.env.example` as the shareable template. Defaults select Qwen3 4B and local services, with **`EDEN_ALLOW_CLOUD=false`**.

| Optional service | `.env` fields |
| --- | --- |
| Microsoft model through Foundry / Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` |
| Azure AI Search | `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_INDEX`, `AZURE_SEARCH_API_KEY` |
| Azure Speech | `AZURE_SPEECH_REGION`, `AZURE_SPEECH_KEY`; `AZURE_SPEECH_VOICE` is optional |
| Azure Functions | `EDEN_FUNCTIONS_URL`, `AZURE_FUNCTIONS_KEY` |
| Application Insights | `APPLICATIONINSIGHTS_CONNECTION_STRING` |

Set `EDEN_ALLOW_CLOUD=true` to enable configured Microsoft services. With the default `auto` selectors, a fully configured Microsoft service is preferred; otherwise the local alternative is selected. Cloud services are not guaranteed free, and two model passes can add usage and latency. No resource is automatically provisioned or upgraded.

Failures can fall back from the Microsoft model to local Qwen, Agent Framework to direct Ollama, Azure Search to local retrieval, Azure Speech to browser voices, and optional Azure Functions hosting to the local API. Unsupported generated content can fall back to a short factual script or calculated answer. Provider labels and collapsed diagnostics disclose the result. Backup code is annotated **BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION**.

For resource setup, exact fallback locations, optional Functions hosting and live verification, see [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). Local operational metrics are available at [/api/metrics](http://127.0.0.1:4173/api/metrics): request count, failures, fallbacks, average latency and the most recent result. No quality percentages are claimed as measured results.

## Check and verify

```powershell
npm run check
npm run test:ai
npm run test:microsoft
npm run smoke:rag
```

`check` checks JavaScript syntax. `smoke:rag` runs actual CPU BGE/Chroma retrieval, persistence, idempotence, match/time isolation and semantic ranking checks without starting the web server. Add `--story` using `npm run smoke:rag -- --story` to also exercise the Qwen/API path; Ollama must be running. `test:ai` covers time isolation, whole-match stories, dribble comparisons, contact-based scheduled fouls across 40 seeded matches, calculated rankings, ties/missing data, evidence checks, clean spoken copy, outcome retention, provider contracts and fallbacks using simulated service responses. These commands do not establish live Azure connectivity.

With Eden and the selected model running:

```powershell
npm run smoke:ai
```

That makes a real request to the running backend and configured model; it fails if only a factual fallback is returned. Set `EDEN_TEST_URL` if the server uses a different port.

After configuring your Azure resources and enabling cloud access:

```powershell
npm run azure:setup-search
npm run verify:microsoft
```

Run `azure:setup-search` only if using Azure AI Search; it creates an index inside your existing service. `verify:microsoft` makes real calls to the model and configured Search/Speech services with backups disabled, so a local answer cannot count as Microsoft success. It can consume the resources' usage allowance. Functions deployment and Application Insights ingestion require separate Azure-environment verification.

## Simulator behavior and limitations

Players have formation-based roles and seeded individual finishing/dribbling ratings. Scoring estimates depend on role/finishing, distance, angle, pressure and the type of attempt. Penalties use a separate estimate. Values are synthetic heuristics, not calibrated xG.

Fouls require a player controlling the ball and a defender reaching contact distance. Free kicks occur at the foul location; penalties use the penalty spot. The ball must cross a boundary before a throw-in or corner is awarded. Restart takers approach and collect the dead ball; the taker runs up while other players hold their setup positions, then normal movement resumes after contact.

Goal kicks preserve other players' positions. Penalties minimally clear illegal positions. Attacking corners and dangerous free kicks retain defensive cover, while opposing midfielders and spare forwards recover to defend. Dismissed players are excluded from active selection and movement. After a goal, active players return continuously to their own halves before the conceding side restarts.

Winning possession after a defended free kick or corner temporarily adds `0.06` to the open-play scoring estimate, capped at `0.88`, for up to eight playing seconds. This is an intentional demonstration rule, not an empirically measured football effect.

Green event cards open reviews with symmetric attacking/defending context and up to four hypothetical options: up to two green attacking choices, a blue possession reset and a red risky dribble. Penalties offer only the penalty attempt. Alternatives are estimates; they do not execute another match timeline.

The engine records events and tracking frames at approximately 5 Hz. `window.eden.match` exposes the current state, `events`, `frames` and `seed` for development inspection. Coordinates use a 0–100 pitch grid with a shared clock. Frames retain the original roster entries, including inactive dismissed players; review snapshots use active players. A fixed seed, configuration and sequence of simulation time steps are reproducible; AI wording is not guaranteed reproducible.

Backend match memory is in RAM and bounded to 20 matches per process. Browser results and generated reviews last for the current page/match session, not permanent storage. No real footage analysis, licensed live-data integration or alternate-timeline rollout is implemented.

## Code map

| Location | Responsibility |
| --- | --- |
| `dist/simulator.js` | Synthetic match engine, events, tracking frames and probabilities |
| `dist/set-piece-shape.js` | Role-aware restart positioning |
| `dist/app.js`, `dist/analysis.js` | Pitch/stats rendering and deterministic event reviews |
| `dist/intelligence.js` | Ask Eden, speech controls and evidence UI |
| `dist/index.html`, `dist/styles.css` | Page structure and styling |
| `server.mjs` | Local HTTP server and optional Functions proxy |
| `server/config.mjs` | Private `.env` loading and provider selection |
| `server/memory.mjs`, `server/insights.mjs` | Match memory, retrieval context, player calculations and story outlines |
| `server/story.mjs`, `server/copy.mjs` | Model workflow, checks and clean display/spoken copy |
| `server/providers.mjs` | Microsoft/Ollama/Search/Speech adapters and backups |
| `server/telemetry.mjs` | Local operational metrics and opt-in Azure export |
| `agents/story_agent.py`, `requirements.txt` | Pinned local Microsoft Agent Framework integration |
| `azure-functions.mjs`, `host.json` | Optional Azure Functions host entry point |
| `scripts/`, `tests/` | Verification commands and automated checks |

### Fictional match setting and story coverage

During setup, choose an Eden league and regular, title-race, survival or derby stakes. These are explicitly fictional pre-match context, not real standings or permission to invent goals, assists or results. This background is supplied as a separate cited retrieval document alongside the recorded events.

“Tell the story” and recap cover opening and later turning points across the whole match. Old event reviews still stop at that event. Dribble comparisons count recorded carries, not inferred skill ratings or successful take-ons. A scheduled demo foul is introduced after 22 match minutes if no foul has occurred: an opponent approaches the actual ball carrier and the incident resolves only on contact. Other fouls remain probabilistic. Tackle, counterattack, throw-in, corner, free-kick, goal-kick and goal labels use white text with no box and animate for one second. Animated restart/goal stoppages do not blur the pitch or show the large stoppage box.

For an optional local-model narrative check without starting the web server, run `node scripts/smoke-narratives.mjs` while Ollama is running. Its output identifies whether wording came from Qwen or the factual story fallback.

The default local model is now Qwen3 4B. For a lighter, less reliable wording option, set `OLLAMA_MODEL=qwen3:1.7b` in `.env` and restart. The full-history calculated answers and factual story fallback work with either model.

### Microsoft audit and Qwen responsibilities

See [the Microsoft audit and provider map](docs/MICROSOFT-AUDIT.md) for offline verification results, cloud limitations and the exact roles of Qwen, Microsoft models, Search, Speech, Functions and monitoring. `npm run test:microsoft` runs account-free integration contracts, including optional hosting and monitoring. `npm run verify:microsoft` requires live credentials and disables service backups.

## Semantic match memory

See [docs/SEMANTIC-MEMORY.md](docs/SEMANTIC-MEMORY.md) for the English retrieval and multilingual BGE/Chroma workflow, environment settings, storage and troubleshooting. Embeddings and Chroma data are local under `.data/`, ignored by Git and excluded from Azure deployment. This persistent search index is not a browser-accessible archive of previous matches. Match snapshots still supply the authoritative event records.

### Set-piece counters

Under Eden's simulation rule, only the defending team's recovery of an opposition free kick or corner can start a counterattack. It must happen within ten playing seconds of the delivery; the same-side recovery, ordinary open-play tackles and other restarts do not qualify. An explicit counter event follows the ball win, so a generic tackle cannot overwrite its label. Qualifying counters prioritise forward passing, quicker decisions and more direct carries; the existing six-percentage-point scoring bonus lasts up to eight playing seconds while possession is retained. A dead ball, turnover or expiry ends that advantage. Ordinary tackles display **TACKLE** and play continues.

## Languages and producer review

Arabic and Spanish questions are translated into English before calculations and English BGE retrieval. Football metric terms, identities and numbers are checked. A failed question translation stops with a clear error rather than searching with a changed question. Exact calculated counts use fixed localized wording, without asking the model to rewrite numbers.

Generated English stories are translated and back-translated for evidence checks. If that fails, whole-match recaps can use a labelled localized factual script; other replies may retain checked English with a translation notice. These checks reduce errors, not guarantee perfect translations. Arabic reply cards use right-to-left layout. Listen uses the actual reply language and available voices.

Broadcaster story/review cards have **Approve**, **Reject** and **Export script**. Only approved drafts export JSON containing the text, source IDs, language, match clock and synthetic-data label. This is a local producer handoff, not a broadcast integration or persistent audit trail. Questions and fan cards do not show producer controls.

Run `npm run smoke:localization` with Ollama running for real Spanish/Arabic questions and a Spanish recap. See [the comparison](docs/PROJECT_COMPARISON.md) and [submission video script](docs/DEMO_SCRIPT.md). The final automated suite includes language, audience, producer-export and consolation-goal regressions.
