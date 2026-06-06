# Release process

This document is the **checklist + script** for cutting a release. We
follow [SemVer 2.0](https://semver.org/) and Keep-a-Changelog.

## When to cut a release

- **Patch (0.0.x)**: bug fixes only, no API changes
- **Minor (0.x.0)**: new features, additive API changes, no breaking
  changes
- **Major (x.0.0)**: breaking changes to public API or data model

Cut a release when:
- You've accumulated 5+ merged PRs since the last release, OR
- A security fix needs to ship immediately (cut a patch from
  `main` directly), OR
- A breaking change is going out (cut a major)

## Pre-release checklist

- [ ] All tests pass on `main` (CI green)
- [ ] `pnpm build` is clean
- [ ] `CHANGELOG.md` is updated under `[X.Y.Z]` heading
- [ ] `package.json#version` is bumped
- [ ] No uncommitted changes (`git status` clean)
- [ ] On the right commit (`git log -1` shows the release commit)

## Cutting the release

```bash
# 1. Make sure you're on main, clean
git checkout main
git pull --rebase
git status

# 2. Bump version (choose one)
npm version patch    # 0.1.0 -> 0.1.1
npm version minor    # 0.1.0 -> 0.2.0
npm version major    # 0.1.0 -> 1.0.0

# 3. Update CHANGELOG.md — move Unreleased items into the new version
# section. Commit.

# 4. Tag and push
git push && git push --tags

# 5. Build a GitHub release
gh release create v0.1.0 \
  --title "v0.1.0" \
  --notes-file .github/RELEASE_NOTES_v0.1.0.md

# 6. Deploy the tag to production
# (Vercel: push to main is enough, or tag-triggered deploy if configured)
vercel --prod
```

## Release notes template

```markdown
# v0.1.0 — 2026-06-07

## Highlights

- **<one sentence the user cares about>**
- **<another>**

## What's new

- **Provider**: Added <X> integration (#pr)
- **Stock**: 30-day sparkline now in display (#pr)
- **Admin**: Share link for /display (#pr)
- **i18n**: Japanese translation (#pr)

## Bug fixes

- Fixed #issue: <description>

## Breaking changes

- None

## Upgrade

- Self-host: `git pull && pnpm install && pnpm rebuild better-sqlite3 && pnpm build`
- Hosted: no action needed; we've already rolled out

## Contributors

Thanks to @alice, @bob, @carol for this release.
```

## Hotfix (out-of-band) releases

If you need to ship a fix without waiting for a regular release:

```bash
git checkout main
git pull
git checkout -b hotfix/fix-thing
# fix the thing, commit
npm version patch
git push && git push --tags
gh release create v0.1.1 --title "v0.1.1 (hotfix)" --notes "..."
# merge back to main
git checkout main
git merge hotfix/fix-thing --ff-only
git push
```

## Post-release

- [ ] Email subscribers (see COMMUNITY.md)
- [ ] Post on social (if you maintain accounts)
- [ ] Update the landing page if it references the version
- [ ] Close any issues fixed by the release with "fixed in vX.Y.Z"
- [ ] Bump the `Unreleased` section in CHANGELOG.md to a blank state
  ready for the next round

## Versioning gotchas

- We use **plain `v` prefix** for tags: `v0.1.0`, not `0.1.0` or
  `release/0.1.0`. Vercel, GitHub, and most tooling default to this.
- We do **not** use SemVer build metadata (`+build`) — overkill.
- We do **not** use SemVer pre-release identifiers (`-alpha.1`) for
  `0.x.x` — instead, branches named `0.x-feature-name` for in-flight
  work.
- We commit `package-lock.json` (well, `pnpm-lock.yaml`). Every
  release pins the lockfile.

## Why automate later, not now

Release automation (release-please, changesets, semantic-release) is
worth it when:

- You ship more than once a week
- You have multiple maintainers
- You keep forgetting step 3

Until then, the manual checklist above takes 5 minutes and gives you
full control over the release notes.
