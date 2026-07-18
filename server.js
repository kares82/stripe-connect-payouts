require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
const BASE_URL = process.env.BASE_URL || "http://localhost:4242";
const PORT = process.env.PORT || 4242;

/*
 * IMPORTANT: the webhook route needs the RAW request body to verify the
 * Stripe signature. So it is registered BEFORE express.json(). Every other
 * route can use parsed JSON.
 */

// ---------------------------------------------------------------------------
// Webhook endpoint (raw body). Registered first, on purpose.
// ---------------------------------------------------------------------------
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      // Signature verification failed -> reject. This is the security check.
      console.error(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the events relevant to a Connect payouts flow.
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object;
        const ready =
          account.charges_enabled && account.payouts_enabled;
        console.log(
          `[account.updated] ${account.id} — charges_enabled=${account.charges_enabled}, payouts_enabled=${account.payouts_enabled}${
            ready ? " (fully onboarded)" : ""
          }`
        );
        break;
      }
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log(
          `[checkout.session.completed] ${session.id} — amount_total=${session.amount_total}`
        );
        break;
      }
      case "transfer.created": {
        const transfer = event.data.object;
        console.log(
          `[transfer.created] ${transfer.id} — ${transfer.amount} to ${transfer.destination}`
        );
        break;
      }
      case "payout.paid": {
        const payout = event.data.object;
        console.log(`[payout.paid] ${payout.id} — ${payout.amount}`);
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  }
);

// JSON parsing for all remaining routes.
app.use(express.json());
app.use(express.static("public"));

// In-memory store of connected accounts created this session.
// A real app persists these in a database keyed to the user.
const connectedAccounts = [];

// ---------------------------------------------------------------------------
// 1. Create a Connect Express account for a "user" who will receive payouts.
// ---------------------------------------------------------------------------
app.post("/create-account", async (req, res) => {
  try {
    const account = await stripe.accounts.create({
      type: "express",
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    connectedAccounts.push({ id: account.id, ready: false });
    res.json({ accountId: account.id });
  } catch (err) {
    console.error("create-account error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 2. Generate a hosted onboarding link for that account.
//    Stripe collects identity + bank details; you don't build that UI.
// ---------------------------------------------------------------------------
app.post("/onboarding-link", async (req, res) => {
  try {
    const { accountId } = req.body;
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/?refresh=${accountId}`,
      return_url: `${BASE_URL}/?onboarded=${accountId}`,
      type: "account_onboarding",
    });
    res.json({ url: accountLink.url });
  } catch (err) {
    console.error("onboarding-link error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3. Check whether an account has finished onboarding (payouts_enabled).
// ---------------------------------------------------------------------------
app.get("/account-status/:accountId", async (req, res) => {
  try {
    const account = await stripe.accounts.retrieve(req.params.accountId);
    res.json({
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
    });
  } catch (err) {
    console.error("account-status error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 4. Take a payment into the PLATFORM (your Stripe balance) via Checkout.
//    In test mode you fund the platform balance so you can transfer out.
// ---------------------------------------------------------------------------
app.post("/create-checkout-session", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Demo payment (funds platform balance)" },
            unit_amount: 5000, // $50.00
          },
          quantity: 1,
        },
      ],
      success_url: `${BASE_URL}/?paid=1`,
      cancel_url: `${BASE_URL}/?canceled=1`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("checkout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. THE PAYOUT STEP the client specifically wants: transfer funds from the
//    platform balance to a connected account. This is "pay out to users",
//    not just Checkout.
// ---------------------------------------------------------------------------
app.post("/payout", async (req, res) => {
  try {
    const { accountId, amount } = req.body;
    const transfer = await stripe.transfers.create({
      amount: amount || 2000, // default $20.00
      currency: "usd",
      destination: accountId,
      description: "Demo payout to connected user",
    });
    res.json({ transferId: transfer.id, amount: transfer.amount });
  } catch (err) {
    console.error("payout error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/config", (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

app.listen(PORT, () => {
  console.log(`Stripe Connect demo running at ${BASE_URL}`);
});
