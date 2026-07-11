# Smoke Signals AI — Platform & API Reference

> **Purpose.** This file gives every project (and every AI coding session) shared knowledge of
> (1) our product portfolio, (2) every external API we use across the fleet, and (3) the
> integration practices we have learned — often the hard way. Read the section for a vendor
> **before** writing new code against it. This file is duplicated across all product repos;
> when you materially change an integration, update it in your repo and propagate.
>
> Compiled 2026-07-11 from the actual code and docs of all five repos. File paths below are
> repo-relative and name which repo they live in.

---

## 1. Company & product landscape

**Smoke Signals AI** (smokesignals.ai, owner Nick Zeckets, nick@smokesignals.ai) is a
signal-based demand-generation agency that builds GTM operating systems for B2B companies.
The core thesis is the **"alpha signal" flywheel**: *signal → interactive app + original
content → social posts → inbound leads → sharpen the signal again.* Each product implements
a stage of that flywheel. Target ICP: B2B companies running HubSpot whose buyers are active
on LinkedIn (not agencies).

### The five products

| Product | Repo | URL | One-liner |
|---|---|---|---|
| **ContentOS** | `contentos` | contentos.smokesignals.ai | AI content-operations platform: articles, landing pages, emails, social posts, interactive micro-apps, positioning engine, GEO/AI-search measurement |
| **SocialOS** | `SocialOS` | socialos.smokesignals.ai | LinkedIn engagement monitoring → ICP scoring → automated AI-personalized LinkedIn outreach campaigns; VoC analysis |
| **DealOS** | `MEDDPICC-HubSpot-app` | dealos.smokesignals.ai | HubSpot marketplace app: AI deal-qualification scoring (MEDDPICC + 14 other frameworks) from real deal communications |
| **GTM OS** | `gtm-os-analysis` | gtmos.smokesignals.ai | Lead-magnet app: free AI-generated GTM analysis report for inbound prospects; dogfoods the flywheel; grades leads against our ICP |
| **Client Management Portal** | `client-management` | customer.smokesignals.ai | Internal + client-facing agency portal: unified campaign dashboards (HubSpot/HeyReach/Smartlead/SocialOS), accountability-gap detection, Friday Huddle, "Emily" LinkedIn-boost agent |

**How they connect:**
- The **Client Management Portal consumes SocialOS's integration API** (`Authorization: Bearer $SOCIALOS_INTEGRATION_KEY`, base `https://socialos.smokesignals.ai/api/integration/...`) for LinkedIn campaign/engagement data.
- **Three products write customer telemetry into Smoke Signals' own HubSpot portal** via private-app tokens: DealOS (`OWN_HUBSPOT_ACCESS_TOKEN`, `lib/crm-tracker.js`), SocialOS (`SOCIALOS_HUBSPOT_ACCESS_TOKEN`), ContentOS (`SMOKESIGNALS_HUBSPOT_TOKEN`, `src/lib/analytics-hubspot.ts`). Note the env-var name differs per repo — follow the local convention; all are fire-and-forget and must never block customer flows.
- **GTM OS** writes lead grades into our own portal (`gtmos_*` contact properties) and pings Slack `#sales` for C+ leads.
- Call transcripts (AskElephant/Fathom/Grain) reach ContentOS via inbound webhooks and reach the Portal indirectly inside HubSpot notes.

### Stack conventions (fleet-wide)

- **Hosting: Railway** everywhere (some PRDs still say Vercel — trust the code, not the PRD). Postgres on Railway; Redis only in GTM OS.
- **Frameworks:** Next.js App Router (ContentOS 16, SocialOS 16, Portal 14) or plain Express (DealOS, GTM OS). ORMs: Prisma (ContentOS 7, SocialOS 6), Drizzle (Portal), raw `pg` (DealOS).
- **Background work:** Postgres-table-as-queue + worker dyno (ContentOS `docs/worker-tier.md`, DealOS `lib/job-queue.js`) or Railway cron hitting `Authorization: Bearer $CRON_SECRET` endpoints (Portal). **In-process schedulers have burned us** (silent failures when the web process wasn't alive at the tick — Portal removed theirs); if you must run one, split roles like DealOS `DEALOS_ROLE=web|worker`.
- **Auth:** NextAuth magic-link (Portal v5 beta, ContentOS v4), custom JWT (SocialOS), HubSpot OAuth identity (DealOS).
- ⚠️ **Prisma migration discipline (ContentOS & SocialOS):** the start command runs `prisma migrate deploy`, which applies migration *files* only — editing `schema.prisma` without a migration file in the same commit takes production down with `P2022` on every query. Write `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for idempotency. SocialOS extra footgun: `prisma/migrations/` is **gitignored** — `git add -f` new migrations or they silently never deploy; first `migrate deploy` after `db push` needs baselining (`scripts/db-sync.sh` handles P3005).
- ⚠️ **ContentOS deploys to production on push to ANY branch** (Railway setting). Treat every push there as a prod deploy.

---

## 2. API inventory (index)

| Service | Used for | Products | Auth pattern |
|---|---|---|---|
| **Anthropic Claude** | All AI generation, agents, scoring, chat | all 5 | `ANTHROPIC_API_KEY` (`x-api-key` / SDK) |
| **HubSpot** | Customer CRM (OAuth apps) + our own portal (private apps) | all 5 | OAuth 2.0 per customer; `pat-*` Bearer for own portal |
| **Anysite** | Anonymous LinkedIn/Reddit scraping & enrichment | SocialOS, GTM OS, ContentOS | `ANYSITE_API_KEY` in **`access-token` header** |
| **Unipile** | Authenticated LinkedIn actions (invites, DMs, posting) | SocialOS, ContentOS | `UNIPILE_API_KEY` in **`X-API-KEY` header**, per-tenant DSN host |
| **Parallel.ai** | AI web research, GEO measurement, extract, monitors | ContentOS | `PARALLEL_API_KEY` in **`x-api-key` header** |
| **Firecrawl** | JS-rendered scraping + web search | ContentOS, SocialOS, GTM OS | `FIRECRAWL_API_KEY` Bearer |
| **Jina Reader** | Free fallback scraper (`r.jina.ai/{url}`) | ContentOS | none |
| **Voyage AI** | Embeddings for pgvector semantic search | ContentOS, SocialOS, Portal (Emily) | `VOYAGE_API_KEY` Bearer |
| **ElevenLabs** | Premium TTS (agent voices) | ContentOS, Portal | `ELEVENLABS_API_KEY` in **`xi-api-key` header** |
| **Deepgram** | STT (always) + budget TTS | ContentOS, Portal | `DEEPGRAM_API_KEY` as `Authorization: Token <key>` |
| **HeyReach** | LinkedIn outreach automation stats/events | Portal | per-client key in **`X-API-KEY` header** |
| **Smartlead** | Cold-email sending + stats | ContentOS, Portal | key as **`?api_key=` query param** |
| **Lemlist** | Cold-email alternative | Portal | OAuth 2.0 |
| **Gong** | Call transcript pull | ContentOS | per-org HTTP Basic (accessKey:secret) |
| **Slack** | Notifications, concierge relay, reports, DMs | all 5 | OAuth v2 bot tokens or `SLACK_BOT_TOKEN`; `SLACK_SIGNING_SECRET` for inbound |
| **Microsoft Teams** | Client report delivery | Portal | per-client incoming-webhook URL (URL is the credential) |
| **Resend** | Transactional email | SocialOS, Portal, ContentOS, DealOS | `RESEND_API_KEY` SDK |
| **Gmail API** | Emily's outreach mailbox | Portal | Google OAuth2, `gmail.send` + `gmail.readonly` only |
| **Stripe** | Billing (subscriptions, credits, usage tiers) | ContentOS, SocialOS, DealOS | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| **Cloudflare** | Custom hostnames (SaaS) + R2 object storage | ContentOS | `CLOUDFLARE_API_TOKEN`; R2 via S3 SDK |
| **Railway API** | Programmatic custom-domain registration | ContentOS | `RAILWAY_API_TOKEN`, GraphQL |
| **Sentry** | Error monitoring (with PII scrubbing) | SocialOS | DSN env vars, no-op when unset |
| **PostHog** | Product analytics | ContentOS | `POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` |
| **CMS export** (Webflow / HubSpot CMS / WordPress) | Publish content to customer CMS | ContentOS | per-customer tokens / App Passwords |
| **SocialOS integration API** | Product-to-product data | Portal → SocialOS | `SOCIALOS_INTEGRATION_KEY` Bearer |

---

## 3. Anthropic Claude — our core AI provider

Every product calls Claude. The mature reference implementations are
**ContentOS `src/lib/anthropic.ts`** (instrumentation + fallback chains + caching) and
**SocialOS `src/lib/anthropic.ts`** (`callAnthropic` shared transport).

### Model tiering (route by stakes and volume)

| Tier | Model | Fleet usage |
|---|---|---|
| Premium / customer-facing prose | `claude-opus-4-8` | GTM OS reports for HubSpot-running prospects; DealOS follow-up emails; Portal agent default |
| Heavy synthesis | `claude-opus-4-7` / `claude-opus-4-6` | ContentOS heavy tier; Portal narratives |
| Default workhorse | `claude-sonnet-4-6` (alias) / `claude-sonnet-5` | Most generation, chat, complex scoring passes |
| High-volume / cheap | `claude-haiku-4-5` | Extraction, classification, ICP grading, per-deal scoring |

Rules we follow:
- **Centralize model IDs in one module** (`ai-models.ts` / `anthropic-models.ts`) — a deprecation is then one diff, not seven. SocialOS learned this when a pinned `claude-sonnet-4-20250514` snapshot was retired and started 4xx-ing, breaking a user-facing feature.
- **Prefer aliases over dated snapshots** for anything long-lived; pin snapshots only when output stability matters more than longevity.
- **Implement model fallback**: Portal catches 404/400 (retired model) → retries with a fallback model; ContentOS steps down a chain (opus-4-7 → opus-4-6 → sonnet-4-6 → haiku) **only on 529 overload**, never on other errors, and never restarts a stream after the first token shipped.
- ContentOS supports runtime re-tiering via `AI_MODEL_TIERS` env JSON (no deploy needed).

### Call patterns that work

- **`temperature: 0` for scoring/classification** — deterministic, stable across runs, fewer malformed responses (DealOS).
- **Prompt caching**: mark the static system prompt with `cache_control: { type: 'ephemeral' }`; keep it byte-stable across requests so the prefix cache hits (GTM OS, Portal, ContentOS — ContentOS caps at ONE breakpoint per request, under the 4-breakpoint max, and skips thinking blocks).
- **Streaming for anything long**: SSE to the browser survives edge-proxy timeouts (Portal task-gen lesson). Pass an `AbortController` wired to client disconnect so you stop paying for tokens nobody reads (GTM OS).
- **Structured output via forced tool use**: `tool_choice: { type: "tool", name: "submit_analysis" }` beats prose-JSON prompting (SocialOS engine).
- **Server-side `web_search` tool** (`web_search_20250305`, name `web_search`, `max_uses`) for research features (ContentOS GEO/research, SocialOS VoC chat + web-tech).
- **Message Batches API for latency-tolerant bulk work**: 50% token cost + massive parallelism (DealOS nightly scoring). Access defensively (`client.messages.batches || client.beta.messages.batches`), poll with a timeout, and always keep a live per-item fallback path. Refresh downstream OAuth tokens (e.g. HubSpot) *after* the batch returns — batch turnaround can outlive an access token.
- **Timeouts & retries**: SDK `timeout` 180s / `maxRetries: 3`, or manual retry on 429/529/5xx with exponential backoff capped ~16s. **Classify errors**: transient (429/529/5xx/"overloaded") → retry/user-facing "high demand"; 4xx → log loudly as a bug and do NOT retry (GTM OS shipped a hard 400 hidden behind a "high demand" message for days).

### Hard-won gotchas

1. **Lone UTF-16 surrogates crash the API with a 400** ("no low surrogate in string"). LinkedIn posts and scraped copy are full of emoji; fixed-length `.slice()` truncation splits surrogate pairs. **Sanitize every text field** before sending (`stripLoneSurrogates` in GTM OS `server/utils/validation.js`; `sanitizeAnthropicBody` in SocialOS). SocialOS originally patched 2 of 8 call sites and left 6 broken — which is why **every repo must route all Claude calls through ONE shared transport function**.
2. **LLM JSON needs a repair ladder**: strip code fences and commentary, escape literal control chars, drop trailing commas, close unbalanced braces, extract the outermost `{...}` — then if parsing still fails, **re-request the whole call** (DealOS `lib/llm-json.js`, the best implementation). Never silently zero-out a result on parse failure.
3. **Check `stop_reason === 'max_tokens'`** — truncation is not fixable by re-parsing; size `max_tokens` per task.
4. **Cost instrumentation**: wrap `.create`/`.stream` to log tokens, cache reads/writes, estimated USD, and a caller tag per call (ContentOS logs `anthropic.usage`; DealOS writes per-portal rows to Postgres). Measured tokens are the source of truth for margin math — hardcoded per-feature cost guesses drift badly (ContentOS credits audit found real margins far below the claimed 90% because non-LLM vendors weren't metered).
5. **Cost guardrails for volume features**: per-org daily ceilings and a kill-switch that degrades to a deterministic template (SocialOS personalization: `CAMPAIGN_AI_MAX_PERSONALIZATIONS_PER_ORG_PER_DAY`, default 5000).
6. Keep methodology/internal vocabulary out of customer-facing generated text (DealOS email generator maintains an explicit "BANNED" list). GTM OS's prompt has a house-style banned-words list to avoid AI slop (no em dashes, no "leverage/unlock/seamless", no "not A, but B" hooks) — reuse it for any customer-facing prose.

---

## 4. HubSpot — the central CRM

Deepest integrations: DealOS (`server/src/lib/hubspot.js`), ContentOS (`src/lib/hubspot.ts`, 110KB), Portal (`lib/crm/*`), SocialOS (`src/server/services/hubspot.ts`), GTM OS (`server/services/hubspot.js`).

### Auth modes we use
1. **OAuth 2.0 public apps** (customer portals): authorize at `https://app.hubspot.com/oauth/authorize`, token at `https://api.hubapi.com/oauth/v1/token`. Tokens expire every **6 hours** — refresh proactively with a buffer (5 min before expiry; SocialOS refreshes at 5.5h) AND retry once on 401. On a **4xx refresh failure treat the token as revoked**: clear stored connection state so the UI says "Not connected" instead of retrying a dead token forever.
2. **Private-app tokens** (`pat-*`) for our own portal (telemetry sinks, GTM OS lead writing).
3. Portal identity: `GET /oauth/v1/access-tokens/{token}` returns `hub_id` + granted scopes.

### Rate limits (the #1 operational issue)
- The **CRM search API has a strict ~4–5 req/s per-portal "secondly" limit** that parallel fan-outs trip instantly. Pace searches with a **client-side token bucket before the wire** (DealOS `lib/rate-limiter.js`, `HUBSPOT_SEARCH_RPS=3`); treat 429-retry as fallback, not flow control.
- General limit ~100 req/10s: batch associations in small concurrent groups with inter-batch delays (Portal uses concurrency 2 + 300ms).
- Always honor `Retry-After` on 429 with exponential backoff + jitter (jitter matters — concurrent callers otherwise resynchronize and stampede again).
- **Batch endpoints**: read/update in chunks of ≤100 IDs; fetch engagements via one association call + one batch read, never N+1.

### Scope gotchas (bit us repeatedly)
- **OAuth scopes are frozen at consent.** Adding a *required* scope invalidates/403s every existing install until customers reauthorize. Prefer HubSpot **optional / conditionally-required** scopes for post-launch additions, detect missing grants at runtime, and show an actionable "reconnect" prompt (ContentOS `docs/hubspot-scope-migration.md`, Portal social scope).
- The `oauth` scope is not always echoed in a token's granted-scope list — exclude it from scope-audit diffs (DealOS).
- Keep the canonical scope list in exactly ONE module and sync app manifests to it.
- Free/Starter portals are plan-gated for some APIs — check granted scopes after OAuth and refuse politely with guidance (SocialOS requires Marketing Hub Pro+).

### Data & API quirks
- **Custom properties**: provision idempotently on install (create group + properties, tolerate 409s). ⚠️ **HubSpot reserves archived property names forever** — a deleted property's name can never be recreated (GTM OS lost `gtmos_linkedin_url` this way). Property values cap at 65,536 chars — truncate.
- **A portal admin can delete/retype your properties at any time.** GTM OS's `writeDroppingInvalidProps()` pattern: parse which property names the 400 flags invalid, drop just those, retry, and log loudly — one broken property must cost one field, not the whole lead.
- **Include error response bodies in thrown errors** — a bare "HubSpot API error: 400" let a rejected payload go unnoticed for days.
- Never write object-valued fields into properties (400: "Cannot deserialize value of type java.lang.String") — flatten/normalize enrichment payloads first.
- Never blank a shared standard property (e.g. `hs_linkedin_url`) — only write when you have a value; other integrations share it.
- **Webhooks**: v3 signature = HMAC-SHA256 over `method + url + rawBody + timestamp` with the client secret, base64, 5-min replay window, `timingSafeEqual`. Capture the raw body via `express.json({ verify })`. **Respond 200 within 5 seconds, process async**, and **debounce** engagement-triggered work through a durable queue (engagements land in bursts). Raise the JSON body limit (default 100kb 413s at scale).
- **No pipeline-config webhook exists for public apps** — cache pipelines with a short TTL (30s) + a manual "Resync" button.
- Some portals don't support association filters in search — keep a fetch-all-then-filter fallback.
- Trust `hs_is_closed` but ALSO check stage categories: customers create custom closed stages ("Churned") without the closed flag.
- **Broadcast/Social API** (`/broadcast/v1/broadcasts`) is deprecated but the ONLY per-post social-metrics source; needs the optional `social` scope; metrics retained ~30 days → snapshot daily and merge with a `GREATEST` high-water-mark so totals never regress (Portal `docs/social-reporting.md`).
- HubSpot CMS export: `POST /cms/v3/pages/site-pages` creates DRAFT pages (needs `content` scope).
- Tenant isolation: key every cache row by `portalId`/`orgId` as a *required* argument — this physically prevents cross-tenant leaks (DealOS).
- Detecting "does this company run HubSpot" from their website: naive substring scans false-positive on blog posts about HubSpot and false-negative on bot-blocked sites — check actual tracking-script hosts, and follow GTM containers (`googletagmanager.com/gtm.js?id=...`) since HubSpot is often loaded via tag manager (GTM OS).

---

## 5. LinkedIn data & actions — Anysite, Unipile, HeyReach

We deliberately split LinkedIn work across **anonymous scraping (Anysite)** — no customer
session at risk — and **authenticated actions (Unipile)** — the customer's own account.
**Prefer Anysite for all reads/enrichment**; only use Unipile when the action must come from
the customer's identity (invites, DMs, posting, "is *my* account connected to X").

### Anysite (`api.anysite.io`) — anonymous LinkedIn/Reddit scraping
- Auth: `ANYSITE_API_KEY` in an **`access-token` header** (not Bearer). All endpoints POST. Management endpoints additionally need `ANYSITE_ACCOUNT_ID`.
- Reference clients: SocialOS `src/lib/anysite.ts` (~1500 lines, most complete), GTM OS `server/services/anysite.js`.
- Key endpoints: `/api/linkedin/{user,company,post}`, `/user/posts`, `/company/posts`, `/post/{comments,reactions,reposts}`, `/search/{posts,people,companies,jobs,users}`, `/linkedin/email/user` (email→person), `/sn_search/users` (Sales Navigator), `/company/employees`, `/google/company` (domain→company). Usage feed: `GET /token/requests`, `/token/statistic`.
- **Billing is per CREDIT, not per call** — endpoints vary wildly (comments=63 credits, post search=9, user=3, most=1; ≈$0.001/credit on the Enterprise plan). Don't model cost per-request; SocialOS `docs/cost-analysis.md` is the source of truth.
- **412 gotchas** (all documented in code):
  - `company`/`current_companies` filters must be **arrays of URNs**, not bare strings.
  - Company lookups 412 on bare company names / vanity slugs — resolve a URN or LinkedIn company URL first; convert `fsd_company:{id}` → `company:{id}` for job/employee search.
  - Some encoded URNs 412 on `/user/posts` — soft-fail to fallbacks.
- **Response shapes drift across versions**: URNs arrive as string-or-object, display fields nested — normalize defensively (`urnString()`, `textOrName()`, depth-limited key search). An object leaking into a HubSpot property 400s the create.
- **Rate limiting**: provider cap ~200/min. SocialOS runs a per-process token bucket (180/min) *with a serialization chain* (so `Promise.all` bursts can't all pass the check) PLUS a Postgres-backed cross-replica limiter, since the key is shared.
- **Distinguish per-minute vs daily 429s**: parse the stated reset (`Retry-After` header, "try again in N seconds" body, `retry_after` field). Wait > ~2 min ⇒ daily fair-use cap: **pause that endpoint until reset and fail fast** — blind retries fire thousands of doomed calls.
- **Per-endpoint circuit breaker** for 412 storms: 10 failures/60s opens for a 60s cooldown, half-open probe after (SocialOS `anysite-circuit.ts`).
- **Caching**: cache successes (24h) and genuine misses (short negative-cache, ~10 min) — but **never cache failures**: caching a transient `[]` strips that data from every report for a day.
- **Timeouts**: 10s (GTM OS — fail fast into fallbacks; 30s let serial enrichment stack to minutes) to 5 min (SocialOS bulk). Pick per use-case.
- De-dupe provider alert emails (1-hour cooldown per error category) — a run hitting 100 401s must not send 100 emails.
- Cost attribution with a shared key: match Anysite's per-request usage feed to your own call log by (endpoint, ~timestamp) nearest-neighbor (SocialOS `anysite-usage.ts`).

### Unipile — authenticated LinkedIn account management
- Auth: `UNIPILE_API_KEY` in **`X-API-KEY`**; base `https://{UNIPILE_DSN}/api/v1` where the DSN is **per-tenant** (e.g. `api31.unipile.com:16102`). Billing: flat ~$5/mo per connected account, not per call — disconnect accounts when done with them to recycle slots.
- Endpoints: `POST /hosted/accounts/link` (hosted-auth connect wizard; link expires 1h — carry a nonce to prevent forged account attach), `/users/invite`, `/users/relations`, `/chats` + `/chats/{id}/messages`, `POST /posts` (multipart/form-data — let fetch set the boundary), `/posts/{id}/{reactions,comments}`, `GET /users/{id}` (**generates a real "viewed your profile" footprint**).
- Webhooks: Unipile doesn't natively sign — verify HMAC only if you proxy-sign, and rely on DB validation of the account-name payload. **Normalize event-name casing and accept synonyms** (`RECONNECTED` vs `RECONNECT_SUCCESS`) — matching only one left accounts stuck "Disconnected".

### ⚠️ LinkedIn account safety (SocialOS `docs/linkedin-safety-plan.md` — built after a customer account got restricted)
Any project doing authenticated LinkedIn automation MUST follow these:
1. **Cap profile reads per account per day** (~80, under Unipile's ~100 guidance) with an atomic claim counter; global rate limits are not enough.
2. **Business-hours window + ±30% jitter** on all reads/sends — fixed-interval cron sweeps read as automation.
3. **Warm up new/dormant accounts**: ramp 2→4→7→12→20→34→40 sends/day, advancing only on healthy days; heavy senders can start near historical volume.
4. **Auto-throttle/freeze on restriction signals** (disconnect, 422 `cannot_resend_yet`); re-warm from the floor on reconnect.
5. Alert owners pre-emptively at 80% of read ceiling / 90% of send cap.
6. Prefer webhooks over polling; prefer Anysite (anonymous) over Unipile (authenticated) for enrichment.
7. Ops: pin per-account proxy country in the Unipile dashboard (impossible-travel flags can't be prevented in code).

### HeyReach (Portal) — LinkedIn outreach stats
- Auth: per-client key in **`X-API-KEY`**. Stats: `POST https://api.heyreach.io/api/public/stats/GetOverallStats` (numeric `CampaignIds`). Webhooks: HMAC-SHA256 hex in `X-HeyReach-Signature` + ±5 min timestamp freshness + dedup + immediate 200/async processing. Response shapes unstable — unwrap `overallStats || stats || data` defensively; return null, don't throw.

---

## 6. Web research & scraping — Parallel.ai, Firecrawl, Jina, direct fetch

**Scrape chain convention** (ContentOS knowledge ingest): Firecrawl → Jina Reader → SSRF-safe direct fetch. Prefer Parallel.ai `/v1/extract` where configured.

### Parallel.ai (`api.parallel.ai`) — AI-native web research (ContentOS `src/lib/parallel.ts`)
- Auth: `PARALLEL_API_KEY` via **`x-api-key`**. Endpoints: `POST /v1/search`, `POST /v1/tasks/runs` + `GET /v1/tasks/runs/{id}/result` (long-poll), `POST /v1/extract` (≤20 URLs), `POST /v1/monitors`. Task processors `lite|base|core|pro|ultra` ($0.005→$0.30/run); search $0.005; extract $0.001/URL.
- **The metering pattern to copy everywhere:** every paid wrapper *requires* a meter object naming the org the spend belongs to — there is no way to call a paid endpoint without attribution. A `UsageEvent` with real vendor COGS is written the moment the call succeeds. Free status/result GETs are not metered. Budget expectation ≈ $150/customer/mo, reconciled in an admin spend rollup.
- Retry: ONE in-client retry on 429/5xx with jittered backoff; longer retries belong to the job queue (attempt counters on the queue row). Per-endpoint timeouts (search 60s, extract 90s, result poll = task timeout + 30s).
- Race-safe billing: unique key on the output row (e.g. `(promptId, engine, sampleDate)`) so two cron replicas can't double-bill.

### Firecrawl (`api.firecrawl.dev`) — JS-rendered scraping
- Auth: `FIRECRAWL_API_KEY` Bearer. Endpoints: `POST /v1/scrape`, `/v1/map`, `/v1/search`.
- **Format selection matters**: request `rawHtml`/`html` when you need script/iframe tags (tech detection — markdown strips them; `onlyMainContent: true` strips the head/footer where tracking scripts live). Leave JS rendering off unless needed (halves cost). `waitFor: 2500` for JS modals.
- Contract: **never throws** — returns a structured `{ok, status}` outcome; a Firecrawl failure degrades to the next scraper in the chain. Self-disables when the key is unset.
- Response shapes drift (links as `string[]` vs `[{url}]`; search results under `data`/`data.web`/bare) — coerce defensively. Rate-limit with your own token bucket (60/min) — batch tech-detection runs 429-storm otherwise.
- Timeouts 30–60s. Log `err.cause` to get the real TLS/network error code.

### Jina Reader — zero-auth fallback: `GET https://r.jina.ai/{url}`, `Accept: text/markdown`, `X-No-Cache: true`, 30s timeout.

### ⚠️ Direct fetches of user-supplied URLs MUST be SSRF-safe
Block private/link-local/metadata IPs (`169.254.169.254`) and re-validate every redirect hop (ContentOS `src/lib/ssrf.ts`; security findings SEC-010/031). Send a real UA (`Mozilla/5.0 (compatible; <Product>/1.0)`) and a hard timeout.

---

## 7. Voice — Deepgram + ElevenLabs

Two halves, don't confuse them: **STT is always Deepgram**; **TTS is Deepgram (budget) or ElevenLabs (premium)** — auto-prefer ElevenLabs when its key is present, allow `TTS_PROVIDER` override (Portal `lib/agent/voice.ts`).

### Deepgram
- Auth: `Authorization: Token $DEEPGRAM_API_KEY`.
- STT: `POST https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true` (recorded clips) or streaming from the browser.
- **Browser streaming pattern**: mint a short-lived (60s TTL) browser token via `POST /v1/auth/grant` so mic audio streams direct from the browser and the long-lived key never ships to the client (ContentOS voice routes).
- TTS: `POST /v1/speak?model=aura-asteria-en&encoding=mp3`.
- Degrade to typed-only mode when unconfigured (return a `voice_not_configured` signal, not a 500).

### ElevenLabs
- Auth: **`xi-api-key` header**, always server-side proxied — never expose the key to the browser.
- Endpoint: `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}[/stream]`, `model_id: "eleven_turbo_v2_5"`, `voice_settings: { stability: 0.4–0.45, similarity_boost: 0.7 }`, `Accept: audio/mpeg`.
- House voices: **Rachel `21m00Tcm4TlvDq8ikWAM`** (default/partner/female), **Adam `pNInz6obpgDQGcFmaJgB`** (male). Override via `ELEVENLABS_VOICE_ID*` env vars.
- Cap input text (2000–5000 chars); strip code fences and spell out acronyms before speaking; `Cache-Control: no-store` on audio responses.

---

## 8. Voyage AI — embeddings

- Auth: `VOYAGE_API_KEY` Bearer → `POST https://api.voyageai.com/v1/embeddings`.
- Models in use: **`voyage-3-lite` @ 512 dims** (ContentOS + SocialOS knowledge bases), **`voyage-3.5` @ 1024 dims** (Portal Emily memory). **The dimension MUST match the pgvector column** (`VECTOR(512)` vs `VECTOR(1024)`) — validate returned dimensions.
- Set `input_type: "document"` for indexing and `"query"` for search — they embed differently.
- **Batch up to 128 texts per request** and **sort results by the echoed `index`** (order is not guaranteed). Chunking that works: ~800 tokens, 100 overlap, truncate inputs ~16k chars.
- Retry 429/5xx/network with delays [0, 1s, 3s, 8s]; other 4xx fail immediately; 30s timeout. Optional at boot — a missing key only disables indexing.
- Memory-layer principle (ContentOS `docs/memory-layer.md`): **don't vectorize raw transcripts** — raw volume is unbounded; map-reduce overnight into bounded distinct insights, embed those.

---

## 9. Email & messaging — Resend, Slack, Teams, Gmail

### Resend (transactional email, fleet standard)
- `RESEND_API_KEY` + official SDK. Senders: `updates@smokesignals.ai` (Portal), `noreply@contentos.smokesignals.ai`, `socialos@smokesignals.ai`, `admin@smokesignals.ai` (DealOS).
- Read the key at call time and no-op gracefully when unset. Magic-link/auth emails: keep a single outstanding token per user (delete priors on reissue); HTML-escape user-supplied names/orgs in templates.
- Used for: magic links, invites, digests, approval links, provider alerts, admin magic-link auth (restrict to `@smokesignals.ai`).

### Slack
- Two auth modes: per-workspace **OAuth v2 bot tokens** (multi-tenant products) or a static `SLACK_BOT_TOKEN` (internal single-workspace). Minimal scopes: `chat:write` (+ `chat:write.public`, `channels:read`, `groups:read`; add history/users scopes only when reading).
- Inbound (Events API): verify `SLACK_SIGNING_SECRET` HMAC (`v0:{timestamp}:{rawBody}`, SHA-256, `timingSafeEqual`, 5-min replay window); answer `url_verification` challenges; **ack 200 fast, process async**; ignore your own bot's posts; **de-dupe on `event_id`** and set the seen-flag only *after* a successful write so Slack's retry recovers failures (GTM OS `server/routes/chat.js` is the reference).
- Sending: on `not_in_channel`, auto-`conversations.join` and retry once; chunk to ≤48 blocks/message (limit is 50) with pauses; `unfurl_links/unfurl_media: false`; map `ok:false error:'ratelimited'` to a 429 and honor `Retry-After`.
- Reading channels: paginate with cursors, bound page counts, and filter noise subtypes carefully — a blanket `if (msg.subtype) continue` silently drops file shares and thread broadcasts (Portal lesson).
- OAuth `state`: HMAC-signed payload, verified with `timingSafeEqual`; upsert installs so re-install refreshes the token.
- The Events request URL is verified at app-creation time — deploy the endpoint (answering challenges) *before* configuring the app.

### Microsoft Teams (Portal)
- Per-client **incoming webhook URL** stored on the client record — the URL is the credential (treat it as a secret). POST a legacy **MessageCard** (`@type: MessageCard`, `themeColor`, `potentialAction`/`OpenUri`).

### Gmail API (Portal — Emily's mailbox)
- Google OAuth2 web-app flow; **narrow scopes by design**: `gmail.send` + `gmail.readonly` only. `access_type=offline` + `prompt=consent` to guarantee a refresh token; `hd=<domain>` + `login_hint` to pin the workspace.
- **Refresh token encrypted at rest** (AES-256-GCM).
- **Inbound via History-API polling with a persisted cursor, not Pub/Sub push** — Workspace domain-restricted-sharing policy blocks the Pub/Sub publisher grant push needs. Don't fight it; poll.
- OAuth footgun: the redirect URI must be **byte-identical** between the auth request and token exchange — compute it in exactly one place.

---

## 10. Cold email — Smartlead, Lemlist

### Smartlead
- Auth: long-lived full-access key as **`?api_key=` query param** (per-tenant, stored on the org/client record, not env). Base `https://server.smartlead.ai/api/v1`.
- **Use `/campaigns/{id}/analytics` for aggregates** — the older `/statistics` endpoint returns paginated *lead-level* rows, not totals (burned the Portal).
- Response shapes are unstable (array of per-step stats to sum, or wrapped in `data`/`statistics`/`stats`, or flat) — parse defensively and keep per-endpoint diagnostics (`fetchSmartleadCampaignStatsWithDiag` pattern: record status/type/keys/preview per attempted endpoint).
- Pushing sequences: `POST /campaigns/{id}/sequences` **replaces** all steps — naturally idempotent for re-pushes. Personalized 1:1 sends via campaign-scoped lead custom-field merge keys. Agency accounts scope by `client_id`.
- Reconcile campaign status nightly (paused/stopped/deleted upstream); surface 404s as an "invalid" state on the source record for admin remediation.
- Webhooks: HMAC-SHA256 hex (`x-smartlead-signature`/`x-signature`) + freshness + dedup + fast-200/async.

### Lemlist
- OAuth 2.0 (`LEMLIST_CLIENT_ID/SECRET`, token URL `https://api.lemlist.com/api/v1/auth/oauth2/token`), refresh with 5-min buffer, HMAC-signed OAuth `state` — mirrors the HubSpot token pattern exactly (Portal `lib/crm/tokens.ts`).

**Hard product rule (fleet-wide): AI never sends outbound.** Assistants/partners draft; sending requires an explicit user action on the owning surface. "Nothing leaves the building without an explicit user action."

---

## 11. Stripe — billing

Three implementations: ContentOS (`src/lib/stripe.ts` + credits engine), SocialOS, DealOS (`lib/billing.js`). Practices that matter:

- **Webhooks are at-least-once → handlers MUST be idempotent.** Claim `event.id` in a unique-keyed table before processing; a P2002/unique violation means already handled; delete the claim on handler failure so Stripe's retry can re-run (ContentOS SEC-017 fix — a double-granted-credits bug).
- Webhook routes need the **raw body** (`express.raw` / equivalent) for `stripe.webhooks.constructEvent`.
- Events to handle: `checkout.session.completed`, `invoice.paid` (**skip `billing_reason: subscription_create`** to avoid double-counting the first invoice), `customer.subscription.updated/deleted`, `invoice.payment_failed`.
- **Money mutations need DB-level atomicity** — read-check-then-write credit grants and deductions race under concurrency (double-spend). Use unique claims / row locks / atomic `updateMany` guards.
- Bound credit grants (positive integer, sane max) — never trust a quantity from metadata unchecked, and re-bind webhook metadata org IDs to the paying customer.
- Keep legacy plan slugs as aliases when renaming tiers — in-flight webhooks reference old slugs.
- SDK version quirks are real (v20: subscription at `invoice.parent.subscription_details`) — pin and note the version.
- Lazy-init the client (`getStripe()`) so builds/boots don't crash when unconfigured.
- Patterns in production: quantity-based subscription for credit units (ContentOS Agency tier), inline `price_data` for bundles (pricing changes ship as code), `setup_future_usage: 'off_session'` to save cards, usage-tier pricing derived from measured COGS (DealOS: tiers priced for ~90% gross margin against Claude costs — and meter EVERY vendor, not just the LLM, or margins are fiction).

---

## 12. Call transcripts — Gong + notetaker webhooks

- **Gong (pull)**: per-org HTTP Basic (accessKey:secret) stored on the org record (not env). `GET /v2/calls`, `POST /v2/calls/transcript`, `POST /v2/calls/extensive` (parties). Cursor pagination with a page cap; chunk call-ids by 100; parties fetch is non-fatal (fall back to speaker IDs); response shapes vary by plan — parse defensively; idempotent watermarked ingestion.
- **AskElephant / Fathom / Grain (push)**: per-org rotatable ingest token in the webhook URL (`mit_<hex>`). Normalize payloads tolerantly — hunt transcript text across common field names with dotted-path search; on extraction failure log the top-level keys so mappings can be tightened. AskElephant also lands transcripts inside HubSpot notes (Portal parses them from there — two-pass HTML-unescape).

---

## 13. Infra services

### Railway (hosting fleet-wide + API)
- Programmatic custom domains: GraphQL at `https://backboard.railway.com/graphql/v2`, `RAILWAY_API_TOKEN`. Duplicate-create returns an unparseable generic 400 — self-heal by re-querying for the existing domain id.
- Railway reserves `RAILWAY_PUBLIC_DOMAIN` and silently overwrites edits.
- Private-network Postgres uses `ssl: false` legitimately; add `?connection_limit=20&pool_timeout=10` to Prisma URLs.
- Redis on Railway needs IPv6: `socket: { family: 0 }`. **Running prod without Redis loses ephemeral state on every deploy** — warn loudly.
- One-off jobs: run via `railway ssh` with scripts committed under `scripts/` (see GTM OS backfill scripts for the retro-narrative style worth copying).

### Cloudflare (ContentOS)
- **Cloudflare for SaaS** custom hostnames + a router Worker: the SaaS fallback-origin preserves the original Host header which Railway can't route — a Worker + Origin Rule rewrites Host to the canonical domain while the original rides in `x-forwarded-host` for tenant resolution.
- Make ALL Cloudflare ops idempotent (check-before-create); PATCH custom hostnames to re-trigger the slow verifier.
- **R2** via S3 SDK (`region: "auto"`, endpoint `https://{account}.r2.cloudflarestorage.com`): all-or-nothing config gate with inline-data-URL fallback; persist `r2://bucket/key` scheme; best-effort deletes (an orphan key beats a 500); R2↔Workers egress is free. Sanitize user filenames before using them in keys.

### Sentry (SocialOS — reference implementation `docs/telemetry.md`)
- Gate on DSN presence so dev/CI send nothing. `sendDefaultPii: false` PLUS a `beforeSend` scrubber that redacts emails, cookies (`li_at`, `JSESSIONID`), and API-key patterns (`sk-ant-*`, `sk_*`, `pat-*`, `re_*`, JWTs, `Bearer ...`). Tunnel browser events through your own route to beat ad-blockers. Tag releases with the git SHA (`RAILWAY_GIT_COMMIT_SHA`).

### PostHog (ContentOS)
- `posthog-node` lazily imported, `flushAt: 1`; ALL failures swallowed — analytics must never break a request. Typed event-name union documents call sites. Fan out to the own-HubSpot telemetry sink in parallel.

---

## 14. Cross-cutting engineering rules (the distilled lessons)

These recur across every repo. Follow them for ANY new integration:

1. **One transport module per vendor.** Every call goes through a single shared client so fixes (sanitizers, retries, instrumentation) land once. The SocialOS surrogate bug — patched at 2 of 8 call sites — is the cautionary tale.
2. **Config-gate optional integrations**: `isXConfigured()` → clean no-op / typed-only mode / fallback behavior / operator setup notice. Never crash on a missing key; never let an optional integration's failure break a core flow. Integration secrets are credentials, not feature flags.
3. **Structured outcomes, not thrown vendor errors**: return `{data, outcome/status}`; never leak vendor names or raw errors to end users.
4. **Retry only what can succeed**: 429/5xx/timeouts/network with exponential backoff + jitter, honoring `Retry-After`. **Never retry other 4xx** — they fail identically. Distinguish per-minute limits (backoff) from daily caps (pause the endpoint, fail fast). Circuit-break repeating single-error storms.
5. **Rate-limit client-side, before the wire.** Token bucket per provider; if the key is shared across replicas, add a Postgres-backed distributed limiter that is **fail-open** (a DB hiccup must never gate outbound calls). Serialize the bucket check so `Promise.all` bursts can't all pass at once. In-memory limiters do not coordinate across replicas.
6. **Never cache failures.** Cache successes with TTLs and genuine misses with short negative-cache sentinels; only set `cacheable` flags when the result is trustworthy.
7. **Parse vendor responses defensively** — shapes drift across versions (Firecrawl, Anysite, Unipile, Gong, Smartlead, notetakers). Multi-alias field reads, depth-limited key hunts, normalize string-or-object values.
8. **Webhook hardening checklist**: raw-body capture → HMAC verify with `timingSafeEqual` (reject when the secret is unconfigured) → ±5-min timestamp freshness → dedup by event id (mark seen only after successful processing) → **respond 200 immediately, process async** → debounce bursty triggers through a durable queue → normalize event-name casing/synonyms.
9. **OAuth lifecycle**: proactive refresh with a buffer AND retry-once-on-401; refresh 4xx = revoked → clear state, prompt reconnect; HMAC-signed `state` with TTL; byte-identical redirect URIs computed in one place; scopes are frozen at consent (prefer optional scopes post-launch); keep the scope list in one module.
10. **Meter every paid call with tenant attribution at call time** (the Parallel.ai mandatory-meter pattern). Get the vendor's billing *unit* right (tokens vs credits vs per-account vs flat) — wrong units made one admin dashboard overstate COGS 10× and one credits system understate them. Measured usage beats hardcoded guesses.
11. **Money mutations are atomic and idempotent**: unique-claim tables for webhook events, unique keys on billable output rows, row-level guards on credit math.
12. **Security non-negotiables**: SSRF-safe fetch for user URLs; never bind `role`/`organizationId` from a client request body; centralize authz (per-route discipline fails at scale — ContentOS shipped 277 routes with no middleware); `sandbox="allow-scripts allow-same-origin"` on an iframe voids the sandbox; encrypt third-party tokens at rest (AES-256-GCM — known gap: DealOS stores HubSpot tokens plaintext); don't reuse one secret across crypto domains; scrub PII/keys from error telemetry.
13. **Fail loudly where it counts**: include vendor error bodies in thrown errors; `console.warn` on silent truncation/caps; alert (deduped) on auth/quota failures; heartbeat-monitor scheduled jobs (ledger table + staleness alerts) so "did it fire?" is one SQL query.
14. **Tenant isolation by construction**: every cache/query keyed by org/portal id as a required argument.
15. **Agentic safety** (Portal's Emily is the reference design): default-off feature flags for anything with spend or outbound risk; no LLM reasoning in irreversible click-paths; in-flight assertions comparing intended vs actual before the commit step; idempotent-by-name writes for crash recovery; observe-mode rollouts.

---

## 15. Maintaining this file

- Update the relevant section **in the same PR** that changes an integration's behavior, adds a vendor, or hits a new gotcha.
- Keep entries factual and code-anchored (file paths, env var names, exact endpoints/headers).
- This file is duplicated in all product repos; propagate meaningful edits to the others (any repo's copy can seed the sync).
