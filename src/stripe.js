const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('WARNING: STRIPE_SECRET_KEY is not set. Payments will fail until you configure it.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2024-06-20'
});

/**
 * Creates a Stripe-hosted Checkout Session for a single order.
 * We send ONE line item representing the whole order total, rather than
 * syncing every menu item to Stripe's product catalog — our own order
 * record (in orders.json) already holds the full itemized breakdown,
 * and Stripe never needs to know the composition, only the amount to
 * charge. client_reference_id ties the Stripe session back to our order.
 */
async function createCheckoutSession(order) {
  const amountInCents = Math.round(order.total * 100);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'], // Apple Pay / Google Pay auto-appear via the
                                     // "card" + Payment Request Button behavior in
                                     // Stripe Checkout when the customer's device/
                                     // browser supports them — no extra config needed
                                     // beyond enabling them in the Stripe Dashboard
                                     // under Settings -> Payment methods.
    client_reference_id: order.id,
    customer_email: order.customer.email,
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Sweet Candy order ${order.id}`,
            description: `Subtotal €${order.subtotal.toFixed(2)} + delivery €${order.deliveryFee.toFixed(2)} + tip €${order.tip.toFixed(2)}`
          },
          unit_amount: amountInCents
        },
        quantity: 1
      }
    ],
    metadata: {
      order_id: order.id
    },
    success_url: `${process.env.STOREFRONT_URL}/order-success.html?order=${order.id}&token=${order.trackingToken}`,
    cancel_url: `${process.env.STOREFRONT_URL}/checkout.html?cancelled=1&order=${order.id}`
  });

  return session;
}

/**
 * Verifies a webhook request's signature against the raw request body.
 * Throws if the signature is invalid (request did not really come from
 * Stripe, or the payload was tampered with in transit).
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  return stripe.webhooks.constructEvent(
    rawBody,
    signatureHeader,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

module.exports = { stripe, createCheckoutSession, verifyWebhookSignature };
