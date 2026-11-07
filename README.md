# VibeScan

**Read between the vibes.** AI dating-profile language interpretation: paste a bio (or upload a screenshot), get a structured, context-aware breakdown of positive, ambiguous and explicitly concerning language, with alternative readings and questions to ask. It never scores or diagnoses a person.

## Architecture

```
vibescan/
├─ frontend/                 Static site: HTML + CSS + vanilla JS (ES modules). No build step.
│  ├─ index.html             Landing page
│  ├─ analyzer.html          Analysis workspace (paste / screenshot, age gate, progress)
│  ├─ results.html           Report (summary, signals, phrase breakdown, questions…)
│  ├─ _headers               Security headers + CSP (applied by Workers static assets)
│  ├─ css/                   variables · global · landing · analyzer · results · animations · responsive
│  └─ js/                    app · analyzer · results · api · ocr · validation · config
└─ backend/                  ONE Cloudflare Worker: serves /api/* and the static frontend
   ├─ wrangler.toml
   ├─ src/index.js           Routing, CORS, rate limiting, request validation, SSE streaming
   ├─ src/ai.js              Provider modules (Workers AI) + stage tracking + output parsing
   ├─ src/prompt.js          System prompt (server-side only, never sent to the browser)
   ├─ src/validate.js        Request validation + strict validation of model output
   ├─ test/ · scripts/       Unit/integration tests, 11 fictional bios, live QA script
   └─ .env.example
```

One `wrangler deploy` ships the API and the site on the same origin, so there is no CORS setup and no secret ever reaches the browser. Workers AI is a Cloudflare **binding**, so there is no API key to leak.

### Request flow
1. Browser validates text (20–3,000 chars) and POSTs `{text}` to `/api/analyze`.
2. Worker validates again (type, size, length), rate-limits, then streams the model output.
3. The Worker never forwards raw model text. It emits `stage` events based on which JSON keys the model has actually written, then one `result` event containing **validated** JSON, or one `error` event.
4. Validation drops any signal whose quoted phrase does not appear in the user's text (and tells the user how many were removed), enforces categories and lengths, and rejects malformed output. If the AI is down, over quota or returns junk, the user gets a clear error. **Nothing is ever fabricated.**

### The progress stages are real, not timed
`Reading profile` = request accepted · `Understanding context` = first model output · `Identifying language patterns` = model reaches the signals · `Preparing explanations` = expectations/questions · `Generating results` = observations, then validation. The model emits keys in a fixed order, which is what makes this observable.

## AI model (verified at build time, 7 Nov 2026)
- **Provider / model:** Cloudflare Workers AI, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (text in, text out, supports JSON mode and streaming).
- **Free tier:** 10,000 Neurons per day, shared across everything on the account, resets 00:00 UTC. Cloudflare's published rate for this model is 26,668 Neurons per million input tokens and 204,805 per million output tokens. See <https://developers.cloudflare.com/workers-ai/platform/pricing>.
- **What that means:** my estimate is ~300–350 Neurons per analysis (≈1.1k tokens in, ≈1.5k out), i.e. **roughly 25–30 analyses per day in total for all users**. It is *not* unlimited. When it runs out, users see "VibeScan has reached its free daily AI limit". Re-check the pricing page before launch, as limits change.
- **Swapping providers:** add an async generator to `PROVIDERS` in `src/ai.js` and set `AI_PROVIDER`. Nothing else changes.
- Only the model's streamed text is requested; JSON is enforced by the prompt plus strict server-side validation (not by `response_format`), because that is what allows honest streaming progress.

## Run locally
Requires Node 20+ and a free Cloudflare account.
```bash
cd backend
npm install
npx wrangler login
npx wrangler dev          # http://localhost:8787 (frontend + API)
```
`wrangler dev` calls the **real** Workers AI remotely, so it uses your daily Neurons. To use only the static pages without AI, run `python3 -m http.server` in `frontend/` (analysis will show an error, by design). ES modules need `http://`, not `file://`.

## Deploy (free)
1. Push this repo to GitHub.
2. **Option A, CLI:** `cd backend && npx wrangler deploy`. You get `https://vibescan.<you>.workers.dev`.
3. **Option B, Git integration:** Cloudflare dashboard → Workers & Pages → Create → Import a repository. Root directory `backend`, deploy command `npx wrangler deploy`.
4. Optional: attach a custom domain in the dashboard.

*Frontend on a different origin (e.g. Cloudflare Pages)?* Set `API_BASE` in `frontend/js/config.js` to the Worker URL and put the frontend origin in `ALLOWED_ORIGINS` in `wrangler.toml`.

## Environment variables (`.env.example`)
| Name | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `workersai` | Provider module used by `src/ai.js` |
| `AI_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Workers AI model id |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated extra origins allowed to call the API |

Workers AI needs no key. If you add a provider that does, use `npx wrangler secret put NAME`. Never commit secrets or put them in frontend code.

## Rate limiting
- **Built in:** a best-effort limiter (10 requests/minute per IP) that lives in each Worker isolate. It is a safety net, not a guarantee.
- **Recommended:** enable Cloudflare's Rate Limiting binding. Uncomment the `[[ratelimits]]` block in `wrangler.toml` (the code uses it automatically when `env.RATE_LIMITER` exists). **I could not test this binding syntax here**, so check it against the current Workers docs, or add a Rate Limiting rule in the dashboard instead.

## Privacy and security
- No accounts, no database, no analytics. Worker observability/logging is disabled and the code never logs request bodies.
- Screenshots are read in-browser with Tesseract.js and never uploaded. Users review and edit the text before it is sent.
- The finished report is held in `sessionStorage` (this tab only) so the results page can show it. "Clear analysis", "Clear" on the workspace, or closing the tab removes it.
- 18+ confirmation is stored in `localStorage` (just a flag, on-device).
- Disclosed to users: text is processed by Cloudflare Workers AI.
- Hardening applied: strict CSP and security headers (`_headers`), image magic-byte checks, size/length limits, prompt-injection delimiting, no `innerHTML` for model text, origin allow-list.
- **Third-party requests the browser makes (disclosed honestly):** Google Fonts on page load, and jsDelivr when OCR is first used (Tesseract.js, plus its English language data). No profile content goes to either. For a stricter posture, self-host the fonts and Tesseract assets and drop those hosts from the CSP.

## Testing
```bash
cd backend
npm test                       # 11 tests: validation, span matching, stage tracking, SSE, CORS, rate limit, failure paths
npm run test:bios              # LIVE: runs 11 fictional bios through a running instance (uses Neurons)
# UI end-to-end with a mocked API (needs playwright):
(cd ../frontend && python3 -m http.server 8099) &  python3 test/e2e_ui.py
```
`test/bios.json` covers healthy communication, ambiguous phrases, controlling expectations, traditional values, confidence language, contradictions, very short/empty input, multiple concerning statements, cultural slang and harmless unconventional preferences.

### What has and has not been verified
| Verified in the build environment | **Not** verified (do this before launch) |
|---|---|
| All 11 backend tests (mock AI binding) | Real Workers AI output quality on the 11 bios (`npm run test:bios`) |
| Browser E2E at 360/390/768/1024/1440px with a mocked API: age gate, validation, progress, results, sheet/panel, copy buttons, keyboard, reset, error path, no console errors, no horizontal scroll | **Screenshot OCR end to end.** The sandbox blocks the CDN, so I only confirmed upload validation and the graceful failure message |
| Upload validation: wrong type, fake image, >5 MB | `wrangler deploy`, the `_headers` CSP with real Tesseract (may need `connect-src` additions), the rate-limit binding |
| | Screen-reader pass (NVDA/VoiceOver) and a contrast tool run |

## Design notes and deviations from the brief
- Palette and fonts follow the brief. One change: secondary text uses `#5F635F` instead of `#777B77`, and sage text uses a darker `#4A5E4E`, so body copy meets WCAG AA contrast. The brief's sage `#718675` is kept for borders and accents.
- Classifications are never colour-only: each has a label, a symbol (+ ? !) and a distinct underline style (solid / dashed / wavy).
- The model schema adds `things_to_clarify` and `practical_suggestion` (needed for Final observations), `why_it_matters` / `alternative_interpretation` on every signal, and structured `expectations`. The server adds exact character offsets so highlights always line up with the original text.
- The landing page's preview and "example analysis" are clearly labelled illustrations. The workspace's "example profile" only fills the text box with made-up text; the analysis is still real.
- No PDF export (as specified). Reports are copied as plain text.
