import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
  if (!['GET','POST','PATCH','DELETE'].includes(req.method)) { res.setHeader('Allow','GET, POST, PATCH, DELETE'); return res.status(405).json({error:'Method not allowed'}); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({error:'Server configuration missing'});
  const token=(req.headers.authorization||'').startsWith('Bearer ')?req.headers.authorization.slice(7):'';
  if(!token) return res.status(401).json({error:'Login required'});
  const db=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    const {data:auth,error:authErr}=await db.auth.getUser(token);
    if(authErr||!auth.user) return res.status(401).json({error:'Invalid login session'});
    const {data:admin,error:adminErr}=await db.from('admins').select('user_id').eq('user_id',auth.user.id).maybeSingle();
    if(adminErr) return res.status(500).json({error:'Could not verify admin permissions'});
    if(!admin) return res.status(403).json({error:'Admin access denied'});
    if(req.method==='GET') { const {data,error}=await db.from('product_offers').select('*').order('created_at',{ascending:false}); if(error) throw error; return res.status(200).json({offers:data||[]}); }
    const b=req.body||{};
    if(req.method==='DELETE') { if(!b.id) return res.status(400).json({error:'Offer id required'}); const {error}=await db.from('product_offers').delete().eq('id',b.id); if(error) throw error; return res.status(200).json({success:true}); }
    if(req.method==='PATCH' && b.id && typeof b.is_active==='boolean' && !b.title) { const {data,error}=await db.from('product_offers').update({is_active:b.is_active,updated_at:new Date().toISOString()}).eq('id',b.id).select('*').single(); if(error) throw error; return res.status(200).json({offer:data}); }
    const title=typeof b.title==='string'?b.title.trim():''; const productId=String(b.product_id??''); const type=b.discount_type; const value=Number(b.discount_value); const start=new Date(b.start_date); const end=new Date(b.end_date);
    if(!productId||!title||title.length>120||!['percentage','fixed'].includes(type)||!Number.isFinite(value)||value<=0||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start) return res.status(400).json({error:'Check product, title, discount and date range.'});
    if(type==='percentage'&&value>100) return res.status(400).json({error:'Percentage must be 100 or less.'});
    const {data:product,error:pe}=await db.from('products').select('id,price').eq('id',productId).maybeSingle(); if(pe) throw pe; if(!product) return res.status(400).json({error:'Product not found.'}); if(type==='fixed'&&value>=Number(product.price)) return res.status(400).json({error:'Fixed discount must be less than product price.'});
    const payload={product_id:productId,title,discount_type:type,discount_value:value,start_date:start.toISOString(),end_date:end.toISOString(),is_active:b.is_active!==false,updated_at:new Date().toISOString()};
    let result;
    if(req.method==='PATCH'&&b.id){result=await db.from('product_offers').update(payload).eq('id',b.id).select('*').single();}else{result=await db.from('product_offers').insert(payload).select('*').single();}
    if(result.error) throw result.error; return res.status(req.method==='POST'?201:200).json({offer:result.data});
  } catch(e) { console.error('Offers API:',e.message); return res.status(500).json({error:'Offers operation failed. Confirm the product_offers migration has been applied.'}); }
}
