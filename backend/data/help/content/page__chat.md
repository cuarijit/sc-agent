# Chat

## Purpose
The Chat page is a dedicated LLM console for explaining recommendations and parameter policies in plain English. It pairs each LLM response with citations drawn from the policy / vendor document corpus so planners can verify the source of any claim.

## When to use it
- "Why did the system recommend this?" — switch to **Recommendation** mode and ask.
- "What policy governs this safety stock value?" — switch to **Parameter** mode.
- Pre-meeting prep: have the LLM produce a paragraph summarizing a SKU's situation.

## Layout walkthrough
- Mode toggle (top): Recommendation | Parameter.
- Question textarea + Ask button.
- Answer card with the LLM response.
- Citations list under the answer — each citation links to the source doc.
- Provider/model metadata at the bottom (e.g. `openai:gpt-4.1-mini`).

## Key controls explained
| Control | What it does |
|---|---|
| Mode toggle | Switches the system prompt template (recommendation- vs parameter-focused). |
| Ask button | POSTs the question to the configured LLM provider with retrieved context. |
| Citation card click | Opens the source document. |

## Data flow
- Reads: provider/model from the user's saved settings (`/admin/settings`).
- Writes: `POST /api/chat/ask` (no persistent history; per-session only).
- Retrieval: `document_search_service.py` provides the snippets used as context.

## Permissions
Read for all roles. The LLM provider config is admin-managed.

## Common pitfalls
- If no provider is configured, the Ask button is disabled — set one in Settings.
- Long answers are streamed; cancelling mid-stream does not credit back the LLM call.
