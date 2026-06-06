# Status page

A status page is **non-negotiable** for any paid SaaS. This document
is the decision + implementation guide.

## Recommended providers (ranked)

1. **[Instatus](https://instatus.com)** — Free tier covers 1 service,
   5 components, 5 team members. Embed-friendly. ~$20/mo for the
   paid tier. Easiest to set up.

2. **[Better Stack](https://betterstack.com)** — Free tier with 1
   monitor, 10 statuspage subscribers. Better incident timeline.
   ~$25/mo for paid.

3. **[Better Uptime](https://betteruptime.com)** — Free tier with
   5 monitors, statuspage included. Easiest ping/heartbeat setup.

4. **Self-hosted** — [cstate](https://cstate.netlify.app/) (Netlify
   open source, free) is the only serious option if you want
   full control. Adds hosting + maintenance cost.

## What to monitor

Three categories, in priority order:

### 1. Ink Monitor itself (the service)
- HTTP 200 on `https://<your-domain>/api/health` every 60s
- HTTP 200 on `https://<your-domain>/api/health/ready` every 60s
- Response time < 2s p95
- HTTPS certificate expiry > 14 days

### 2. Upstream data sources (the data we proxy)
- Tencent `qt.gtimg.cn` reachability
- Sina `hq.sinajs.cn` reachability
- Eastmoney `push2his.eastmoney.com` reachability
- OpenAI `api.openai.com/v1/usage` reachability
- Anthropic `api.anthropic.com/v1/messages` reachability

The /api/snapshot response can include a `data_sources` field listing
the last successful fetch time per source. A source "down for >5min"
is a "degraded" incident, not a "down" incident.

### 3. CI / deploy pipeline
- GitHub Actions: last CI run succeeded
- Vercel: latest deploy succeeded

## Incidents to expect

- **Tencent rate limit**: occurs during US/EU business hours when their
  edge nodes are busy. The page renders cached or synthetic data.
  No user action needed; auto-recovers.
- **OpenAI 401**: user has rotated their key. We surface "ERR" in the
  card; user re-adds the key.
- **OpenAI 429**: too many polls. Mitigated by per-row TTL.
- **Vercel cold start**: first request after deploy is slow. Subsequent
  ones fast. No user action.
- **DB file lock**: should not happen on a single Vercel function; on
  self-host with a load balancer, the SQLite WAL can wedge. Reboot.

## Page content

Suggested components to display on the public status page:

- **API**: liveness + readiness
- **Display**: `/display` page itself
- **Data sources**: per-source health
- **Auth**: GitHub OAuth callback reachability
- **Admin**: `/admin` reachability
- **Scheduled**: backups completed in the last 24h
- **Performance**: p50 / p95 / p99 response time

## Subscriber comms

When you launch a paid tier, add a "Subscribe to updates" widget on
the status page. Email + RSS + Slack incoming-webhook.

When something is degraded:
- **Investigating** within 5 minutes of detection
- **Identified** within 15 minutes
- **Resolved** with a post-mortem within 24 hours of resolution

Post-mortems are public. Nobody trusts a status page with no history.

## Setting up Instatus (15 minutes)

1. Sign up at https://instatus.com
2. Create a new service: "Ink Monitor"
3. Add the components listed above
4. Add monitors pointing at `/api/health` and `/api/health/ready`
5. Embed the status badge in your `/` page footer and in the
   `/api/health` response (`X-Ink-Monitor-Status` header pointing to
   the public status page URL)
6. Configure email subscribers and a public RSS feed
7. Pin a 1-line "all systems operational" message in your README

Total time: ~15 min if you've done it before, ~1 hour the first time.
