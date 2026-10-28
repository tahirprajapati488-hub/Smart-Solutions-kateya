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

    return res.status(200).json({
      products: data
    });
  } catch (error) {
    console.error('Products API error:', error.message);

    return res.status(500).json({
      error: 'Server error'
    });
  }
}
