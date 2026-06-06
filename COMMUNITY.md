# Community

This document is the **decision + setup guide** for community
channels. The code in this repo is enough to launch an open-source
project; the rest is operational.

## Channels to set up, in order

### 1. GitHub Issues + Discussions (do this first)

Free, low maintenance, scales to thousands.

**Setup**:
1. Go to your repo → Settings → General → Features
2. Enable Issues (already on by default)
3. Enable Discussions
4. Create the categories:
   - **Announcements** (locked, maintainers only)
   - **General** — "how do I…"
   - **Ideas** — feature requests, before filing an issue
   - **Show and tell** — what you built with Ink Monitor
   - **Q&A** — support
5. Pin a welcome message

**Effort**: 30 min. Ongoing: 1 hr/wk.

### 2. Sponsor (GitHub Sponsors)

Set up at https://github.com/sponsors once you publish the repo.

Suggested tiers (USD/month):
- **$3** — Supporter, name in `BACKERS.md`
- **$10** — Sponsor, name in README footer
- **$50** — Logo in README + a "sponsored by" slot on `/`
- **$500** — Direct contact line, feature requests prioritized

Goal: $200-500/mo covers a basic hosted instance for early adopters.

### 3. Discord (optional, do this if Sponsors / community is active)

Free. 30 min to set up. Maintenance burden: 2-5 hr/wk.

**Channel structure**:
- `#welcome` — read the rules
- `#general` — chatter
- `#help` — usage questions (redirect from /issues to here)
- `#showcase` — what you built
- `#dev` — for contributors
- `#announcements` — locked, maintainers only

**Don't** start a Discord before you have ≥ 50 GitHub stars.
Pre-launch Discord = ghost town.

### 4. Newsletter (do this around launch, not before)

ConvertKit (free up to 1K subscribers) or Buttondown ($9/mo).

**Cadence**: monthly, with release notes + a behind-the-scenes note.

**Don't** send weekly. Nobody wants email from a project they're just
trying.

### 5. Twitter / X / Mastodon (only if you're active there personally)

The official Ink Monitor account should mirror the GitHub release feed.
Don't have a separate content strategy.

## Contributor pipeline

1. **Discussions → Issues** — vague ideas get triaged in Discussions
2. **Issue → PR** — `good first issue` and `help wanted` labels route
   newcomers to tractable problems
3. **PR → Review** — maintainers review within 7 days; first-time
   contributors get extra patience
4. **PR → Merge** — squash-merge, update CHANGELOG, thank the
   contributor in the next release post

## What to do on day 1 of public launch

- [ ] Pin a "Welcome to Ink Monitor" Discussion
- [ ] Add the repo to https://github.com/topics/e-ink,
      https://github.com/topics/monitoring, etc.
- [ ] Post on Hacker News (https://news.ycombinator.com/show)
      with a thoughtful "Show HN" — best time Tue-Thu 8-10am US/Eastern
- [ ] Tweet / Mastodon with a 30-second demo video
- [ ] Email 5 friends who you think would actually use it
- [ ] Add a "good first issue" label to 3 easy issues
- [ ] Enable GitHub Discussions
- [ ] Set up GitHub Sponsors

## What NOT to do

- Don't add a Discord before you have community to fill it
- Don't run paid ads. The unit economics of an e-ink monitoring tool
  can't survive CAC > $20
- Don't sponsor newsletters until you have 100+ active users
- Don't create a Twitter account you can't maintain. A dead account
  is worse than no account
- Don't auto-post release notes to Reddit / HN / Lobsters. They get
  flagged and your account gets banned

## The single most important thing

**Respond to issues and discussions within 48 hours.** The single
biggest predictor of an open-source project's success or failure is
how quickly the maintainers respond to the first 10 issues. If you
respond fast and helpfully, contributors show up. If issues sit for
weeks, they go elsewhere.

Set up a notification:
- Email from GitHub for every new issue + every mention
- Slack/Discord/Telegram webhook for the same

## A note on AI-generated responses

Some projects use AI to auto-respond to issues. Resist this. People
can tell, and it's the fastest way to lose trust. The whole point
of open source is human collaboration.

If you're overwhelmed, ask for help: promote an active contributor
to "triager" role. They get triage-only permissions and help
respond to issues.
