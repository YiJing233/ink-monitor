// Vitest setup — runs before any test file imports.
// Set deterministic crypto env so the dev-fallback warning doesn't fire.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.ENCRYPTION_SALT = 'vitest-salt';
process.env.NEXTAUTH_SECRET = 'vitest-secret';
