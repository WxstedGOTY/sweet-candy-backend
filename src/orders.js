const crypto = require('crypto');
const db = require('./db');
const { computeSubtotal } = require('./products');

const MIN_ORDER_EUR = parseFloat(process.env.MIN_ORDER_EUR || '10');
const DELIVERY_FEE_EUR = parseFloat(process.env.DELIVERY_FEE_EUR || '1');
const FREE_DELIVERY_THRESHOLD_EUR = parseFloat(process.env.FREE_DELIVERY_THRESHOLD_EUR || '25');

const ALLOWED_TIPS = [0, 1, 2, 5]; // custom amounts are validated separately (see validateTip)
const MAX_CUSTOM_TIP_EUR = 50; // sanity ceiling against fat-fingered/malicious input

const STATUS_FLOW = [
  'payment_pending',
  'payment_confirmed',
  'order_received',
  'preparing',
  'ready_for_delivery',
  'out_for_delivery',
  'delivered'
];
const TERMINAL_EXTRA_STATUSES = ['cancelled', 'refunded', 'payment_failed'];

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Validates a tip amount. Accepts the fixed quick-pick amounts or a
 * custom amount within a sane range. Returns the validated number or
 * throws.
 */
function validateTip(tipEur) {
  if (tipEur === undefined || tipEur === null) return 0;
  const value = Number(tipEur);
  if (Number.isNaN(value) || value < 0) {
    throw new Error('Invalid tip amount.');
  }
  if (value > MAX_CUSTOM_TIP_EUR) {
    throw new Error(`Tip cannot exceed €${MAX_CUSTOM_TIP_EUR}.`);
  }
  // Round to cents
  return round2(value);
}

/**
 * Computes the full, trusted price breakdown for an order.
 * Throws a descriptive error if the order doesn't meet the minimum.
 */
function computeTotals(cartItems, tipEur) {
  const { subtotal, lineItems } = computeSubtotal(cartItems);

  if (subtotal < MIN_ORDER_EUR) {
    const err = new Error(`Minimum order is €${MIN_ORDER_EUR.toFixed(2)}. Current subtotal: €${subtotal.toFixed(2)}.`);
    err.code = 'BELOW_MINIMUM_ORDER';
    throw err;
  }

  const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD_EUR ? 0 : DELIVERY_FEE_EUR;
  const tip = validateTip(tipEur);
  const total = round2(subtotal + deliveryFee + tip);

  return { subtotal, deliveryFee, tip, total, lineItems };
}

function generateOrderId() {
  // Human-friendly, sortable-ish, non-guessable enough for display purposes.
  // (The *tracking* token below is the one that actually needs to be unguessable.)
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `SC-${stamp}-${rand}`;
}

function generateTrackingToken() {
  // Long, cryptographically random token for the customer's tracking link.
  // Never derived from the order ID or any guessable data.
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Creates a new order in "payment_pending" status. Called BEFORE
 * redirecting the customer to Stripe, so we always have a record even
 * if they abandon checkout.
 */
async function createPendingOrder({ cartItems, tipEur, customer, distanceInfo }) {
  const totals = computeTotals(cartItems, tipEur);

  const order = {
    id: generateOrderId(),
    trackingToken: generateTrackingToken(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'payment_pending',
    paymentStatus: 'pending',
    stripeSessionId: null,
    processedStripeEventIds: [],
    items: totals.lineItems,
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    tip: totals.tip,
    total: totals.total,
    customer: {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      city: customer.city || '',
      postalCode: customer.postalCode || '',
      buildingDetails: customer.buildingDetails || '',
      deliveryInstructions: customer.deliveryInstructions || ''
    },
    delivery: {
      distanceMeters: distanceInfo.distanceMeters,
      distanceText: distanceInfo.distanceText,
      durationText: distanceInfo.durationText || null
    },
    courierId: null,
    statusHistory: [{ status: 'payment_pending', at: new Date().toISOString() }]
  };

  await db.insert('orders', order);
  return order;
}

async function attachStripeSession(orderId, stripeSessionId) {
  return db.update('orders', orderId, () => ({
    stripeSessionId,
    updatedAt: new Date().toISOString()
  }));
}

/**
 * Marks an order's payment as confirmed. Idempotent: if the Stripe
 * event has already been processed for this order, does nothing (this
 * is what prevents duplicate charges/orders from webhook retries).
 */
async function confirmPayment(orderId, stripeEventId) {
  const order = await db.getById('orders', orderId);
  if (!order) return null;

  if (order.processedStripeEventIds.includes(stripeEventId)) {
    return order; // already processed this exact event, no-op
  }
  if (order.paymentStatus === 'paid') {
    // Payment already confirmed via a different event id; just record it and stop.
    return db.update('orders', orderId, (o) => ({
      processedStripeEventIds: [...o.processedStripeEventIds, stripeEventId]
    }));
  }

  return db.update('orders', orderId, (o) => ({
    paymentStatus: 'paid',
    status: 'order_received',
    processedStripeEventIds: [...o.processedStripeEventIds, stripeEventId],
    updatedAt: new Date().toISOString(),
    statusHistory: [...o.statusHistory,
      { status: 'payment_confirmed', at: new Date().toISOString() },
      { status: 'order_received', at: new Date().toISOString() }
    ]
  }));
}

async function markPaymentFailed(orderId, stripeEventId) {
  const order = await db.getById('orders', orderId);
  if (!order || order.processedStripeEventIds.includes(stripeEventId)) return order;
  return db.update('orders', orderId, (o) => ({
    paymentStatus: 'failed',
    status: 'payment_failed',
    processedStripeEventIds: [...o.processedStripeEventIds, stripeEventId],
    updatedAt: new Date().toISOString(),
    statusHistory: [...o.statusHistory, { status: 'payment_failed', at: new Date().toISOString() }]
  }));
}

async function markPaymentCancelled(orderId, stripeEventId) {
  const order = await db.getById('orders', orderId);
  if (!order || order.processedStripeEventIds.includes(stripeEventId)) return order;
  if (order.paymentStatus === 'paid') return order; // never downgrade a paid order
  return db.update('orders', orderId, (o) => ({
    paymentStatus: 'cancelled',
    status: 'cancelled',
    processedStripeEventIds: [...o.processedStripeEventIds, stripeEventId],
    updatedAt: new Date().toISOString(),
    statusHistory: [...o.statusHistory, { status: 'cancelled', at: new Date().toISOString() }]
  }));
}

function isValidNextStatus(currentStatus, nextStatus) {
  if (TERMINAL_EXTRA_STATUSES.includes(nextStatus)) return true; // admin can always cancel/refund
  const curIdx = STATUS_FLOW.indexOf(currentStatus);
  const nextIdx = STATUS_FLOW.indexOf(nextStatus);
  if (curIdx === -1 || nextIdx === -1) return false;
  return nextIdx === curIdx + 1; // only allow moving one step forward at a time
}

async function setOrderStatus(orderId, nextStatus) {
  const order = await db.getById('orders', orderId);
  if (!order) throw new Error('Order not found.');
  if (!isValidNextStatus(order.status, nextStatus)) {
    throw new Error(`Cannot move order from "${order.status}" to "${nextStatus}".`);
  }
  return db.update('orders', orderId, (o) => ({
    status: nextStatus,
    updatedAt: new Date().toISOString(),
    statusHistory: [...o.statusHistory, { status: nextStatus, at: new Date().toISOString() }]
  }));
}

async function assignCourier(orderId, courierId) {
  return db.update('orders', orderId, () => ({
    courierId,
    updatedAt: new Date().toISOString()
  }));
}

module.exports = {
  STATUS_FLOW,
  MIN_ORDER_EUR,
  DELIVERY_FEE_EUR,
  FREE_DELIVERY_THRESHOLD_EUR,
  ALLOWED_TIPS,
  computeTotals,
  createPendingOrder,
  attachStripeSession,
  confirmPayment,
  markPaymentFailed,
  markPaymentCancelled,
  setOrderStatus,
  assignCourier
};
