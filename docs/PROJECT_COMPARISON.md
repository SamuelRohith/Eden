# Public comparison: Many Hands and Eden

Inspected 28 October 2026: [Many Hands home](https://ca-manyhands-7kzrrno7qr6zo.orangedune-9d42108b.eastus2.azurecontainerapps.io/) and its Studio. This compares visible product behavior and published claims, not source-code quality or a common independent benchmark.

| Area | Many Hands observed | Eden |
|---|---|---|
| Central problem | Clear focus on fair attribution and avoiding scapegoating | Broader synthetic-match simulation, explainable moments and storytelling |
| Match experience | Recorded synthetic action replay and responsibility views | Continuous 22-player/ball simulation, set pieces, stats and saved moment reviews |
| Producer handoff | Pre-air queue with approve/edit/reject controls | Added session-only approve/reject and approved script export with source IDs |
| Evaluation | Public methodology and self-published speed/quality measurements | Automated regressions and real local smoke checks; no comparable quality benchmark yet |
| Trust presentation | Visible human evidence checks, outage/audit demonstrations | Source references, numeric checks, disclosed model/factual fallbacks and heuristic labels |
| Audience/language | Several audience templates; browser explicitly distinguishes templates from its AI desk | Fan/broadcaster generation instructions; English/Arabic/Spanish with translation checks and localized factual fallback |
| Developer story | API/MCP and cloud-oriented presentation | Local Qwen/Agent Framework and BGE/Chroma; optional Microsoft cloud adapters |

Many Hands is more mature as a packaged hackathon submission: its focused problem, producer workflow and evaluation presentation are stronger. Eden offers a richer live simulation and a free local retrieval/generation path. There is no defensible percentage by which either is “better,” because their scope differs and their published performance numbers were not independently reproduced.

## Improvement adopted

Eden now gives broadcaster scripts a producer decision before export. Draft/rejected outputs cannot export; approved JSON preserves match ID/clock, language, audience, text, provider, sources and the synthetic-data flag. This applies the useful human-review pattern without copying the other project's branding, responsibility model or claimed metrics. It is not a live broadcast integration or durable audit system.

## Remaining priorities

Measure narrative usefulness and factual precision on a labelled event set; verify a real configured Microsoft deployment; and test an external event-feed adapter. Those would strengthen the submission more than adding unrelated features. Their cloud/agent claims and displayed benchmarks remain their claims, not verified findings about our own stack.
