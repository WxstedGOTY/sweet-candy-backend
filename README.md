# Sweet Candy — Checkout, Delivery, Payment & Courier System

This is a real, functional backend (not a mockup) that adds online ordering,
delivery-distance validation, Stripe payment, order tracking, and an
admin + courier management system to the existing Sweet Candy site.

---

## 1. What changed

**New backend application** (`/`, this folder) — a Node.js/Express server that:
- Validates every order server-side (prices, minimum order, delivery fee, tip)
- Checks real driving distance to the customer's address via Google's Distance Matrix API
- Creates Stripe Checkout Sessions and verifies payment via a signed webhook
- Stores orders with a full status pipeline, tip tracking, and courier assignment
- Provides an admin dashboard and a separate, restricted courier dashboard
- Gives customers a secure, token-based tracking link (no login required, no address/phone/email exposed)

**Existing storefront (`public/index.html`)** — unchanged in design/content, with two additions:
- A small "+" button next to every menu item to add it to a cart (stored in the browser only)
- A floating cart bar with a "Checkout →" button, only visible once something is in the cart

**New pages** (all styled to match the existing site):
- `public/checkout.html` — cart review, delivery form, live address/distance check, tip selection
- `public/order-success.html` — shown after payment, links to tracking
- `public/track.html` — customer order status page
- `public/admin/login.html` + `public/admin/dashboard.html`
- `public/courier/login.html` + `public/courier/dashboard.html`

**Nothing on the legal pages (privacy/cookies/terms) was rewritten automatically** — since real checkout now exists, go back through those three pages and replace the remaining bracketed placeholders (payment processor name is now "Stripe", delivery partner details, etc.).

---

## 2. Environment variables you need to configure

Copy `.env.example` to `.env` and fill in:

| Variable | What it's for |
|---|---|
| `PORT` | Port the server runs on (default 3000) |
| `PUBLIC_BASE_URL` | Your backend's public URL once deployed |
| `STOREFRONT_URL` | Your storefront's public URL (used for CORS + Stripe redirect URLs) |
| `JWT_SECRET` | Long random string signing admin/courier login sessions |
| `STRIPE_SECRET_KEY` | From your Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | From the webhook endpoint you create in Stripe (see below) |
| `GOOGLE_MAPS_API_KEY` | From Google Cloud Console, with Distance Matrix API enabled |
| `STORE_ADDRESS` | Already set to Posidonos 25, Rio, Patra — the delivery-distance origin |
| `MIN_ORDER_EUR`, `DELIVERY_FEE_EUR`, `FREE_DELIVERY_THRESHOLD_EUR`, `MAX_DELIVERY_DISTANCE_METERS` | Already set to your requested values (10 / 1 / 25 / 20000) |

Generate a strong `JWT_SECRET` with:
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 3. Configuring the payment provider (Stripe)

1. Create a Stripe account at https://dashboard.stripe.com (use test mode first).
2. Go to **Developers → API keys** and copy your Secret key into `STRIPE_SECRET_KEY`.
3. Go to **Settings → Payment methods** and make sure **Cards** is enabled, plus toggle on **Apple Pay** and **Google Pay** — Stripe Checkout shows these automatically to eligible customers/devices once enabled, no extra code is needed on your end.
4. Go to **Developers → Webhooks → Add endpoint**:
   - Endpoint URL: `https://your-backend-domain.example.com/api/webhook/stripe`
   - Events to send: `checkout.session.completed`, `checkout.session.async_payment_failed`, `checkout.session.expired`
5. Copy the webhook's **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
6. When ready for real payments, switch your API keys from test (`sk_test_...`) to live (`sk_live_...`) and re-create the webhook endpoint in live mode too (test and live webhooks are separate).

Your card data never touches this server — Stripe Checkout collects it directly, and this backend only ever sees a success/failure event and a payment reference.

---

## 4. Configuring the maps/routing API (Google)

1. Go to https://console.cloud.google.com and create (or select) a project.
2. Enable **Distance Matrix API**.
3. Enable billing on the project — Google requires this even within the free monthly credit.
4. Go to **APIs & Services → Credentials → Create Credentials → API key**.
5. **Restrict the key** (important for security/cost control): under API restrictions, limit it to only the Distance Matrix API; under application restrictions, restrict by your server's IP address if your host has a static IP.
6. Put the key in `GOOGLE_MAPS_API_KEY`.

Each address check costs a small fraction of a cent; Google's free monthly credit comfortably covers a small shop's order volume.

---

## 5. How the 20 km driving-distance check works

- The customer's typed address is sent to Google's **Distance Matrix API** with `mode=driving`, alongside your shop's fixed address (`STORE_ADDRESS`).
- Google returns the real driving distance and duration along actual roads — not a straight-line radius.
- If the distance is **≤ 20,000 meters (20 km)**, the order is allowed to proceed.
- If it's **over 20 km**, checkout is blocked with a clear message telling the customer they're outside the delivery area.
- If Google can't match the address to a real location at all (typo, incomplete address, non-existent street), the customer is asked to provide a more complete address — they are never silently allowed through.
- This check runs **twice**: once when the customer clicks "Check delivery availability" (so they see the result before paying), and again, from scratch, when the order is actually created — so a customer can never bypass the check by tampering with the page in their browser.

---

## 6. How to test a complete order (in Stripe test mode)

1. Install dependencies: `npm install`
2. Fill in `.env` (test Stripe keys are fine, and a real Google Maps key — there's no sandbox for that one, but distance lookups are nearly free).
3. Create your first admin and courier accounts:
   ```
   npm run create-admin
   npm run create-courier
   ```
4. Start the server: `npm start`
5. Open the storefront, add a few items to the cart (enough to clear the €10 minimum), and go to checkout.
6. Enter a real, checkable address within ~20 km of Posidonos 25, Rio, Patra (e.g. anywhere across Patras, Rio, or nearby towns) to see the distance check succeed, or a far-away address to see it correctly blocked.
7. Continue to payment. On Stripe's test checkout page, use test card `4242 4242 4242 4242`, any future expiry date, any 3-digit CVC.
8. After paying, you'll land on the success page with a tracking link — open it to see the status.
9. Log into `/admin/login.html` with the admin account you created, find the order, move it through the status pipeline, and assign it to your courier account.
10. Log into `/courier/login.html` with the courier account — the order should appear once it's "Ready for delivery," with a working "Open in Maps" link and buttons to advance it to delivered.

---

## 7. Before you actually launch

- [ ] Switch Stripe to live mode and re-point the webhook to the live endpoint
- [ ] Restrict your Google Maps API key properly (see section 4) so it can't be copied and abused by someone else
- [ ] Set `NODE_ENV=production` so secure cookies are enforced
- [ ] Deploy this backend somewhere that runs Node.js continuously — GitHub Pages **cannot** run this (it only serves static files). Reasonable options: Render, Railway, Fly.io, or a small VPS.
- [ ] Point `STOREFRONT_URL` at wherever your real storefront ends up living, and make sure the storefront's cart/checkout links point at this backend's real domain
- [ ] Fill in the remaining bracketed placeholders in `privacy.html` and `terms.html` (payment processor is now Stripe; delivery is handled in-house unless you're using a courier partner — update accordingly)
- [ ] Back up the `data/` folder regularly — it's the entire order/customer database. Since it's a plain JSON file, a simple daily copy to cloud storage is enough at this scale
- [ ] Create real admin/courier accounts with strong, unique passwords (the `create-admin`/`create-courier` scripts are the only way to make one — there's no public signup, on purpose)
- [ ] Test the whole flow once in live mode with a real card for a small real amount before telling customers it's open

---

## A note on scale

The order database is a JSON file (`data/orders.json`), not a full database server. This was a deliberate choice to avoid requiring you to provision and pay for a separate database just to get started, and it's genuinely fine for a single shop's order volume. If the business grows enough that this becomes a bottleneck (very high order volume, or running multiple server instances at once), the fix is to swap `src/db.js` for a real database client — every other file only ever calls the four functions in that one file, so the rest of the app doesn't need to change.
