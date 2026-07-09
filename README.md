# GTM OS — Smoke Signals AI

Signal-based GTM intelligence app. Visitors enter their email and company website, receive a comprehensive analysis powered by alpha signals, and can chat with an AI concierge that hands off to the team in Slack.

## Stack

- Node.js + Express backend
- Anthropic API (Claude) for AI analysis (streamed) and the concierge chat
  - Premium tier: `claude-opus-4-8` when the company's site uses HubSpot
  - Standard tier: `claude-sonnet-4-6` otherwise
- Anysite.io for LinkedIn enrichment, the reader's recent posts, the company's open job postings, company profile/logo, and BuiltWith tech stack lookup
- HubSpot API for CRM operations
- Slack (Web API + Events API) for the concierge chat handoff
- Deployed on Railway at gtmos.smokesignals.ai

## How it works

1. Visitor submits email + website.
2. In parallel: website scrape, CRM lookup, BuiltWith check, LinkedIn profile enrichment, then the reader's recent LinkedIn posts, the company's open jobs, and the company profile (logo + facts).
3. Claude streams a five-section GTM report. The frontend renders it live (perceived speed), then upgrades to the full interactive layout (alpha-signal micro-app, sequence timeline).
4. In parallel with the report, the submission is ICP-graded (see below). The grade is written to the contact in HubSpot, and any submission that passes pings the sales channel in Slack.
5. On the results page, an AI concierge answers questions grounded in the visitor's report. Conversations relay to a Slack channel; teammates can reply in the thread and it appears in the widget.

## ICP grading

Every submission gets a grade (`server/services/icp.js`), written to the
`gtmos_icp_grade` contact property (created automatically) with the audit trail
in `gtmos_icp_grade_detail`. The rules:

- **F** — no HubSpot detected on their site, or the company is a
  HubSpot/growth/marketing agency (a Haiku classifier reads the scraped website
  to make the agency call). Nothing else is evaluated.
- **C** — has HubSpot and is not an agency (the floor for a pass; under 10
  employees or unknown headcount stays here).
- **B** — 10–25 employees.
- **A** — more than 25 employees.

The submitter's title (from LinkedIn enrichment) then adjusts downward only:
below director (manager/analyst/associate/…) caps the grade at B; an unknown
title demotes one level (A→B, B→C — C is the floor, an unknown title never
fails anyone); director level and above changes nothing. Whether the company's
buyers are active on LinkedIn is captured as an informational signal (it does
not move the grade) and shown in the Slack notification.

Any submission grading C or better posts a notification to the sales channel
(`SLACK_SALES_CHANNEL_ID`, default `#sales`). The bot only has `chat:write`,
so invite it to the channel once: `/invite @GTM OS Concierge`.

## Setup

```bash
cp .env.example .env
# Fill in API keys
npm install
npm start
```

## Environment Variables

```
HUBSPOT_ACCESS_TOKEN=   # HubSpot private app token
ANYSITE_API_KEY=        # Anysite.io API key
ANTHROPIC_API_KEY=      # Anthropic API key
SLACK_BOT_TOKEN=        # (optional) xoxb-... bot token with chat:write
SLACK_CHANNEL_ID=       # (optional) channel for visitor conversations, e.g. C0123ABCD
SLACK_SALES_CHANNEL_ID= # (optional) channel for ICP-qualified lead notifications; defaults to #sales (C0AHAMMDLCX)
SLACK_SIGNING_SECRET=   # (optional) verifies inbound Slack Events API requests
PORT=3000
```

## Slack concierge setup

The chat AI works without Slack. To relay conversations and let the team reply live, set up a Slack app. Deploy the app first, the events URL is verified on creation.

**Fast path:** at https://api.slack.com/apps -> **Create New App** -> **From a manifest**, pick your workspace, choose the **YAML** tab, and paste the contents of [`slack-app-manifest.yaml`](./slack-app-manifest.yaml).

Then:

1. **Install App** -> **Install to Workspace** -> copy the **Bot User OAuth Token** (`xoxb-...`) into `SLACK_BOT_TOKEN`.
2. **Basic Information** -> **Signing Secret** -> copy into `SLACK_SIGNING_SECRET` (the Signing Secret, not the Client Secret or Verification Token).
3. Invite the bot to the target channel (`/invite @GTM OS Concierge`) and copy the channel ID (`C...`) into `SLACK_CHANNEL_ID`.
4. **Event Subscriptions** -> confirm the Request URL `https://.../api/slack/events` shows **Verified** (hit **Retry** if the service was cold during creation).

Scopes used: `chat:write` (post into the channel and thread) and `channels:history` (receive thread replies). For private channels, add `groups:history` and the `message.groups` event.

Teammates reply in the thread that opens for each visitor; their replies surface in the visitor's chat widget.
