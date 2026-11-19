import Stripe from 'npm:stripe@22.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const ORIGINS=new Set(['https://micomicteca.es','https://www.micomicteca.es','https://mi-comicoteca.ramsesluque.workers.dev']);
const PRICE_ID='price_1UXof1BSgo4Eri2pvUIG4aTX';
const headersFor=(origin:string)=>({'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'});
const jsonFor=(origin:string)=>(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headersFor(origin),'Content-Type':'application/json'}});
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||''; const responseOrigin=ORIGINS.has(origin)?origin:'https://micomicteca.es'; const json=jsonFor(responseOrigin);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headersFor(responseOrigin)});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 if(!ORIGINS.has(origin))return json({error:'Origen no autorizado'},403);
 const token=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return json({error:'Inicia sesión para continuar'},401);
 const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),secret=Deno.env.get('STRIPE_LIVE_SECRET_KEY');
 if(!url||!anon||!service||!secret||!(/^(sk_live_|rk_live_)/.test(secret)))return json({error:'Stripe real aún no está configurado en el servidor. No se ha efectuado ningún cargo.'},503);
 try{
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user?.id||!user.email)return json({error:'Sesión caducada. Vuelve a entrar.'},401);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:existing,error:dbError}=await admin.from('subscriptions').select('customer_id,status').eq('user_id',user.id).maybeSingle();
  if(dbError)throw dbError;
  if(['active','trialing'].includes(existing?.status||''))return json({error:'La membresía ya está activa'},409);
  const stripe=new Stripe(secret);
  const price=await stripe.prices.retrieve(PRICE_ID,{expand:['product']});
  if(!price.livemode||!price.active||price.currency!=='eur'||price.unit_amount!==999||price.recurring?.interval!=='month'||typeof price.product==='string'||price.product.name!=='MI COMICOTECA')return json({error:'Tarifa real no válida; operación detenida'},503);
  const isTester=user.email.trim().toLowerCase()==='contactonosolocomics@gmail.com'&&!existing?.customer_id;
  const priorCustomers=isTester?await stripe.customers.list({email:user.email,limit:20}):{data:[]};
  const hasPriorSubscription=isTester&&(await Promise.all(priorCustomers.data.map(c=>stripe.subscriptions.list({customer:c.id,status:'all',limit:1})))).some(result=>result.data.length>0);
  const grantTrial=isTester&&!hasPriorSubscription;
  const session=await stripe.checkout.sessions.create({mode:'subscription',line_items:[{price:PRICE_ID,quantity:1}],customer:existing?.customer_id||undefined,customer_email:existing?.customer_id?undefined:user.email,client_reference_id:user.id,metadata:{user_id:user.id,app:'mi-comicoteca',tester_trial:grantTrial?'30_days':'none'},subscription_data:{metadata:{user_id:user.id,app:'mi-comicoteca'},...(grantTrial?{trial_period_days:30}:{})},success_url:origin+'/?checkout=success&session_id={CHECKOUT_SESSION_ID}',cancel_url:origin+'/?checkout=cancelled'});
  return json({url:session.url,livemode:true});
 }catch(e){console.error('Live checkout failure',e);return json({error:'No se pudo iniciar el pago real. No se ha efectuado ningún cargo.'},500)}
});