# Stripe Connect — Payouts to Users (test mode demo)

A minimal Node.js/Express app demonstrating the Stripe Connect flow for paying
out to users — not just accepting payments. Built to show the full path:
onboard a connected account, take a payment into the platform balance, and
transfer funds out to the connected user, with signature-verified webhooks.

## What it demonstrates

- **Connect Express accounts** — create accounts and generate Stripe-hosted
  onboarding links (Stripe collects identity and bank details; no custom
  onboarding UI to build or maintain compliance for).
- **Payouts to users** — `transfers.create` moves funds from the platform
  balance to a connected account. This is the "pay out to your users" piece,
  distinct from Checkout.
- **Webhooks with signature verification** — the `/webhook` route uses the raw
  request body and `stripe.webhooks.constructEvent` to verify the Stripe
  signature before trusting any event. Handles `account.updated`,
  `checkout.session.completed`, `transfer.created`, `payout.paid`.
- **Account status checks** — reads `payouts_enabled` / `details_submitted`
  to know when an account is ready to receive funds.

## Run it

1. `npm install`
2. `cp .env.example .env` and fill in your **test-mode** keys
   (`sk_test_...`, `pk_test_...`).
3. `npm start` → open http://localhost:4242
4. Walk the four steps in the UI: create account → onboard (use Stripe's
   test onboarding values) → fund platform balance with test card
   `4242 4242 4242 4242` → transfer to the connected account.

## Webhooks

To exercise signature-verified webhooks locally, use the Stripe CLI:

```
stripe listen --forward-to localhost:4242/webhook
```

The CLI prints a signing secret (`whsec_...`). Put it in `.env` as
`STRIPE_WEBHOOK_SECRET`. Events will now be verified against it; a bad
signature returns HTTP 400 and the event is rejected.

## Notes

- Test mode only. No live keys, no real money.
- Connected accounts are held in memory for the demo; a production build
  persists account IDs in a database keyed to each user.
- The transfer step assumes a funded platform balance. In test mode the
  Checkout payment funds it.
