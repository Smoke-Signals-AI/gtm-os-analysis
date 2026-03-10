# GTM OS — Smoke Signals AI

Signal-based GTM intelligence app. Visitors enter their email and company website, receive a comprehensive analysis powered by alpha signals.

## Stack

- Node.js + Express backend
- Anthropic API (Claude) for AI analysis
- Anysite.io for LinkedIn enrichment + BuiltWith tech stack lookup
- HubSpot API for CRM operations
- Deployed on Railway at gtmos.smokesignals.ai

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
PORT=3000
```
