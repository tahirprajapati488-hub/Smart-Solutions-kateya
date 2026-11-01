import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server configuration missing' });
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = new Date().toISOString();
    let query = db.from('product_offers').select('id,product_id,title,discount_type,discount_value,start_date,end_date,is_active').eq('is_active', true).lte('start_date', now).gt('end_date', now).order('start_date', { ascending: false });
    if (req.query?.product_id) query = query.eq('product_id', String(req.query.product_id));
    const { data: offers, error } = await query;
    if (error) throw error;
    const ids = [...new Set((offers || []).map(o => String(o.product_id)))];
    let products = [];
    if (ids.length) {
      const { data, error: productsError } = await db.from('products').select('id,name,price').in('id', ids);
      if (productsError) throw productsError;
      products = data || [];
    }
    const byId = new Map(products.map(p => [String(p.id), p]));
    return res.status(200).json({ offers: (offers || []).map(offer => { const product = byId.get(String(offer.product_id)); return { ...offer, product_name: product?.name || 'Unknown product', product_price: product?.price ?? null }; }) });
  } catch (error) {
    console.error('Public offers API error:', error.message);
    return res.status(500).json({ error: 'Could not load offers: ' + (error?.message || 'database request failed') });
  }
}
