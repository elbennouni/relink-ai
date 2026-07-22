---
name: Clerk live vs test user IDs
description: Replit auto-swaps Clerk keys at publish time; dev and prod user stores are separate — the userId for the same email differs between environments.
---

## Rule
Dev userId ≠ Prod userId for the same Clerk account (e.g. mikam514@gmail.com).

- Dev (pk_test_): `user_3GjPZrMGlyCigLIWdHEqRpZ9kZS`
- Prod (pk_live_): `user_3GjaMrTLQgY6tHQ7wI7rGe9DHfo`

**Why:** Replit auto-swaps `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` from pk_test_/sk_test_ to pk_live_/sk_live_ on publish. Clerk's test and live environments have completely separate user stores — the same email gets a different userId in each.

**How to apply:**
- Any data inserted in dev under the test userId will NOT appear in prod (different userId).
- When migrating or inserting production data, always verify the live userId first using the `[DEBUG] GET /api/relations userId=` log in prod deployment logs.
- The fix-user-id admin endpoint (`POST /api/admin/fix-user-id`) can update all relations from old userId to new userId in one call.

## Mobile app Clerk key issue
The mobile app (`_layout.tsx`) hardcoded `pk_test_` as fallback. In production, this causes 401 errors because the prod server uses sk_live_ and can't verify pk_test_ tokens.

**Fix applied:** Mobile app now fetches the publishable key from `GET /api/config` (which returns `CLERK_PUBLISHABLE_KEY`, auto-swapped to pk_live_ in prod) before initializing ClerkProvider.
