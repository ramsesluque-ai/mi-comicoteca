import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const OWNER='0bcbe06d-263d-4ac1-a516-355d27d417f1';
const ORIGINS=new Set(['https://micomicteca.es','https://www.micomicteca.es','https://mi-comicoteca.ramsesluque.workers.dev']);
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGINS.has(origin)?origin:'https://micomicteca.es','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,OPTIONS','Vary':'Origin'};
 const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='GET'||!ORIGINS.has(origin))return respond({error:'Acceso no permitido'},403);
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token)return respond({error:'Inicia sesión'},401);
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await auth.auth.getUser(token);
 if(error||user?.id!==OWNER)return respond({error:'Solo administración'},403);
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:subscriptions,error:subError}=await admin.from('subscriptions').select('*').limit(1000);
 if(subError)return respond({error:'No se pueden consultar las suscripciones'},500);
 const subsById=new Map((subscriptions||[]).map(s=>[s.user_id,s]));
 const users=[];let page=1;
 while(page<=30){
  const {data,error:listError}=await admin.auth.admin.listUsers({page,perPage:100});
  if(listError)return respond({error:'No se puede consultar el registro de usuarios'},500);
  for(const u of data.users){
   const s=subsById.get(u.id);
   users.push({id:u.id,email:u.email||'',registered_at:u.created_at,last_sign_in_at:u.last_sign_in_at||null,subscription_status:s?.status||'not_subscribed',period_end:s?.current_period_end||null});
  }
  if(data.users.length<100)break;
  page++;
 }
 users.sort((a,b)=>String(b.registered_at).localeCompare(String(a.registered_at)));
 return respond({users,generated_at:new Date().toISOString()});
});