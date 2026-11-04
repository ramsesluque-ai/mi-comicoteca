import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const URL='https://uihlavjgdqavhmpilimq.supabase.co';
const KEY='sb_publishable_GOuw-kWvc45vzQXIZ9mTYQ_HiOeHoL-';
const db=createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const note=(msg,bad=false)=>{const el=$('notice');el.textContent=msg;el.className=bad?'error':'ok';};
let user=null,hasAccess=false,seriesCache=new Map();
function el(tag,txt,cls){const n=document.createElement(tag);if(txt!==undefined)n.textContent=String(txt);if(cls)n.className=cls;return n;}
function row(title,subtitle){const n=el('div',undefined,'item');n.append(el('strong',title),el('small',subtitle||'', 'muted'));return n;}
async function guard(fn){try{await fn();}catch(e){note(e.message||String(e),true);}}
async function refresh(){const {data:{user:u},error}=await db.auth.getUser();if(error&&error.name!=='AuthSessionMissingError')console.warn(error);user=u;$('authPanel').classList.toggle('hide',!!u);$('appPanel').classList.toggle('hide',!u);if(!u)return;$('identity').textContent=u.email||'Mi cuenta';
const {data:p,error:pe}=await db.from('profiles').select('membership_active,membership_valid_until,role').eq('id',u.id).maybeSingle();if(pe)throw pe;
hasAccess=!!p&&(p.role==='admin'||(p.membership_active&&(p.membership_valid_until===null||new Date(p.membership_valid_until)>new Date())));
$('membership').textContent=hasAccess?'Membresía activa':'Membresía no activa';
$('checkout').disabled=true; // No activar cobros reales ni de prueba desde esta página hasta verificar el entorno Stripe.
$('billingMessage').textContent=hasAccess?'Acceso activo.':'Pago en preparación. No se admiten cobros hasta completar la validación del entorno real.';
await loadOwn();if(hasAccess)await searchMaster();else $('masterList').replaceChildren(el('p','El Maestro se habilita con una membresía activa.','muted'));
}
async function loadOwn(){const {data,error}=await db.from('user_comics').select('id,status,custom_title,master_comic_id,notes').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);if(error)throw error;
const filtered=(data||[]).filter(x=>!$('ownFilter').value||x.status===$('ownFilter').value);$('ownCount').textContent=(data||[]).length+' ejemplares (máximo 100 visibles)';
const list=$('ownList');list.replaceChildren();if(!filtered.length)list.append(el('p','Todavía no tienes ejemplares en esta sección.','muted'));
for(const c of filtered){const card=row(c.custom_title||'Ejemplar '+c.master_comic_id,c.status);const remove=el('button','Eliminar','secondary');remove.onclick=()=>guard(async()=>{if(!confirm('¿Eliminar este ejemplar de tu colección?'))return;const {error}=await db.from('user_comics').delete().eq('id',c.id).eq('user_id',user.id);if(error)throw error;await loadOwn();});card.append(remove);list.append(card);}}
async function searchMaster(){if(!hasAccess)return;const q=$('search').value.trim();let query=db.from('master_comics').select('id,series_id,issue_number,title,isbn,cover_url').limit(40);if(q)query=query.or('title.ilike.%'+q.replace(/[,()%]/g,'')+'%,isbn.ilike.%'+q.replace(/[,()%]/g,'')+'%');const {data,error}=await query;if(error)throw error;
const ids=[...new Set((data||[]).map(x=>x.series_id).filter(Boolean))];if(ids.length){const {data:s,error:se}=await db.from('master_series').select('id,publisher,title,volume_stage,start_year').in('id',ids);if(se)throw se;for(const x of s||[])seriesCache.set(x.id,x);}
const list=$('masterList');list.replaceChildren();if(!data?.length){list.append(el('p','No hay resultados en la base de datos. El Maestro todavía puede estar pendiente de importación.','muted'));return;}
for(const c of data){const s=seriesCache.get(c.series_id);const card=row((s?.title||'Serie')+' #'+(c.issue_number||'?'),[s?.publisher,s?.volume_stage,s?.start_year,c.title].filter(Boolean).join(' · '));
for(const [label,status] of [['Añadir a colección','In Collection'],['Añadir a wishlist','On Wish List']]){const b=el('button',label,status==='On Wish List'?'secondary':'');b.onclick=()=>guard(async()=>{const {error}=await db.from('user_comics').insert({user_id:user.id,master_comic_id:c.id,status});if(error)throw error;note('Ejemplar añadido.');await loadOwn();});card.append(b);}list.append(card);}}
$('login').onclick=()=>guard(async()=>{const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;await refresh();});
$('register').onclick=()=>guard(async()=>{if($('password').value.length<8)throw Error('La contraseña debe tener al menos 8 caracteres');const {error}=await db.auth.signUp({email:$('email').value.trim(),password:$('password').value,emailRedirectTo:location.origin+location.pathname});if(error)throw error;note('Registro solicitado. Revisa tu correo para confirmar la cuenta.');await refresh();});
$('logout').onclick=()=>guard(async()=>{const {error}=await db.auth.signOut();if(error)throw error;await refresh();});
$('searchBtn').onclick=()=>guard(searchMaster);$('search').onkeydown=e=>{if(e.key==='Enter')guard(searchMaster);};
$('ownFilter').onchange=()=>guard(loadOwn);
db.auth.onAuthStateChange(()=>{setTimeout(()=>guard(refresh),0);});guard(refresh);
