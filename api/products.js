import { createClient } from '@supabase/supabase-js';

function buildOfferSummary(basePrice, offer) {
  const originalPrice = Number(basePrice);

  if (!offer || !offer.is_active) {
    return {
      original_price: Number.isFinite(originalPrice) ? originalPrice : 0,
      discounted_price: Number.isFinite(originalPrice) ? originalPrice : 0,
      offer: null
    };
  }

  const discountValue = Number(offer.discount_value);
  const safePrice = Number.isFinite(originalPrice) ? originalPrice : 0;

  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return {
      original_price: safePrice,
      discounted_price: safePrice,
      offer: null
    };
  }

  let finalPrice = safePrice;

  if (offer.discount_type === 'percentage') {
    if (discountValue > 100) {
      return {
        original_price: safePrice,
        discounted_price: safePrice,
        offer: null
      };
    }
    finalPrice = safePrice * (1 - discountValue / 100);
  } else if (offer.discount_type === 'fixed') {
    finalPrice = safePrice - discountValue;
  }

  if (!Number.isFinite(finalPrice) || finalPrice < 0) {
    finalPrice = 0;
  }

  const offerSummary = {
    id: offer.id,
    title: offer.title,
    discount_type: offer.discount_type,
    discount_value: discountValue,
    original_price: safePrice,
    discounted_price: Number(finalPrice.toFixed(2))
  };

  return {
    original_price: safePrice,
    discounted_price: Number(finalPrice.toFixed(2)),
    offer: offerSummary
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, description, price, image_url, category, stock')
      .eq('active', true)
      .order('id', { ascending: true });

    if (productsError) {
      console.error('Products lookup failed:', productsError.message);
      return res.status(500).json({ error: 'Could not load products' });
    }

    const productIds = (products || []).map((product) => product.id);
    let offerMap = new Map();

    if (productIds.length > 0) {
      const now = new Date().toISOString();
      const { data: offers, error: offersError } = await supabase
        .from('product_offers')
        .select('id, product_id, title, discount_type, discount_value, start_date, end_date, is_active')
        .in('product_id', productIds)
        .eq('is_active', true)
        .lte('start_date', now)
        .gte('end_date', now);

      if (offersError) {
        console.error('Offers lookup failed:', offersError.message);
        return res.status(500).json({ error: 'Could not load product offers' });
      }

      for (const offer of offers || []) {
        offerMap.set(String(offer.product_id), offer);
      }
    }

    const resolvedProducts = (products || []).map((product) => {
      const offer = offerMap.get(String(product.id));
      const { original_price, discounted_price, offer: offerSummary } = buildOfferSummary(product.price, offer);

      return {
        ...product,
        price: Number(product.price),
        original_price,
        discounted_price,
        offer: offerSummary
      };
    });

    return res.status(200).json({ products: resolvedProducts });
  } catch (error) {
    console.error('Products API error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
