// ---------------------------------------------------------------------
// Real driving-distance check via Google's Distance Matrix API.
// Requires GOOGLE_MAPS_API_KEY with "Distance Matrix API" enabled
// and billing active on the Google Cloud project.
// ---------------------------------------------------------------------

const fetch = require('node-fetch');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const STORE_ADDRESS = process.env.STORE_ADDRESS;
const MAX_DELIVERY_DISTANCE_METERS = parseInt(process.env.MAX_DELIVERY_DISTANCE_METERS || '20000', 10);

/**
 * Checks the real driving distance from the store to a customer address.
 * Returns one of:
 *   { ok: true, distanceMeters, distanceText, durationText }
 *   { ok: false, reason: 'ADDRESS_NOT_FOUND' }        -> ask for a more complete address
 *   { ok: false, reason: 'OUTSIDE_DELIVERY_AREA', distanceMeters, distanceText }
 *   { ok: false, reason: 'SERVICE_UNAVAILABLE' }       -> Google API error/misconfiguration
 */
async function checkDeliveryDistance(customerAddress) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error(
      'GOOGLE_MAPS_API_KEY is not set. Add it to your .env before accepting delivery orders.'
    );
  }
  if (!customerAddress || typeof customerAddress !== 'string' || customerAddress.trim().length < 5) {
    return { ok: false, reason: 'ADDRESS_NOT_FOUND' };
  }

  const params = new URLSearchParams({
    origins: STORE_ADDRESS,
    destinations: customerAddress,
    mode: 'driving',
    units: 'metric',
    region: 'gr',
    key: GOOGLE_MAPS_API_KEY
  });

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;

  let data;
  try {
    const res = await fetch(url, { timeout: 10000 });
    data = await res.json();
  } catch (err) {
    console.error('Distance Matrix request failed:', err.message);
    return { ok: false, reason: 'SERVICE_UNAVAILABLE' };
  }

  if (data.status !== 'OK') {
    console.error('Distance Matrix API returned status:', data.status, data.error_message || '');
    return { ok: false, reason: 'SERVICE_UNAVAILABLE' };
  }

  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== 'OK') {
    // NOT_FOUND or ZERO_RESULTS -> address could not be matched to a real route
    return { ok: false, reason: 'ADDRESS_NOT_FOUND' };
  }

  const distanceMeters = element.distance.value;
  const distanceText = element.distance.text;
  const durationText = element.duration.text;

  if (distanceMeters > MAX_DELIVERY_DISTANCE_METERS) {
    return { ok: false, reason: 'OUTSIDE_DELIVERY_AREA', distanceMeters, distanceText };
  }

  return { ok: true, distanceMeters, distanceText, durationText };
}

module.exports = { checkDeliveryDistance };
