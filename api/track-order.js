module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const orderNumber = String(
      req.body?.order_number || ""
    ).trim();

    const phone = String(
      req.body?.customer_phone || ""
    ).replace(/\D/g, "");

    if (
      !orderNumber ||
      !/^[6-9]\d{9}$/.test(phone)
    ) {
      return res.status(400).json({
        error: "Order Number aur 10-digit mobile number daalein."
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Server configuration missing");
    }

    const query = new URLSearchParams({
      select: "order_number,status,total_amount,created_at,items",
      order_number: `eq.${orderNumber}`,
      customer_phone: `eq.${phone}`,
      limit: "1"
    });

    const response = await fetch(
      `${supabaseUrl}/rest/v1/orders?${query.toString()}`,
      {
        method: "GET",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`
        }
      }
    );

    if (!response.ok) {
      console.error(
        "Order tracking query failed:",
        response.status
      );

      return res.status(500).json({
        error: "Tracking abhi available nahi hai."
      });
    }

    const orders = await response.json();

    if (!orders.length) {
      return res.status(404).json({
        error: "Order Number ya mobile number match nahi hua."
      });
    }

    const order = orders[0];

    return res.status(200).json({
      order_number: order.order_number,
      status: order.status,
      total_amount: order.total_amount,
      created_at: order.created_at,
      items: order.items
    });

  } catch (error) {
    console.error("Track order error:", error);

    return res.status(500).json({
      error: "Server error. Baad mein try karein."
    });
  }
};
