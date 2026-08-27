# `lib/ai`

Claude helpers for SajiloKaam.

Right now this only holds the client factory and the model constant — the env
var is wired so Phase 4 can start immediately. The triage prompt, the structured
output schema (category, urgency, cost band, DIY verdict), and the image-input
path all land in Phase 4.

Notes for whoever writes that code:

- Everything here is `server-only`. `ANTHROPIC_API_KEY` must never be sent to
  the browser, so triage runs in a Route Handler or Server Action.
- Use structured outputs (`output_config.format`) to get the triage result back
  as validated JSON. Assistant prefill is rejected on current models.
- Leave adaptive thinking on and tune `output_config.effort` instead — a triage
  call is short, so `medium` is usually enough.
- Photos come in as `{ type: "image", source: { type: "base64", ... } }`
  content blocks. Supabase Storage holds the upload; pass the bytes, not a
  signed URL that expires mid-request.
