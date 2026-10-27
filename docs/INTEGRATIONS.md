# Eden AI setup and fallback guide

## Already configured for local use

All application settings are in the project-root `.env`. It is ignored by Git and is not served from `dist/`. No real keys are included. Restart `npm start` after editing it. Node 22+ loads it server-side; the browser never receives secrets.

The free local path uses `qwen3:4b` on Ollama, Microsoft Agent Framework for the storyteller, local retrieval and device speech. The model and Python dependencies must be installed; no Azure account is needed for that path. This uses local compute and is not a free cloud hosting service.

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
ollama pull qwen3:4b
npm start
```

If this machine already has these dependencies, only `npm start` and a running Ollama are needed. A cold model load can take considerably longer than subsequent requests. The default context is 4,096 tokens, with one story request processed at a time to limit memory use. An optional `EDEN_PYTHON_PATH` can point to another Python environment with the pinned requirements installed. `EDEN_AGENT_RUNTIME=direct` uses Ollama without the framework worker.

## What to fill in .env

Leave a service's fields blank to use its local alternative. `EDEN_ALLOW_CLOUD=false` blocks all Microsoft network calls even if keys exist. Set it to `true` only when you want to use your configured resources; it is an on/off gate, not a cloud spending cap.

| Service | Required .env fields | Where to obtain them |
| --- | --- | --- |
| Microsoft model through Foundry / Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` | Your model resource endpoint and key; the name of your deployed model in Foundry. |
| Azure AI Search | `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_INDEX`, `AZURE_SEARCH_API_KEY` | Your existing Search service overview and **Keys**. Use a server-side admin key for this demo's uploads/index setup. |
| Azure Speech | `AZURE_SPEECH_REGION`, `AZURE_SPEECH_KEY` | Speech resource **Keys and Endpoint**. Select F0 when available for the free allowance. |
| Azure Functions | `EDEN_FUNCTIONS_URL`, `AZURE_FUNCTIONS_KEY` | An already deployed Eden function's URL and function key. Optional; local Node hosts the same handlers by default. |
| Application Insights | `APPLICATIONINSIGHTS_CONNECTION_STRING` | Your Application Insights resource's connection string. Optional; `/api/metrics` works locally. |

The model endpoint must be a resource root such as `https://RESOURCE.openai.azure.com` or `https://RESOURCE.services.ai.azure.com`. A root ending in `/openai/v1/` is also accepted. Do not enter a Foundry project URL containing `/api/projects/`. Use a deployed model that supports chat completions and JSON object output. `AZURE_OPENAI_DEPLOYMENT` is your deployment's name, which may differ from the base model name.

When Search is configured and cloud access is enabled, run `npm run azure:setup-search` once. It creates the documented `eden-events` index inside your existing service, without provisioning any resource. Retrieval uploads the current match's events before searching. Search results are restricted to the match and requested time, then combined with the known local buildup. The Azure index uses keyword search and metadata filters. Local retrieval uses BGE embeddings and Chroma cosine search, with keyword retrieval as the final backup. It is a retrieval-augmented storytelling system, not model retraining.

`AZURE_SPEECH_VOICE` can stay blank for language-specific defaults (English, Arabic or Spanish), or name a compatible voice. Browser speech depends on installed/available voices and may not be offline on every device.

## Feature workflow

1. The simulator emits synthetic events; the browser preserves them with the same timestamps and IDs used by the pitch.
2. The backend receives a snapshot every two seconds and with every story request. Event IDs make syncing idempotent.
3. BGE and Chroma retrieve relevant event/possession passages using match, time, player and team filters, while a chronological match arc preserves whole-match coverage. Deterministic code computes event totals, supported player rankings and limited shot/wide-channel patterns at the requested time. Rankings use the entire time-filtered event history, not only retrieved snippets.
4. A factual story outline identifies a key moment, its recorded buildup and a supported response. Microsoft Foundry/Azure OpenAI, or local Qwen through Microsoft Agent Framework, writes a short JSON draft for broadcaster analysis, the chosen team focus. A second model pass edits checked sentences into short, ready-to-read copy, using a factual reference script so it cannot omit the central outcome. It uses the same active provider, and may add latency/token usage. If editing fails, the supported draft is retained; if the draft drops the central moment, a short factual script is shown instead. Cloud models may perform differently, but merely switching to Microsoft does not guarantee a particular speed or writing quality.
5. Deterministic checks reject unknown references, inconsistent numeric facts and common invented football actions. A bad sentence is withheld without discarding other supported sentences. Local drafts with no supported sentences get one bounded repair attempt. These checks do not establish every tactical claim as true, and lexical checks cannot cover all paraphrases perfectly.
6. The interface displays the answer or spoken script first, with a **Listen** control. Match figures, evidence, definitions and provider diagnostics are collapsed under **Evidence & details**. Speech reads the clean script only; internal timing/actor labels and scoring estimates are removed.

Questions such as **Which player made the most mistakes?** use a defined proxy: recorded possession losses (intercepted passes, clean dispossessions, heavy touches out for a throw) plus committed fouls. Cards and missed shots are not counted again as mistakes. Ties are explicit. Where an older event lacks attribution, the result is marked incomplete or unanswerable rather than guessing a player. Limited legacy attribution is recovered only from unambiguous literal event wording. New events preserve `lostTeam`, `lostPlayer`, `offenderTeam` and `offender` alongside the original action.

Supported rankings also include completed passes, shots, goals, fouls and possession losses; team-ranking questions aggregate those same facts. Generic questions still use the model and relevant context. If no reliable answer is available, the question receives a direct explanation of that limitation, never an unrelated recent-event dump. The definition and supporting incidents remain inspectable without being read aloud. A calculated answer can work even while the model is unavailable, and is labeled **Match analysis**.

The Agent Framework integration is one storyteller agent with a deterministic retrieval/validation pipeline. It is not presented as a multi-agent system. The model never drives the simulator or changes stats. No video detection or alternate match simulation is performed by the AI.

Use **Automatic stories** to generate at stoppages, half-time and full-time. Otherwise use **Tell the story**, **Match recap**, the question box, or **Ask Eden** inside event review. Automatic requests are coalesced while a story is running; gameplay stays responsive and does not wait for AI. An old event review cannot access later events or full-time totals.

Match memory is in RAM, bounded to 20 matches per server process. Browser stories/reviews remain for the current page session and are reset by a new match. It is not permanent storage. A full snapshot accompanies every request so a restarted/other Azure worker can answer without relying on its earlier in-memory state. The API is a local prototype; Internet deployment would need user authentication, request budgets and durable storage before production use.

## Exact fallback locations

Search the repository for `BACKUP FOR TESTING PURPOSES AND SMOOTH EXECUTION`.

| Location | Primary failure / unavailable service | Backup |
| --- | --- | --- |
| `server/providers.mjs`, `generate()` | Microsoft model HTTP/auth/timeout failure | Local Qwen through the selected local runtime |
| `server/providers.mjs`, `localGenerate()` | Python/framework worker fails | Same local Qwen through Ollama REST |
| `server/providers.mjs`, `retrieve()` | Azure Search upload/search fails | Local event retrieval with the same match/time boundaries |
| `server/providers.mjs`, `speech()` and `dist/intelligence.js`, `speak()` | Azure Speech fails/unavailable | Available device/browser voices |
| `server/story.mjs`, `tellStory()` | Unsupported model story | Local correction attempt; ultimately a short clean match summary, calculated answer, or explicit insufficient-evidence reply |
| `server.mjs`, `handleAPI()` | Optional Azure Functions backend fails | Same API handlers run locally |

Microsoft services are selected by `auto` only when cloud calls are enabled and that service is fully configured. Set selectors to `ollama`, `local` and `browser` to explicitly choose the local services even with cloud enabled. `EDEN_ENABLE_FALLBACK=false` makes configured provider failures fail visibly for verification. The unconfigured `auto` selection still chooses local providers by design. It never selects an unconfigured paid service. Telemetry uses local counters if its optional Azure exporter cannot initialize; an initialized exporter is not proof that Azure ingested its telemetry.

## How to verify

1. Run `npm start` and open `http://127.0.0.1:4173`.
2. Start a match. **Local AI ready** means Ollama is reachable and the configured model is installed; it is a readiness check, not a completed generation check.
3. Let a few events happen. Select broadcaster mode and click **Tell the story**. The paragraph should be ready to read aloud, with no raw event labels or stats panel above it. A successful local response names **Local Qwen3**; framework/provider details and supporting events are inside **Evidence & details**. **Match summary** and **Match analysis** badges identify deterministic alternatives.
4. Open a green event and click **Ask Eden** in its review. Its displayed minute must be that event's time. Close/reopen it to confirm its generated review is retained.
5. Try a team focus, an explicit question and **Listen**. Small-model quality and available device voices vary.
6. Turn on **Automatic stories**, resume play and reach full time. The latest recap is queued if another story is still running.

Commands:

```powershell
npm run check
npm run test:ai
npm run smoke:ai
```

`test:ai` uses simulated service responses to test Microsoft request formats, cloud gating, fallbacks, grounding and time isolation; it makes no cloud calls. `smoke:ai` calls the running backend and actual configured model and fails if only original event text is returned. Set `EDEN_TEST_URL` if testing a different local port.

After filling your Microsoft model credentials, enabling cloud, and setting up Search if used, run:

```powershell
npm run verify:microsoft
```

That command uses **real configured Azure services** with fallbacks disabled and can consume their usage allowance. It tests the model and any configured Search/Speech resources. Blank optional services are reported as skipped. Azure Functions deployment and Application Insights ingestion must additionally be checked in your Azure environment. Until these live checks pass, Microsoft cloud adapters are implemented and contract-tested, not verified against your account.

## Optional Azure Functions hosting

`azure-functions.mjs`, `host.json`, the package `main` entry and `@azure/functions` provide an HTTP function named `eden`. No cloud deployment has been performed. Deploy the repository root as a Node 22 Functions app, and put its model/Search/Speech settings in the Function App's **Application settings**. `.env` is local only and ignored by Git; Azure needs its own environment settings. Keep `EDEN_FUNCTIONS_URL` blank inside the Function App itself to avoid proxy loops.

The local proxy's `.env` can then contain `EDEN_FUNCTIONS_URL=https://APP.azurewebsites.net/api/eden` and its `AZURE_FUNCTIONS_KEY`. The browser still calls the local Node server; the key stays server-side. Hosted workers cannot reach your laptop's `127.0.0.1:11434`: their local-Qwen fallback requires an Ollama service reachable from that host, or the entire request must fall back to the local Node proxy. Do not expose Ollama publicly to make that happen. Real Functions hosting is optional and is not claimed to be unlimited free.

Monitoring exports aggregate request count/duration and provider labels only, when enabled. It does not export match text, team names, prompts, answers or credentials. Model failures, fallbacks and average latency remain available from the local `/api/metrics` endpoint. Security overrides in `package.json` pin the optional monitoring dependency's identity/UUID chain; keep the lockfile when installing.

## Service references

- [Microsoft Agent Framework with Ollama](https://learn.microsoft.com/en-us/agent-framework/integrations/by-component/model-providers/ollama)
- [Azure model chat completions](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/chatgpt?pivots=programming-language-chat-completions)
- [Azure AI Search REST APIs](https://learn.microsoft.com/en-us/rest/api/searchservice/)
- [Azure Speech REST API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)
- [Azure Functions Node reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)

## Whole-match stories and fictional context

`server/insights.mjs` calculates dribble/player counts and a chronological match arc from all events available at the requested cutoff. `server/memory.mjs` adds compact player facts, the match arc, and an explicitly fictional league/scenario document to the retrieved evidence. This is retrieval augmented generation; it does not train the model or require an unlimited growing prompt. Historical reviews remain time-isolated. The landing-screen Fan/Broadcaster choice controls story length and detail. Arabic/Spanish questions pass through English translation before retrieval; outputs use verified translation or disclosed localized factual wording. Broadcaster story drafts can be approved/rejected and exported with provenance. Match events and scores must remain factual even when fictional league stakes are selected. Copy buttons were removed; Listen remains.

The account-free Microsoft audit and Qwen/provider responsibility map are in [MICROSOFT-AUDIT.md](MICROSOFT-AUDIT.md).

Local semantic setup, environment fields and diagnostics: [SEMANTIC-MEMORY.md](SEMANTIC-MEMORY.md). The default `auto` retrieval path selects configured Microsoft Search first, then local Chroma, then a labelled keyword/structured-event backup. Setting `EDEN_RETRIEVAL_PROVIDER=chroma` explicitly selects Chroma, even when Azure Search is configured.
