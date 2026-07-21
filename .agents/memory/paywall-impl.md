---
name: Paywall implementation
description: How the ReLink paywall is implemented across web and mobile
---

# ReLink Paywall

## Architecture
- Premium status stored in **Clerk publicMetadata**: `{ isPremium: true }`
- Set from backend (payment webhook) or Clerk dashboard manually
- Dev bypass: set `VITE_FORCE_PREMIUM=true` in web env to skip paywall

## Web implementation
- `artifacts/relink-web/src/hooks/usePremium.ts` — hook reads `user.publicMetadata.isPremium`
- `artifacts/relink-web/src/components/PaywallGate.tsx` — wraps page content; if not premium, shows blurred overlay + upgrade CTA
- Applied in `App.tsx` wrapping: Workspace, Memory, WhatsApp, Import routes
- **Free**: NoContact route — not wrapped with PaywallGate
- Upgrade page at `/upgrade` — explains features, CTA to email for early access (payment provider TBD)

## AppShell
- Shows "Passer à Premium" link in sidebar if not premium
- Shows "Premium actif" badge if premium

## Mobile
- Not yet gated (paywall is web-only for now)
- To add: check `user.publicMetadata.isPremium` in Expo app

## To complete (payment provider not yet chosen)
- User needs to choose Stripe or Whop
- After selection: add payment webhook → set Clerk publicMetadata.isPremium = true
- Can add backend middleware `requirePremium` once payment is live
