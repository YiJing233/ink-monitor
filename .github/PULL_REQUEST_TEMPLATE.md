## Summary

<!-- One or two sentences describing the change. -->

## Linked issues

Closes #

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation / README update
- [ ] Refactor (no functional change)

## How has this been tested?

- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] Manual verification (describe what you did)

## E-ink checklist (required if `/display` is touched)

- [ ] Page still server-renders with JavaScript disabled
- [ ] No new CSS Grid, `:has()`, `backdrop-filter`, or transitions
- [ ] All numerics use thousand separators (`1,234.56`) so they read without tabular-nums
- [ ] No new client-side dependency
- [ ] If you added an interactive control, the title-bar `<a href="/display">` tap-to-refresh still works

## Security checklist (required if `/api/*` or `lib/crypto.ts` is touched)

- [ ] No new field is logged at the `info` or higher level
- [ ] No new env var is required for existing users to keep working
- [ ] If you changed the encryption format, existing ciphertexts still decrypt
- [ ] User-scoped queries still pass `userId` (no cross-tenant leaks)

## Screenshots / recordings (if visual)

<!-- Drag & drop images, or paste Markdown `![alt](url)`. -->

## Checklist

- [ ] I have read [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md)
- [ ] I have run `pnpm test` locally
- [ ] My changes don't introduce new TypeScript errors
- [ ] I have updated CHANGELOG.md under `[Unreleased]`
