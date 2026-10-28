import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: 'Server configuration missing'
    });
  }

  try {
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const { data, error } = await supabase
      .from('products')
      .select('id, name, description, price, image_url, category, stock')
      .eq('active', true)
      .order('id', { ascending: true });

    if (error) {
      console.error('Products lookup failed:', error.message);
      return res.status(500).json({
        error: 'Could not load products'
      });
    }

    const now = new Date().toISOString();
    const { data: offers, error: offersError } = await supabase
      .from('product_offers').select('*').eq('is_active', true)
      .lte('start_date', now).gt('end_date', now);
    if (offersError && !/product_offers/i.test(offersError.message || '')) throw offersError;
    const activeOffers = offers || [];
    const productsWithOffers = (data || []).map(product => {
      const offer = activeOffers.find(o => String(o.product_id) === String(product.id));
      if (!offer) return { ...product, offer: null, final_price: Number(product.price) };
      const price = Number(product.price), value = Number(offer.discount_value);
      const finalPrice = Math.max(0, offer.discount_type === 'percentage' ? price * (1 - value / 100) : price - value);
      return { ...product, offer: { id: offer.id, title: offer.title, discount_type: offer.discount_type, discount_value: value }, final_price: Number(finalPrice.toFixed(2)) };
    });
    return res.status(200).json({ products: productsWithOffers });
  } catch (error) {
    console.error('Products API error:', error.message);

    return res.status(500).json({
      error: 'Server error'
    });
  }
}
