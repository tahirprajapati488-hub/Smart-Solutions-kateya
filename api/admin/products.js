import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const allowedMethods = ['GET', 'POST', 'PATCH', 'DELETE'];

  if (!allowedMethods.includes(req.method)) {
    res.setHeader('Allow', allowedMethods.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      error: 'Server configuration missing'
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : '';

  if (!token) {
    return res.status(401).json({ error: 'Login required' });
  }

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

  try {
    // Verify the user's Supabase access token.
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Invalid login session' });
    }

    const user = authData.user;

    // Only users listed in the admins table are allowed.
    // This assumes public.admins has a user_id UUID column
    // containing the corresponding Supabase Auth user ID.
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminError) {
      console.error('Admin check failed:', adminError.message);
      return res.status(500).json({
        error: 'Could not verify admin permissions'
      });
    }

    if (!admin) {
      return res.status(403).json({ error: 'Admin access denied' });
    }

    // GET: List all products for the admin.
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('id', { ascending: false });

      if (error) throw error;

      return res.status(200).json({ products: data });
    }

    const body = req.body || {};

    // POST: Create a product.
    if (req.method === 'POST') {
      const name = typeof body.name === 'string'
        ? body.name.trim()
        : '';

      const category = typeof body.category === 'string'
        ? body.category.trim()
        : '';

      const description = typeof body.description === 'string'
        ? body.description.trim()
        : '';

      const image_url = typeof body.image_url === 'string'
        ? body.image_url.trim()
        : '';

      const price = Number(body.price);
      const stock = Number(body.stock);

      if (!name || name.length > 150) {
        return res.status(400).json({ error: 'Invalid product name' });
      }

      if (!category || category.length > 80) {
        return res.status(400).json({ error: 'Invalid category' });
      }

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ error: 'Invalid price' });
      }

      if (!Number.isSafeInteger(stock) || stock < 0) {
        return res.status(400).json({ error: 'Invalid stock quantity' });
      }

      if (description.length > 5000) {
        return res.status(400).json({ error: 'Description is too long' });
      }

      if (
        image_url &&
        (
          image_url.length > 2048 ||
          !/^https:\/\//i.test(image_url)
        )
      ) {
        return res.status(400).json({
          error: 'Image URL must use HTTPS'
        });
      }

      const { data, error } = await supabase
        .from('products')
        .insert({
          name,
          category,
          description,
          price,
          stock,
          image_url: image_url || null,
          active: true
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({
        message: 'Product created',
        product: data
      });
    }

    const id = Number(body.id);

    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Valid product ID required' });
    }

    // PATCH: Update product details or active status.
    if (req.method === 'PATCH') {
      const updates = {};

      if (body.name !== undefined) {
        if (
          typeof body.name !== 'string' ||
          !body.name.trim() ||
          body.name.trim().length > 150
        ) {
          return res.status(400).json({ error: 'Invalid product name' });
        }
        updates.name = body.name.trim();
      }

      if (body.category !== undefined) {
        if (
          typeof body.category !== 'string' ||
          !body.category.trim() ||
          body.category.trim().length > 80
        ) {
          return res.status(400).json({ error: 'Invalid category' });
        }
        updates.category = body.category.trim();
      }

      if (body.description !== undefined) {
        if (
          typeof body.description !== 'string' ||
          body.description.length > 5000
        ) {
          return res.status(400).json({ error: 'Invalid description' });
        }
        updates.description = body.description.trim();
      }

      if (body.price !== undefined) {
        const price = Number(body.price);
        if (!Number.isFinite(price) || price <= 0) {
          return res.status(400).json({ error: 'Invalid price' });
        }
        updates.price = price;
      }

      if (body.stock !== undefined) {
        const stock = Number(body.stock);
        if (!Number.isSafeInteger(stock) || stock < 0) {
          return res.status(400).json({ error: 'Invalid stock' });
        }
        updates.stock = stock;
      }

      if (body.image_url !== undefined) {
        if (typeof body.image_url !== 'string') {
          return res.status(400).json({ error: 'Invalid image URL' });
        }

        const imageUrl = body.image_url.trim();

        if (
          imageUrl &&
          (
            imageUrl.length > 2048 ||
            !/^https:\/\//i.test(imageUrl)
          )
        ) {
          return res.status(400).json({ error: 'Image URL must use HTTPS' });
        }

        updates.image_url = imageUrl || null;
      }

      if (body.active !== undefined) {
        if (typeof body.active !== 'boolean') {
          return res.status(400).json({ error: 'Invalid active status' });
        }
        updates.active = body.active;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No changes provided' });
      }

      const { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({ error: 'Product not found' });
      }

      return res.status(200).json({
        message: 'Product updated',
        product: data
      });
    }

    // DELETE: Permanently delete a product.
    if (req.method === 'DELETE') {
      const { data, error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({ error: 'Product not found' });
      }

      return res.status(200).json({ message: 'Product deleted' });
    }
  } catch (error) {
    console.error('Admin products API error:', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
        }
