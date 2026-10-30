---
name: meta-model-api
description: Rules for Halo code that calls Meta models. Use when writing, testing or reviewing code that calls Muse Spark or Spark Open (api.meta.ai, inference.baseten.co), Muse Voice Transcribe, or SAM 3.1.
---

# Meta model API rules for Halo

Halo calls three model families. Read the file for the one your code touches before writing it:

- **LLM calls** (Insight, Notes Builder, any chat completion): [llm.md](llm.md)
- **Speech to text** (Transcriber): [voice.md](voice.md)
- **Face tracking** (Face Tracker): [sam.md](sam.md)

Rules every call shares:

- Use the official OpenAI SDK pointed at the provider's base URL. Meta's own client package is out of date.
- Keys live only in backend environment variables, loaded from `.env`. The extension never holds a key, and code never logs one.
- Tests use recorded fixtures or fakes for every model call, so CI runs offline and spends nothing. A live call belongs only in the manual eval script.
- Source of these rules: the Meta Model Cookbook (github.com/meta-models/meta-model-cookbook) and dev.meta.ai docs. When a rule here and the live API disagree, the API wins: note it in your module's STATE.md under Open questions.
