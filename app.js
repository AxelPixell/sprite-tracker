import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged,connectAuthEmulator} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,collection,doc,onSnapshot,setDoc,getDoc,updateDoc,deleteDoc,deleteField,writeBatch,arrayUnion,arrayRemove,query,orderBy,limit,addDoc,serverTimestamp,connectFirestoreEmulator} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ================= CONFIGURAZIONE (da modificare) ================= */
// 1) Incolla qui le chiavi: Console Firebase > Impostazioni progetto > Le tue app > App web > Configurazione SDK
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBhqbA-WP7_ZTBuAz71Ao8E0aoLG1LhaeE",
  authDomain: "fortnite-sprite-tracker-c6c12.firebaseapp.com",
  projectId: "fortnite-sprite-tracker-c6c12",
  storageBucket: "fortnite-sprite-tracker-c6c12.firebasestorage.app",
  messagingSenderId: "927459336875",
  appId: "1:927459336875:web:109456d977fc211dd54dee"
};
// 2) Email degli admin (devono coincidere con quelle nelle regole Firestore!)
const ADMIN_EMAILS = ["pxyspam@gmail.com"];
const DEFAULT_VARIANT_COLOR = "#ffd54a";
// 3) Rarità: nome (scritto in minuscolo) -> colore esadecimale dello sfondo dell'avatar dello spiritello.
//    Nel file di import/export il nome non distingue maiuscole e minuscole. Cambia i colori, aggiungi o togli voci qui:
//    l'ordine di questo elenco è quello del menu nella modifica spiritello. Rarità vuota, "-" o non in elenco = nessuno sfondo.
const RARITIES = {
  raro:        "#2d9cff",
  epico:       "#b45cff",
  leggendario: "#ff9a1f",
  mitico:      "#ffd83d"
};
// Sfumatura dello sfondo: parte dal colore pieno in alto e si scurisce verso il basso.
// 0 = nessuna sfumatura (colore uniforme), 1 = nero in basso. Valori consigliati: 0.7 - 0.95.
const RARITY_FADE = 0.9;
/* ================================================================== */
const rarityKey = r => { const k = String(r||"").trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(RARITIES,k) ? k : ""; };
const rarityColor = r => RARITIES[rarityKey(r)] || "";
// Disponibilità. Spiritello: na (non disponibile), rel (data di rilascio AAAA-MM-GG, vuota = a tempo indeterminato),
// vrel (data di rilascio di ogni variante, {chiaveVariante: data}). Variante globale: na, rel.
// Alla data di rilascio (data del dispositivo, dalle 00:00) spiritello e varianti diventano disponibili in automatico; con data vuota restano
// non disponibili finché l'admin non toglie la spunta. Se la data di una variante è successiva a quella dello spiritello vale la più tarda.
const fmtDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d||"") ? d.split("-").reverse().join("/") : "";
const relText = d => d ? "dal "+fmtDate(d) : "data da definire";
function isoDate(y,m,d){ y=+y; m=+m; d=+d; const t=new Date(Date.UTC(y,m-1,d)); return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d ? `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` : ""; }
function parseDate(v){   // accetta AAAA-MM-GG, GG/MM/AAAA e i numeri-data di Excel; altro (anche "-") = nessuna data
  const s = String(v??"").trim(); let m;
  if(!s || s==="-") return "";
  if((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return isoDate(m[1],m[2],m[3]);
  if((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/))) return isoDate(m[3],m[2],m[1]);
  if(/^\d{5}$/.test(s)){ const t = new Date(Math.round((+s-25569)*86400000)); return isoDate(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate()); }
  return "";
}
// null = disponibile; altrimenti {date} = data in cui lo diventerà ("" = indeterminata).
// Ogni blocco (spiritello, variante globale) è attivo se la sua data è vuota o futura; se più blocchi sono attivi vale la data più tarda.
const spLocked = sp => !!sp.na && (!sp.rel || sp.rel > todayStr());
function lockInfo(sp,v){
  const t = todayStr(), L = [];
  if(sp.na){ const vd = sp.vrel && v.key in sp.vrel ? sp.vrel[v.key] : sp.rel; L.push(!sp.rel || !vd ? "" : (sp.rel > vd ? sp.rel : vd)); }
  if(v.na) L.push(v.rel||"");
  const open = L.filter(d => !d || d > t);
  if(!open.length) return null;
  return {date: open.includes("") ? "" : open.reduce((x,y)=>x>y?x:y)};
}
const rarityBg = c => c ? `linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,${RARITY_FADE}) 100%),${c}` : "";

window.__appStarted = true;   // letto dallo script di diagnostica in index.html: se manca, app.js non è partito

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app), db = getFirestore(app);
// L'errore viene memorizzato e mostrato da render(), così non viene più cancellato dai render successivi
let loadError = null;
function showErr(m){ loadError = m; render(); }
setTimeout(() => { if(!loaded) showErr("Nessuna risposta da Firestore. Controlla le chiavi in FIREBASE_CONFIG, le regole e la console del browser (F12)."); }, 8000);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const slug = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const STATES = ["Non posseduto","Posseduto","Incoronato"];
 
let user = null, isAdmin = false;
let sprites = [], variants = [];      // database globale
let me = {}, friends = {}, friendUnsubs = {}, meUnsub = null;
let filter = "all", pinned = new Set();
let loaded = false;   // diventa true alla prima risposta di Firestore
let logs = [], logUnsub = null;   // registro modifiche (solo admin)
 
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("on"),3000)}
// Registro delle ultime modifiche (collezione "log", leggibile/scrivibile solo dagli admin)
const logEv = text => addDoc(collection(db,"log"),{text,ts:serverTimestamp(),by:user?.displayName||""}).catch(()=>{});
function dlgLog(){
  dlg(`<h3>Ultime 5 modifiche</h3>${logs.map(l=>`<div class="row"><span class="muted">${l.ts?l.ts.toDate().toLocaleString("it-IT"):"…"}</span><span>${esc(l.text)}</span>${l.by?`<span class="muted">(${esc(l.by)})</span>`:""}</div>`).join("")||'<p class="muted">Nessuna modifica registrata.</p>'}`);
}
const login = () => signInWithPopup(auth,new GoogleAuthProvider()).catch(e=>toast("Login fallito: "+e.code));
 
/* ---------- Dati globali (visibili a tutti) ---------- */
onSnapshot(collection(db,"sprites"), s => { loaded = true; loadError = null; sprites = s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order??1e9)-(b.order??1e9)||a.name.localeCompare(b.name)); render(); }, e=>showErr("Errore di lettura da Firestore ("+e.code+"). Controlla le regole e le chiavi in FIREBASE_CONFIG."));
onSnapshot(doc(db,"config","variants"), s => { variants = s.exists() ? s.data().list : []; render(); }, e=>showErr("Errore di lettura delle varianti ("+e.code+"). Controlla le regole Firestore."));
 
/* ---------- Auth e dati utente ---------- */
onAuthStateChanged(auth, async u => {
  user = u; isAdmin = !!u && ADMIN_EMAILS.map(e=>e.toLowerCase()).includes((u.email||"").toLowerCase());
  meUnsub?.(); meUnsub = null;   // chiude il listener del profilo dell'utente precedente
  Object.values(friendUnsubs).forEach(f=>f()); friendUnsubs = {}; friends = {}; me = {};
  logUnsub?.(); logUnsub = null; logs = [];
  pinned.clear();
  if (isAdmin) logUnsub = onSnapshot(query(collection(db,"log"),orderBy("ts","desc"),limit(5)), s => { logs = s.docs.map(d=>d.data()); }, ()=>{});
  render();
  if (u) {
    try { await setDoc(doc(db,"users",u.uid),{name:u.displayName||"Utente"},{merge:true}); }
    catch(e){ toast("Errore salvataggio profilo: "+(e.code||e.message)); }
    if (auth.currentUser !== u) return;   // nel frattempo c'è stato un logout o un cambio account
    meUnsub = onSnapshot(doc(db,"users",u.uid), s => { me = s.data()||{}; syncFriends(); render(); },
      e => toast("Errore lettura profilo: "+(e.code||e.message)));
  }
});
function syncFriends(){
  const ids = me.friends||[];
  for (const id of Object.keys(friendUnsubs)) if(!ids.includes(id)){friendUnsubs[id]();delete friendUnsubs[id];delete friends[id];}
  for (const id of ids) if(!friendUnsubs[id]) friendUnsubs[id]=onSnapshot(doc(db,"users",id),s=>{friends[id]=s.data()||{name:"?"};render()},()=>{});
}
 
/* ---------- Rendering ---------- */
const stateOf = (sid,vk) => (me.states||{})[sid+"__"+vk] || 0;
// Il filtro agisce sulle singole varianti; quelle appena toccate restano visibili finché non cambi filtro
// Filtri: Tutti = tutto; Solo disponibili = senza i non disponibili; Solo posseduti = senza i non disponibili; Solo mancanti = include i non disponibili
function showCell(sp,v){
  if(!user||filter==="all"||pinned.has(sp.id+"__"+v.key)) return true;
  const n=stateOf(sp.id,v.key), L=lockInfo(sp,v);
  if(filter==="avail") return !L;
  if(filter==="owned") return n>0 && !L;
  return n===0;
}
function render(){
  $("#auth").innerHTML = user
    ? `<span class="muted">${esc(user.displayName)}${isAdmin?" (admin)":""}</span> <button class="ghost" data-act="logout">Esci</button>`
    : `<button data-act="login">Accedi con Google</button>`;
  // Contatore: ogni variante di ogni spiritello conta come un elemento; posseduta e incoronata contano entrambe come "possedute"
  const cnt = {owned:0, crown:0, total:0};
  if(user){
    const vm0 = Object.fromEntries(variants.map(v=>[v.key,v]));   // le varianti non disponibili non si possono avere: non contano nel totale
    sprites.forEach(sp => (sp.variants||[]).forEach(k => { if(!vm0[k] || lockInfo(sp,vm0[k])) return; cnt.total++; const n = stateOf(sp.id,k); if(n>0) cnt.owned++; if(n===2) cnt.crown++; }));
  }
  let tb = "";
  if(user) tb += `<select id="flt"><option value="all">Tutti</option><option value="avail">Solo disponibili</option><option value="owned">Solo posseduti</option><option value="missing">Solo mancanti</option></select>
    <span class="counter" title="Varianti possedute o incoronate / totale delle varianti disponibili di tutti gli spiritelli (tra parentesi: quante sono incoronate)">Posseduti: <b>${cnt.owned}</b> / ${cnt.total} (👑 ${cnt.crown})</span>
    <button data-act="friends">👥 Amici</button><button data-act="pdf">📄 PDF</button><button data-act="backup">💾 Backup</button>`;
  if(isAdmin) tb += `<button data-act="newSprite">＋ Spiritello</button><button data-act="variants">🎨 Varianti</button><button data-act="import">⬆ Importa</button><button data-act="export">⬇ Esporta</button><button data-act="log">📜 Log</button>`;
  $("#toolbar").innerHTML = tb; if($("#flt")) $("#flt").value = filter;
  const vmap = Object.fromEntries(variants.map(v=>[v.key,v]));
  const list = sprites.map(sp => {
    const allv = variants.filter(v=>(sp.variants||[]).includes(v.key));
    const allLocked = allv.length>0 && allv.every(v=>lockInfo(sp,v));   // riga tutta non disponibile: viene oscurata
    const vs = allv.filter(v=>showCell(sp,v));
    if(user && filter!=="all" && !vs.length) return "";
    const cells = vs.map(v => {
      const n = stateOf(sp.id,v.key);
      const who = Object.values(friends).filter(f=>((f.states||{})[sp.id+"__"+v.key]||0)>0).map(f=>esc(f.name)).join(", ");
      const L = lockInfo(sp,v);
      return `<div class="cell ${L?"s0 lock":"s"+n}" data-s="${esc(sp.id)}" data-v="${esc(v.key)}" title="${L?"Non disponibile ("+esc(relText(L.date))+")":STATES[n]}">
        <div class="tile"><span class="dot"></span><span class="vname" style="color:${esc(v.color)}">${esc(v.name)}</span></div>
        <div class="fr${L?" rel":""}">${L?"🗓 "+esc(relText(L.date)):who}</div></div>`;
    }).join("");
    return `<article class="sprite${allLocked?" dim":""}"><div class="bar">
      ${(rc=>sp.avatar?`<img class="av" src="${esc(sp.avatar)}" alt="" loading="lazy"${rc?` style="background:${esc(rarityBg(rc))}"`:""}>`:`<div class="av"${rc?` style="background:${esc(rarityBg(rc))}"`:""}></div>`)(rarityColor(sp.rarity))}
      <h2>${esc(sp.name)}${spLocked(sp)?` <small>🔒 ${esc(sp.rel?"rilascio "+fmtDate(sp.rel):"rilascio da definire")}</small>`:""}</h2>
      ${isAdmin?`<button class="ghost" data-act="editSprite" data-s="${esc(sp.id)}">✎</button><button class="danger" data-act="delSprite" data-s="${esc(sp.id)}">🗑</button>`:""}
      </div><div class="cells">${cells||'<span class="muted">Nessuna variante</span>'}</div></article>`;
  }).join("");
  $("#list").innerHTML = loadError ? `<p class="muted">⚠ ${esc(loadError)}</p>`
    : !loaded ? '<p class="muted">Caricamento…</p>'
    : (list || '<p class="muted">Nessuno spiritello da mostrare.</p>');
}
 
// A mezzanotte ricalcola la disponibilità (data di rilascio raggiunta) senza dover ricaricare la pagina
(function midnightTick(){ const n=new Date(), next=new Date(n.getFullYear(),n.getMonth(),n.getDate()+1,0,0,2); setTimeout(()=>{ render(); midnightTick(); }, next-n); })();

/* ---------- Eventi ---------- */
document.addEventListener("change", e => { if(e.target.id==="flt"){filter=e.target.value;pinned.clear();render();} });
document.addEventListener("click", async e => {
  const cell = e.target.closest(".cell");
  if(cell && !e.target.closest("dialog")){
    if(!user) return toast("Accedi con Google per segnare i tuoi spiritelli");
    if(cell.classList.contains("lock")) return toast("Non ancora disponibile");
    const {s,v}=cell.dataset, n=(stateOf(s,v)+1)%3;
    pinned.add(s+"__"+v);
    await setDoc(doc(db,"users",user.uid),{states:{[s+"__"+v]: n===0?deleteField():n}},{merge:true});
    return;
  }
  const b = e.target.closest("[data-act]"); if(!b) return;
  const a = b.dataset.act, sp = sprites.find(x=>x.id===b.dataset.s);
  ({login, logout:()=>signOut(auth), friends:dlgFriends, pdf:dlgPdf, backup:dlgBackup, newSprite:()=>dlgSprite(), editSprite:()=>dlgSprite(sp),
    delSprite:async()=>{ if(confirm(`Eliminare ${sp.name}?`)) { await deleteDoc(doc(db,"sprites",sp.id)); logEv(`Eliminato spiritello «${sp.name}»`); } },
    variants:dlgVariants, import:dlgImport, export:dlgExport, log:dlgLog}[a]||(()=>{}))();
});
function dlg(html,closeLabel="Chiudi"){const d=$("#dlg");d.innerHTML=html+`<div class="row"><button class="ghost" id="dclose">${closeLabel}</button></div>`;d.showModal();$("#dclose").onclick=()=>d.close();return d}
 
/* ---------- Admin: spiritello ---------- */
function dlgSprite(sp){
  // "Applica la data a tutte le varianti" parte spuntato se le date delle varianti coincidono con quella dello spiritello
  const allSame = !sp || !sp.na || (sp.variants||[]).every(k => !sp.vrel || !(k in sp.vrel) || sp.vrel[k]===(sp.rel||""));
  const d = dlg(`<h3>${sp?"Modifica":"Nuovo"} spiritello</h3>
    <div class="row"><input id="sn" placeholder="Nome" value="${esc(sp?.name)}"></div>
    <div class="row"><input id="su" placeholder="URL avatar (vuoto = nessuno)" value="${esc(sp?.avatar)}"></div>
    <div class="row"><span class="muted">Rarità (sfondo avatar):</span><select id="srar"><option value="">Nessuna</option>${Object.keys(RARITIES).map(k=>`<option value="${esc(k)}" ${rarityKey(sp?.rarity)===k?"selected":""}>${esc(k[0].toUpperCase()+k.slice(1))}</option>`).join("")}</select><span id="srsw" style="display:inline-block;width:22px;height:22px;border-radius:50%;border:2px solid var(--muted);background:${esc(rarityBg(rarityColor(sp?.rarity))||"transparent")}"></span></div>
    <div class="row"><label class="chk"><input type="checkbox" id="sna" ${sp?.na?"checked":""}>Non disponibile</label>${sp?.na&&sp.rel&&sp.rel<=todayStr()?' <span class="muted">(data di rilascio raggiunta: risulta già disponibile)</span>':""}</div>
    <div id="narea">
      <div class="row"><span class="muted">Data di rilascio (vuota = a tempo indeterminato):</span><input type="date" id="srel" value="${esc(sp?.rel)}"></div>
      <div class="row"><label class="chk"><input type="checkbox" id="sall" ${allSame?"checked":""}>Applica la data a tutte le varianti</label></div>
      <div id="vrels">${variants.map(v=>`<div class="row vrr" data-vk="${esc(v.key)}"><span style="color:${esc(v.color)}">${esc(v.name)}</span><input type="date" value="${esc(sp?.vrel && v.key in sp.vrel ? sp.vrel[v.key] : (sp?.rel||""))}"></div>`).join("")}</div>
    </div>
    <p class="muted">Varianti presenti:</p><div>${variants.map(v=>`<label class="chk"><input type="checkbox" data-vc value="${esc(v.key)}" ${(sp?.variants||[]).includes(v.key)?"checked":""}><span style="color:${esc(v.color)}">${esc(v.name)}</span></label>`).join("")||"Crea prima delle varianti (🎨 Varianti)"}</div>
    <div class="row"><button id="ssave">Salva</button></div>`);
  $("#srar").onchange = () => { $("#srsw").style.background = rarityBg(rarityColor($("#srar").value)) || "transparent"; };
  const syncRel = () => {
    const na=$("#sna").checked, all=$("#sall").checked, rel=$("#srel").value;
    $("#narea").style.display = na ? "" : "none";
    const on = new Set([...d.querySelectorAll("input[data-vc]:checked")].map(c=>c.value));
    d.querySelectorAll(".vrr").forEach(r => { if(all) r.querySelector("input").value = rel; r.style.display = (!all && on.has(r.dataset.vk)) ? "" : "none"; });
  };
  $("#sna").onchange = $("#sall").onchange = syncRel; $("#srel").oninput = $("#srel").onchange = syncRel;
  d.querySelectorAll("input[data-vc]").forEach(c => c.onchange = syncRel);
  syncRel();
  $("#ssave").onclick = async () => {
    const name = $("#sn").value.trim(); if(!name) return toast("Nome mancante");
    const vs = [...d.querySelectorAll("input[data-vc]:checked")].map(c=>c.value);
    const na=$("#sna").checked, rel=na?$("#srel").value:"", vrel={};
    if(na) vs.forEach(k => { vrel[k] = $("#sall").checked ? rel : (d.querySelector(`.vrr[data-vk="${k}"] input`)?.value||""); });
    const av=$("#su").value.trim(), rar=rarityKey($("#srar").value), data={name,avatar:av,rarity:rar,variants:vs,na,rel,vrel};
    if(!sp) data.order=Math.max(-1,...sprites.map(s=>s.order??-1))+1;
    // in modifica updateDoc sostituisce per intero la mappa vrel (con setDoc+merge le date tolte resterebbero)
    if(sp) await updateDoc(doc(db,"sprites",sp.id),data); else await setDoc(doc(db,"sprites",slug(name)),data,{merge:true});
    if(!sp) logEv(`Aggiunto spiritello «${name}»`+(na?` (non disponibile, rilascio ${fmtDate(rel)||"a tempo indeterminato"})`:""));
    else {
      const vn=k=>variants.find(v=>v.key===k)?.name||k, old=sp.variants||[], ch=[];
      if(sp.name!==name) ch.push(`nome cambiato da «${sp.name}» a «${name}»`);
      if((sp.avatar||"")!==av) ch.push("avatar modificato");
      if(rarityKey(sp.rarity)!==rar) ch.push(`rarità cambiata da ${rarityKey(sp.rarity)||"nessuna"} a ${rar||"nessuna"}`);
      const sj=o=>JSON.stringify(Object.entries(o||{}).sort());
      if(!!sp.na!==na) ch.push(na?"reso non disponibile":"reso disponibile");
      if(na && (sp.rel||"")!==rel) ch.push(`rilascio da ${fmtDate(sp.rel)||"indeterminato"} a ${fmtDate(rel)||"indeterminato"}`);
      if(na && sp.na && sj(sp.vrel)!==sj(vrel)) ch.push("date di rilascio delle varianti modificate");
      const add=vs.filter(k=>!old.includes(k)), rem=old.filter(k=>!vs.includes(k));
      if(add.length) ch.push("varianti aggiunte: "+add.map(vn).join(", "));
      if(rem.length) ch.push("varianti eliminate: "+rem.map(vn).join(", "));
      if(ch.length) logEv(`Spiritello «${sp.name}» modificato: `+ch.join("; "));
    }
    d.close();
  };
}
 
/* ---------- Admin: gestione varianti globali ---------- */
const saveVariants = l => setDoc(doc(db,"config","variants"),{list:l});
function dlgVariants(){
  const d = dlg(`<h3>Varianti (valgono per tutti gli spiritelli)</h3>
    <p class="muted">Usa le frecce ▲▼ per spostare una variante: l'ordine vale per tutti gli spiritelli e si salva subito. I dati degli utenti non vengono toccati.</p>
    ${variants.map(v=>`<div class="row vrow" data-k="${esc(v.key)}"><span class="mv"><button class="ghost" data-a="up" title="Sposta su">▲</button><button class="ghost" data-a="down" title="Sposta giù">▼</button></span><input type="color" value="${esc(v.color)}"><input class="vnm" value="${esc(v.name)}"><label class="chk" title="Variante non disponibile in tutti gli spiritelli"><input type="checkbox" class="vna" ${v.na?"checked":""}>non disp.</label><input type="date" class="vrl" ${v.na?"":"disabled"} value="${esc(v.rel)}" title="Data di rilascio (vuota = a tempo indeterminato)">${v.na&&v.rel&&v.rel<=todayStr()?'<span class="muted">(già disponibile)</span>':""}
      <button data-a="save">Salva</button><button class="danger" data-a="del">🗑</button></div>`).join("")}
    <hr><h3>Nuova variante</h3>
    <div class="row"><input type="color" id="nc" value="${DEFAULT_VARIANT_COLOR}"><input id="nn" placeholder="Nome">
    <label class="chk"><input type="checkbox" id="nall" checked>aggiungi a tutti gli spiritelli</label><button id="nadd">Crea</button></div>
    <div class="row"><label class="chk"><input type="checkbox" id="nna">non disponibile</label><span class="muted">rilascio (vuoto = a tempo indeterminato):</span><input type="date" id="nrel" disabled></div>`);
  $("#nna").onchange = () => { $("#nrel").disabled = !$("#nna").checked; };
  // Riordino a tasti. Cambia solo l'ordine della lista globale (config/variants): le chiavi delle varianti restano uguali,
  // quindi gli stati salvati dagli utenti (idSpiritello__chiaveVariante) e le varianti di ogni spiritello non vengono toccati.
  let curKeys = variants.map(v=>v.key);   // ultimo ordine inviato al database
  const refreshArrows = () => {
    const rows = [...d.querySelectorAll(".vrow")];
    rows.forEach((r,i)=>{ r.querySelector('[data-a="up"]').disabled = i===0; r.querySelector('[data-a="down"]').disabled = i===rows.length-1; });
  };
  refreshArrows();
  const moveRow = async (row, dir) => {
    const sib = dir==="up" ? row.previousElementSibling : row.nextElementSibling;
    if(!sib || !sib.classList.contains("vrow")) return;
    row.parentNode.insertBefore(dir==="up" ? row : sib, dir==="up" ? sib : row);
    refreshArrows();
    const l = [...d.querySelectorAll(".vrow")].map(x=>variants.find(v=>v.key===x.dataset.k)).filter(Boolean);
    const keys = l.map(v=>v.key);
    if(l.length!==variants.length || keys.join()===curKeys.join()) return;
    curKeys = keys;
    try { await saveVariants(l); toast("Ordine salvato"); }
    catch(err){ toast("Errore nel salvataggio dell'ordine"); d.close(); dlgVariants(); }
  };
  d.onchange = e => { if(e.target.classList.contains("vna")) e.target.closest(".vrow").querySelector(".vrl").disabled = !e.target.checked; };
  d.onclick = async e => {
    const r = e.target.closest("[data-k]"), a = e.target.dataset.a; if(!r||!a) return;
    if(a==="up"||a==="down") return moveRow(r,a);
    const i = variants.findIndex(v=>v.key===r.dataset.k); if(i<0) return;
    const l=variants.map(v=>({...v}));
    if(a==="save"){
      const o=variants[i]; l[i].color=r.querySelector("input[type=color]").value; l[i].name=r.querySelector(".vnm").value.trim()||l[i].name;
      if(r.querySelector(".vna").checked){ l[i].na=true; l[i].rel=r.querySelector(".vrl").value; } else { delete l[i].na; delete l[i].rel; }
      await saveVariants(l); toast("Salvato");
      const ch=[]; if(o.name!==l[i].name) ch.push(`nome da «${o.name}» a «${l[i].name}»`); if(o.color!==l[i].color) ch.push(`colore da ${o.color} a ${l[i].color}`);
      if(!!o.na!==!!l[i].na) ch.push(l[i].na?"reso non disponibile":"reso disponibile");
      if(l[i].na && (o.rel||"")!==(l[i].rel||"")) ch.push(`rilascio da ${fmtDate(o.rel)||"indeterminato"} a ${fmtDate(l[i].rel)||"indeterminato"}`);
      if(ch.length) logEv(`Variante «${o.name}» modificata: `+ch.join("; "));
    }
    if(a==="del" && confirm(`Eliminare la variante ${l[i].name} da tutti gli spiritelli?`)){
      const key=l[i].key, nm=l[i].name; l.splice(i,1); await saveVariants(l); logEv(`Eliminata variante «${nm}»`);
      const b=writeBatch(db); sprites.filter(s=>(s.variants||[]).includes(key)).forEach(s=>b.update(doc(db,"sprites",s.id),{variants:s.variants.filter(x=>x!==key)})); await b.commit(); d.close();
    }
  };
  $("#nadd").onclick = async () => {
    const name=$("#nn").value.trim(), key=slug(name); if(!key) return toast("Nome mancante");
    if(variants.some(v=>v.key===key)) return toast("Esiste già");
    const nv={key,name,color:$("#nc").value}; if($("#nna").checked){ nv.na=true; nv.rel=$("#nrel").value; }
    await saveVariants([...variants,nv]); logEv(`Aggiunta nuova variante «${name}» (colore ${nv.color})`+(nv.na?` - non disponibile, rilascio ${fmtDate(nv.rel)||"a tempo indeterminato"}`:""));
    if($("#nall").checked){ const b=writeBatch(db); sprites.forEach(s=>b.update(doc(db,"sprites",s.id),{variants:arrayUnion(key)})); await b.commit(); }
    d.close(); toast("Variante creata");
  };
}
 
/* ---------- Admin: import / export ---------- */
function parseText(t){
  const lines=t.replace(/^\uFEFF/,"").split(/\r?\n/).filter(l=>l.trim()); if(!lines.length) return [];
  const sep=[";","\t",","].find(x=>lines[0].includes(x))||";";
  return lines.map(l=>l.split(sep).map(c=>c.trim().replace(/^"|"$/g,"")));
}
async function readRows(f){
  if(/\.(csv|txt)$/i.test(f.name)) return parseText(await f.text());
  const wb=XLSX.read(await f.arrayBuffer()); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""}).map(r=>r.map(c=>String(c).trim()));
}
function dlgImport(){
  const d = dlg(`<h3>Importa spiritelli</h3><p class="muted">Una riga per spiritello: <b>Nome; rarità; disponibilità; data rilascio; URL (o -); variante1; variante2…</b><br>Rarità: ${Object.keys(RARITIES).join(", ")} oppure - (nessuno sfondo). Disponibilità: <i>disponibile</i> o <i>non disponibile</i>; data di rilascio AAAA-MM-GG o GG/MM/AAAA, oppure - (a tempo indeterminato). I formati precedenti (<b>Nome; rarità; URL; varianti…</b> e <b>Nome; URL; varianti…</b>) vengono riconosciuti e lasciano invariate le impostazioni mancanti.<br>Formati: txt, csv, xlsx, ods. Le varianti vengono <b>sostituite</b> da quelle del file e gli spiritelli seguono l'ordine del foglio; quelli già esistenti vengono aggiornati.</p>
    <div class="row"><input type="file" id="ifile" accept=".txt,.csv,.xlsx,.xls,.ods"><button id="igo">Importa</button></div>
    <div class="row"><label class="chk"><input type="checkbox" id="irep">Elimina gli spiritelli non presenti nel file</label></div>`);
  $("#igo").onclick = async () => {
    const f=$("#ifile").files[0]; if(!f) return toast("Scegli un file");
    let rows=(await readRows(f)).filter(r=>r[0]); const header = rows.length&&/^(nome|name)$/i.test(rows[0][0]) ? rows.shift() : null;
    // Colonna rarità presente? Con intestazione: se la 2ª cella non parla di avatar/URL. Senza: se nessuna riga ha un URL nella 2ª colonna.
    // Colonne disponibilità e data presenti? Con intestazione: se la 3ª cella parla di disponibilità. Senza: se qualche riga ha "disponibile" / "non disponibile" nella 3ª colonna.
    const hasAv = header ? /disponib/i.test(header[2]||"") : rows.some(r=>/^(non\s+)?disponibile$/i.test(r[2]||""));
    const hasRar = hasAv || (header ? !/avatar|url|immagine|image|link/i.test(header[1]||"") : !rows.some(r=>/^(https?:)?\/\/|^data:/i.test(r[1]||"")));
    const ci = hasAv ? 4 : hasRar ? 2 : 1;   // indice della colonna avatar; le varianti iniziano subito dopo
    const vl=[];   // solo le varianti del nuovo file, nell'ordine di comparsa (nome/colore già scelti vengono mantenuti)
    const ops=rows.map(r=>{
      const keys=r.slice(ci+1).filter(Boolean).map(n=>{const k=slug(n); if(k&&!vl.some(v=>v.key===k)){const o=variants.find(v=>v.key===k); vl.push(o?{...o}:{key:k,name:n,color:DEFAULT_VARIANT_COLOR});} return k;}).filter(Boolean);
      const old=sprites.find(s=>s.id===slug(r[0]));
      const na = hasAv ? /^non\s+disponibile$/i.test(r[2]||"") : !!old?.na;
      const rel = hasAv ? (na ? parseDate(r[3]) : "") : (old?.rel||"");
      // le date delle singole varianti si tengono solo se la data dello spiritello non è cambiata
      const keepV = na && old && !!old.na===na && (old.rel||"")===rel;
      const vrel = keepV ? Object.fromEntries(Object.entries(old.vrel||{}).filter(([k])=>keys.includes(k))) : {};
      return {id:slug(r[0]),name:r[0],avatar:(r[ci]&&r[ci]!=="-")?r[ci]:(old?.avatar||""),rarity:hasRar?rarityKey(r[1]):rarityKey(old?.rarity),na,rel,vrel,variants:[...new Set(keys)]};
    }).filter(o=>o.id);
    const ids=new Set(ops.map(o=>o.id)), valid=new Set(vl.map(v=>v.key)), replace=$("#irep").checked;
    const writes=ops.map((o,i)=>b=>b.set(doc(db,"sprites",o.id),{name:o.name,avatar:o.avatar,rarity:o.rarity,na:o.na,rel:o.rel,vrel:o.vrel,variants:o.variants,order:i}));  // order = riga del foglio
    sprites.filter(s=>!ids.has(s.id)).forEach((s,i)=>writes.push(b=>replace ? b.delete(doc(db,"sprites",s.id)) : b.update(doc(db,"sprites",s.id),{order:ops.length+i,variants:(s.variants||[]).filter(k=>valid.has(k))})));
    await saveVariants(vl);
    for(let i=0;i<writes.length;i+=400){const b=writeBatch(db); writes.slice(i,i+400).forEach(w=>w(b)); await b.commit();}
    logEv(`Caricata nuova lista di spiritelli: ${ops.length} spiritelli, ${vl.length} varianti (${vl.map(v=>v.name).join(", ")})${replace?" - elenco precedente sostituito":""}`);
    d.close(); toast(`Importati ${ops.length} spiritelli`);
  };
}
function dlgExport(){
  const d = dlg(`<h3>Esporta database globale</h3><div class="row"><select id="efmt"><option value="csv">CSV</option><option value="txt">TXT</option><option value="xlsx">Excel (xlsx)</option><option value="ods">ODS</option></select><button id="ego">Scarica</button></div>`);
  $("#ego").onclick = () => {
    const vn=Object.fromEntries(variants.map(v=>[v.key,v.name]));
    const rows=sprites.map(s=>[s.name,rarityKey(s.rarity)||"-",s.na?"non disponibile":"disponibile",s.na?(s.rel||"-"):"-",s.avatar||"-",...variants.filter(v=>(s.variants||[]).includes(v.key)).map(v=>vn[v.key])]);
    const fmt=$("#efmt").value;
    if(fmt==="csv"||fmt==="txt") save(new Blob(["\uFEFF"+rows.map(r=>r.join(fmt==="csv"?";":"\t")).join("\n")],{type:"text/plain"}),"spiritelli."+fmt);
    else { const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),"Spiritelli"); XLSX.writeFile(wb,"spiritelli."+fmt,{bookType:fmt}); }
  };
}
function save(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}
 
/* ---------- Amici ---------- */
function dlgFriends(){
  const d = dlg(`<h3>Amici</h3><p>Il tuo UID: <code>${esc(user.uid)}</code> <button class="ghost" id="cuid">Copia</button></p>
    <div class="row"><span class="muted">Condividi il tuo UID:</span><button id="uwa">WhatsApp</button><button id="udc">Discord</button></div>
    <div class="row"><input id="fuid" placeholder="UID dell'amico"><button id="fadd">Aggiungi</button></div>
    ${(me.friends||[]).map(id=>`<div class="row"><span style="flex:1">${esc(friends[id]?.name||id)}</span><button class="danger" data-rm="${esc(id)}">Rimuovi</button></div>`).join("")}`);
  $("#cuid").onclick=()=>navigator.clipboard?.writeText(user.uid).then(()=>toast("UID copiato"));
  // Condivisione dell'UID: WhatsApp apre la chat con il testo già pronto; Discord non permette testi precompilati,
  // quindi il messaggio viene copiato negli appunti e va incollato nella chat.
  const uidMsg = "Aggiungimi su Spiritelli Tracker! Il mio UID: "+user.uid+"\n"+location.origin+location.pathname;
  $("#uwa").onclick=()=>window.open("https://wa.me/?text="+encodeURIComponent(uidMsg),"_blank");
  $("#udc").onclick=()=>{
    const p = navigator.clipboard?.writeText(uidMsg);
    window.open("https://discord.com/channels/@me","_blank");
    if(p) p.then(()=>toast("Messaggio copiato: incollalo nella chat Discord"),()=>toast("Copia non riuscita: usa il pulsante Copia"));
    else toast("Copia non disponibile: usa il pulsante Copia");
  };
  $("#fadd").onclick=async()=>{
    const id=$("#fuid").value.trim(); if(!id||id===user.uid) return toast("UID non valido");
    const s=await getDoc(doc(db,"users",id)); if(!s.exists()) return toast("Utente non trovato");
    await updateDoc(doc(db,"users",user.uid),{friends:arrayUnion(id)}); d.close(); toast("Amico aggiunto");
  };
  d.onclick=async e=>{const id=e.target.dataset.rm; if(id){await updateDoc(doc(db,"users",user.uid),{friends:arrayRemove(id)}); d.close();}};
}
 
/* ---------- PDF personale + condivisione ---------- */
function buildPdf(){
  const pdf=new window.jspdf.jsPDF(); let y=16;
  pdf.setFontSize(16); pdf.text("I miei spiritelli - "+(user.displayName||""),14,y); y+=9; pdf.setFontSize(10);
  const vn=Object.fromEntries(variants.map(v=>[v.key,v.name]));
  for(const sp of sprites){
    const g=[[],[],[]]; (sp.variants||[]).forEach(v=>{ const n=stateOf(sp.id,v), vo=variants.find(x=>x.key===v); if(n===0 && vo && lockInfo(sp,vo)) return; g[n].push(vn[v]||v); });
    const txt=`${sp.name}  |  Incoronati: ${g[2].join(", ")||"-"}  |  Posseduti: ${g[1].join(", ")||"-"}  |  Mancanti: ${g[0].join(", ")||"-"}`;
    const lines=pdf.splitTextToSize(txt,182);
    if(y+lines.length*5>285){pdf.addPage();y=16;}
    pdf.text(lines,14,y); y+=lines.length*5+2;
  }
  return pdf.output("blob");
}
/* ---------- Backup della checklist personale (file txt) ---------- */
// Formato del file: una riga per spiritello  ->  Nome | Variante: stato | Variante: stato
// Le righe che iniziano con # sono commenti. Stati: non posseduto, posseduto, incoronato.
const STATE_NAMES = ["non posseduto","posseduto","incoronato"];
const norm = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
function todayStr(){ const t=new Date(), z=n=>String(n).padStart(2,"0"); return `${t.getFullYear()}-${z(t.getMonth()+1)}-${z(t.getDate())}`; }
// Legge capitolo e stagione dal titolo in <header><h1>: "Capitolo 4 Stagione 7" oppure "C4S7"
function chapterSeason(){
  const t = document.querySelector("header h1")?.textContent || "";
  const m = t.match(/capitolo\s*(\d+)\D*?stagione\s*(\d+)/i) || t.match(/\bC\s*(\d+)\s*S\s*(\d+)\b/i);
  return m ? `_cap${m[1]}st${m[2]}` : "";
}
const backupName = () => `backup_checklist_${todayStr()}${chapterSeason()}`;

function buildBackup(){
  const lines = [`# ${backupName()}`, "# Formato: Spiritello | Variante: stato | Variante: stato", "# Stati possibili: non posseduto, posseduto, incoronato"];
  sprites.forEach(sp => {
    const vs = variants.filter(v => (sp.variants||[]).includes(v.key));   // solo varianti presenti nella lista globale, nel suo ordine
    lines.push([sp.name, ...vs.map(v => `${v.name}: ${STATE_NAMES[stateOf(sp.id,v.key)] || STATE_NAMES[0]}`)].join(" | "));
  });
  return lines.join("\n")+"\n";
}

// Confronta il file con la lista globale (per nome di spiritello e di variante, senza maiuscole/accenti)
function analyzeBackup(text){
  const found = new Map(), badSprites = [], badVariants = [];
  let rows = 0;
  text.replace(/^\uFEFF/,"").split(/\r?\n/).forEach(line => {
    line = line.trim(); if(!line || line.startsWith("#")) return;
    const parts = line.split(" | ").map(p=>p.trim()), name = parts.shift();
    if(!name) return;
    rows++;
    const sp = sprites.find(s => norm(s.name)===norm(name));
    if(!sp){ if(!badSprites.includes(name)) badSprites.push(name); return; }
    const upd = found.get(sp.id)?.upd || {};
    parts.forEach(p => {
      const i = p.lastIndexOf(":");
      const vname = i<0 ? p : p.slice(0,i), st = i<0 ? -1 : STATE_NAMES.indexOf(norm(p.slice(i+1)));
      const v = variants.find(x => norm(x.name)===norm(vname) && (sp.variants||[]).includes(x.key));
      if(!v || st<0){ badVariants.push(`${sp.name}: ${p}`); return; }
      upd[sp.id+"__"+v.key] = st;
    });
    found.set(sp.id, {name:sp.name, upd});
  });
  return {rows, found, badSprites, badVariants};
}

function dlgBackup(){
  const d = dlg(`<h3>Backup della mia checklist</h3>
    <p class="muted">Salva su file di testo lo stato di tutte le tue varianti, oppure ripristinalo da un backup.</p>
    <div class="row"><button id="bkexp">⬇ Esporta (txt)</button></div>
    <hr>
    <div class="row"><input type="file" id="bkfile" accept=".txt,text/plain"><button id="bkgo">⬆ Importa</button></div>
    <p class="muted">Prima dell'importazione vedrai un riepilogo e potrai confermare o annullare.</p>`);
  d.onclick = null;
  $("#bkexp").onclick = () => {
    if(!sprites.length) return toast("Nessuno spiritello da esportare");
    save(new Blob([buildBackup()],{type:"text/plain;charset=utf-8"}), backupName()+".txt");
    toast("Backup salvato");
  };
  $("#bkgo").onclick = async () => {
    const f = $("#bkfile").files[0]; if(!f) return toast("Scegli un file");
    let text; try{ text = await f.text(); }catch(e){ return toast("Impossibile leggere il file"); }
    const r = analyzeBackup(text);
    if(!r.rows) return toast("Il file non contiene righe valide");
    d.close(); dlgBackupConfirm(r);
  };
}

function dlgBackupConfirm(r){
  const n = r.found.size, nv = [...r.found.values()].reduce((a,x)=>a+Object.keys(x.upd).length,0);
  const box = a => a.length ? `<div class="scroll">${a.map(esc).join("<br>")}</div>` : "";
  const d = dlg(`<h3>Importa checklist</h3>
    <p>✅ Spiritelli conformi, che verranno importati: <b>${n}</b> (${nv} varianti)</p>
    <p>⚠ Spiritelli non presenti nella lista globale, che verranno scartati: <b>${r.badSprites.length}</b></p>${box(r.badSprites)}
    ${r.badVariants.length ? `<p>⚠ Varianti non riconosciute, che verranno ignorate: <b>${r.badVariants.length}</b></p>${box(r.badVariants)}` : ""}
    <p class="muted">Per gli spiritelli conformi, lo stato delle varianti presenti nel file sostituisce quello attuale. Il resto della tua checklist non viene toccato.</p>
    ${n ? `<div class="row"><button id="bkok">Importa</button></div>` : `<p>Nessuno spiritello da importare.</p>`}`, "Annulla");
  d.onclick = null;
  if(!n) return;
  $("#bkok").onclick = async () => {
    if(!user) return toast("Accedi con Google");
    $("#bkok").disabled = true;
    const upd = {};
    r.found.forEach(x => Object.entries(x.upd).forEach(([k,st]) => { upd[k] = st===0 ? deleteField() : st; }));
    try{ await setDoc(doc(db,"users",user.uid),{states:upd},{merge:true}); d.close(); toast(`Importati ${n} spiritelli (${nv} varianti)`); }
    catch(e){ $("#bkok").disabled = false; toast("Errore durante l'importazione: "+(e.code||e.message)); }
  };
}

function dlgPdf(){
  const d=dlg(`<h3>Esporta la mia lista (PDF)</h3><div class="row"><button data-p="wa">WhatsApp</button><button data-p="dc">Discord</button><button data-p="save">Salva su dispositivo</button></div>
    <p class="muted">Su smartphone si apre il menu di condivisione; su PC il PDF viene scaricato e si apre l'app scelta.</p>`);
  d.onclick=async e=>{
    const t=e.target.dataset.p; if(!t) return;
    const blob=buildPdf(), file=new File([blob],"spiritelli.pdf",{type:"application/pdf"});
    if(t!=="save" && navigator.canShare?.({files:[file]})){ try{await navigator.share({files:[file],title:"I miei spiritelli"});return;}catch(err){if(err.name==="AbortError")return;} }
    save(blob,"spiritelli.pdf");
    if(t==="wa") window.open("https://wa.me/?text="+encodeURIComponent("La mia lista spiritelli Fortnite (allego il PDF)"),"_blank");
    if(t==="dc") window.open("https://discord.com/channels/@me","_blank");
    if(t!=="save") toast("PDF salvato: allegalo nella chat");
  };
}

