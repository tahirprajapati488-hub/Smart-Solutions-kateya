const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_STATUSES = [
  "Pending",
  "Contacted",
  "Token Requested",
  "Confirmed",
  "Cancelled"
];

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "PATCH"].includes(req.method)) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({ error: "Please log in" });
    }

    const { data: userData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !userData.user) {
      return res.status(401).json({ error: "Invalid login" });
    }

    const { data: admin, error: adminError } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (adminError || !admin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      return res.status(200).json({ orders: data || [] });
    }

    const body = req.body || {};
    const orderId = body.id;
    const status = body.status;

    if (
      orderId === undefined ||
      !Number.isInteger(Number(orderId)) ||
      !ALLOWED_STATUSES.includes(status)
    ) {
      return res.status(400).json({ error: "Invalid order ID or status" });
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", Number(orderId))
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: "Order not found" });
    }

    return res.status(200).json({ order: data });
  } catch (error) {
    console.error("Admin orders API error:", error);
    return res.status(500).json({ error: "Server error while processing orders" });
  }
};
