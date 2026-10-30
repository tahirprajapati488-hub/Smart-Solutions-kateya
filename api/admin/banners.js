import { createClient } from '@supabase/supabase-js';

const allowedImage = value => typeof value === 'string' && value.length <= 2048 && /^https:\/\//i.test(value);
const validDate = value => Number.isFinite(new Date(value).getTime());

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const methods = ['GET', 'POST', 'PATCH', 'DELETE'];
  if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); return res.status(405).json({ error: 'Method not allowed' }); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server configuration missing' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return res.status(401).json({ error: 'Invalid login session' });
    const { data: admin, error: adminError } = await db.from('admins').select('user_id').eq('user_id', auth.user.id).maybeSingle();
    if (adminError) return res.status(500).json({ error: 'Admin verification failed' });
    if (!admin) return res.status(403).json({ error: 'Admin access denied' });

    if (req.method === 'GET') {
      const { data, error } = await db.from('site_banners').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ banners: data || [] });
    }

    const body = req.body || {};
    if (req.method === 'DELETE') {
      if (!body.id) return res.status(400).json({ error: 'Poster ID required' });
      const { error } = await db.from('site_banners').delete().eq('id', body.id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    if (req.method === 'PATCH' && body.id && typeof body.is_active === 'boolean' && body.title === undefined) {
      const { data, error } = await db.from('site_banners').update({ is_active: body.is_active, updated_at: new Date().toISOString() }).eq('id', body.id).select('*').single();
      if (error) throw error;
      return res.status(200).json({ banner: data });
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const subtitle = typeof body.subtitle === 'string' ? body.subtitle.trim() : '';
    const image_url = typeof body.image_url === 'string' ? body.image_url.trim() : '';
    const button_text = typeof body.button_text === 'string' ? body.button_text.trim() : '';
    const link_url = typeof body.link_url === 'string' ? body.link_url.trim() : '';
    const start = new Date(body.start_date), end = new Date(body.end_date);
    const sort_order = Number(body.sort_order ?? 0);
    if (!title || title.length > 120 || subtitle.length > 300 || !allowedImage(image_url) || button_text.length > 40 || link_url.length > 2048 || (link_url && !allowedImage(link_url)) || !validDate(body.start_date) || !validDate(body.end_date) || end <= start || !Number.isInteger(sort_order) || sort_order < 0 || sort_order > 9999) {
      return res.status(400).json({ error: 'Title, HTTPS image, dates and display order check करें। End date start date के बाद होनी चाहिए।' });
    }
    const payload = { title, subtitle, image_url, button_text, link_url: link_url || null, start_date: start.toISOString(), end_date: end.toISOString(), is_active: body.is_active !== false, sort_order, updated_at: new Date().toISOString() };
    let result;
    if (req.method === 'PATCH' && body.id) result = await db.from('site_banners').update(payload).eq('id', body.id).select('*').single();
    else result = await db.from('site_banners').insert(payload).select('*').single();
    if (result.error) throw result.error;
    return res.status(req.method === 'POST' ? 201 : 200).json({ banner: result.data });
  } catch (error) {
    console.error('Admin banners API error:', error.message);
    return res.status(500).json({ error: 'Poster operation failed. Confirm the site_banners SQL migration has been applied.' });
  }
}
