# Microsoft integration audit and Qwen map

Checked locally on 28 October 2026. All 65 automated tests pass, including 11 dedicated Microsoft integration checks, 8 semantic-retrieval checks and 6 set-piece/counterattack regressions. The real BGE/Chroma smoke check and the Qwen/Chroma end-to-end path also passed. Syntax checks passed for 36 JavaScript files; Python dependencies passed `pip check`. The installed Python Agent Framework and Ollama adapter imported successfully (`agent-framework-core` 1.23.0, `agent-framework-ollama` 1.0.0b261022). Cloud access was disabled and no Microsoft service credentials, Functions URL or monitoring connection were configured. No cloud deployment was performed.

## What the results establish

| Component | Checks performed | What remains unverified |
|---|---|---|
| Microsoft Foundry / Azure OpenAI | v1 URL, deployment name, key header, successful response, failure/unsupported-answer fallback, strict error propagation, project-URL rejection | Real resource access, model availability, JSON-mode support, latency, quota, writing quality |
| Azure AI Search | Index schema creation, event uploads, match/time filter, retrieval response, failed/partial uploads and local fallback | Actual index provisioning, admin-key permissions, indexing delay and search relevance |
| Azure Speech | SSML escaping, regional URL and headers, audio response, empty audio and HTTP failure handling, browser fallback | Resource key/region, chosen voice availability and actual audio quality |
| Microsoft Agent Framework | Installed Python imports; earlier local Qwen execution was exercised through the worker; framework-to-direct-Ollama fallback is tested | Azure-hosted Python/Ollama availability; the Microsoft model path currently uses REST, not this Python worker |
| Azure Functions | Installed SDK loads; Node v4 registration is syntax-checked; actual handler tested with a fresh match snapshot; malformed/oversized inputs; proxy authentication forwarding, failure fallback and cloud gate | Azure host execution, function-key enforcement by the host, deployment, scale, cold starts and persistent storage |
| Application Insights / Azure Monitor | Installed SDK exports load; injected SDK verifies metric setup and aggregate-only attributes; SDK failures and cloud gating preserve local metrics | Real exporter initialization against a connection and telemetry arriving in the Azure portal |

These are code-path and simulated-service checks, not a claim that the cloud services have been connected. `npm run test:microsoft` runs the dedicated account-free checks; `npm run test:ai` includes those checks and the rest of the application suite. SDK import checks can take several seconds on the first run.

## Important compatibility limits

- The Microsoft text adapter targets the Azure OpenAI-compatible `/openai/v1/chat/completions` interface with API-key authentication and JSON mode. Choose a deployment that supports that interface and JSON output. This does not support every model in the Foundry catalog or a Foundry project/agent endpoint.
- The Python Microsoft Agent Framework worker currently wraps **local Ollama**, while the configured Microsoft cloud model is called directly through REST. This is one drafting/editing workflow, not an implemented multi-agent team.
- Azure Search is keyword/event retrieval with match/time filtering; its local backup now uses BGE embeddings and Chroma. The Azure index is not a vector index. Calculated counts still come from the whole recorded history.
- A deployed Function App needs its own environment settings. Your local `.env` is excluded from deployment. A cloud worker cannot reach Ollama on your laptop's `127.0.0.1`; with no reachable model it can return a labelled factual summary. The local proxy retries locally on an HTTP/transport failure, not on a successful factual-summary response.
- Match memory is bounded RAM, not durable cloud storage. Complete snapshots restore story context after a worker restart; they do not provide a permanent archive.
- An initialized monitoring exporter does not prove ingestion. Check the metric in Azure after a request. The local health/metrics routes describe the local process, even when story traffic is forwarded to Functions.

## Current structure and where Qwen is used

1. `dist/simulator.js` produces synthetic positions, passes, shots, fouls and outcomes. It never calls Qwen.
2. `dist/intelligence.js` records events and sends the match snapshot plus a question/story request to the backend. The landing-screen audience choice selects fan or broadcaster phrasing. Team focus and English, Arabic and Spanish output are selectable.
3. `server/memory.mjs` and `server/insights.mjs` calculate full-history totals, player facts, a match arc and time-filtered retrieved evidence. `server/semantic.mjs` and the Python retrieval worker use CPU BGE embeddings with persistent Chroma cosine search. No model counts the dribbles or calculates the score.
4. `server/story.mjs` asks the active text provider to draft **Tell the story**, **Match recap**, **Explain this moment**, and questions not covered by a direct calculated English answer.
5. The same provider receives an editing pass. If necessary, a further bounded repair pass is requested. These are additional model calls, not model training.
6. With today's settings, `server/providers.mjs` selects Qwen3 4B through `agents/story_agent.py` and Microsoft Agent Framework. If the framework worker fails and backups are enabled, the same Qwen model is called through Ollama directly.
7. Once a compatible Microsoft deployment is configured and cloud access is enabled, the Microsoft model becomes the primary writer/editor. Qwen remains the backup for failed Microsoft requests or rejected output. It is not automatically called alongside every successful Microsoft answer.
8. English questions (including translated Arabic/Spanish questions) with supported calculated facts return immediately as **Match analysis** without calling either model. If model generation fails, a clearly labelled **Match summary** is built from recorded facts, without Qwen.
9. **Listen** uses Azure Speech when configured, otherwise browser voices. Qwen does not synthesize speech. It also does not control the pitch animation, set pieces, event-review alternatives, probability calculations, cards or match statistics.

Current local model: `OLLAMA_MODEL=qwen3:4b`. The previously installed 1.7B model remains available but is not automatically selected as another backup. Change the model setting explicitly to use it.

## Later live verification

Fill the service fields in `.env`, enable cloud access and provision the Search index if using Search. Run `npm run verify:microsoft`. That command disables the model/service backups so a local answer cannot be mistaken for Microsoft success; it tests the cloud model on one selected recorded event plus any configured Search/Speech services. Real calls may consume your allowance. Functions deployment/authentication and actual Application Insights ingestion still need separate Azure checks.

## Official references consulted

- [Azure OpenAI JSON and structured output compatibility](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs)
- [Azure AI Search REST 2024-07-01](https://learn.microsoft.com/en-us/rest/api/searchservice/documents/search-post?view=rest-searchservice-2024-07-01)
- [Azure Speech text-to-speech REST](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)
- [Azure Functions Node programming model](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
- [Azure Monitor OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable?tabs=nodejs)

## Translation and producer handoff

Qwen (or the configured Microsoft model) also translates Arabic/Spanish questions to English and generated English prose to the selected language. Back-translation is an additional check, not proof of semantic correctness. Real local tests found a dribble/tackle translation error; protected metric vocabulary and a rejection check now prevent that silent substitution. Exact calculated answers use fixed localized phrases, not model-written numbers. When narrative translation fails checks, a labelled localized factual recap or checked English is retained.

The real local Spanish and Arabic dribble checks returned correct 2-versus-1 totals. The Spanish recap used disclosed localized facts after model translation failed checks. Provider labels distinguish this from Qwen prose. This demonstrates the fallback, not successful cloud translation.

Broadcaster drafts now require local approval before exporting a script with sources and language. Approval is session-only and does not publish to a broadcaster or establish a tamper-proof audit trail.
