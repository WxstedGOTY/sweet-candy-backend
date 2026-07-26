const express = require('express');
const rateLimit = require('express-rate-limit');
const { checkDeliveryDistance } = require('../distance');
const { computeTotals, createPendingOrder, attachStripeSession } = require('../orders');
const { createCheckoutSession } = require('../stripe');

const router = express.Router();

// Distance lookups cost money (Google API) and checkout-session creation
// hits Stripe, so both are rate-limited per IP against abuse.
const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

function isValidCustomer(customer) {
  if (!customer) return 'Missing customer details.';
  if (!customer.name || customer.name.trim().length < 2) return 'Please enter a valid name.';
  if (!customer.phone || !/^[0-9+()\s-]{7,20}$/.test(customer.phone.trim())) return 'Please enter a valid phone number.';
  if (!customer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())) return 'Please enter a valid email.';
  if (!customer.address || customer.address.trim().length < 5) return 'Please enter a full delivery address.';
  return null;
}

/**
 * POST /api/checkout/quote
 * Body: { cart: [{id, qty}], tip, address }
 * Validates the cart against the real menu prices and the delivery
 * minimum, and checks the address against the real driving-distance
 * limit. Does NOT create an order yet — this is only used to show the
 * customer accurate totals and delivery eligibility before they fill in
 * the rest of the checkout form.
 */
router.post('/quote', checkoutLimiter, async (req, res) => {
  try {
    const { cart, tip, address } = req.body;

    let totals;
    try {
      totals = computeTotals(cart, tip);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'INVALID_CART' });
    }

    const distanceResult = await checkDeliveryDistance(address);
    if (!distanceResult.ok) {
      const messages = {
        ADDRESS_NOT_FOUND: 'We couldn\u2019t find that address. Please provide a more complete address (street, number, city, postal code).',
        OUTSIDE_DELIVERY_AREA: `Sorry, that address is ${distanceResult.distanceText || 'too far'} from our shop by road \u2014 outside our 20 km delivery area.`,
        SERVICE_UNAVAILABLE: 'We couldn\u2019t verify delivery distance right now. Please try again in a moment.'
      };
      return res.status(400).json({
        error: messages[distanceResult.reason] || 'Delivery is unavailable for this address.',
        code: distanceResult.reason
      });
    }

    return res.json({
      ok: true,
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      tip: totals.tip,
      total: totals.total,
      distance: {
        distanceText: distanceResult.distanceText,
        durationText: distanceResult.durationText
      }
    });
  } catch (err) {
    console.error('Quote error:', err);
    return res.status(500).json({ error: 'Something went wrong calculating your order. Please try again.' });
  }
});

/**
 * POST /api/checkout/create-session
 * Body: { cart, tip, customer: {...} }
 * Re-validates everything from scratch (never trusts a prior /quote
 * call), creates the order record, then creates a Stripe Checkout
 * Session and returns its URL for redirect.
 */
router.post('/create-session', checkoutLimiter, async (req, res) => {
  try {
    const { cart, tip, customer } = req.body;

    const customerError = isValidCustomer(customer);
    if (customerError) {
      return res.status(400).json({ error: customerError, code: 'INVALID_CUSTOMER' });
    }

    let totals;
    try {
      totals = computeTotals(cart, tip);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'INVALID_CART' });
    }

    const distanceResult = await checkDeliveryDistance(customer.address);
    if (!distanceResult.ok) {
      const messages = {
        ADDRESS_NOT_FOUND: 'We couldn\u2019t find that address. Please provide a more complete address.',
        OUTSIDE_DELIVERY_AREA: `That address is outside our 20 km delivery area (${distanceResult.distanceText || ''}).`,
        SERVICE_UNAVAILABLE: 'We couldn\u2019t verify delivery distance right now. Please try again shortly.'
      };
      return res.status(400).json({
        error: messages[distanceResult.reason] || 'Delivery is unavailable for this address.',
        code: distanceResult.reason
      });
    }

    const order = await createPendingOrder({
      cartItems: cart,
      tipEur: tip,
      customer,
      distanceInfo: distanceResult
    });

    const session = await createCheckoutSession(order);
    await attachStripeSession(order.id, session.id);

    return res.json({ ok: true, checkoutUrl: session.url, orderId: order.id, trackingToken: order.trackingToken });
  } catch (err) {
    console.error('Create session error:', err);
    return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

module.exports = router;
