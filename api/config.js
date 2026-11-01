export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!supabaseUrl || !supabaseAnonKey) return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY in Vercel Environment Variables.' });
  return res.status(200).json({ supabaseUrl, supabaseAnonKey });
}
