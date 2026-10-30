import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server configuration missing' });
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const now = new Date().toISOString();
    const { data, error } = await db.from('site_banners')
      .select('id,title,subtitle,image_url,button_text,link_url,start_date,end_date,is_active,sort_order')
      .eq('is_active', true).lte('start_date', now).gt('end_date', now)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) throw error;
    return res.status(200).json({ banners: data || [] });
  } catch (error) {
    console.error('Public banners API error:', error.message);
    return res.status(500).json({ error: 'Could not load banners' });
  }
}
