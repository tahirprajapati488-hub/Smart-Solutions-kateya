import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

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

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  if (!token) {
    return res.status(401).json({ error: 'Login required' });
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

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Invalid login session' });
    }

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    if (adminError) {
      return res.status(500).json({ error: 'Admin verification failed' });
    }

    if (!admin) {
      return res.status(403).json({ error: 'Admin access denied' });
    }

    const { image, contentType } = req.body || {};

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (
      typeof image !== 'string' ||
      !allowedTypes.includes(contentType) ||
      !/^data:image\/(jpeg|png|webp);base64,/.test(image)
    ) {
      return res.status(400).json({ error: 'Invalid image' });
    }

    const base64 = image.substring(image.indexOf(',') + 1);
    const buffer = Buffer.from(base64, 'base64');

    if (
      !buffer.length ||
      buffer.length > 3 * 1024 * 1024 ||
      buffer.toString('base64') !== base64
    ) {
      return res.status(400).json({
        error: 'Image must be valid and no larger than 3 MB'
      });
    }

    const extension = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp'
    }[contentType];

    const filePath = `${randomUUID()}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filePath, buffer, {
        contentType,
        upsert: false
      });

    if (uploadError) {
      console.error('Image upload failed:', uploadError.message);
      return res.status(500).json({ error: 'Image upload failed' });
    }

    const { data } = supabase.storage
      .from('product-images')
      .getPublicUrl(filePath);

    return res.status(200).json({
      image_url: data.publicUrl
    });

  } catch (error) {
    console.error('Upload API error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
      }
