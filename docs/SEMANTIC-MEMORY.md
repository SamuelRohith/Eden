# English semantic match memory

Eden uses `BAAI/bge-small-en-v1.5` at revision `5c38ec7c405ec4b44b94cc5a9bb96e735b38267a` for 384-dimensional, normalized embeddings. Chroma stores the embeddings in a persistent cosine-distance collection. Qwen3 4B remains the text generator. The retrieval documents, BGE queries and evidence checks use English. Arabic and Spanish questions are translated to English first; generated replies are translated with identity, number, source and back-translation checks. Exact totals use fixed localized phrasing. A failed narrative translation uses disclosed localized facts or checked English. The main interface remains English; Arabic reply cards use right-to-left layout.

## First-run setup

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run setup:rag
npm start
```

Create `.venv` using Python 3.11+ first if it does not exist. `setup:rag` explicitly downloads the pinned model revision into the local cache. It has already been run on this computer. Normal app runs load cached model files only. A clean installation needs internet for the one-time dependency/model download; ordinary BGE embedding and Chroma search run locally. Ollama must be running with `qwen3:4b` for model-written stories.

The embedding worker runs on the CPU with two threads by default, leaving the GPU for Qwen. It stays loaded while Eden runs, and stops when the Eden server stops. No separate database service or API key is required. Python is still required for BGE even if `EDEN_AGENT_RUNTIME=direct` bypasses the Agent Framework storyteller worker.

## Data flow

1. The browser sends the complete current event snapshot every two seconds. Sync schedules indexing without waiting for it, so pitch animation is independent of embedding work.
2. `server/passages.mjs` creates short individual-event descriptions and connected possession passages. Original match IDs, timestamps, event order, teams, players and source IDs stay attached. Each sequence contains at most three events and is bounded in text size; the model input ceiling is 512 tokens.
3. `server/semantic.mjs` maintains one Python worker and coalesces queued snapshots. The worker skips unchanged document hashes, embeds new or changed passages in batches and removes obsolete partial-sequence versions. Completed event passages do not get re-embedded on every question.
4. The query receives BGE's recommended retrieval instruction; stored passages do not. Query and passages use the same pinned model. Chroma searches by cosine distance, filtered to the match and the selected time/event-order boundary. Explicit team names and player numbers add exact filters.
5. Retrieved source IDs are checked again against the authoritative match/time-filtered events and inserted before recency-only filler. The generator sees original recorded events and calculations, not untrusted generated summaries as new facts. Retrieved possession IDs refer back to their component events.
6. Qwen or the configured Microsoft model drafts and edits an English response. Existing evidence checks and labelled factual fallbacks still apply.

Similarity means relevance, not causality, a scoring probability or proof of a tactical claim. A similarity search always has nearest neighbours; the generator must still acknowledge missing evidence. This implementation has not been benchmarked as a football-specific retrieval model.

## Counts and whole-match stories

Known count/comparison questions use exact full-history calculations immediately and do not wait for Chroma or call Qwen. Semantic retrieval is not used to count goals, dribbles or fouls. These responses report `retrieval: calculated`.

For a whole-match story or recap, the entire available history supplies the score progression, chronological key moments, player contributions and statistics. Semantic hits add related possessions rather than selecting the whole recap solely by similarity. Qwen receives bounded evidence, not every routine pass or tracking frame. A historical review excludes later events, including events at the same timestamp but with a later event ID/order.

## Environment settings

| Setting | Default | Purpose |
|---|---|---|
| `EDEN_RETRIEVAL_PROVIDER` | `auto` | Configured Azure Search first; otherwise Chroma. `chroma` forces local semantic search; `local` selects keyword retrieval. |
| `EDEN_SEMANTIC_ENABLED` | `true` | Enable local BGE/Chroma. |
| `EDEN_EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` | Requested model; the worker requires 384 dimensions. |
| `EDEN_EMBEDDING_REVISION` | pinned SHA above | Reproducible model revision. Changing model/revision requires a new database path. |
| `EDEN_CHROMA_PATH` | `.data/chroma` | Persistent local database. |
| `EDEN_EMBEDDING_CACHE` | `.data/models` | Model cache. |
| `EDEN_EMBEDDING_THREADS` | `2` | CPU embedding threads. |
| `EDEN_EMBEDDING_TIMEOUT_MS` | `120000` | Worker startup/request timeout. |
| `EDEN_RETRIEVAL_TOP_K` | `6` | Relevant passages per query. |
| `EDEN_RETRIEVAL_RETAIN_MATCHES` | `20` | Rolling retention of indexed matches. |

`.env` contains all settings. `.data/` is ignored by Git and excluded from Azure Functions uploads. The index persists across server restarts, but browser match history and authoritative match memory still have their existing session/RAM limitations. There is no UI for reopening an old indexed match after a browser refresh. The rolling retention applies to search documents, not to the downloaded model cache.

## Microsoft and backups

`auto` prefers Azure Search only when cloud access and its credentials are configured. An Azure Search error falls back to BGE/Chroma; a failed/disabled local embedding path falls back to existing keyword/structured-event retrieval when `EDEN_ENABLE_FALLBACK=true`. Backups are for testing purposes and smooth execution, and response notes identify the actual path. With strict backups disabled, requested service failures propagate instead of silently passing.

Local Chroma is independent of which model writes the story. A Microsoft model can consume Chroma-retrieved evidence. Configuring Azure Speech does not change retrieval or text generation. A deployed Azure Function needs its own installed Python runtime, dependencies and model/cache/storage if Chroma is selected; the current Node-only deployment does not automatically include the laptop's `.venv` or `.data`. Use Azure Search for that host or provision the additional runtime/storage explicitly.

## Check it

- Generate a story and open **Evidence & details**. BGE/Chroma notes identify semantic retrieval; a labelled note identifies a keyword backup. Supporting events retain their timeline links.
- `/api/health` includes a `retrieval` object: model, CPU device, dimension, cosine metric, status, document count and embedding count when ready. **Check connection** refreshes its status tooltip.
- `npm run smoke:rag` uses the actual BGE model and an isolated temporary Chroma database to verify semantic ranking, incremental indexing, persistence and historical/match isolation. It does not start a web server.
- `npm run smoke:rag -- --story` also requests a recorded-moment explanation through the real Qwen/Agent Framework/API path. The temporary test index is removed after its workers close.
- `npm run test:ai` runs deterministic contracts and regressions without downloading a model or needing Azure credentials.

Verified locally: BGE/Chroma returned the possession-recovery sequence first for an attack-after-winning-possession query; persistence, unchanged-document reuse and time/match isolation passed. The end-to-end reply came from local Qwen through Microsoft Agent Framework. This is a smoke check, not a measured general retrieval-accuracy score.

## References

- [BGE model card and query instruction](https://huggingface.co/BAAI/bge-small-en-v1.5)
- [Chroma cosine collection configuration](https://docs.trychroma.com/docs/collections/configure)
- [Chroma metadata filters](https://docs.trychroma.com/docs/querying-collections/metadata-filtering)
