const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  findUserByUsername, verifyPassword, issueSessionCookie,
  clearSessionCookie, requireRole
} = require('../auth');
const { setOrderStatus, assignCourier } = require('../orders');
const { stripe } = require('../stripe');

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
  if (!user || user.role !== 'admin') {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  issueSessionCookie(res, user);
  return res.json({ ok: true, username: user.username, name: user.name });
});

router.post('/logout', requireRole('admin'), (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Escapes a value for safe display; the admin dashboard frontend should
// still avoid innerHTML with raw fields, but this is a second layer.
function sanitizeForList(order) {
  return {
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    tip: order.tip,
    total: order.total,
    courierId: order.courierId,
    customer: order.customer, // full-access role, PII is appropriate here
    delivery: order.delivery,
    items: order.items
  };
}

router.get('/orders', requireRole('admin'), async (req, res) => {
  const { status, search } = req.query;
  let orders = await db.getAll('orders');

  if (status) {
    orders = orders.filter((o) => o.status === status);
  }
  if (search) {
    const q = String(search).toLowerCase();
    orders = orders.filter((o) =>
      o.id.toLowerCase().includes(q) ||
      o.customer.name.toLowerCase().includes(q) ||
      o.customer.phone.toLowerCase().includes(q) ||
      o.customer.email.toLowerCase().includes(q)
    );
  }

  orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders: orders.map(sanitizeForList) });
});

router.get('/orders/:id', requireRole('admin'), async (req, res) => {
  const order = await db.getById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order: sanitizeForList(order) });
});

router.patch('/orders/:id/status', requireRole('admin'), async (req, res) => {
  try {
    const updated = await setOrderStatus(req.params.id, req.body.status);
    res.json({ ok: true, order: sanitizeForList(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/orders/:id/assign-courier', requireRole('admin'), async (req, res) => {
  const { courierId } = req.body;
  const courier = await db.getById('users', courierId);
  if (!courier || courier.role !== 'courier') {
    return res.status(400).json({ error: 'Invalid courier.' });
  }
  const updated = await assignCourier(req.params.id, courierId);
  res.json({ ok: true, order: sanitizeForList(updated) });
});

router.get('/couriers', requireRole('admin'), async (req, res) => {
  const users = await db.getAll('users');
  const couriers = users.filter((u) => u.role === 'courier').map((c) => ({ id: c.id, name: c.name, username: c.username }));
  res.json({ couriers });
});

/**
 * POST /api/admin/orders/:id/refund
 * Issues a real Stripe refund for a paid order. Requires the order to
 * have a stored payment_intent id (set automatically by the webhook
 * when payment was confirmed).
 */
router.post('/orders/:id/refund', requireRole('admin'), async (req, res) => {
  const order = await db.getById('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.paymentStatus !== 'paid') {
    return res.status(400).json({ error: 'Only paid orders can be refunded.' });
  }
  if (!order.stripePaymentIntentId) {
    return res.status(400).json({ error: 'No payment record found for this order.' });
  }
  try {
    await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId });
    const updated = await db.update('orders', order.id, (o) => ({
      paymentStatus: 'refunded',
      status: 'refunded',
      updatedAt: new Date().toISOString(),
      statusHistory: [...o.statusHistory, { status: 'refunded', at: new Date().toISOString() }]
    }));
    res.json({ ok: true, order: sanitizeForList(updated) });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ error: 'Refund failed. Check the Stripe dashboard for details.' });
  }
});

/**
 * GET /api/admin/tips-report
 * Aggregates tips by courier so the business can track what's owed.
 */
router.get('/tips-report', requireRole('admin'), async (req, res) => {
  const orders = await db.getAll('orders');
  const users = await db.getAll('users');
  const couriersById = Object.fromEntries(users.filter(u => u.role === 'courier').map(u => [u.id, u.name]));

  const report = {};
  for (const order of orders) {
    if (order.paymentStatus !== 'paid' || !order.courierId) continue;
    if (!report[order.courierId]) {
      report[order.courierId] = { courierId: order.courierId, courierName: couriersById[order.courierId] || 'Unknown', totalTips: 0, deliveredOrders: 0 };
    }
    report[order.courierId].totalTips = Math.round((report[order.courierId].totalTips + order.tip) * 100) / 100;
    if (order.status === 'delivered') report[order.courierId].deliveredOrders += 1;
  }

  res.json({ report: Object.values(report) });
});

module.exports = router;
