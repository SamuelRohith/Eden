# Eden submission demo

Target: about 100 seconds, strictly under two minutes. Use real working footage. No copyrighted music or real match footage is needed. The generated local MP4 uses Microsoft Zira desktop narration and actual captured Eden screens, including a moving match excerpt. AI waits are edited out; do not present the edited sequence as a latency benchmark.

| Scene | Show | Say |
|---|---|---|
| Introduction | Landing screen and audience choice | Meet Eden. Every match has a story. Eden turns synthetic football events into clear, evidence-backed match intelligence. |
| Start a match | Team/formation setup, then live pitch, stats and commentary | Choose a fan or broadcaster experience, name your teams, select formations, and start a ninety-second match. All twenty-two players and the ball move on the pitch while statistics and commentary update. |
| Explain a moment | Click a green goal card; show the two-sided review and alternatives | Key moments stay available for review. Inspect the recorded buildup and compare passing, shooting, and dribbling options using transparent simulation estimates. |
| Ask a question | Ask “Which team dribbled more?” and show the direct answer | Ask Eden a match question. Exact totals come from the complete event history, so the language model does not guess who leads a count. |
| Grounding | Open Evidence & details on a story/review | For explanations and stories, BGE embeddings and Chroma retrieve relevant events and possessions. Microsoft Agent Framework runs Qwen locally to draft and edit responses. Unsupported wording falls back to recorded facts. |
| Personalize | Show Spanish and Arabic answers, including right-to-left text | Switch to Spanish or Arabic. Questions are interpreted in English for retrieval, and responses preserve the same match facts. Fans get shorter explanations. Broadcasters get more detailed scripts. |
| Producer review | Approve a script; show Export becoming available | A producer can approve or reject a draft, then export an approved script with its sources. Azure model, search, speech, and hosting adapters are available, but this demo uses the free local stack. |
| End | Landing title or final match view | Eden. See the moment, understand the match, and tell the story. |

## Before submitting

- Watch the final MP4 and confirm the audio is intelligible and duration is under 120 seconds.
- Upload it to an accepted public video host and paste the public URL into the project entry. The local MP4 is not a public submission URL.
- Include the public GitHub repository and a concise pitch naming the Microsoft Agent Framework path used locally. Only claim live Azure services after credentials and real service checks succeed.
- The simulator uses synthetic data. Decision probabilities are illustrative heuristics, not calibrated xG or verified predictions. Translated recaps may use disclosed factual phrases when model translation fails.
- If recording yourself instead, use the same scene order and speak naturally. A human voice is preferable if clear; local text-to-speech is a workable free alternative.
