const express = require('express');
const { verifyWebhookSignature } = require('../stripe');
const { confirmPayment, markPaymentFailed, markPaymentCancelled } = require('../orders');
const db = require('../db');

const router = express.Router();

/**
 * POST /api/webhook/stripe
 *
 * IMPORTANT: this route must receive the RAW request body (not JSON-
 * parsed) for signature verification to work. That's configured in
 * server.js with express.raw() applied ONLY to this path, before the
 * global express.json() middleware.
 */
router.post('/stripe', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = verifyWebhookSignature(req.body, signature);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook signature verification failed.`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const orderId = session.client_reference_id;
        if (orderId) {
          const order = await confirmPayment(orderId, event.id);
          // Store the payment_intent id so refunds are possible later.
          if (order && session.payment_intent) {
            await db.update('orders', orderId, () => ({ stripePaymentIntentId: session.payment_intent }));
          }
        }
        break;
      }
      case 'checkout.session.async_payment_failed': {
        const session = event.data.object;
        if (session.client_reference_id) {
          await markPaymentFailed(session.client_reference_id, event.id);
        }
        break;
      }
      case 'checkout.session.expired': {
        const session = event.data.object;
        if (session.client_reference_id) {
          await markPaymentCancelled(session.client_reference_id, event.id);
        }
        break;
      }
      default:
        // Other event types are ignored on purpose (we only act on the
        // events relevant to this flow).
        break;
    }

    // Always respond 2xx quickly once we've handled (or intentionally
    // ignored) the event, so Stripe doesn't keep retrying unnecessarily.
    return res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error:', err);
    // Returning 500 causes Stripe to retry the event later, which is
    // safe here because confirmPayment/markPaymentFailed/markPaymentCancelled
    // are all idempotent against event.id.
    return res.status(500).json({ error: 'Webhook handling failed.' });
  }
});

module.exports = router;
