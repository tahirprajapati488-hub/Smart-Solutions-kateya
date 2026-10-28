import { createClient } from '@supabase/supabase-js';

function isValidDateString(value) {
  return typeof value === 'string' && value && !Number.isNaN(new Date(value).getTime());
}

function normalizeOfferData(raw, productPrice = null) {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const discountType = raw.discount_type === 'fixed' || raw.discount_type === 'percentage'
    ? raw.discount_type
    : '';
  const discountValue = Number(raw.discount_value);
  const startDate = raw.start_date;
  const endDate = raw.end_date;
  const isActive = typeof raw.is_active === 'boolean' ? raw.is_active : true;

  if (!title || title.length > 150) {
    throw new Error('Offer title is required and must be under 150 characters.');
  }

  if (!discountType) {
    throw new Error('Discount type must be percentage or fixed.');
  }

  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new Error('Discount value must be a valid non-negative number.');
  }

  if (discountType === 'percentage' && discountValue > 100) {
    throw new Error('Percentage discounts cannot exceed 100%.');
  }

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    throw new Error('Start date and end date are required.');
  }

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();

  if (endMs <= startMs) {
    throw new Error('End date must be after start date.');
  }

  if (productPrice !== null) {
    const basePrice = Number(productPrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      throw new Error('Product price is invalid.');
    }

    if (discountType === 'fixed' && discountValue > basePrice) {
      throw new Error('Fixed discount cannot exceed the product price.');
    }
  }

  return {
    title,
    discount_type: discountType,
    discount_value: discountValue,
    start_date: new Date(startDate).toISOString(),
    end_date: new Date(endDate).toISOString(),
    is_active: isActive
  };
}

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
    return res.status(500).json({ error: 'Server configuration missing' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Login required' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Invalid login session' });
    }

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    if (adminError) {
      console.error('Admin check failed:', adminError.message);
      return res.status(500).json({ error: 'Could not verify admin permissions' });
    }

    if (!admin) {
      return res.status(403).json({ error: 'Admin access denied' });
    }

    if (req.method === 'GET') {
      const { data: offers, error: offersError } = await supabase
        .from('product_offers')
        .select('id, product_id, title, discount_type, discount_value, start_date, end_date, is_active, created_at, updated_at, products(name, price)')
        .order('created_at', { ascending: false });

      if (offersError) throw offersError;

      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, name, price, active')
        .order('id', { ascending: true });

      if (productsError) throw productsError;

      return res.status(200).json({
        offers: (offers || []).map((offer) => ({
          ...offer,
          product_name: offer.products?.name || 'Unknown product',
          product_price: offer.products?.price ?? null
        })),
        products: products || []
      });
    }

    const body = req.body || {};

    if (req.method === 'POST') {
      const productId = Number(body.product_id);
      if (!Number.isSafeInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'Valid product ID is required.' });
      }

      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, price')
        .eq('id', productId)
        .maybeSingle();

      if (productError) throw productError;
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      const normalized = normalizeOfferData(body, product.price);

      const { data, error } = await supabase
        .from('product_offers')
        .insert({
          product_id: productId,
          title: normalized.title,
          discount_type: normalized.discount_type,
          discount_value: normalized.discount_value,
          start_date: normalized.start_date,
          end_date: normalized.end_date,
          is_active: normalized.is_active,
          created_by: authData.user.id
        })
        .select('*')
        .single();

      if (error) throw error;
      return res.status(201).json({ message: 'Offer created', offer: data });
    }

    const offerId = Number(body.id);
    if (!Number.isSafeInteger(offerId) || offerId <= 0) {
      return res.status(400).json({ error: 'Valid offer ID is required.' });
    }

    if (req.method === 'PATCH') {
      const { data: existingOffer, error: existingOfferError } = await supabase
        .from('product_offers')
        .select('product_id, discount_type, discount_value, title, start_date, end_date, is_active')
        .eq('id', offerId)
        .maybeSingle();

      if (existingOfferError) throw existingOfferError;
      if (!existingOffer) {
        return res.status(404).json({ error: 'Offer not found.' });
      }

      const { data: product, error: productError } = await supabase
        .from('products')
        .select('price')
        .eq('id', body.product_id ?? existingOffer.product_id)
        .maybeSingle();

      if (productError) throw productError;
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      const merged = {
        ...existingOffer,
        ...body,
        title: body.title ?? existingOffer.title,
        discount_type: body.discount_type ?? existingOffer.discount_type,
        discount_value: body.discount_value ?? existingOffer.discount_value,
        start_date: body.start_date ?? existingOffer.start_date,
        end_date: body.end_date ?? existingOffer.end_date,
        is_active: body.is_active ?? existingOffer.is_active,
        product_id: body.product_id ?? existingOffer.product_id
      };

      const normalized = normalizeOfferData(merged, product.price);

      const { data, error } = await supabase
        .from('product_offers')
        .update({
          product_id: Number(merged.product_id),
          title: normalized.title,
          discount_type: normalized.discount_type,
          discount_value: normalized.discount_value,
          start_date: normalized.start_date,
          end_date: normalized.end_date,
          is_active: normalized.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', offerId)
        .select('*')
        .single();

      if (error) throw error;
      return res.status(200).json({ message: 'Offer updated', offer: data });
    }

    if (req.method === 'DELETE') {
      const { data, error } = await supabase
        .from('product_offers')
        .delete()
        .eq('id', offerId)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({ error: 'Offer not found.' });
      }

      return res.status(200).json({ message: 'Offer deleted' });
    }
  } catch (error) {
    console.error('Offer API error:', error.message);
    return res.status(500).json({ error: error.message || 'Server error' });
  }
}
