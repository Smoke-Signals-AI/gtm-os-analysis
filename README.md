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
4. On the results page, an AI concierge answers questions grounded in the visitor's report. Conversations relay to a Slack channel; teammates can reply in the thread and it appears in the widget.

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
