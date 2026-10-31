import { cloud } from "./cloud.js?v=5";
import { initAccount } from "./admin.js?v=5";

const BASE = "https://resembleai-chatterbox-multilingual-tts-v3.hf.space";
function myServer(){ try{ return localStorage.getItem("koli.server")||""; }catch{ return ""; } }
function ttsApi(){ return (myServer()||BASE) + "/gradio_api"; }
const FN = "generate_tts_audio";
const MAX = 300;
const VC_BASE = "https://plachta-seed-vc.hf.space";
const SAMPLES = "https://storage.googleapis.com/chatterbox-demo-samples/mtl_prompts/";
let mode = "tts";
const $ = id => document.getElementById(id);

/* ---------- storage (IndexedDB, falls back to memory) ---------- */
const mem = { voices: [], takes: [] };
let dbp = null;
function db(){
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try{
      const r = indexedDB.open("koli", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("voices",{keyPath:"id"}); r.result.createObjectStore("takes",{keyPath:"id"}); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    }catch{ res(null); }
  });
  return dbp;
}
async function localAll(store){
  const d = await db(); if(!d) return mem[store];
  return new Promise(res=>{ try{ const q=d.transaction(store).objectStore(store).getAll(); q.onsuccess=()=>res(q.result); q.onerror=()=>res(mem[store]); }catch{ res(mem[store]); } });
}
async function localPut(store,obj){
  mem[store] = mem[store].filter(x=>x.id!==obj.id).concat(obj);
  const d = await db(); if(!d) return;
  try{ d.transaction(store,"readwrite").objectStore(store).put(obj); }catch{}
}
async function localDel(store,id){
  mem[store] = mem[store].filter(x=>x.id!==id);
  const d = await db(); if(!d) return;
  try{ d.transaction(store,"readwrite").objectStore(store).delete(id); }catch{}
}

async function all(store){ return cloud.active ? cloud.all(store) : localAll(store); }
async function put(store,obj){ return cloud.active ? cloud.put(store,obj) : localPut(store,obj); }
async function del(store,id){ return cloud.active ? cloud.del(store,id) : localDel(store,id); }

/* ---------- audio helpers ---------- */
function encodeWav(data, rate){
  const ab = new ArrayBuffer(44 + data.length*2), v = new DataView(ab);
  const w = (o,str)=>{ for(let i=0;i<str.length;i++) v.setUint8(o+i,str.charCodeAt(i)); };
  w(0,"RIFF"); v.setUint32(4,36+data.length*2,true); w(8,"WAVE"); w(12,"fmt ");
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,rate,true);
  v.setUint32(28,rate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,"data"); v.setUint32(40,data.length*2,true);
  for(let i=0;i<data.length;i++){ const x=Math.max(-1,Math.min(1,data[i])); v.setInt16(44+i*2, x<0?x*0x8000:x*0x7fff, true); }
  return new Blob([ab],{type:"audio/wav"});
}
async function decode(blob){
  const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
  try{ return await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close?.(); }
}
async function toWav(blob, maxSecs=20){
  const buf = await decode(blob);
  const rate = 24000, secs = Math.min(buf.duration, maxSecs);
  const off = new OfflineAudioContext(1, Math.ceil(secs*rate), rate);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const out = await off.startRendering();
  const data = out.getChannelData(0);
  return { wav: encodeWav(data, rate), secs: buf.duration, peaks: peaks(data) };
}
async function concatWav(blobs, gap){
  const bufs=[]; for(const b of blobs) bufs.push(await decode(b));
  const rate=24000;
  const total=bufs.reduce((a,b)=>a+b.duration+gap,0);
  const off=new OfflineAudioContext(1,Math.max(1,Math.ceil(total*rate)),rate);
  let t=0; for(const b of bufs){ const src=off.createBufferSource(); src.buffer=b; src.connect(off.destination); src.start(t); t+=b.duration+gap; }
  const out=await off.startRendering();
  return encodeWav(out.getChannelData(0),rate);
}
function peaks(data){ const n=80, step=Math.floor(data.length/n)||1, p=[]; for(let i=0;i<n;i++){ let m=0; for(let j=i*step;j<(i+1)*step&&j<data.length;j++) m=Math.max(m,Math.abs(data[j])); p.push(m);} return p; }
function drawWave(p, id="wave"){
  const c=$(id), g=c.getContext("2d");
  g.clearRect(0,0,c.width,c.height); const gr=g.createLinearGradient(c.width,0,0,0); gr.addColorStop(0,"#ff5f45"); gr.addColorStop(1,"#ffb23e"); g.fillStyle=gr;
  if(!p) return; const bw=c.width/p.length;
  p.forEach((h,i)=>{ const hh=Math.max(2,h*c.height); g.fillRect(c.width-(i+1)*bw+1,(c.height-hh)/2,bw-2,hh); });
}

/* ---------- voices ---------- */
const SYSTEM = [
  { id:"default", name:"יואב", note:"גבר · עברית", builtin:true, url:SAMPLES+"he_m1.flac", ttsDefault:true },
  { id:"s_en_f1", name:"מאיה", note:"אישה · מבטא אמריקאי", builtin:true, url:SAMPLES+"en_f1.flac" },
  { id:"s_fr_f1", name:"נועה", note:"אישה · מבטא צרפתי", builtin:true, url:SAMPLES+"fr_f1.flac" },
  { id:"s_es_f1", name:"דנה", note:"אישה · מבטא ספרדי", builtin:true, url:SAMPLES+"es_f1.flac" },
  { id:"s_de_f1", name:"שירה", note:"אישה · מבטא גרמני", builtin:true, url:SAMPLES+"de_f1.flac" },
  { id:"s_it_m1", name:"איתי", note:"גבר · מבטא איטלקי", builtin:true, url:SAMPLES+"it_m1.flac" },
  { id:"s_pt_m1", name:"רון", note:"גבר · מבטא פורטוגלי", builtin:true, url:SAMPLES+"pt_m1.flac" },
  { id:"s_ar_m1", name:"עומר", note:"גבר · מבטא ערבי", builtin:true, url:SAMPLES+"ar_m1.flac" }
];
let mine = [], voices = [], selected = "default", pending = null;

async function loadVoices(){
  mine = (await all("voices")).sort((a,b)=>a.created-b.created);
  voices = [...mine, ...SYSTEM];
  try{ selected = localStorage.getItem("koli.voice") || selected; }catch{}
  if(!voices.find(v=>v.id===selected)) selected="default";
  renderVoices(); loadVS(); renderCast();
}
function voiceById(id){ return voices.find(v=>v.id===id) || SYSTEM[0]; }
function voiceBtn(v){
  const b=document.createElement("button"); b.type="button"; b.className="voice";
  b.setAttribute("aria-pressed", String(v.id===selected));
  const av=document.createElement("span"); av.className="av"; av.setAttribute("aria-hidden","true");
  let h=0; for(const c of v.name) h=(h*31+c.codePointAt(0))%360; av.style.setProperty("--h",h);
  av.textContent=[...v.name.trim()][0]||"?";
  const n=document.createElement("b"); n.textContent=v.name;
  const sp=document.createElement("span"); sp.className="n"; sp.textContent = v.builtin ? v.note : `דגימה של ${v.secs.toFixed(0)} שנ'`;
  b.append(av,n,sp);
  b.onclick=()=>{ selected=v.id; try{localStorage.setItem("koli.voice",v.id);}catch{} renderVoices(); loadVS(); setTimeout(()=>closeSheet("voiceSheet"),180); };
  return b;
}
function renderVoices(){
  const my=$("myVoices"), sys=$("sysVoices"); my.textContent=""; sys.textContent="";
  mine.forEach(v=>my.append(voiceBtn(v)));
  const add=document.createElement("button"); add.type="button"; add.className="voice add"; add.textContent="+ שמירת קול חדש";
  add.onclick=openAdd; my.append(add);
  SYSTEM.forEach(v=>sys.append(voiceBtn(v)));
  $("voiceCount").textContent = `${mine.length} שלך · ${SYSTEM.length} של המערכת`;
  const cur=voices.find(v=>v.id===selected);
  $("curName").textContent = cur ? cur.name : "";
  if(cur){ const av=$("voiceRowAv"); let hh=0; for(const c of cur.name) hh=(hh*31+c.codePointAt(0))%360; av.style.setProperty("--h",hh); av.textContent=[...cur.name.trim()][0]||"?"; }
  $("voiceActions").hidden = !cur || !!cur.builtin;
  $("renameRow").hidden = true;
  const rm=$("delVoice"); rm.dataset.armed=""; rm.textContent="מחיקה";
}
$("delVoice").onclick=async()=>{
  const rm=$("delVoice");
  if(!rm.dataset.armed){ rm.dataset.armed="1"; rm.textContent="ללחוץ שוב לאישור"; return; }
  await del("voices",selected); selected="default"; try{localStorage.setItem("koli.voice","default");}catch{} loadVoices();
};
$("renameVoice").onclick=()=>{ const cur=mine.find(v=>v.id===selected); if(!cur) return; $("renameRow").hidden=false; $("renameIn").value=cur.name; $("renameIn").focus(); };
$("renameSave").onclick=async()=>{
  const cur=mine.find(v=>v.id===selected); const n=$("renameIn").value.trim(); if(!cur||!n) return;
  cur.name=n; await put("voices",cur); loadVoices();
};
$("renameIn").addEventListener("keydown",e=>{ if(e.key==="Enter") $("renameSave").click(); });

/* ---------- trimmer ---------- */
const fmt=t=>{ t=Math.max(0,t); const m=Math.floor(t/60), sec=t-m*60; return `${m}:${sec.toFixed(1).padStart(4,"0")}`; };
async function sliceWav(buf, start, end){
  const rate=24000, len=Math.max(1,Math.ceil((end-start)*rate));
  const off=new OfflineAudioContext(1,len,rate);
  const src=off.createBufferSource(); src.buffer=buf; src.connect(off.destination); src.start(0,start,end-start);
  const out=await off.startRendering(); const data=out.getChannelData(0);
  return { wav: encodeWav(data,rate), secs:end-start, peaks: peaks(data) };
}
function makeTrimmer(root, {max, min=1, label, onChange}){
  const uid=root.id;
  root.innerHTML=`<div class="trim-head"><b>${label}</b><span class="trim-info"></span></div>
    <canvas width="600" height="64" aria-hidden="true"></canvas>
    <div class="trim-ranges" dir="ltr">
      <output></output><input type="range" id="${uid}-s" step="0.1" min="0" aria-label="נקודת התחלה"><label for="${uid}-s">התחלה</label>
      <output></output><input type="range" id="${uid}-e" step="0.1" min="0" aria-label="נקודת סיום"><label for="${uid}-e">סוף</label>
    </div>
    <div class="row">
      <button class="btn t-play" type="button">השמעת הקטע</button>
      <button class="btn t-in" type="button">התחלה מכאן</button>
      <button class="btn t-out" type="button">סוף כאן</button>
      <button class="btn t-reset" type="button">איפוס</button>
    </div>`;
  const cv=root.querySelector("canvas"), g=cv.getContext("2d");
  const [rs,re]=root.querySelectorAll("input"), [os,oe]=root.querySelectorAll("output"), info=root.querySelector(".trim-info");
  let buf=null, media=null, pk=[], start=0, end=0, stopAt=null, raf=0;
  function draw(){
    const W=cv.width,H=cv.height; g.clearRect(0,0,W,H); if(!buf) return;
    const bw=W/pk.length, d=buf.duration;
    const gr=g.createLinearGradient(0,0,W,0); gr.addColorStop(0,"#ff5f45"); gr.addColorStop(1,"#ffb23e");
    const mute=getComputedStyle(document.documentElement).getPropertyValue("--line").trim()||"rgba(128,128,128,.3)";
    pk.forEach((h,i)=>{ const t=(i+.5)/pk.length*d; g.fillStyle=(t>=start&&t<=end)?gr:mute; const hh=Math.max(2,h*H*.92); g.fillRect(i*bw+1,(H-hh)/2,Math.max(1,bw-2),hh); });
    const x1=start/d*W, x2=end/d*W; g.fillStyle="#ff5f45"; g.fillRect(x1-1,0,3,H); g.fillRect(x2-2,0,3,H);
    if(media && !media.paused){ const x=media.currentTime/d*W; g.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(); g.fillRect(x,0,2,H); }
  }
  function sync(fire=true){
    rs.value=start; re.value=end; os.textContent=fmt(start); oe.textContent=fmt(end);
    const len=end-start; info.textContent=`אורך הקטע: ${len.toFixed(1)} שנ'${max&&len>=max-0.05?` (מקסימום ${max})`:""}`;
    draw(); if(fire) onChange?.(start,end);
  }
  function clamp(which){
    const d=buf.duration;
    start=Math.max(0,Math.min(start,d-min)); end=Math.max(start+min,Math.min(end,d));
    if(max && end-start>max){ if(which==="s") end=start+max; else start=end-max; }
  }
  rs.oninput=()=>{ start=+rs.value; clamp("s"); sync(); };
  re.oninput=()=>{ end=+re.value; clamp("e"); sync(); };
  cv.onpointerdown=e=>{ if(!buf) return; const r=cv.getBoundingClientRect(); const t=(e.clientX-r.left)/r.width*buf.duration;
    if(Math.abs(t-start)<Math.abs(t-end)){ start=t; clamp("s"); } else { end=t; clamp("e"); } sync(); };
  function loop(){ draw(); if(media && !media.paused){ if(stopAt!=null && media.currentTime>=stopAt){ media.pause(); stopAt=null; } raf=requestAnimationFrame(loop); } }
  root.querySelector(".t-play").onclick=()=>{ if(!media) return; if(!media.paused){ media.pause(); return; } media.currentTime=start; stopAt=end; media.play().then(()=>{ cancelAnimationFrame(raf); loop(); }).catch(()=>{}); };
  root.querySelector(".t-in").onclick=()=>{ if(!media||!buf) return; start=media.currentTime; clamp("s"); sync(); };
  root.querySelector(".t-out").onclick=()=>{ if(!media||!buf) return; end=media.currentTime; clamp("e"); sync(); };
  root.querySelector(".t-reset").onclick=()=>{ if(!buf) return; start=0; end=max?Math.min(buf.duration,max):buf.duration; sync(); };
  return {
    set(b, m){
      buf=b; media=m; const d=b.duration;
      [rs,re].forEach(r=>{ r.max=d.toFixed(1); });
      const ch=b.getChannelData(0), n=150, step=Math.max(1,Math.floor(ch.length/n)); pk=[];
      let top=0; for(let i=0;i<n;i++){ let mx=0; for(let j=i*step;j<(i+1)*step&&j<ch.length;j+=4) mx=Math.max(mx,Math.abs(ch[j])); pk.push(mx); top=Math.max(top,mx); }
      if(top>0) pk=pk.map(x=>x/top);
      start=0; end=max?Math.min(d,max):d; root.hidden=false;
      if(media){ media.onplay=()=>{ cancelAnimationFrame(raf); loop(); }; media.onseeked=draw; }
      sync();
    },
    get(){ return {start,end}; },
    clear(){ buf=null; media=null; root.hidden=true; draw(); }
  };
}

/* ---------- add voice panel ---------- */
let pendingOrig=null, addBuf=null, addBlob=null, addOrig=null, addSliceT=null;
const addTrim=makeTrimmer($("addTrim"),{max:20,min:3,label:"חיתוך הדגימה",onChange:()=>{ clearTimeout(addSliceT); addSliceT=setTimeout(updatePending,250); }});
async function updatePending(){
  if(!addBuf) return; const {start,end}=addTrim.get();
  pending=await sliceWav(addBuf,start,end); updateSave();
  setAdd(`דגימה של ${pending.secs.toFixed(1)} שניות מוכנה.${pending.secs<8?" עדיף לפחות 10 שניות.":""}`,"ok");
}
function showAddPreview(){
  const pv=$("addPreview"); if(pv.src) URL.revokeObjectURL(pv.src);
  if(addBlob){ pv.src=URL.createObjectURL(addBlob); pv.hidden=false; $("cleanRow").hidden=false; $("undoClean").hidden=!addOrig; }
  else { pv.removeAttribute("src"); pv.hidden=true; $("cleanRow").hidden=true; addTrim.clear(); }
}
/* sheets */
let sheetStack=[];
function openSheet(id){
  const el=$(id); if(!el.hidden) return;
  sheetStack.push(id); el.hidden=false; el.classList.remove("closing");
  $("scrim").hidden=false; document.body.classList.add("sheet-open");
}
function closeSheet(id){
  const el=$(id); if(el.hidden) return;
  el.classList.add("closing");
  setTimeout(()=>{ el.hidden=true; el.classList.remove("closing"); },200);
  sheetStack=sheetStack.filter(x=>x!==id);
  if(!sheetStack.length){ $("scrim").hidden=true; document.body.classList.remove("sheet-open"); }
}
$("scrim").onclick=()=>{ const top=sheetStack[sheetStack.length-1]; if(top==="addPanel") $("cancelAdd").click(); else if(top) closeSheet(top); };
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeSheet(b.closest(".sheet").id));
addEventListener("keydown",e=>{ if(e.key==="Escape" && sheetStack.length) $("scrim").click(); });
$("voiceRow").onclick=()=>openSheet("voiceSheet");

function openAdd(){ closeSheet("voiceSheet"); openSheet("addPanel"); pending=null; addBuf=null; addBlob=null; addOrig=null; showAddPreview(); $("voiceName").value=""; $("consent").checked=false; updateSave(); }
$("cancelAdd").onclick=()=>{ stopRec(); closeSheet("addPanel"); };
function setAdd(msg,cls=""){ const s=$("addStatus"); s.textContent=msg; s.className="status "+cls; }
function updateSave(){ $("saveVoice").disabled = !(pending && $("consent").checked && $("voiceName").value.trim()); }
["consent","voiceName"].forEach(id=>$(id).addEventListener("input",updateSave));

async function takeSample(blob, keepOrig=false){
  try{
    setAdd("מעבד את הדגימה…");
    const buf=await decode(blob);
    if(buf.duration<4){ setAdd(`הדגימה קצרה מדי (${buf.duration.toFixed(1)} שנ'). צריך לפחות 5 שניות, עדיף 10.`,"err"); pending=null; updateSave(); return; }
    if(buf.duration>600){ setAdd("הקובץ ארוך מדי. העלה קובץ של עד 10 דקות.","err"); return; }
    if(!keepOrig) addOrig=null;
    addBuf=buf; addBlob=blob; showAddPreview(); addTrim.set(buf,$("addPreview")); await updatePending();
    if(buf.duration>20) setAdd(`הקובץ באורך ${buf.duration.toFixed(0)} שניות. בחר בחיתוך קטע של עד 20 שניות עם דיבור ברור.`,"ok");
  }catch(e){ pending=null; setAdd("לא הצלחתי לקרוא את הקובץ. נסה קובץ MP3, WAV או M4A.","err"); }
  updateSave();
}
$("fileIn").onchange=e=>{ const f=e.target.files[0]; if(f){ if(!$("voiceName").value) $("voiceName").value=f.name.replace(/\.[^.]+$/,"").slice(0,30); takeSample(f);} e.target.value=""; };

let rec=null, chunks=[], recTimer=null;
async function startRec(){
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){ setAdd("ההקלטה לא זמינה כאן. הקלט בהקלטת קול של הטלפון והעלה את הקובץ.","err"); return; }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    chunks=[]; rec=new MediaRecorder(stream);
    rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);
    rec.onstop=()=>{ stream.getTracks().forEach(t=>t.stop()); takeSample(new Blob(chunks,{type:rec.mimeType})); rec=null; $("recBtn").textContent="הקלטה"; $("recBtn").classList.remove("pulse"); };
    rec.start(); let s=0; $("recBtn").textContent="עצירה (0)"; $("recBtn").classList.add("pulse");
    setAdd("מקליט… קרא משפט או שניים בקול רגיל.");
    recTimer=setInterval(()=>{ s++; $("recBtn").textContent=`עצירה (${s})`; if(s>=20) stopRec(); },1000);
  }catch{ setAdd("אין גישה למיקרופון. אשר הרשאה בדפדפן, או העלה קובץ הקלטה.","err"); }
}
function stopRec(){ clearInterval(recTimer); if(rec && rec.state!=="inactive") rec.stop(); }
$("recBtn").onclick=()=> rec ? stopRec() : startRec();

$("saveVoice").onclick=async()=>{
  const v={ id:"v"+Date.now(), name:$("voiceName").value.trim(), wav:pending.wav, secs:Math.min(pending.secs,20), created:Date.now(), consent:true };
  try{ await put("voices",v); }catch(e){ setAdd("השמירה נכשלה: "+errText(e),"err"); return; }
  if(cloud.active) cloud.logConsent("voice_consent", v.id);
  selected=v.id; try{localStorage.setItem("koli.voice",v.id);}catch{}
  closeSheet("addPanel"); await loadVoices(); setGen(`הקול "${v.name}" נשמר ונבחר.`,"ok");
};

/* ---------- state ---------- */
const ta=$("text"), dlgTa=$("dlgText");
let busy=false, stage="", variants=1;
const CHUNK=250, TEXT_MAX=5000;
const STT_BASE="https://hf-audio-whisper-large-v3.hf.space";
const ENH_BASE="https://resembleai-resemble-enhance.hf.space";
const MODE_LABEL={tts:"הפקה", vc:"המרה לקול שנבחר", dub:"דיבוב הסרטון", dlg:"הפקת הדיאלוג"};
const MODE_WORK={tts:"מפיק את הקול", vc:"ממיר את ההקלטה", dub:"מדבב את הסרטון", dlg:"מפיק את הדיאלוג"};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const store={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch{ return d; } }, set(k,v){ const raw=JSON.stringify(v); try{ localStorage.setItem(k,raw); }catch{} cloud.savePref(k,raw); } };

/* ---------- banner ---------- */
let bnTimer=null;
function setGen(msg,cls=""){
  const b=$("banner"), state = cls==="err" ? "err" : cls==="ok" ? "ok" : "work";
  clearTimeout(bnTimer);
  if(!msg){ hideBanner(); return; }
  b.className="banner "+state; b.hidden=false; document.body.classList.add("has-banner");
  $("bnTitle").textContent = state==="err" ? "משהו השתבש" : state==="ok" ? "מוכן!" : (MODE_WORK[mode]||"עובד");
  $("bnMsg").textContent = msg;
  if(state==="ok") bnTimer=setTimeout(hideBanner, 6000);
}
function hideBanner(){ const b=$("banner"); b.classList.add("leaving"); bnTimer=setTimeout(()=>{ b.hidden=true; b.classList.remove("leaving"); document.body.classList.remove("has-banner"); },300); }
$("bnClose").onclick=hideBanner;
function errText(e){
  if(!e) return "לא ידוע";
  if(typeof e==="string") return e;
  const parts=[e.message,e.title,e.original_msg,e.error].filter(x=>typeof x==="string"&&x);
  if(parts.length) return parts.join(" | ");
  try{ return JSON.stringify(e); }catch{ return String(e); }
}
function showErr(e){
  const m=errText(e);
  setGen(/quota|GPU|exceeded/i.test(m) ? `נגמרה המכסה החינמית לעכשיו. נסה שוב בעוד כמה דקות, או חבר חשבון Hugging Face למטה. (${m.slice(0,140)})`
       : /queue|full|busy/i.test(m) ? "השרת עמוס. נסה שוב עוד רגע."
       : `נכשל בשלב ${stage}. נסה שוב עוד רגע. פרטים: ${m.slice(0,220)}`,"err");
  console.error(e);
}
function ticker(t0, label){ return setInterval(()=>setGen(`${label}… ${Math.round((Date.now()-t0)/1000)} שנ'`),1000); }

/* ---------- server plumbing (Gradio) ---------- */
function token(){ try{ return (localStorage.getItem("koli.hf")||"").trim(); }catch{ return ""; } }
function auth(h={}){ const t=token(); return t ? {...h, Authorization:"Bearer "+t} : h; }
async function http(url,opts,what){
  let r;
  try{ r=await fetch(url,opts); }
  catch(e){ throw new Error(`${what}: אין תקשורת עם השרת (${e.message})${token()?". נסה ללחוץ ניתוק בהגדרות החשבון ולנסות שוב":""}`); }
  if(!r.ok){ let t=""; try{t=(await r.text()).slice(0,160);}catch{} throw new Error(`${what}: השרת החזיר ${r.status} ${t}`); }
  return r;
}
async function upload(blob, api=ttsApi(), name="voice.wav"){
  const fd=new FormData(); fd.append("files", blob, name);
  const r=await http(api+"/upload",{method:"POST",body:fd,headers:auth()},"העלאת הקובץ");
  const j=await r.json(); const path=Array.isArray(j)?j[0]:j;
  return { path, orig_name:name, mime_type:blob.type||"audio/wav", meta:{_type:"gradio.FileData"} };
}
const remote = (url)=>({ path:url, url, orig_name:url.split("/").pop(), meta:{_type:"gradio.FileData"} });
async function callTTS(data, api=ttsApi(), fn=FN){
  const r=await http(`${api}/call/${fn}`,{method:"POST",headers:auth({"Content-Type":"application/json"}),body:JSON.stringify({data})},"שליחת הבקשה");
  let j; try{ j=await r.json(); }catch{ const e=new Error("NO_CALL_API"); e.noCall=true; throw e; }
  const { event_id } = j;
  const res=await http(`${api}/call/${fn}/${event_id}`,{headers:auth()},"קבלת התוצאה");
  const txt=await res.text();
  const blocks=txt.split(/\n\n/); let ev="", payload=null, lastGen=null;
  for(const blk of blocks){
    const e=(blk.match(/^event:\s*(.*)$/m)||[])[1]; const d=(blk.match(/^data:\s*(.*)$/m)||[])[1];
    if(e){ ev=e.trim(); if(d){ try{payload=JSON.parse(d);}catch{payload=d;} } if(ev==="generating"&&payload) lastGen=payload; if(ev==="complete"||ev==="error") break; }
  }
  if(ev!=="complete"){ if(ev==="error"&&payload==null&&lastGen) return lastGen; throw new Error(`השרת דחה את הבקשה${payload?": "+(typeof payload==="string"?payload:JSON.stringify(payload)):(token()?" בלי פירוט. כנראה עומס זמני או שהמכסה של החשבון נגמרה להיום":" בלי פירוט. כנראה נגמרה המכסה החינמית למשתמשים בלי חשבון. חבר חשבון Hugging Face בחינם בהגדרות שלמטה")}`); }
  return payload;
}
async function getJson(urls){
  for(const u of urls){
    try{ const r=await fetch(u,{headers:auth()}); if(!r.ok) continue; const t=await r.text(); try{ return [u, JSON.parse(t)]; }catch{} }catch{}
  }
  return [null,null];
}
async function callQueue(api, fn, data, cfg){
  if(!cfg){ const [,c]=await getJson([api+"/config", api.replace(/\/gradio_api$/,"")+"/config"]); cfg=c; }
  if(!cfg) throw new Error("קריאת הגדרות השרת נכשלה");
  const deps=cfg.dependencies||[];
  let idx=deps.findIndex(d=>d.api_name===fn);
  if(idx<0) idx=deps.findIndex(d=>d.api_name && d.api_name!==false && (d.inputs||[]).length===data.length);
  if(idx<0) throw new Error("לא נמצאה הפעולה בהגדרות השרת");
  const dep=deps[idx]; const fn_index = dep.id ?? idx;
  const session_hash=Math.random().toString(36).slice(2,13);
  await http(api+"/queue/join",{method:"POST",headers:auth({"Content-Type":"application/json"}),
    body:JSON.stringify({data, fn_index, session_hash, event_data:null, trigger_id: dep.targets?.[0]?.[0] ?? null})},"כניסה לתור");
  const res=await http(`${api}/queue/data?session_hash=${session_hash}`,{headers:auth({Accept:"text/event-stream"})},"קבלת התוצאה");
  const reader=res.body.getReader(); const dec=new TextDecoder(); let buf="", last=null;
  while(true){
    const {value,done}=await reader.read(); if(done) break;
    buf+=dec.decode(value,{stream:true});
    let i;
    while((i=buf.indexOf("\n\n"))>=0){
      const chunk=buf.slice(0,i); buf=buf.slice(i+2);
      const line=chunk.split("\n").find(l=>l.startsWith("data:")); if(!line) continue;
      let m; try{ m=JSON.parse(line.slice(5)); }catch{ continue; }
      if(m.msg==="process_generating" && m.output?.data) last=m.output.data;
      if(m.msg==="estimation" && m.rank>0) setGen(`ממתין בתור… מקום ${m.rank+1}`);
      if(m.msg==="process_completed"){
        try{ reader.cancel(); }catch{}
        if(m.success===false || (m.output?.error && !m.output?.data)){ throw new Error("השרת דחה את הבקשה: "+(m.output?.error||m.title||m.message||"בלי פירוט. כנראה עומס או מכסה חינמית שנגמרה")); }
        return m.output?.data || last;
      }
      if(m.msg==="unexpected_error"||m.msg==="queue_full"){ try{reader.cancel();}catch{} throw new Error(m.msg==="queue_full"?"השרת עמוס (התור מלא)":"השרת דחה את הבקשה: "+(m.message||"שגיאה לא צפויה")); }
    }
  }
  if(last) return last;
  throw new Error("החיבור לשרת נסגר לפני שהתקבלה תוצאה");
}
async function callAny(data, api, fn, cfg){
  try{ return await callTTS(data, api, fn); }
  catch(e){ if(e.noCall || /השרת החזיר (404|405)/.test(e.message)) return await callQueue(api, fn, data, cfg); throw e; }
}
function fileUrl(o, api){ if(!o) return null; if(typeof o==="string") return o; if(o.url) return o.url; if(o.path) return `${api}/file=${o.path}`; return null; }
function audioUrl(data, api){ const arr=Array.isArray(data)?data:[data]; for(let i=arr.length-1;i>=0;i--){ const u=fileUrl(arr[i],api); if(u) return u; } return null; }
async function fetchBlob(url){ const r=await http(url,{},"הורדת הקובץ"); return await r.blob(); }

const spaces={};
const pnames=e=>(e[1].parameters||[]).map(p=>p.parameter_name||"");
async function connectSpace(base, pick, label){
  if(spaces[base]) return spaces[base];
  let cfg=null;
  for(let i=0;i<4 && !cfg;i++){
    if(i){ setGen(`${label} מתעורר משינה, זה לוקח עד דקה…`); await wait(8000); }
    [,cfg]=await getJson([base+"/config", base+"/gradio_api/config"]);
  }
  if(!cfg) throw new Error(`${label} לא עונה כרגע`);
  const major=parseInt(String(cfg.version||"0").split(".")[0],10);
  const api = base + (cfg.api_prefix ?? (major>=5 ? "/gradio_api" : ""));
  const [,info]=await getJson([api+"/info", base+"/info", base+"/gradio_api/info"]);
  const ep = info ? pick(Object.entries(info.named_endpoints||{})) : null;
  if(!ep) throw new Error(`לא נמצאה הפעולה ב${label}`);
  return spaces[base]={ api, fn:ep[0].replace(/^\//,""), params:ep[1].parameters||[], cfg };
}

/* ---------- text to speech core ---------- */
const VS_DEF={exag:.5,pace:.5,temp:.8};
function getVS(id){ return {...VS_DEF, ...store.get("koli.vs."+id,{})}; }
function loadVS(){
  const o=getVS(selected);
  [["exag","exagOut"],["pace","paceOut"],["temp","tempOut"]].forEach(([i,out])=>{ $(i).value=o[i]; $(out).textContent=o[i]; });
  const v=voices.find(x=>x.id===selected); $("vsNote").textContent = v ? `נשמר ל${v.name}` : "";
  markRec();
}
[["exag","exagOut"],["pace","paceOut"],["temp","tempOut"]].forEach(([i,o])=>{ $(i).oninput=()=>{ $(o).textContent=$(i).value; store.set("koli.vs."+selected,{exag:+$("exag").value,pace:+$("pace").value,temp:+$("temp").value}); }; });

const refCache=new Map();
async function voiceRef(v){
  if(v.ttsDefault) return null;
  const k=v.id+"@"+(myServer()||"shared");
  if(!refCache.has(k)) refCache.set(k, await voiceFileFor(v, ttsApi()));
  return refCache.get(k);
}
async function ttsOnce(text, v){
  const st=getVS(v.id);
  const mk=async()=>[text, await voiceRef(v), "he", st.exag, st.temp, 0, st.pace];
  let data;
  try{ data=await callTTS(await mk()); }
  catch(e1){ if(!/השרת דחה/.test(e1.message)) throw e1; refCache.clear(); setGen("השרת לא הצליח בפעם הראשונה, מנסה שוב…"); data=await callTTS(await mk()); }
  const url=audioUrl([Array.isArray(data)?data[0]:data], ttsApi());
  if(!url) throw new Error("לא התקבל קובץ שמע");
  return await fetchBlob(url);
}

/* ---------- pronunciation dictionary ---------- */
let dict=store.get("koli.dict",[]);
const esc=t=>t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function applyDict(t){
  for(const {from,to} of dict){
    if(!from) continue;
    const re=new RegExp(`(^|[^\\p{L}])([והבכלמש]{0,2})${esc(from)}(?=$|[^\\p{L}])`,"gu");
    t=t.replace(re,(m,pre,px)=>pre+px+to);
  }
  return t;
}
function renderDict(){
  const ul=$("dictList"); ul.textContent="";
  dict.forEach((d,i)=>{
    const li=document.createElement("li");
    const sp=document.createElement("span"); const a=document.createElement("b"); a.textContent=d.from; sp.append(a, document.createTextNode(" ← "+d.to));
    const x=document.createElement("button"); x.type="button"; x.textContent="×"; x.setAttribute("aria-label",`מחיקת ${d.from}`);
    x.onclick=()=>{ dict.splice(i,1); store.set("koli.dict",dict); renderDict(); };
    li.append(sp,x); ul.append(li);
  });
  $("dictCount").textContent = dict.length ? `${dict.length} מילים` : "";
}
$("dictAdd").onclick=()=>{
  const from=$("dictFrom").value.trim(), to=$("dictTo").value.trim(); if(!from||!to) return;
  dict=dict.filter(d=>d.from!==from); dict.push({from,to}); store.set("koli.dict",dict);
  $("dictFrom").value=""; $("dictTo").value=""; $("dictFrom").focus(); renderDict(); count(); updateReadAs();
};
$("dictTo").addEventListener("keydown",e=>{ if(e.key==="Enter") $("dictAdd").click(); });

/* ---------- splitting long text ---------- */
function splitText(t){
  const parts=t.replace(/\r/g,"").split(/\n+|(?<=[.!?…؟])\s+/).map(x=>x.trim()).filter(Boolean);
  const pieces=[];
  for(const p of parts){
    if(p.length<=CHUNK){ pieces.push(p); continue; }
    let cur="";
    for(const w of p.split(/(?<=[,،;:])\s+|\s+/)){
      if((cur+" "+w).trim().length>CHUNK && cur){ pieces.push(cur.trim()); cur=w; } else cur=(cur+" "+w).trim();
    }
    if(cur) pieces.push(cur);
  }
  const out=[]; let cur="";
  for(const p of pieces){ if(cur && (cur+" "+p).length>CHUNK){ out.push(cur); cur=p; } else cur=cur?cur+" "+p:p; }
  if(cur) out.push(cur);
  return out;
}

/* ---------- variants setting ---------- */
variants=store.get("koli.variants",1);
function renderVariants(){ document.querySelectorAll("[data-var]").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.var===variants))); }
document.querySelectorAll("[data-var]").forEach(b=>b.onclick=()=>{ variants=+b.dataset.var; store.set("koli.variants",variants); renderVariants(); count(); });

/* ---------- projects: segment editor ---------- */
const projects={tts:null, dlg:null};
function currentProject(){ return projects[mode]||null; }
function renderSegs(activeIdx=-1){
  const proj=currentProject(); const panel=$("segPanel");
  panel.hidden=!proj; if(!proj) return;
  const list=$("segList"); list.textContent="";
  const missing=proj.segs.filter(s=>!s.variants.length).length;
  $("segInfo").textContent = `${proj.segs.length} קטעים${missing?` · ${missing} חסרים`:""}`;
  $("segResumeRow").hidden = !missing || busy;
  proj.segs.forEach((sg,i)=>{
    const d=document.createElement("div"); d.className="seg"+(sg.variants.length?"":" missing")+(i===activeIdx?" active":"");
    const h=document.createElement("div"); h.className="seg-head";
    const num=document.createElement("span"); num.textContent=`קטע ${i+1}`; h.append(num);
    if(proj.kind==="dlg"){ const w=document.createElement("span"); w.className="who"; w.textContent=`${sg.who} · ${voiceById(sg.voiceId).name}`; h.append(w); }
    const st=document.createElement("span"); st.className="state"; st.textContent = i===activeIdx ? "מפיק…" : sg.variants.length ? "" : "עוד לא הופק"; h.append(st);
    const p=document.createElement("p"); p.textContent=sg.text;
    d.append(h,p);
    if(sg.variants.length){
      const a=document.createElement("audio"); a.controls=true; a.preload="none"; a.src=URL.createObjectURL(sg.variants[sg.chosen]); d.append(a);
    }
    const act=document.createElement("div"); act.className="seg-actions";
    if(sg.variants.length>1) sg.variants.forEach((_,k)=>{
      const c=document.createElement("button"); c.type="button"; c.className="chip"; c.textContent=`גרסה ${k+1}`; c.setAttribute("aria-pressed",String(k===sg.chosen));
      c.onclick=()=>{ sg.chosen=k; renderSegs(); finalize(proj,null,true); };
      act.append(c);
    });
    const re=document.createElement("button"); re.type="button"; re.className="btn"; re.textContent = sg.variants.length ? "הפקה מחדש" : "הפקה"; re.disabled=busy;
    re.onclick=()=>regenSeg(proj,i);
    act.append(re); d.append(act); list.append(d);
  });
}
async function genSeg(proj,i,k,total){
  const sg=proj.segs[i];
  setGen(`קטע ${i+1} מתוך ${total}${variants>1?` · גרסה ${k+1} מתוך ${variants}`:""}`);
  renderSegs(i);
  const blob=await ttsOnce(sg.text, voiceById(sg.voiceId));
  sg.variants.push(blob); sg.chosen=sg.variants.length-1;
  if(k===0 && sg.variants.length>1) sg.chosen=0;
}
async function runProject(kind, segs, label, gap){
  if(busy) return; busy=true; count();
  const t0=Date.now();
  const proj={ kind, label, gap, takeId:"t"+Date.now(), segs:segs.map(sg=>({...sg, variants:[], chosen:0})) };
  projects[kind]=proj;
  try{
    stage="חיבור לשרת"; setGen("מתחבר לשרת החינמי…");
    await fillMissing(proj);
    await finalize(proj,t0);
  }catch(e){ showErr(e); }
  finally{ busy=false; count(); renderSegs(); }
}
async function fillMissing(proj){
  stage="הפקה";
  for(let i=0;i<proj.segs.length;i++){
    if(proj.segs[i].variants.length) continue;
    for(let k=0;k<variants;k++) await genSeg(proj,i,k,proj.segs.length);
    proj.segs[i].chosen=0;
  }
}
$("segResume").onclick=async()=>{
  const proj=currentProject(); if(!proj||busy) return; busy=true; count();
  const t0=Date.now();
  try{ await fillMissing(proj); await finalize(proj,t0); }catch(e){ showErr(e); }
  finally{ busy=false; count(); renderSegs(); }
};
async function regenSeg(proj,i){
  if(busy) return; busy=true; count();
  const t0=Date.now();
  try{ stage="הפקה מחדש"; await genSeg(proj,i,0,proj.segs.length); proj.segs[i].chosen=proj.segs[i].variants.length-1; await finalize(proj,t0,true); }
  catch(e){ showErr(e); }
  finally{ busy=false; count(); renderSegs(); }
}
async function finalize(proj,t0,update=false){
  if(proj.segs.some(sg=>!sg.variants.length)){ renderSegs(); return; }
  stage="חיבור הקטעים";
  const blob = proj.segs.length===1 ? proj.segs[0].variants[proj.segs[0].chosen] : await concatWav(proj.segs.map(sg=>sg.variants[sg.chosen]), proj.gap);
  const voiceNames=[...new Set(proj.segs.map(sg=>voiceById(sg.voiceId).name))].join(", ");
  const take={ id:proj.takeId, text:proj.label, voice:voiceNames, blob, created:Date.now(), kind:"audio" };
  await put("takes",take); renderTakes(take.id, !update);
  setGen(update ? "הקובץ המלא עודכן." : `מוכן אחרי ${Math.round((Date.now()-(t0||Date.now()))/1000)} שניות.`,"ok");
}

/* ---------- text to speech mode ---------- */
/* ---------- Hebrew: numbers and symbols to words ---------- */
const HE_ONES=["","אחת","שתיים","שלוש","ארבע","חמש","שש","שבע","שמונה","תשע"];
const HE_TEENS=["עשר","אחת עשרה","שתים עשרה","שלוש עשרה","ארבע עשרה","חמש עשרה","שש עשרה","שבע עשרה","שמונה עשרה","תשע עשרה"];
const HE_TENS=["","עשר","עשרים","שלושים","ארבעים","חמישים","שישים","שבעים","שמונים","תשעים"];
const HE_HUND=["","מאה","מאתיים","שלוש מאות","ארבע מאות","חמש מאות","שש מאות","שבע מאות","שמונה מאות","תשע מאות"];
const HE_THOU=["","אלף","אלפיים","שלושת אלפים","ארבעת אלפים","חמשת אלפים","ששת אלפים","שבעת אלפים","שמונת אלפים","תשעת אלפים"];
function joinVav(parts){ parts=parts.filter(Boolean); if(parts.length<2) return parts.join(""); return parts.slice(0,-1).join(" ")+" ו"+parts[parts.length-1]; }
const HE_ONES_M=["","אחד","שניים","שלושה","ארבעה","חמישה","שישה","שבעה","שמונה","תשעה"];
const HE_TEENS_M=["עשרה","אחד עשר","שנים עשר","שלושה עשר","ארבעה עשר","חמישה עשר","שישה עשר","שבעה עשר","שמונה עשר","תשעה עשר"];
function below1000(n, masc=false){
  const ONES=masc?HE_ONES_M:HE_ONES, TEENS=masc?HE_TEENS_M:HE_TEENS;
  const h=Math.floor(n/100), r=n%100, t=Math.floor(r/10), o=r%10;
  const rest = r===0 ? "" : r<10 ? ONES[r] : r<20 ? TEENS[r-10] : (o ? HE_TENS[t]+" ו"+ONES[o] : HE_TENS[t]);
  if(!h) return rest;
  return rest ? (r<20||o===0 ? HE_HUND[h]+" ו"+rest : HE_HUND[h]+" "+rest) : HE_HUND[h];
}
function heNumber(n){
  if(n===0) return "אפס";
  if(n>=1e12) return String(n);
  const parts=[];
  const bil=Math.floor(n/1e9), mil=Math.floor(n%1e9/1e6), th=Math.floor(n%1e6/1000), rest=n%1000;
  const big=(k,word)=> k===1?word : k===2?"שני "+word : below1000(k,true)+" "+word;
  if(bil) parts.push(big(bil,"מיליארד"));
  if(mil) parts.push(big(mil,"מיליון"));
  if(th) parts.push(th<10?HE_THOU[th]:th===10?"עשרת אלפים":below1000(th,true)+" אלף");
  if(rest) parts.push(below1000(rest));
  if(parts.length===1) return parts[0];
  const last=parts.pop();
  const lastHasVav = / ו/.test(last);
  return parts.join(" ")+(lastHasVav?" ":" ו")+last;
}
function heDecimal(str){
  const [i,f]=str.replace(/,/g,"").split(".");
  const whole=heNumber(parseInt(i,10));
  if(!f) return whole;
  const asNumber = f.length===1 || (f.length===2 && f[1]==="0" && f[0]!=="0");
  return whole+" נקודה "+(asNumber ? heNumber(parseInt(f,10)) : [...f].map(d=>heNumber(+d)).join(" "));
}
function hebrewize(t){
  if(!/\d/.test(t)) return t;
  t=t.replace(/(^|[^\p{L}])([והבכלמש]{1,2})[-־](?=[\d₪$])/gu,"$1$2");
  t=t.replace(/(\d{1,2}):(\d{2})(?!\d)/g,(m,h,mm)=>{ const H=+h, M=+mm; if(H>24||M>59) return m; return heNumber(H)+(M?" ו"+(M===30?"חצי":M===15?"רבע":heNumber(M)+" דקות"):""); });
  t=t.replace(/₪\s?(\d[\d,]*(?:\.\d+)?)/g,"$1 שקלים").replace(/(\d[\d,]*(?:\.\d+)?)\s?(?:₪|ש"ח|ש״ח)/g,"$1 שקלים");
  t=t.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g,"$1 דולר").replace(/(\d[\d,]*(?:\.\d+)?)\s?\$/g,"$1 דולר").replace(/(\d[\d,]*(?:\.\d+)?)\s?%/g,"$1 אחוז");
  t=t.replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g,m=>heDecimal(m));
  return t;
}
function prepText(t){ return hebrewize(applyDict(t)); }
function ttsChunks(){ return splitText(prepText(ta.value.trim())); }
function count(){
  if(mode==="tts"){
    const n=ta.value.length, c=ta.value.trim()?ttsChunks().length:0;
    $("count").textContent=`${n.toLocaleString("he-IL")} תווים · ${c===1?"קטע אחד":c+" קטעים"}${variants>1&&c?` · ${c*variants} הפקות`:""}`;
  }
  if(mode==="dlg"){ const lines=parseScript(); $("dlgCount").textContent=`${lines.length} שורות`; }
  const ready = mode==="vc" ? !!vcSrc : mode==="dub" ? !!dubSrc : mode==="dlg" ? parseScript().length>0 : !!ta.value.trim();
  $("genBtn").disabled = busy || !ready;
  $("genBtn").classList.toggle("working",busy);
  $("segResumeRow").hidden = true;
  if(!busy){ const pr=currentProject(); if(pr) $("segResumeRow").hidden = !pr.segs.some(sg=>!sg.variants.length); }
}
function updateReadAs(){ const raw=ta.value.trim(), out=prepText(raw); const show = raw && out!==raw; $("readAs").hidden=!show; if(show) $("readAsText").textContent=out; }
ta.addEventListener("input",()=>{ count(); updateReadAs(); try{localStorage.setItem("koli.text",ta.value);}catch{} });
try{ const t=localStorage.getItem("koli.text"); if(t) ta.value=t; }catch{}
async function runTTS(){
  const text=ta.value.trim(); if(!text) return;
  const v=voiceById(selected);
  const segs=ttsChunks().map(t=>({text:t, voiceId:v.id}));
  await runProject("tts", segs, text.length>80 ? text.slice(0,80)+"…" : text, 0.25);
}

/* ---------- dialogue mode ---------- */
let castMap=store.get("koli.cast",{});
function parseScript(){
  let last="קריין";
  return dlgTa.value.split(/\n+/).map(l=>l.trim()).filter(Boolean).map(l=>{
    const m=l.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
    if(m){ last=m[1].trim(); return {who:last, text:m[2].trim()}; }
    return {who:last, text:l};
  });
}
function renderCast(){
  if(!voices.length) return;
  const names=[...new Set(parseScript().map(l=>l.who))];
  const box=$("cast"); box.textContent="";
  names.forEach((name,i)=>{
    if(!castMap[name] || !voices.find(v=>v.id===castMap[name])){
      const byName=voices.find(v=>v.name===name);
      castMap[name]= byName ? byName.id : voices[i % voices.length].id;
    }
    const row=document.createElement("div"); row.className="cast-row";
    const b=document.createElement("b"); b.textContent=name;
    const sel=document.createElement("select"); sel.setAttribute("aria-label",`הקול של ${name}`); sel.id="cast-"+i;
    voices.forEach(v=>{ const o=document.createElement("option"); o.value=v.id; o.textContent= v.builtin ? `${v.name} · ${v.note}` : `${v.name} (שלי)`; sel.append(o); });
    sel.value=castMap[name];
    sel.onchange=()=>{ castMap[name]=sel.value; store.set("koli.cast",castMap); };
    row.append(b,sel); box.append(row);
  });
  store.set("koli.cast",castMap);
}
let castT=null;
dlgTa.addEventListener("input",()=>{ count(); clearTimeout(castT); castT=setTimeout(renderCast,400); store.set("koli.dlg",dlgTa.value); });
{ const t=store.get("koli.dlg",null); if(t) dlgTa.value=t; }
async function runDialog(){
  const lines=parseScript(); if(!lines.length) return;
  const segs=[];
  for(const l of lines) for(const t of splitText(prepText(l.text))) segs.push({text:t, voiceId:castMap[l.who]||selected, who:l.who});
  const names=[...new Set(lines.map(l=>l.who))];
  await runProject("dlg", segs, `דיאלוג: ${names.join(", ")}`, 0.45);
}

/* ---------- voice conversion (Seed-VC) ---------- */
let vcSrc=null;
const pickVC=eps=>eps.find(e=>pnames(e).includes("f0_condition")) || eps.find(e=>pnames(e).some(n=>/source/.test(n)) && pnames(e).some(n=>/target|reference/.test(n)));
const sysWavCache=new Map();
async function voiceFileFor(v, api){
  if(!v.builtin) return await upload(v.wav, api, "target.wav");
  try{
    if(!sysWavCache.has(v.id)){ const r=await fetch(v.url); if(!r.ok) throw 0; sysWavCache.set(v.id,(await toWav(await r.blob(),20)).wav); }
    return await upload(sysWavCache.get(v.id), api, "target.wav");
  }catch{ return remote(v.url); }
}
function splitPoints(buf, target=15, minLen=8, maxLen=20){
  const d=buf.duration; if(d<=maxLen) return [[0,d]];
  const ch=buf.getChannelData(0), sr=buf.sampleRate, win=Math.floor(sr*0.05);
  const energy=t=>{ const i=Math.floor(t*sr); let e=0; for(let k=i;k<i+win&&k<ch.length;k++) e+=ch[k]*ch[k]; return e; };
  const cuts=[]; let st=0;
  while(d-st>maxLen){
    let best=st+target, bestE=Infinity;
    for(let t=st+minLen;t<=st+maxLen;t+=0.05){ const e=energy(t); if(e<bestE){ bestE=e; best=t; } }
    cuts.push([st,best]); st=best;
  }
  cuts.push([st,d]); return cuts;
}
async function convertVoice(srcWav, v){
  stage="חיבור לשרת ההמרה"; setGen("מתחבר לשרת ההמרה…");
  const sp=await connectSpace(VC_BASE, pickVC, "שרת ההמרה");
  stage="העלאת הקול שנבחר";
  const tgt=await voiceFileFor(v, sp.api);
  const buf=await decode(srcWav);
  const parts=splitPoints(buf);
  const sing=$("vcSing").checked;
  const mk=(src,steps)=>sp.params.map(p=>{
    const n=p.parameter_name||"";
    if(/source/.test(n)) return src;
    if(/target|reference/.test(n)) return tgt;
    if(/diffusion/.test(n)) return steps;
    if(/pitch/.test(n)) return +$("vcPitch").value;
    if(n==="f0_condition") return sing || +$("vcPitch").value!==0;
    if(/auto_f0/.test(n)) return !sing;
    if(/stream/.test(n)) return false;
    if(/anonym/.test(n)) return false;
    return p.parameter_default ?? null;
  });
  const outs=[]; const steps=+$("vcSteps").value;
  for(let i=0;i<parts.length;i++){
    const [a,b]=parts[i];
    const label = parts.length>1 ? `קטע ${i+1} מתוך ${parts.length}` : "ההקלטה";
    stage=`המרה (${label})`; setGen(`ממיר את ${label}…`);
    const piece = parts.length>1 ? (await sliceWav(buf,a,b)).wav : srcWav;
    const src=await upload(piece, sp.api, `source${i}.wav`);
    let out;
    try{ out=await callAny(mk(src,steps), sp.api, sp.fn, sp.cfg); }
    catch(e1){
      if(!/השרת דחה/.test(e1.message)) throw e1;
      setGen(`השרת לא הצליח עם ${label}. מנסה שוב בהגדרה קלה יותר (איכות 10)…`);
      try{ out=await callAny(mk(src,Math.min(10,steps)), sp.api, sp.fn, sp.cfg); }
      catch(e2){ const e=new Error(`${errText(e2)}. נסה קטע קצר יותר, קול אחר מהקולות שלך, או חכה כמה דקות שהמכסה תתמלא.`); throw e; }
    }
    const url=audioUrl(out, sp.api);
    if(!url) throw new Error("לא התקבל קובץ שמע");
    outs.push(await fetchBlob(url));
  }
  return outs.length===1 ? outs[0] : await concatWav(outs, 0);
}
function setVc(msg,cls=""){ const s=$("vcStatus"); s.textContent=msg; s.className="status "+cls; }
let vcBuf=null, vcBlob=null;
const vcTrim=makeTrimmer($("vcTrim"),{max:60,min:1,label:"חיתוך ההקלטה",onChange:(st,en)=>{ vcSrc={secs:en-st}; }});
async function vcSlice(){ const {start,end}=vcTrim.get(); return await sliceWav(vcBuf,start,end); }
async function takeVcSource(blob){
  try{
    setVc("מעבד את ההקלטה…");
    const buf=await decode(blob);
    if(buf.duration<1){ setVc("ההקלטה קצרה מדי.","err"); vcSrc=null; return; }
    if(buf.duration>600){ setVc("הקובץ ארוך מדי. העלה קובץ של עד 10 דקות.","err"); return; }
    vcBuf=buf; vcBlob=blob;
    const pv=$("vcPreview"); if(pv.src) URL.revokeObjectURL(pv.src); pv.src=URL.createObjectURL(blob); pv.hidden=false;
    vcTrim.set(buf,pv); vcSrc={secs:vcTrim.get().end-vcTrim.get().start};
    $("vcClearRow").hidden=false; $("vcRecBtn").textContent="הקלטה חדשה"; $("vcUpLabel").textContent="העלאת קובץ אחר"; $("sttBox").hidden=true;
    setVc(buf.duration>60 ? `ההקלטה באורך ${buf.duration.toFixed(0)} שניות. בחר בחיתוך קטע של עד 60 שניות.` : `הקלטה של ${buf.duration.toFixed(1)} שניות מוכנה. אפשר לחתוך אותה, ואז ללחוץ "המרה".`,"ok");
  }catch{ vcSrc=null; setVc("לא הצלחתי לקרוא את הקובץ. נסה MP3, WAV, M4A או סרטון MP4.","err"); }
  count();
}
$("vcFile").onchange=e=>{ const f=e.target.files[0]; if(f) takeVcSource(f); e.target.value=""; };
let vcRec=null, vcChunks=[], vcTimer=null;
async function vcStart(){
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){ setVc("ההקלטה לא זמינה כאן. הקלט באפליקציית ההקלטות והעלה את הקובץ.","err"); return; }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    vcChunks=[]; vcRec=new MediaRecorder(stream);
    vcRec.ondataavailable=e=>e.data.size&&vcChunks.push(e.data);
    vcRec.onstop=()=>{ stream.getTracks().forEach(t=>t.stop()); takeVcSource(new Blob(vcChunks,{type:vcRec.mimeType})); vcRec=null; $("vcRecBtn").classList.remove("pulse"); $("vcRecBtn").textContent = vcSrc ? "הקלטה חדשה" : "הקלטה"; };
    vcRec.start(); let n=0; $("vcRecBtn").textContent="עצירה (0)"; $("vcRecBtn").classList.add("pulse"); setVc("מקליט… דבר בקול רגיל.");
    vcTimer=setInterval(()=>{ n++; $("vcRecBtn").textContent=`עצירה (${n})`; if(n>=60) vcStop(); },1000);
  }catch{ setVc("אין גישה למיקרופון. אשר הרשאה בדפדפן, או העלה קובץ.","err"); }
}
function vcStop(){ clearInterval(vcTimer); if(vcRec&&vcRec.state!=="inactive") vcRec.stop(); }
$("vcClear").onclick=()=>{
  vcStop(); vcSrc=null; vcBuf=null; vcBlob=null; vcTrim.clear();
  const pv=$("vcPreview"); pv.pause(); if(pv.src) URL.revokeObjectURL(pv.src); pv.removeAttribute("src"); pv.hidden=true; $("vcClearRow").hidden=true; $("sttBox").hidden=true;
  $("vcRecBtn").textContent="הקלטה"; $("vcUpLabel").textContent="העלאת הקלטה";
  setVc("ההקלטה נמחקה. הקלט או העלה הקלטה חדשה."); count();
};
$("vcRecBtn").onclick=()=> vcRec ? vcStop() : vcStart();
[["vcPitch","vcPitchOut"],["vcSteps","vcStepsOut"]].forEach(([i,o])=>{ $(i).oninput=()=>$(o).textContent=$(i).value; });
async function runVC(){
  if(busy||!vcSrc) return; busy=true; count();
  const v=voiceById(selected); const t0=Date.now(); let tick=null;
  try{
    tick=setTimeout(()=>{ tick=ticker(t0,"ממיר"); },4000);
    const sl=await vcSlice();
    const blob=await convertVoice(sl.wav, v);
    const take={ id:"t"+Date.now(), text:`המרת הקלטה של ${sl.secs.toFixed(0)} שנ'`, voice:v.name, blob, created:Date.now(), kind:"audio" };
    await put("takes",take); renderTakes(take.id);
    setGen(`מוכן אחרי ${Math.round((Date.now()-t0)/1000)} שניות.`,"ok");
  }catch(e){ delete spaces[VC_BASE]; showErr(e); }
  finally{ clearTimeout(tick); clearInterval(tick); busy=false; count(); }
}

/* ---------- transcription (Whisper) ---------- */
const pickSTT=eps=>eps.find(e=>{ const n=pnames(e); return n.includes("task") && !n.some(x=>/yt|url/.test(x)); });
$("sttBtn").onclick=async()=>{
  if(busy||!vcSrc) return; busy=true; count();
  const t0=Date.now(); let tick=null;
  try{
    stage="חיבור לשרת התמלול"; setGen("מתחבר לשרת התמלול…");
    const sp=await connectSpace(STT_BASE, pickSTT, "שרת התמלול");
    stage="העלאת ההקלטה"; const f=await upload((await vcSlice()).wav, sp.api, "audio.wav");
    stage="תמלול"; tick=ticker(t0,"מתמלל");
    const data=sp.params.map((p,i)=>{ const n=p.parameter_name||""; if(/task/.test(n)) return "transcribe"; if(i===0||/input|audio|file/.test(n)) return f; return p.parameter_default??null; });
    const out=await callAny(data, sp.api, sp.fn, sp.cfg);
    let t=Array.isArray(out)?out[0]:out; if(t&&typeof t==="object") t=t.value??JSON.stringify(t);
    $("sttText").value=(t||"").trim(); $("sttBox").hidden=false;
    setGen("התמלול מוכן. אפשר לערוך אותו לפני שמשתמשים בו.","ok");
  }catch(e){ delete spaces[STT_BASE]; showErr(e); }
  finally{ clearInterval(tick); busy=false; count(); }
};
$("sttCopy").onclick=async()=>{ try{ await navigator.clipboard.writeText($("sttText").value); setGen("התמלול הועתק.","ok"); }catch{ $("sttText").select(); } };
$("sttUse").onclick=()=>{ ta.value=$("sttText").value; ta.dispatchEvent(new Event("input")); setMode("tts"); ta.scrollIntoView({behavior:"smooth",block:"center"}); };

/* ---------- noise cleaning (Resemble Enhance) ---------- */
const pickENH=eps=>eps.find(e=>(e[1].parameters||[]).length>=4) || eps[0];
$("cleanBtn").onclick=async()=>{
  if(busy||!pending) return; busy=true; count(); $("cleanBtn").disabled=true;
  const t0=Date.now(); let tick=null;
  try{
    setAdd("מנקה רעשים…");
    stage="חיבור לשרת הניקוי"; setGen("מתחבר לשרת ניקוי הרעשים…");
    const sp=await connectSpace(ENH_BASE, pickENH, "שרת הניקוי");
    stage="העלאת הדגימה"; const f=await upload(pending.wav, sp.api, "sample.wav");
    stage="ניקוי רעשים"; tick=ticker(t0,"מנקה רעשים");
    const data=sp.params.map((p,i)=>{ if(i===0) return f; if(typeof p.parameter_default==="boolean") return true; return p.parameter_default??null; });
    const out=await callAny(data, sp.api, sp.fn, sp.cfg);
    const arr=Array.isArray(out)?out:[out];
    const url=fileUrl(arr[0],sp.api) || audioUrl(arr,sp.api);
    if(!url) throw new Error("לא התקבל קובץ נקי");
    const cleanBlob=await fetchBlob(url);
    const prev={blob:addBlob};
    await takeSample(cleanBlob, true); addOrig=addOrig||prev; showAddPreview(); addTrim.set(addBuf,$("addPreview")); await updatePending();
    setAdd("הרעשים נוקו. האזן לתוצאה. אפשר לחזור למקור אם המקור נשמע טוב יותר.","ok"); $("undoClean").hidden=false;
    setGen("ניקוי הרעשים הסתיים.","ok");
  }catch(e){ delete spaces[ENH_BASE]; showErr(e); setAdd("הניקוי נכשל. אפשר לשמור את הדגימה גם בלי ניקוי.","err"); }
  finally{ clearInterval(tick); busy=false; count(); $("cleanBtn").disabled=false; updateSave(); }
};
$("undoClean").onclick=async()=>{ if(!addOrig) return; const o=addOrig; addOrig=null; await takeSample(o.blob); setAdd("חזרת לדגימה המקורית.","ok"); };

/* ---------- video dubbing ---------- */
let dubFile=null, dubSrc=null;
function setDub(msg,cls=""){ const s=$("dubStatus"); s.textContent=msg; s.className="status "+cls; }
let dubBuf=null;
const dubTrim=makeTrimmer($("dubTrim"),{max:60,min:1,label:"חיתוך הסרטון",onChange:(st,en)=>{ dubSrc={secs:en-st}; }});
$("dubFile").onchange=async e=>{
  const f=e.target.files[0]; e.target.value=""; if(!f) return;
  dubFile=f; dubSrc=null; dubBuf=null; count();
  const pv=$("dubPreview"); if(pv.src) URL.revokeObjectURL(pv.src); pv.src=URL.createObjectURL(f); pv.hidden=false;
  $("dubClear").hidden=false; $("dubLabel").textContent="העלאת סרטון אחר";
  try{
    setDub("מחלץ את הדיבור מהסרטון…");
    dubBuf=await decode(f);
    dubTrim.set(dubBuf,pv); dubSrc={secs:dubTrim.get().end-dubTrim.get().start};
    setDub(dubBuf.duration>60 ? `הסרטון באורך ${dubBuf.duration.toFixed(0)} שניות. בחר בחיתוך קטע של עד 60 שניות.` : `סרטון של ${dubBuf.duration.toFixed(1)} שניות מוכן. אפשר לחתוך אותו, ואז ללחוץ "דיבוב הסרטון".`,"ok");
  }catch{ dubSrc=null; dubTrim.clear(); setDub("לא הצלחתי לחלץ קול מהסרטון. נסה סרטון MP4 רגיל מהטלפון.","err"); }
  count();
};
$("dubClear").onclick=()=>{
  dubFile=null; dubSrc=null; dubBuf=null; dubTrim.clear(); const pv=$("dubPreview"); pv.pause(); if(pv.src) URL.revokeObjectURL(pv.src); pv.removeAttribute("src"); pv.hidden=true;
  $("dubClear").hidden=true; $("dubLabel").textContent="העלאת סרטון"; setDub("הסרטון נמחק. העלה סרטון חדש."); count();
};
async function muxVideo(file, audioBlob, startAt, maxSecs){
  const v=document.createElement("video");
  v.src=URL.createObjectURL(file); v.muted=true; v.playsInline=true; v.preload="auto";
  v.style.cssText="position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;bottom:0;left:0";
  document.body.append(v);
  try{
    await new Promise((res,rej)=>{ v.onloadedmetadata=res; v.onerror=()=>rej(new Error("לא הצלחתי לפתוח את הסרטון")); });
    const cap=v.captureStream?.bind(v)||v.mozCaptureStream?.bind(v);
    if(!cap||!window.MediaRecorder) throw new Error("הדפדפן לא תומך בבניית סרטון");
    const AC=window.AudioContext||window.webkitAudioContext; const ctx=new AC();
    const buf=await ctx.decodeAudioData(await audioBlob.arrayBuffer());
    const dest=ctx.createMediaStreamDestination();
    const mime=["video/mp4;codecs=avc1,mp4a","video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(m=>MediaRecorder.isTypeSupported(m))||"";
    v.currentTime=startAt; await new Promise(r=>{ v.onseeked=r; setTimeout(r,1500); }); await v.play();
    const vs=cap();
    const stream=new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec=new MediaRecorder(stream, mime?{mimeType:mime}:{}); const parts=[];
    rec.ondataavailable=e=>e.data.size&&parts.push(e.data);
    const done=new Promise(r=>rec.onstop=r);
    const src=ctx.createBufferSource(); src.buffer=buf; src.connect(dest);
    rec.start(250); src.start();
    const dur=Math.min(maxSecs, buf.duration+0.3); const endAt=startAt+dur;
    const t0=Date.now();
    await new Promise(res=>{ const iv=setInterval(()=>{ setGen(`בונה את הסרטון עם הקול החדש… ${Math.max(0,Math.min(dur,v.currentTime-startAt)).toFixed(0)} מתוך ${dur.toFixed(0)} שנ'. השאר את המסך פתוח.`); if(v.ended||v.currentTime>=endAt||(Date.now()-t0)/1000>dur+5){ clearInterval(iv); res(); } },300); });
    rec.stop(); v.pause(); try{src.stop();}catch{} await done; ctx.close?.();
    return new Blob(parts,{type:(mime||"video/webm").split(";")[0]});
  } finally { URL.revokeObjectURL(v.src); v.remove(); }
}
async function runDub(){
  if(busy||!dubSrc) return; busy=true; count();
  const v=voiceById(selected); const t0=Date.now(); let tick=null;
  try{
    tick=setTimeout(()=>{ tick=ticker(t0,"ממיר את הדיבור"); },4000);
    const {start:ds,end:de}=dubTrim.get(); const sl=await sliceWav(dubBuf,ds,de);
    const audio=await convertVoice(sl.wav, v);
    clearTimeout(tick); clearInterval(tick);
    stage="בניית הסרטון";
    let blob, kind="video";
    try{ blob=await muxVideo(dubFile, audio, ds, de-ds); }
    catch(e){ blob=audio; kind="audio"; setGen(`לא הצלחתי לבנות סרטון בדפדפן הזה (${errText(e)}). שמרתי את הקול המדובב כקובץ שמע.`,"err"); }
    const take={ id:"t"+Date.now(), text:`דיבוב סרטון של ${(de-ds).toFixed(0)} שנ'`, voice:v.name, blob, created:Date.now(), kind };
    await put("takes",take); renderTakes(take.id);
    if(kind==="video") setGen(`הסרטון המדובב מוכן אחרי ${Math.round((Date.now()-t0)/1000)} שניות.`,"ok");
  }catch(e){ delete spaces[VC_BASE]; showErr(e); }
  finally{ clearTimeout(tick); clearInterval(tick); busy=false; count(); }
}

/* ---------- modes ---------- */
const MODE_TITLE={tts:"טקסט לקול", vc:"הקלטה לקול אחר", dub:"דיבוב סרטון", dlg:"דיאלוג", settings:"הגדרות"};
function setMode(m){
  document.querySelectorAll(".mode").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.mode===m)));
  $("pageTitle").textContent=MODE_TITLE[m];
  const settings = m==="settings";
  $("workView").hidden=settings; $("settingsView").hidden=!settings; $("actionBar").hidden=settings;
  document.body.classList.toggle("settings",settings);
  scrollTo({top:0});
  if(settings) return;
  mode=m;
  $("ttsPanel").hidden = m!=="tts"; $("vcPanel").hidden = m!=="vc"; $("dubPanel").hidden = m!=="dub"; $("dlgPanel").hidden = m!=="dlg";
  $("optsPanel").hidden = !(m==="tts"||m==="dlg");
  $("genBtn").textContent = MODE_LABEL[m];
  try{ localStorage.setItem("koli.mode",m); }catch{}
  if(m==="dlg") renderCast();
  renderSegs(); count();
}
addEventListener("scroll",()=>document.querySelector(".topbar").classList.toggle("scrolled",scrollY>4),{passive:true});
document.querySelectorAll(".mode").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$("genBtn").onclick=()=> ({tts:runTTS, vc:runVC, dub:runDub, dlg:runDialog})[mode]();

/* ---------- takes ---------- */
async function ensureBlob(t){ if(!t.blob && t.url){ try{ t.blob=await (await fetch(t.url)).blob(); }catch{} } return t.blob; }
async function shareTake(t){
  await ensureBlob(t);
  const ext = t.kind==="video" ? (t.blob?.type.includes("mp4")?"mp4":"webm") : "wav";
  const name=`koli-${t.id}.${ext}`;
  try{
    if(t.blob){
      const f=new File([t.blob], name, {type:t.blob.type||"audio/wav"});
      if(navigator.canShare?.({files:[f]})){ await navigator.share({files:[f], title:"קולי"}); return; }
    }
    setGen("השיתוף הישיר לא נתמך בדפדפן הזה. הורד את הקובץ ושלח אותו מהגלריה או מהקבצים.","err");
  }catch(e){ if(e?.name!=="AbortError") setGen("השיתוף נכשל: "+errText(e),"err"); }
}
async function renderTakes(highlight, autoplay=true){
  const list=(await all("takes")).sort((a,b)=>b.created-a.created).slice(0,30);
  const box=$("takes"); box.textContent="";
  if(!list.length){ const p=document.createElement("p"); p.className="empty"; p.textContent='עוד אין הקלטות. בחר קול ולחץ על הכפתור למטה.'; box.append(p); return; }
  list.forEach(t=>{
    const d=document.createElement("div"); d.className="take";
    const p=document.createElement("p"); p.textContent=`${t.voice}: ${t.text}`;
    const isVid=t.kind==="video";
    const a=document.createElement(isVid?"video":"audio"); a.controls=true; a.preload="metadata"; if(isVid) a.playsInline=true;
    const src = t.blob ? URL.createObjectURL(t.blob) : t.url; a.src=src;
    const row=document.createElement("div"); row.className="row";
    const sh=document.createElement("button"); sh.type="button"; sh.className="btn primary mini"; sh.textContent="שיתוף"; sh.onclick=()=>shareTake(t);
    const dl=document.createElement("a"); dl.href=src;
    if(!t.blob) dl.onclick=async ev=>{ ev.preventDefault(); const b=await ensureBlob(t); if(!b) return; const u=URL.createObjectURL(b); const x=document.createElement("a"); x.href=u; x.download=dl.download; document.body.append(x); x.click(); x.remove(); setTimeout(()=>URL.revokeObjectURL(u),20000); }; dl.download=`koli-${t.id}.${isVid?(t.blob?.type.includes("mp4")?"mp4":"webm"):"wav"}`; dl.textContent="הורדה";
    const rm=document.createElement("button"); rm.type="button"; rm.className="btn mini"; rm.textContent="מחיקה";
    rm.onclick=async()=>{ await del("takes",t.id); renderTakes(); };
    row.append(sh,dl,rm); d.append(p,a,row); box.append(d);
    if(t.id===highlight){ d.classList.add("fresh"); if(autoplay) a.play().catch(()=>{}); }
  });
}

/* ---------- recommended values ---------- */
const REC_GROUPS={ tts:["exag","pace","temp"], vc:["vcPitch","vcSteps","vcSing"] };
function setTuning(id,val){
  const el=$(id); if(!el) return;
  if(el.type==="checkbox"){ el.checked = val==="on"; el.dispatchEvent(new Event("change")); }
  else { el.value=val; el.dispatchEvent(new Event("input")); }
  markRec();
}
function markRec(){
  document.querySelectorAll(".rec-btn").forEach(b=>{
    const el=$(b.dataset.set); if(!el) return;
    const on = el.type==="checkbox" ? el.checked===(b.dataset.val==="on") : Math.abs(+el.value - +b.dataset.val)<1e-9;
    b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on));
  });
}
document.querySelectorAll(".rec-btn").forEach(b=>b.onclick=()=>setTuning(b.dataset.set,b.dataset.val));
document.querySelectorAll("[data-rec-all]").forEach(btn=>btn.onclick=()=>{
  REC_GROUPS[btn.dataset.recAll].forEach(id=>{ const r=document.querySelector(`.rec-btn[data-set="${id}"]`); if(r) setTuning(id,r.dataset.val); });
  setGen("כל הערכים כוונו למומלץ.","ok");
});
["exag","pace","temp","vcPitch","vcSteps"].forEach(id=>$(id).addEventListener("input",markRec));
$("vcSing").addEventListener("change",markRec);

/* ---------- theme ---------- */
function applyTheme(t){
  const root=document.documentElement;
  if(t==="system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme",t);
  try{ localStorage.setItem("koli.theme2",t); }catch{}
  document.querySelectorAll("[data-theme-set]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.themeSet===t)));
  const light = t==="light" || (t==="system" && matchMedia("(prefers-color-scheme: light)").matches);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", light ? "#f2f2f7" : "#000000");
}
document.querySelectorAll("[data-theme-set]").forEach(b=>b.onclick=()=>applyTheme(b.dataset.themeSet));
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change",()=>{ let t=null; try{t=localStorage.getItem("koli.theme2");}catch{} if(t==="system") applyTheme("system"); });
{ let t=null; try{ t=localStorage.getItem("koli.theme2"); }catch{} applyTheme(t==="dark"||t==="system"?t:"light"); }

/* ---------- my own server ---------- */
function spaceBase(input){
  const t=(input||"").trim(); if(!t) return "";
  let m=t.match(/([a-z0-9-]+)\.hf\.space/i); if(m) return `https://${m[1].toLowerCase()}.hf.space`;
  m=t.match(/spaces\/([^\/\s?#]+)\/([^\/\s?#]+)/i);
  if(m) return `https://${(m[1]+"-"+m[2]).toLowerCase().replace(/[^a-z0-9-]/g,"-")}.hf.space`;
  return "";
}
function setSrv(msg,cls=""){ const s=$("srvStatus"); s.textContent=msg; s.className="status "+cls; }
function srvUi(){
  const b=myServer(); $("srvState").textContent = b ? "מחובר" : "לא מוגדר";
  if(b && !$("srvIn").value) $("srvIn").value=b.replace("https://","");
}
$("srvSave").onclick=async()=>{
  const base=spaceBase($("srvIn").value);
  if(!base){ setSrv("הכתובת לא נראית כמו כתובת של שרת ב-Hugging Face. היא צריכה להכיל huggingface.co/spaces/","err"); return; }
  setSrv("בודק את השרת… אם הוא ישן, זה יכול לקחת דקה.");
  let cfg=null;
  for(let i=0;i<4&&!cfg;i++){ if(i) await wait(8000); [,cfg]=await getJson([base+"/config", base+"/gradio_api/config"]); }
  if(!cfg){ setSrv("השרת לא עונה. אם יצרת אותו עכשיו, חכה שיופיע Running באתר של Hugging Face ונסה שוב.","err"); return; }
  const names=(cfg.dependencies||[]).map(d=>d.api_name);
  if(!names.includes(FN)){ setSrv("השרת עונה, אבל זה לא שרת ההקראה הנכון. ודא ששכפלת את Chatterbox-Multilingual-TTS-V3.","err"); return; }
  try{ localStorage.setItem("koli.server",base); }catch{}
  refCache.clear(); srvUi(); $("srvIn").value=base.replace("https://","");
  setSrv("מחובר! מעכשיו ההקראה רצה על השרת שלך, בלי מכסה. ההפקה הראשונה איטית במיוחד, כי השרת טוען את המודל.","ok");
};
$("srvClear").onclick=()=>{ try{ localStorage.removeItem("koli.server"); }catch{} refCache.clear(); $("srvIn").value=""; srvUi(); setSrv("חזרת לשרת המשותף.","ok"); };

/* ---------- install as app ---------- */
let installEvt=null;
addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); installEvt=e; $("installRow").hidden=false; $("installHint").hidden=true; });
$("installBtn").onclick=async()=>{ if(!installEvt) return; installEvt.prompt(); const r=await installEvt.userChoice.catch(()=>null); installEvt=null; $("installRow").hidden=true; if(r?.outcome==="accepted") setGen("קולי הותקנה כאפליקציה.","ok"); };
addEventListener("appinstalled",()=>{ $("installRow").hidden=true; $("installHint").textContent="קולי מותקנת כאפליקציה בטלפון."; $("installHint").hidden=false; });
if(matchMedia("(display-mode: standalone)").matches){ $("installHint").textContent="אתה משתמש בקולי כאפליקציה מותקנת."; }

/* ---------- backup and restore ---------- */
function setBk(msg,cls=""){ const s=$("backupStatus"); s.textContent=msg; s.className="status "+cls; }
const blobToB64=b=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(b); });
const b64ToBlob=async d=>await (await fetch(d)).blob();
$("backupBtn").onclick=async()=>{
  try{
    setBk("מכין גיבוי…");
    const vs=await all("voices"); const withTakes=$("backupTakes").checked;
    const tk=withTakes ? await all("takes") : [];
    const ls={}; try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k.startsWith("koli.") && k!=="koli.hf") ls[k]=localStorage.getItem(k); } }catch{}
    const data={ app:"koli", version:1, created:new Date().toISOString(),
      voices: await Promise.all(vs.filter(v=>v.wav).map(async v=>({...v, path:undefined, wav: await blobToB64(v.wav)}))),
      takes: (await Promise.all(tk.map(async t=>{ const b=await ensureBlob(t); return b ? {...t, url:undefined, path:undefined, blob: await blobToB64(b)} : null; }))).filter(Boolean),
      settings: ls };
    const blob=new Blob([JSON.stringify(data)],{type:"application/json"});
    const d=new Date(); const name=`koli-backup-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}.koli`;
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),20000);
    setBk(`הגיבוי נשמר בתיקיית ההורדות: ${name} (${(blob.size/1048576).toFixed(1)} MB, ${vs.length} קולות${withTakes?`, ${data.takes.length} הקלטות`:""}). הטוקן של Hugging Face לא נכלל בגיבוי.`,"ok");
  }catch(e){ setBk("שמירת הגיבוי נכשלה: "+errText(e),"err"); }
};
$("restoreIn").onchange=async e=>{
  const f=e.target.files[0]; e.target.value=""; if(!f) return;
  try{
    setBk("משחזר…");
    const data=JSON.parse(await f.text());
    if(data.app!=="koli") throw new Error("זה לא קובץ גיבוי של קולי");
    const have=new Set((await all("voices")).map(v=>v.id)); let nv=0, nt=0;
    for(const v of data.voices||[]){ if(have.has(v.id)) continue; await put("voices",{...v, wav: await b64ToBlob(v.wav)}); nv++; }
    const haveT=new Set((await all("takes")).map(t=>t.id));
    for(const t of data.takes||[]){ if(haveT.has(t.id)) continue; await put("takes",{...t, blob: await b64ToBlob(t.blob)}); nt++; }
    for(const [k,v] of Object.entries(data.settings||{})){ try{ if(localStorage.getItem(k)==null) localStorage.setItem(k,v); }catch{} }
    dict=store.get("koli.dict",dict); renderDict(); castMap=store.get("koli.cast",castMap);
    await loadVoices(); await renderTakes(null,false);
    setBk(`השחזור הסתיים: נוספו ${nv} קולות ו-${nt} הקלטות. דברים שכבר היו בטלפון לא שוכפלו.`,"ok");
  }catch(err){ setBk("השחזור נכשל: "+errText(err),"err"); }
};

/* ---------- account ---------- */
function hfUi(){ const t=token(); $("hfState").textContent = t ? "מחובר" : "לא מחובר"; $("hfToken").value = t ? "••••••••"+t.slice(-4) : ""; }
$("hfSave").onclick=()=>{ const v=$("hfToken").value.trim(); if(!/^hf_[A-Za-z0-9]{10,}$/.test(v)){ $("hfState").textContent="הטוקן צריך להתחיל ב-hf_"; return; } try{ localStorage.setItem("koli.hf",v); }catch{} hfUi(); };
$("hfClear").onclick=()=>{ try{ localStorage.removeItem("koli.hf"); }catch{} hfUi(); };

/* ---------- start ---------- */
hfUi(); srvUi(); renderDict(); renderVariants(); markRec(); updateReadAs();
{ const m=store.get("koli.mode",null) ?? (()=>{ try{ return localStorage.getItem("koli.mode"); }catch{ return null; } })(); setMode(["tts","vc","dub","dlg"].includes(m)?m:"tts"); }
await cloud.ready;
if(cloud.active){
  try{ await cloud.loadPrefs(); }catch{}
  dict=store.get("koli.dict",dict); castMap=store.get("koli.cast",castMap); variants=store.get("koli.variants",variants);
  { const t=store.get("koli.dlg",null); if(t) dlgTa.value=t; }
  renderDict(); renderVariants(); count();
}
initAccount();
try{ await loadVoices(); }catch(e){ setGen("טעינת הקולות מהחשבון נכשלה: "+errText(e),"err"); }
renderTakes(null,false).catch(e=>setGen("טעינת ההקלטות מהחשבון נכשלה: "+errText(e),"err"));
if(cloud.active) checkMigration();

/* ---------- move data from this phone into the account ---------- */
async function checkMigration(){
  try{
    const key="koli.migrated."+cloud.user.id;
    if(localStorage.getItem(key)==="done") return;
    const lv=await localAll("voices"), lt=await localAll("takes");
    if(!lv.length && !lt.length){ localStorage.setItem(key,"done"); return; }
    const [cv,ct]=await Promise.all([cloud.ids("voices"),cloud.ids("takes")]);
    const nv=lv.filter(v=>!cv.has(v.id) && v.wav), nt=lt.filter(t=>!ct.has(t.id) && t.blob);
    if(!nv.length && !nt.length){ localStorage.setItem(key,"done"); return; }
    $("migrateText").textContent=`בטלפון הזה שמורים ${nv.length} קולות ו-${nt.length} הקלטות שעוד לא נמצאים בחשבון ${cloud.user.email}. העלאה לחשבון שומרת אותם גם אם תחליף טלפון.`;
    $("migrateCard").hidden=false;
    $("migrateLater").onclick=()=>{ $("migrateCard").hidden=true; };
    $("migrateBtn").onclick=async()=>{
      $("migrateBtn").disabled=true; let done=0, fail=0; const total=nv.length+nt.length;
      const st=m=>{ const e=$("migrateStatus"); e.textContent=m; e.className="status"; };
      for(const v of nv){ try{ await cloud.put("voices",{...v, path:undefined}); cloud.logConsent("voice_consent", v.id); done++; }catch{ fail++; } st(`מעלה… ${done+fail} מתוך ${total}`); }
      for(const t of nt){ try{ await cloud.put("takes",{...t, path:undefined}); done++; }catch{ fail++; } st(`מעלה… ${done+fail} מתוך ${total}`); }
      if(!fail){ localStorage.setItem(key,"done"); $("migrateCard").hidden=true; setGen(`הועלו לחשבון ${done} פריטים. הם נשארים גם בטלפון כגיבוי.`,"ok"); }
      else { const e=$("migrateStatus"); e.textContent=`הועלו ${done}, נכשלו ${fail}. אפשר ללחוץ שוב כדי לנסות את מה שנכשל.`; e.className="status err"; $("migrateBtn").disabled=false; }
      await loadVoices(); renderTakes(null,false);
    };
  }catch{}
}
