import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

function calculateOfferPrice(basePrice, offer) {
  const originalPrice = Number(basePrice);

  if (!offer) {
    return {
      original_price: Number.isFinite(originalPrice) ? originalPrice : 0,
      discounted_price: Number.isFinite(originalPrice) ? originalPrice : 0,
      offer_title: null,
      offer_type: null,
      discount_value: 0
    };
  }

  const discountValue = Number(offer.discount_value);
  let finalPrice = originalPrice;

  if (offer.discount_type === 'percentage') {
    if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100) {
      throw new Error('Invalid offer discount');
    }
    finalPrice = originalPrice * (1 - discountValue / 100);
  } else if (offer.discount_type === 'fixed') {
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      throw new Error('Invalid offer discount');
    }
    finalPrice = originalPrice - discountValue;
  } else {
    throw new Error('Unsupported discount type');
  }

  if (!Number.isFinite(finalPrice) || finalPrice < 0) {
    throw new Error('Discounted price cannot be negative');
  }

  return {
    original_price: originalPrice,
    discounted_price: Number(finalPrice.toFixed(2)),
    offer_title: offer.title || null,
    offer_type: offer.discount_type,
    discount_value: discountValue
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server configuration missing' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { customer_name, customer_phone, customer_address, items } = req.body || {};

    if (
      typeof customer_name !== 'string' ||
      customer_name.trim().length < 2 ||
      customer_name.trim().length > 100 ||
      !/^[6-9]\d{9}$/.test(String(customer_phone || '')) ||
      typeof customer_address !== 'string' ||
      customer_address.trim().length < 10 ||
      customer_address.trim().length > 500
    ) {
      return res.status(400).json({ error: 'Please enter valid customer details.' });
    }

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return res.status(400).json({ error: 'Invalid cart items.' });
    }

    const quantities = new Map();

    for (const item of items) {
      const id = String(item?.id ?? '');
      const qty = Number(item?.qty);

      if (!/^\d+$/.test(id) || !Number.isSafeInteger(qty) || qty < 1 || qty > 1000) {
        return res.status(400).json({ error: 'Invalid product or quantity.' });
      }

      quantities.set(id, (quantities.get(id) || 0) + qty);

      if (quantities.get(id) > 1000) {
        return res.status(400).json({ error: 'Quantity limit exceeded.' });
      }
    }

    const productIds = [...quantities.keys()];
    const nowIso = new Date().toISOString();

    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, name, price, active, stock')
      .in('id', productIds);

    if (productError) {
      console.error('Product lookup failed:', productError.message);
      return res.status(500).json({ error: 'Could not verify products.' });
    }

    if (!products || products.length !== productIds.length) {
      return res.status(400).json({ error: 'One or more products are unavailable.' });
    }

    const { data: activeOffers, error: offersError } = await supabase
      .from('product_offers')
      .select('id, product_id, title, discount_type, discount_value, start_date, end_date, is_active')
      .in('product_id', productIds)
      .eq('is_active', true)
      .lte('start_date', nowIso)
      .gte('end_date', nowIso);

    if (offersError) {
      console.error('Offer lookup failed:', offersError.message);
      return res.status(500).json({ error: 'Could not verify offers.' });
    }

    const offerMap = new Map();
    for (const offer of activeOffers || []) {
      offerMap.set(String(offer.product_id), offer);
    }

    let total = 0;
    const verifiedItems = [];

    for (const product of products) {
      const qty = quantities.get(String(product.id));
      const basePrice = Number(product.price);
      const offer = offerMap.get(String(product.id));
      const pricing = calculateOfferPrice(basePrice, offer);

      if (
        product.active !== true ||
        !Number.isFinite(basePrice) ||
        basePrice < 0 ||
        !Number.isInteger(product.stock) ||
        product.stock < qty ||
        !Number.isFinite(pricing.discounted_price) ||
        pricing.discounted_price < 0
      ) {
        return res.status(400).json({ error: 'A product is inactive, out of stock, or has an invalid discount.' });
      }

      const discountedPrice = Number(pricing.discounted_price.toFixed(2));
      const discountAmount = Number(Math.max(0, pricing.original_price - discountedPrice).toFixed(2));

      total += discountedPrice * qty;

      verifiedItems.push({
        id: product.id,
        name: product.name,
        price: discountedPrice,
        original_price: pricing.original_price,
        discount_amount: discountAmount,
        offer_title: pricing.offer_title,
        qty
      });
    }

    if (!Number.isFinite(total)) {
      return res.status(400).json({ error: 'Invalid order total.' });
    }

    const order_number = 'SSK-' + randomUUID();
    const { data, error } = await supabase
      .from('orders')
      .insert([{
        order_number,
        customer_name: customer_name.trim(),
        customer_phone: String(customer_phone),
        customer_address: customer_address.trim(),
        items: verifiedItems,
        total_amount: Number(total.toFixed(2)),
        payment_method: 'COD',
        status: 'Pending'
      }])
      .select('order_number')
      .single();

    if (error) {
      console.error('Order insert failed:', error.message);
      return res.status(500).json({ error: 'Could not save order.' });
    }

    return res.status(201).json({
      success: true,
      order_number: data.order_number,
      total_amount: Number(total.toFixed(2)),
      message: 'Order request received. The seller will contact you to confirm the order and token amount.'
    });
  } catch (error) {
    console.error('Order API error:', error.message);
    return res.status(500).json({ error: 'Server error.' });
  }
}
