import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

    const {
      customer_name,
      customer_phone,
      customer_address,
      items
    } = req.body || {};

    // Validate customer details
    if (
      typeof customer_name !== 'string' ||
      customer_name.trim().length < 2 ||
      customer_name.trim().length > 100 ||
      !/^[6-9]\d{9}$/.test(
        String(customer_phone || '')
      ) ||
      typeof customer_address !== 'string' ||
      customer_address.trim().length < 10 ||
      customer_address.trim().length > 500
    ) {
      return res.status(400).json({
        error: 'Please enter valid customer details.'
      });
    }

    // Validate cart
    if (
      !Array.isArray(items) ||
      items.length === 0 ||
      items.length > 50
    ) {
      return res.status(400).json({
        error: 'Invalid cart items.'
      });
    }

    const quantities = new Map();

    for (const item of items) {
      const id = String(item?.id ?? '');
      const qty = Number(item?.qty);

      if (
        !/^\d+$/.test(id) ||
        !Number.isSafeInteger(qty) ||
        qty < 1 ||
        qty > 1000
      ) {
        return res.status(400).json({
          error: 'Invalid product or quantity.'
        });
      }

      quantities.set(
        id,
        (quantities.get(id) || 0) + qty
      );

      if (quantities.get(id) > 1000) {
        return res.status(400).json({
          error: 'Quantity limit exceeded.'
        });
      }
    }

    const productIds = [...quantities.keys()];

    // Verify products and prices using the database
    const {
      data: products,
      error: productError
    } = await supabase
      .from('products')
      .select('id, name, price, active, stock')
      .in('id', productIds);

    if (productError) {
      console.error(
        'Product lookup failed:',
        productError.message
      );

      return res.status(500).json({
        error: 'Could not verify products.'
      });
    }

    if (
      !products ||
      products.length !== productIds.length
    ) {
      return res.status(400).json({
        error: 'One or more products are unavailable.'
      });
    }

    let total = 0;
    const verifiedItems = [];

    for (const product of products) {
      const qty = quantities.get(String(product.id));
      const price = Number(product.price);

      if (
        product.active !== true ||
        !Number.isFinite(price) ||
        price < 0 ||
        !Number.isInteger(product.stock) ||
        product.stock < qty
      ) {
        return res.status(400).json({
          error: 'A product is inactive or out of stock.'
        });
      }

      total += price * qty;

      verifiedItems.push({
        id: product.id,
        name: product.name,
        price,
        qty
      });
    }

    if (!Number.isFinite(total)) {
      return res.status(400).json({
        error: 'Invalid order total.'
      });
    }

    // No minimum order amount for retail orders
    const order_number = 'SSK-' + randomUUID();

    const {
      data,
      error
    } = await supabase
      .from('orders')
      .insert([{
        order_number,
        customer_name: customer_name.trim(),
        customer_phone: String(customer_phone),
        customer_address: customer_address.trim(),
        items: verifiedItems,
        total_amount: Number(total.toFixed(2)),
        payment_method: 'COD',
        status: 'Pending'
      }])
      .select('order_number')
      .single();

    if (error) {
      console.error(
        'Order insert failed:',
        error.message
      );

      return res.status(500).json({
        error: 'Could not save order.'
      });
    }

    return res.status(201).json({
      success: true,
      order_number: data.order_number,
      total_amount: Number(total.toFixed(2)),
      message:
        'Order request received. The seller will contact you to confirm the order and token amount.'
    });

  } catch (error) {
    console.error(
      'Order API error:',
      error.message
    );

    return res.status(500).json({
      error: 'Server error.'
    });
  }
      }
