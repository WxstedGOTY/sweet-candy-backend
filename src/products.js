// ---------------------------------------------------------------------
// Canonical product catalog. This is the ONLY source of truth for
// prices used when calculating an order total. The frontend cart may
// send item ids and quantities, but prices are always looked up here,
// server-side — the client's own price data is never trusted.
//
// Keep this in sync with the `prices` object in index.html if you
// change menu prices there.
// ---------------------------------------------------------------------

const PRODUCTS = {
  edam: 0.90, edam_grated: 1.20, philadelphia: 0.90, feta: 1.20, ham: 0.90, turkey: 0.90, bacon: 1.20, salami: 0.90,
  frank_sausage: 1.50, country_sausage: 1.50, oregano_sausage: 1.50, breaded_chicken: 1.20, beef_pork_patty: 1.80, chicken_breast: 1.50,
  tomato: 0.90, green_pepper: 0.90, mushrooms: 0.90, onion: 0.90, lettuce: 0.90, corn: 0.90, olives: 0.90, boiled_egg: 1.00, omelette: 1.20, cheese_croquettes: 1.20,
  tzatziki: 0.90, bbq: 0.90, pink_sauce: 0.90, yellow_sauce: 0.90, mayo: 0.90, hungarian: 0.90, spicy_cheese: 0.90, mustard: 0.00, ketchup: 0.00,
  pita_special: 4.80,
  praline: 1.90, white_choc: 1.90, banana: 0.90, walnut: 0.90, coconut: 0.90, almond: 0.90, biscuit: 0.90, oreo_biscuit: 1.20, filled_biscuit: 1.20, strawberry_jam: 0.90, caprice: 1.20,
  savory_crepe: 2.50, sandwich_base: 2.50, sweet_crepe: 2.50, pancakes: 3.50, waffle: 3.50,
  espresso_single: 2.00, espresso_double: 3.00, cappuccino: 3.00, freddo_espresso: 2.50, freddo_cappuccino: 3.00, americano: 2.50,
  chocolate: 2.45, madagascar_vanilla: 2.45, strawberry: 2.45, vanilla_parfait: 2.45, stracciatella: 2.45, cookie_oreo: 2.45,
  salted_caramel: 2.45, triple_choc: 2.45, ferrero: 2.45, bueno: 2.45, aegina_pistachio: 2.45, kunefe: 2.45, banoffee: 2.45,
  cheesecake_amarena: 2.45, red_velvet: 2.45, yogurt_nuts_berries: 2.45, dubai_choc: 2.45, lotus: 2.45, apple_strudel: 2.45,
  madagascar_bianca: 2.45, lemon_sorbet: 2.45, mango_sorbet: 2.45, tiramisu: 2.45, choco_brownies: 2.45
};

function priceOf(productId) {
  return Object.prototype.hasOwnProperty.call(PRODUCTS, productId) ? PRODUCTS[productId] : null;
}

/**
 * Recomputes a cart's subtotal from trusted server-side prices.
 * Throws if any item id is unknown or quantity is invalid.
 * @param {Array<{id:string, qty:number}>} cartItems
 */
function computeSubtotal(cartItems) {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error('Cart is empty.');
  }
  let subtotal = 0;
  const lineItems = [];
  for (const item of cartItems) {
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      throw new Error(`Invalid quantity for item "${item.id}".`);
    }
    const price = priceOf(item.id);
    if (price === null) {
      throw new Error(`Unknown product: "${item.id}".`);
    }
    const lineTotal = Math.round(price * qty * 100) / 100;
    subtotal += lineTotal;
    lineItems.push({ id: item.id, qty, unitPrice: price, lineTotal });
  }
  return { subtotal: Math.round(subtotal * 100) / 100, lineItems };
}

module.exports = { PRODUCTS, priceOf, computeSubtotal };
