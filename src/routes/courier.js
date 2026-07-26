const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  findUserByUsername, verifyPassword, issueSessionCookie,
  clearSessionCookie, requireRole
} = require('../auth');
const { setOrderStatus } = require('../orders');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  const user = await findUserByUsername(username);
  if (!user || user.role !== 'courier') {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  issueSessionCookie(res, user);
  return res.json({ ok: true, username: user.username, name: user.name });
});

router.post('/logout', requireRole('courier'), (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Only what a courier actually needs: address, phone, instructions,
// status. No email, no payment details, no other customers' orders.
function sanitizeForCourier(order) {
  return {
    id: order.id,
    status: order.status,
    total: order.total,
    tip: order.tip,
    items: order.items.map((i) => ({ id: i.id, qty: i.qty })),
    customer: {
      name: order.customer.name,
      phone: order.customer.phone,
      address: order.customer.address,
      city: order.customer.city,
      postalCode: order.customer.postalCode,
      buildingDetails: order.customer.buildingDetails,
      deliveryInstructions: order.customer.deliveryInstructions
    },
    navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.customer.address)}`
  };
}

router.get('/orders', requireRole('courier'), async (req, res) => {
  const orders = await db.getAll('orders');
  const mine = orders
    .filter((o) => o.courierId === req.user.sub)
    .filter((o) => ['ready_for_delivery', 'out_for_delivery', 'delivered'].includes(o.status))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders: mine.map(sanitizeForCourier) });
});

const ALLOWED_COURIER_TRANSITIONS = {
  ready_for_delivery: 'out_for_delivery',
  out_for_delivery: 'delivered'
};

router.patch('/orders/:id/status', requireRole('courier'), async (req, res) => {
  const order = await db.getById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.courierId !== req.user.sub) {
    return res.status(403).json({ error: 'This order is not assigned to you.' });
  }
  const expectedNext = ALLOWED_COURIER_TRANSITIONS[order.status];
  if (req.body.status !== expectedNext) {
    return res.status(400).json({ error: `You can only move this order to "${expectedNext || 'no further status'}".` });
  }
  try {
    const updated = await setOrderStatus(order.id, req.body.status);
    res.json({ ok: true, order: sanitizeForCourier(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
