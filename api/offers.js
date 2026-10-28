import { createClient } from '@supabase/supabase-js';

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

    const productId = req.query?.product_id;
    const nowIso = new Date().toISOString();

    let query = supabase
      .from('product_offers')
      .select('id, product_id, title, discount_type, discount_value, start_date, end_date, is_active, products(name, price)')
      .eq('is_active', true)
      .lte('start_date', nowIso)
      .gte('end_date', nowIso)
      .order('start_date', { ascending: false });

    if (productId) {
      query = query.eq('product_id', Number(productId));
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({
      offers: (data || []).map((offer) => ({
        ...offer,
        product_name: offer.products?.name || 'Unknown product',
        product_price: offer.products?.price ?? null
      }))
    });
  } catch (error) {
    console.error('Public offers API error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
