const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// The tracking token is a 32-char cryptographically random string, so
// it's not realistically guessable — but rate limiting is added anyway
// as defense in depth against automated probing.
const trackLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const PUBLIC_STATUS_LABELS = {
  payment_pending: 'Waiting for payment',
  payment_confirmed: 'Payment confirmed',
  order_received: 'Order received',
  preparing: 'Preparing your order',
  ready_for_delivery: 'Ready for delivery',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  payment_failed: 'Payment failed'
};

/**
 * GET /api/track/:token
 * Returns ONLY what a customer needs to see their order progress.
 * Deliberately excludes address, phone, email, and payment details.
 */
router.get('/:token', trackLimiter, async (req, res) => {
  const { token } = req.params;
  if (!token || token.length < 16) {
    return res.status(400).json({ error: 'Invalid tracking link.' });
  }

  const order = await db.getOne('orders', (o) => o.trackingToken === token);
  if (!order) {
    return res.status(404).json({ error: 'Order not found. Please check your tracking link.' });
  }

  return res.json({
    orderId: order.id,
    status: order.status,
    statusLabel: PUBLIC_STATUS_LABELS[order.status] || order.status,
    createdAt: order.createdAt,
    total: order.total,
    itemCount: order.items.reduce((sum, i) => sum + i.qty, 0),
    statusHistory: order.statusHistory.map((h) => ({
      status: h.status,
      label: PUBLIC_STATUS_LABELS[h.status] || h.status,
      at: h.at
    }))
  });
});

module.exports = router;
