// Koli: account card, admin panel and abuse report (settings tab).
import { cloud } from "./cloud.js?v=5";
const $ = id => document.getElementById(id);
const C = window.KOLI_CONFIG || {};
const fmtDate = s => s ? new Date(s).toLocaleString("he-IL",{dateStyle:"short",timeStyle:"short"}) : "—";
function status(id,msg,cls=""){ const s=$(id); s.textContent=msg; s.className="status "+cls; }
function el(tag, props={}, ...kids){ const e=document.createElement(tag); Object.assign(e,props); for(const k of kids) e.append(k); return e; }
function btn(label, cls, fn){ const b=el("button",{type:"button",className:"btn "+(cls||""),textContent:label}); b.onclick=fn; return b; }

export function initAccount(){
  if(!cloud.active){ $("acctLocal").hidden=false; return; }
  const u=cloud.user, md=u.user_metadata||{};
  $("acctIn").hidden=false; $("acctActions").hidden=false; $("reportArea").hidden=false;
  $("acctName").textContent = md.full_name || md.name || "";
  $("acctEmail").textContent = u.email || "";
  if(md.avatar_url) $("acctAvatar").src = md.avatar_url; else $("acctAvatar").hidden=true;
  $("acctBadge").hidden = !cloud.isAdmin;
  $("signOutBtn").onclick=()=>cloud.signOut();
  let armed=false;
  $("deleteAcctBtn").hidden = cloud.isAdmin;
  $("deleteAcctBtn").onclick=async()=>{
    if(!armed){ armed=true; $("deleteAcctBtn").textContent="ללחוץ שוב: כל הקולות וההקלטות יימחקו לצמיתות"; setTimeout(()=>{ armed=false; $("deleteAcctBtn").textContent="מחיקת החשבון שלי"; },6000); return; }
    try{ status("acctStatus","מוחק…"); await cloud.deleteAccount(); }catch(e){ status("acctStatus","המחיקה נכשלה: "+(e.message||e),"err"); }
  };
  $("reportBtn").onclick=async()=>{
    const body=$("reportText").value.trim(); if(body.length<5){ status("reportStatus","כתוב כמה מילים על מה שקרה.","err"); return; }
    try{ await cloud.report(body); $("reportText").value=""; status("reportStatus","הדיווח נשלח למנהל. תודה.","ok"); }
    catch(e){ status("reportStatus","השליחה נכשלה: "+(e.message||e),"err"); }
  };
  if(cloud.isAdmin) initAdmin();
}

let filter="pending", users=[];
async function initAdmin(){
  $("adminArea").hidden=false;
  document.querySelectorAll("[data-af]").forEach(b=>b.onclick=()=>{ filter=b.dataset.af; document.querySelectorAll("[data-af]").forEach(x=>x.setAttribute("aria-pressed",String(x===b))); render(); });
  $("adminRefresh").onclick=load;
  await load();
}
async function load(){
  try{
    status("adminStatus","טוען…");
    users = await cloud.admin.users();
    const pend=users.filter(u=>u.status==="pending").length;
    $("adminCount").textContent = `${users.length} משתמשים${pend?` · ${pend} ממתינים`:""}`;
    status("adminStatus",""); render();
  }catch(e){ status("adminStatus","טעינה נכשלה: "+(e.message||e),"err"); }
}
async function render(){
  const box=$("adminList"); box.textContent="";
  if(filter==="reports") return renderReports(box);
  for(const u of users.filter(x=>x.status===filter)){
    const card=el("div",{className:"au"});
    const img=el("img",{alt:"",referrerPolicy:"no-referrer"}); if(u.avatar) img.src=u.avatar;
    const main=el("div",{className:"au-main"}, el("b",{textContent:u.name||u.email}),
      el("small",{textContent:`${u.email} · נרשם ${fmtDate(u.created_at)} · נראה ${fmtDate(u.last_seen_at)}`}),
      el("small",{textContent:`${u.voices} קולות · ${u.takes} הקלטות · תנאים: ${u.terms_version?`גרסה ${u.terms_version}, ${fmtDate(u.terms_accepted_at)}`:"לא אושרו"}`}));
    card.append(el("div",{className:"au-top"}, img, main));
    const row=el("div",{className:"row"});
    const isSelf = u.email && u.email.toLowerCase()===C.ADMIN_EMAIL.toLowerCase();
    if(u.status!=="approved") row.append(btn("אישור","primary",()=>setStatus(u,"approved")));
    if(u.status!=="blocked" && !isSelf) row.append(btn("חסימה","danger-text",()=>setStatus(u,"blocked")));
    if(u.voices||u.takes) row.append(btn("צפייה בתוכן","",async e=>{ e.target.disabled=true; await showContent(u,card); e.target.remove(); }));
    card.append(row); box.append(card);
  }
}
async function setStatus(u, s){
  try{ await cloud.admin.setStatus(u.id,s); u.status=s; status("adminStatus", s==="approved"?`${u.email} אושר.`:s==="blocked"?`${u.email} נחסם. הגישה שלו תיחסם תוך כמה דקות.`:"עודכן.","ok"); render(); }
  catch(e){ status("adminStatus","העדכון נכשל: "+(e.message||e),"err"); }
}
async function showContent(u, card){
  const wrap=el("div",{className:"au-content"},el("small",{textContent:"טוען…"})); card.append(wrap);
  try{
    const { voices, takes } = await cloud.admin.content(u.id);
    const consents = await cloud.admin.consents(u.id);
    wrap.textContent="";
    const item=(label, url, table, row, isVideo)=>{
      const it=el("div",{className:"au-item"}, el("span",{textContent:label}));
      if(url){ const m=el(isVideo?"video":"audio",{controls:true,preload:"none",src:url}); if(isVideo) m.playsInline=true; it.append(m); }
      const r=el("div",{className:"row"});
      if(url){ r.append(el("a",{href:url,target:"_blank",rel:"noopener",textContent:"הורדה"})); }
      r.append(btn("מחיקה","danger-text",async ev=>{ ev.target.disabled=true; try{ await cloud.admin.remove(table,row); it.remove(); }catch(e){ ev.target.disabled=false; status("adminStatus","מחיקה נכשלה: "+(e.message||e),"err"); } }));
      it.append(r); return it;
    };
    voices.forEach(v=>{ const c=consents.find(x=>x.kind==="voice_consent"&&x.ref===v.id); wrap.append(item(`קול: ${v.name} · הצהרת הסכמה ${c?fmtDate(c.created_at):(v.consent_at?fmtDate(v.consent_at):"לא תועדה")}`, v.url, "voices", v, false)); });
    takes.forEach(t=>wrap.append(item(`${t.meta?.voice||""}: ${(t.meta?.text||"").slice(0,120)} · ${fmtDate(t.created_at)}`, t.url, "takes", t, t.meta?.kind==="video")));
    if(!voices.length && !takes.length) wrap.append(el("small",{textContent:"אין תוכן."}));
  }catch(e){ wrap.textContent="טעינה נכשלה: "+(e.message||e); }
}
async function renderReports(box){
  try{
    const rs=await cloud.admin.reports();
    for(const r of rs){
      const card=el("div",{className:"au"},
        el("div",{className:"au-main"}, el("b",{textContent:r.reporter_email||"משתמש"}), el("small",{textContent:`${fmtDate(r.created_at)}${r.handled?" · טופל":""}`})),
        el("p",{textContent:r.body,style:"margin:0;font-size:14px;white-space:pre-wrap"}));
      if(!r.handled) card.append(el("div",{className:"row"}, btn("סימון כטופל","",async ev=>{ await cloud.admin.handled(r.id); r.handled=true; renderReports(box.replaceChildren()||box); })));
      box.append(card);
    }
  }catch(e){ status("adminStatus","טעינת הדיווחים נכשלה: "+(e.message||e),"err"); }
}
