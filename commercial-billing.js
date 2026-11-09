'use strict';
/* Commercial account + billing UI. Test branch only. */
(function(){
 const SESSION='mc_supabase_session_v1';
 const cfg=()=>window.MI_COMICOTECA_CLOUD||{};
 function getSession(){try{return JSON.parse(sessionStorage.getItem(SESSION)||'null')}catch{return null}}
 function setSession(s){if(s)sessionStorage.setItem(SESSION,JSON.stringify(s));else sessionStorage.removeItem(SESSION)}
 async function auth(path,opt={}){const c=cfg(),h=new Headers(opt.headers||{});h.set('apikey',c.publishableKey);return fetch(c.url+path,{...opt,headers:h})}
 async function signIn(email,password){const r=await auth('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.msg||j.message||j.error_description||'No se pudo iniciar sesión');setSession(j);location.reload();return j}
 async function signUp(email,password){const r=await auth('/auth/v1/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.msg||j.message||j.error_description||'No se pudo crear la cuenta');if(j.access_token){setSession(j);location.reload()}return j}
 async function currentUser(){const s=getSession();if(!s?.access_token)return null;const r=await auth('/auth/v1/user',{headers:{Authorization:'Bearer '+s.access_token}});if(!r.ok){setSession(null);return null}return r.json()}
 async function checkout(){const c=cfg(),s=getSession();if(!s?.access_token)throw Error('Inicia sesión antes de suscribirte.');const r=await fetch(c.url+'/functions/v1/create-checkout-session',{method:'POST',headers:{apikey:c.publishableKey,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify({price_id:'price_1UWDPyPelYDWaNXHmtO8IZhJ',success_url:location.origin+location.pathname+'?checkout=success',cancel_url:location.origin+location.pathname+'?checkout=cancelled'})});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||j.message||'No se pudo abrir Stripe Checkout');if(!j.url)throw Error('Stripe no devolvió la URL de Checkout');const checkoutUrl=new URL(j.url);if(checkoutUrl.protocol!=='https:'||!['checkout.stripe.com','checkout.stripe.dev'].includes(checkoutUrl.hostname))throw Error('Destino de pago no válido');location.assign(checkoutUrl.href)}
 function modal(){let el=document.getElementById('commercialAccountModal');if(el)return el;el=document.createElement('div');el.id='commercialAccountModal';el.style.cssText='position:fixed;inset:0;background:#000c;z-index:100000;display:none;align-items:center;justify-content:center;padding:20px';el.innerHTML='<div style="max-width:520px;width:100%;background:#071321;border:1px solid #28445e;border-radius:18px;padding:24px;color:#fff;box-shadow:0 24px 70px #0008"><h2 style="margin:0 0 8px">COMICTECA</h2><p style="color:#b9c7d5;margin-top:0">Cuenta y membresía · 9,99 € / mes</p><div id="cbLoggedOut"><input id="cbEmail" type="email" autocomplete="email" placeholder="Email" style="width:100%;box-sizing:border-box;margin:5px 0;padding:11px"><input id="cbPass" type="password" autocomplete="current-password" placeholder="Contraseña" style="width:100%;box-sizing:border-box;margin:5px 0;padding:11px"><button id="cbLogin" class="btn primary">Entrar</button> <button id="cbSignup" class="btn">Crear cuenta</button></div><div id="cbLoggedIn" style="display:none"><div id="cbUser" style="margin:12px 0;color:#b9c7d5"></div><button id="cbSubscribe" class="btn primary">Suscribirme · 9,99 €/mes</button> <button id="cbLogout" class="btn">Cerrar sesión</button></div><div id="cbState" style="min-height:22px;margin:14px 0;color:#b9c7d5"></div><button id="cbClose" class="btn">Cerrar</button></div>';document.body.appendChild(el);
 const state=el.querySelector('#cbState'),out=el.querySelector('#cbLoggedOut'),inn=el.querySelector('#cbLoggedIn'),usr=el.querySelector('#cbUser');
 async function refresh(){const u=await currentUser();out.style.display=u?'none':'block';inn.style.display=u?'block':'none';usr.textContent=u?'Sesión: '+(u.email||u.id):'';return u}
 el.querySelector('#cbLogin').onclick=async()=>{try{state.textContent='Entrando…';await signIn(el.querySelector('#cbEmail').value,el.querySelector('#cbPass').value);state.textContent='Sesión iniciada.';await refresh()}catch(e){state.textContent='Error: '+e.message}};
 el.querySelector('#cbSignup').onclick=async()=>{try{state.textContent='Creando cuenta…';const j=await signUp(el.querySelector('#cbEmail').value,el.querySelector('#cbPass').value);state.textContent=j.access_token?'Cuenta creada. Ya puedes suscribirte.':'Cuenta creada. Confirma tu correo y después inicia sesión.';await refresh()}catch(e){state.textContent='Error: '+e.message}};
 el.querySelector('#cbSubscribe').onclick=async()=>{try{state.textContent='Abriendo Stripe Checkout…';const btn=el.querySelector('#cbSubscribe');btn.disabled=true;try{await checkout()}finally{btn.disabled=false}}catch(e){state.textContent='Error: '+e.message}};
 el.querySelector('#cbLogout').onclick=()=>{setSession(null);location.reload()};el.querySelector('#cbClose').onclick=()=>el.style.display='none';el._refresh=refresh;return el}
 async function show(){const el=modal();el.style.display='flex';el.querySelector('#cbState').textContent='';await el._refresh();}
 function addButton(){const nav=document.querySelector('.nav');if(!nav||document.getElementById('commercialAccountBtn'))return;const b=document.createElement('button');b.id='commercialAccountBtn';b.type='button';b.textContent='Cuenta / Suscripción';b.onclick=show;nav.appendChild(b)}
 // Fail closed: a local IndexedDB cache is not proof of entitlement.
 async function entitlement(){
  const u=await currentUser();if(!u)return {state:'guest'};
  const session=getSession(),c=cfg();
  const r=await fetch(c.url+'/rest/v1/profiles?id=eq.'+encodeURIComponent(u.id)+'&select=membership_active,membership_valid_until,role',{headers:{apikey:c.publishableKey,Authorization:'Bearer '+session.access_token,Accept:'application/json'}});
  if(!r.ok)throw Error('No se pudo comprobar la membresía');
  const rows=await r.json(),p=rows[0];if(!p)return {state:'inactive'};
  const active=p.role==='admin'||(p.membership_active===true&&(!p.membership_valid_until||Date.parse(p.membership_valid_until)>Date.now()));
  return {state:active?'active':'inactive'};
 }
 function accessScreen(state){
  let gate=document.getElementById('mcAccessGate');
  if(state==='active'){gate?.remove();document.body.classList.add('mc-access-ready');return}
  if(!gate){gate=document.createElement('div');gate.id='mcAccessGate';document.body.appendChild(gate)}
  document.body.classList.add('mc-access-ready');
  if(state==='guest'){
   gate.innerHTML=`<div class="mc-landing">
    <header class="mc-landing-header"><img src="comicteca-logo-real.webp" alt="COMICTECA"><nav><a href="#mc-features">Funciones</a><a href="#mc-how">Cómo funciona</a><a href="#mc-plan">Membresía</a></nav><button class="btn mc-landing-login" data-mc-account>Entrar</button></header>
    <main>
     <section class="mc-hero"><div class="mc-hero-copy"><span class="mc-eyebrow">TU COLECCIÓN, ORGANIZADA</span><h1>Todos tus cómics.<br><em>Una sola COMICTECA.</em></h1><p>Organiza tus colecciones, identifica los números que tienes, prepara tu lista de deseos y consulta tu catálogo desde un mismo lugar.</p><div class="mc-hero-actions"><button class="btn primary" data-mc-account>Crear mi cuenta</button><a class="mc-text-link" href="#mc-features">Descubrir COMICTECA ↓</a></div><div class="mc-hero-tags"><span>Catálogo y colecciones</span><span>Wishlist</span><span>Importación desde Excel</span></div></div><div class="mc-hero-art"><img src="comicteca-logo-real.webp" alt="Logotipo de COMICTECA"><div>Tu universo del cómic, en orden.</div></div></section>
     <section id="mc-features" class="mc-landing-section"><span class="mc-eyebrow">TODO EN UN MISMO SITIO</span><h2>Una herramienta pensada para coleccionistas</h2><div class="mc-feature-grid">
      <article><span class="mc-feature-icon">▦</span><h3>Mi catálogo</h3><p>Registra tus ejemplares y consulta sus fichas con editorial, cabecera, volumen y número.</p></article>
      <article><span class="mc-feature-icon">▤</span><h3>Colecciones</h3><p>Organiza tus series por editorial y edición, y sigue qué números tienes.</p></article>
      <article><span class="mc-feature-icon">☆</span><h3>Lista de deseos</h3><p>Guarda los cómics que buscas para completar tus colecciones.</p></article>
      <article><span class="mc-feature-icon">▧</span><h3>Portadas</h3><p>Gestiona las imágenes asociadas a tus fichas y localiza las que faltan.</p></article>
      <article><span class="mc-feature-icon">◫</span><h3>Panel de control</h3><p>Consulta el estado de tu colección mediante resúmenes e indicadores.</p></article>
      <article><span class="mc-feature-icon">⇧</span><h3>Importación y copias</h3><p>Incorpora registros desde Excel, CSV o JSON y exporta tus datos.</p></article>
     </div></section>
     <section id="mc-how" class="mc-landing-section mc-how"><span class="mc-eyebrow">EMPEZAR ES SENCILLO</span><h2>Tu colección, paso a paso</h2><div class="mc-how-grid"><div><b>01</b><h3>Crea tu cuenta</h3><p>Regístrate con tu correo y accede a tu espacio personal.</p></div><div><b>02</b><h3>Activa tu membresía</h3><p>Contrata el acceso desde tu cuenta.</p></div><div><b>03</b><h3>Organiza tus cómics</h3><p>Añade fichas, importa tu colección y consulta tus series.</p></div></div></section>
     <section id="mc-plan" class="mc-landing-section mc-plan"><div><span class="mc-eyebrow">COMICTECA</span><h2>Tu colección merece su espacio</h2><p>Acceso mediante suscripción mensual. La membresía se activa tras la confirmación del pago.</p></div><div class="mc-plan-card"><span>Membresía mensual</span><strong>9,99 € <small>/ mes</small></strong><p>Gestión de colecciones, wishlist, importación, portadas y copias de seguridad.</p><button class="btn primary" data-mc-account>Crear cuenta y continuar</button></div></section>
    </main><footer class="mc-landing-footer"><img src="comicteca-logo-real.webp" alt=""><span>COMICTECA · Tu colección, a tu manera.</span></footer>
   </div>`;
   gate.querySelectorAll('[data-mc-account]').forEach(b=>b.addEventListener('click',show));
   return;
  }
  const title=state==='inactive'?'Tu COMICTECA está lista para empezar':'Estamos verificando tu acceso';
  const desc=state==='inactive'?'Activa tu membresía para acceder a tu colección y comenzar a organizar tus cómics.':'No podemos comprobar tu acceso ahora mismo. Inténtalo de nuevo desde tu cuenta.';
  gate.innerHTML='<div class="mc-gate-simple"><img src="comicteca-logo-real.webp" alt="COMICTECA"><h1>'+title+'</h1><p>'+desc+'</p><button class="btn primary" data-mc-account>Cuenta y membresía</button></div>';
  gate.querySelector('[data-mc-account]').onclick=show;
 }

 async function verifyAccess(){
  if(new URLSearchParams(location.search).get('modo')==='prueba-importacion')return;
  accessScreen('checking');
  try{const e=await entitlement();accessScreen(e.state)}catch(err){console.warn('Membership check:',err);accessScreen('error')}
 }
 document.addEventListener('DOMContentLoaded',()=>{addButton();verifyAccess();const q=new URLSearchParams(location.search).get('checkout');if(q==='success')setTimeout(()=>{show();document.querySelector('#cbState').textContent='Regreso desde Checkout. El pago y la membresía solo se confirman cuando el servidor valida el evento de Stripe; esta pantalla no confirma un cobro.'},300);if(q==='cancelled')setTimeout(()=>{show();document.querySelector('#cbState').textContent='Checkout cancelado. No se ha realizado ningún cobro.'},300)});
 window.CommercialBilling={show,signIn,signUp,currentUser,checkout};
})();