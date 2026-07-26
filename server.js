require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const checkoutRoutes = require('./src/routes/checkout');
const webhookRoutes = require('./src/routes/webhook');
const trackRoutes = require('./src/routes/track');
const adminRoutes = require('./src/routes/admin');
const courierRoutes = require('./src/routes/courier');

const app = express();
app.set('trust proxy', 1); // needed for correct req.ip behind Render/Railway/etc. reverse proxies

// ---- Security headers ----
app.use(helmet({
  contentSecurityPolicy: false // the storefront already sets its own inline styles/scripts;
                                // enable and configure a strict CSP once the frontend is finalized
}));

// ---- CORS: only allow the real storefront origin to call this API ----
app.use(cors({
  origin: process.env.STOREFRONT_URL,
  credentials: true
}));

app.use(cookieParser());

// ---- General API rate limit (in addition to the stricter per-route limits) ----
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

// ---- Stripe webhook needs the RAW body for signature verification,
//      so it's mounted BEFORE the JSON body parser, with its own
//      express.raw() middleware applied only to this one path. ----
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRoutes);

// ---- Everything else uses normal JSON body parsing ----
app.use(express.json({ limit: '100kb' }));

app.use('/api/checkout', checkoutRoutes);
app.use('/api/track', trackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/courier', courierRoutes);

// ---- Serve the storefront + checkout/tracking/admin/courier pages ----
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sweet Candy backend running on port ${PORT}`);
});
