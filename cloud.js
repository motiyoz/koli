// Koli cloud layer: Google sign-in through Supabase, approval gate, cloud storage, admin.
const C = window.KOLI_CONFIG || {};
const SB_ESM = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm";
const $ = id => document.getElementById(id);
const SYNC_KEYS = k => k==="koli.dict" || k==="koli.cast" || k==="koli.variants" || k==="koli.dlg" || k.startsWith("koli.vs.");

let sb = null, resolveReady;
export const cloud = {
  configured: !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY),
  active: false, user: null, profile: null, isAdmin: false,
  ready: new Promise(r => resolveReady = r),
};

/* ---------- gate ---------- */
function gate(state, msg){
  const g=$("gate"); g.hidden=false; document.documentElement.classList.add("gated");
  g.querySelectorAll("[data-g]").forEach(el=>el.hidden = el.dataset.g!==state);
  if(msg) { const e=g.querySelector(`[data-g="${state}"] .g-msg`); if(e) e.textContent=msg; }
}
function hideGate(){ $("gate").hidden=true; document.documentElement.classList.remove("gated"); }

async function loadProfile(){
  for(let i=0;i<4;i++){
    const { data, error } = await sb.from("profiles").select("*").eq("id", cloud.user.id).maybeSingle();
    if(error) throw error;
    if(data) return data;
    await new Promise(r=>setTimeout(r,800));
  }
  throw new Error("הפרופיל לא נוצר. ודא שהרצת את קובץ ההגדרה setup.sql ב-Supabase.");
}

let evaluating=false, readyDone=false;
async function evaluate(){
  if(evaluating) return; evaluating=true;
  try{
    const { data:{ session } } = await sb.auth.getSession();
    if(!session){ gate("signin"); return; }
    cloud.user = session.user;
    const provider = session.user.app_metadata?.provider;
    cloud.isAdmin = (session.user.email||"").toLowerCase()===C.ADMIN_EMAIL.toLowerCase() && provider==="google";
    const p = await loadProfile(); cloud.profile=p;
    $("gEmail1").textContent = $("gEmail2").textContent = session.user.email || "";
    if(p.status==="blocked"){ gate("blocked"); return; }
    if(p.terms_version!==C.TERMS_VERSION){ gate("terms"); return; }
    if(p.status!=="approved"){ gate("pending"); return; }
    hideGate(); cloud.active=true;
    sb.rpc("touch_last_seen").then(()=>{},()=>{});
    if(!readyDone){ readyDone=true; resolveReady(); }
  }catch(e){ gate("error", e.message||String(e)); }
  finally{ evaluating=false; }
}

async function init(){
  if(!cloud.configured){ hideGate(); resolveReady(); return; }
  gate("loading");
  try{
    const { createClient } = await import(SB_ESM);
    sb = createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:"pkce" } });
    cloud.sb = sb;
  }catch(e){ gate("error","לא הצלחתי לטעון את מערכת הכניסה. בדוק חיבור לאינטרנט ונסה שוב."); return; }
  $("gGoogle").onclick=async()=>{
    $("gGoogle").disabled=true;
    const { error } = await sb.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: location.origin+location.pathname, queryParams:{ prompt:"select_account" } } });
    if(error){ $("gGoogle").disabled=false; gate("error", error.message); }
  };
  $("gAccept").onchange=()=>{ $("gTermsBtn").disabled=!$("gAccept").checked; };
  $("gTermsBtn").onclick=async()=>{
    $("gTermsBtn").disabled=true;
    const { error } = await sb.rpc("accept_terms", { v: C.TERMS_VERSION });
    if(error){ gate("error", error.message); return; }
    evaluate();
  };
  document.querySelectorAll("[data-g-recheck]").forEach(b=>b.onclick=()=>evaluate());
  document.querySelectorAll("[data-g-signout]").forEach(b=>b.onclick=()=>cloud.signOut());
  sb.auth.onAuthStateChange((ev)=>{ if(ev==="SIGNED_OUT"){ cloud.active=false; location.reload(); } else if(ev==="SIGNED_IN" && !readyDone) evaluate(); });
  // a blocked user loses access even mid-session: re-check every few minutes
  setInterval(async()=>{ if(!cloud.active) return; const {data}=await sb.from("profiles").select("status").eq("id",cloud.user.id).maybeSingle(); if(!data || data.status!=="approved"){ cloud.active=false; evaluate(); } }, 180000);
  evaluate();
}

/* ---------- storage helpers ---------- */
const uid = () => cloud.user.id;
const iso = t => new Date(t||Date.now()).toISOString();
const wavCache = new Map(), blobCache = new Map();
async function upload(path, blob){
  const { error } = await sb.storage.from("media").upload(path, blob, { upsert:true, contentType: blob.type || "audio/wav", cacheControl:"3600" });
  if(error) throw new Error("שמירת הקובץ בחשבון נכשלה: "+error.message);
}
function extFor(t){ const ty=t.blob?.type||""; return t.kind==="video" ? (ty.includes("mp4")?"mp4":"webm") : ty.includes("webm")?"webm":ty.includes("mpeg")?"mp3":"wav"; }

cloud.all = async (store) => {
  if(store==="voices"){
    const { data, error } = await sb.from("voices").select("*").order("created_at");
    if(error) throw error;
    return Promise.all(data.map(async r=>{
      let wav=wavCache.get(r.id);
      if(!wav && r.path){ const { data:b } = await sb.storage.from("media").download(r.path); wav=b||null; if(b) wavCache.set(r.id,b); }
      return { id:r.id, name:r.name, secs:r.secs||0, created:Date.parse(r.created_at), consent:!!r.consent_at, wav, path:r.path };
    }));
  }
  const { data, error } = await sb.from("takes").select("*").order("created_at",{ascending:false}).limit(40);
  if(error) throw error;
  const paths=data.map(r=>r.path).filter(Boolean); let urls={};
  if(paths.length){ const { data:s } = await sb.storage.from("media").createSignedUrls(paths, 3600); (s||[]).forEach(x=>{ if(x.signedUrl) urls[x.path]=x.signedUrl; }); }
  return data.map(r=>({ id:r.id, text:r.meta?.text||"", voice:r.meta?.voice||"", kind:r.meta?.kind||"audio", created:Date.parse(r.created_at), path:r.path, url:urls[r.path], blob:blobCache.get(r.id) }));
};
cloud.put = async (store, o) => {
  if(store==="voices"){
    let path=o.path;
    if(!path && o.wav){ path=`${uid()}/voices/${o.id}.wav`; await upload(path, o.wav); }
    const { error } = await sb.from("voices").upsert({ id:o.id, name:o.name, secs:o.secs||null, path, consent_at:o.consent?iso(o.created):null, created_at:iso(o.created) });
    if(error) throw error;
    o.path=path; if(o.wav) wavCache.set(o.id,o.wav);
    return;
  }
  let path=o.path;
  if(o.blob && blobCache.get(o.id)!==o.blob){ path=`${uid()}/takes/${o.id}.${extFor(o)}`; await upload(path, o.blob); blobCache.set(o.id,o.blob); }
  const { error } = await sb.from("takes").upsert({ id:o.id, meta:{ text:o.text, voice:o.voice, kind:o.kind||"audio", mime:o.blob?.type||null }, path, created_at:iso(o.created) });
  if(error) throw error;
  o.path=path;
};
cloud.del = async (store, id) => {
  const table = store==="voices" ? "voices" : "takes";
  const { data } = await sb.from(table).select("path").eq("id",id).maybeSingle();
  if(data?.path) await sb.storage.from("media").remove([data.path]);
  const { error } = await sb.from(table).delete().eq("id",id);
  if(error) throw error;
  wavCache.delete(id); blobCache.delete(id);
};
cloud.ids = async (table) => { const { data } = await sb.from(table).select("id"); return new Set((data||[]).map(r=>r.id)); };

/* ---------- prefs sync ---------- */
let prefs={}, prefT=null;
cloud.loadPrefs = async () => {
  const { data } = await sb.from("user_prefs").select("prefs").eq("user_id",uid()).maybeSingle();
  prefs = data?.prefs || {};
  for(const [k,v] of Object.entries(prefs)){ try{ localStorage.setItem(k,v); }catch{} }
};
cloud.savePref = (k, raw) => {
  if(!cloud.active || !SYNC_KEYS(k)) return;
  prefs[k]=raw; clearTimeout(prefT);
  prefT=setTimeout(()=>{ sb.from("user_prefs").upsert({ user_id:uid(), prefs, updated_at:iso() }).then(()=>{},()=>{}); },1200);
};
cloud.logConsent = (kind, ref) => sb.from("consent_log").insert({ user_id:uid(), kind, ref, version:C.TERMS_VERSION }).then(()=>{},()=>{});

/* ---------- account ---------- */
cloud.signOut = async () => { try{ await sb.auth.signOut(); }catch{} location.reload(); };
cloud.report = async (body) => {
  const { error } = await sb.from("reports").insert({ reporter:uid(), reporter_email:cloud.user.email, body });
  if(error) throw error;
};
cloud.deleteAccount = async () => {
  for(const folder of ["voices","takes"]){
    const { data } = await sb.storage.from("media").list(`${uid()}/${folder}`, { limit:1000 });
    const paths=(data||[]).map(f=>`${uid()}/${folder}/${f.name}`);
    if(paths.length) await sb.storage.from("media").remove(paths);
  }
  const { error } = await sb.rpc("delete_my_account"); if(error) throw error;
  await cloud.signOut();
};

/* ---------- admin ---------- */
cloud.admin = {
  async users(){
    const [{ data:ps, error }, { data:vs }, { data:ts }] = await Promise.all([
      sb.from("profiles").select("*").order("created_at",{ascending:false}),
      sb.from("voices").select("user_id"), sb.from("takes").select("user_id") ]);
    if(error) throw error;
    const cnt=(rows,id)=>(rows||[]).filter(r=>r.user_id===id).length;
    return ps.map(p=>({ ...p, voices:cnt(vs,p.id), takes:cnt(ts,p.id) }));
  },
  async setStatus(id, status){ const { error } = await sb.from("profiles").update({ status }).eq("id",id); if(error) throw error; },
  async content(userId){
    const [{ data:vs }, { data:ts }] = await Promise.all([
      sb.from("voices").select("*").eq("user_id",userId).order("created_at"),
      sb.from("takes").select("*").eq("user_id",userId).order("created_at",{ascending:false}).limit(50) ]);
    const paths=[...(vs||[]),...(ts||[])].map(r=>r.path).filter(Boolean); let urls={};
    if(paths.length){ const { data:s } = await sb.storage.from("media").createSignedUrls(paths, 3600); (s||[]).forEach(x=>{ if(x.signedUrl) urls[x.path]=x.signedUrl; }); }
    return { voices:(vs||[]).map(r=>({...r, url:urls[r.path]})), takes:(ts||[]).map(r=>({...r, url:urls[r.path]})) };
  },
  async remove(table, row){ if(row.path) await sb.storage.from("media").remove([row.path]); const { error } = await sb.from(table).delete().eq("id",row.id); if(error) throw error; },
  async reports(){ const { data, error } = await sb.from("reports").select("*").order("created_at",{ascending:false}).limit(100); if(error) throw error; return data; },
  async handled(id){ await sb.from("reports").update({ handled:true }).eq("id",id); },
  async consents(userId){ const { data } = await sb.from("consent_log").select("*").eq("user_id",userId).order("created_at",{ascending:false}).limit(50); return data||[]; },
};

init();
