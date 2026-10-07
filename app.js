import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {getFirestore,collection,doc,onSnapshot,setDoc,getDoc,updateDoc,deleteDoc,deleteField,writeBatch,arrayUnion,arrayRemove} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ================= CONFIGURAZIONE (da modificare) ================= */
// 1) Incolla qui le chiavi: Console Firebase > Impostazioni progetto > Le tue app > App web > Configurazione SDK
const FIREBASE_CONFIG = {
  apiKey: "INCOLLA_QUI",
  authDomain: "INCOLLA_QUI",
  projectId: "INCOLLA_QUI",
  storageBucket: "INCOLLA_QUI",
  messagingSenderId: "INCOLLA_QUI",
  appId: "INCOLLA_QUI"
};
// 2) Email degli admin (devono coincidere con quelle nelle regole Firestore!)
const ADMIN_EMAILS = ["tuamail@gmail.com"];
const DEFAULT_VARIANT_COLOR = "#ffd54a";
/* ================================================================== */

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app), db = getFirestore(app);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const slug = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const STATES = ["Non posseduto","Posseduto","Incoronato"];

let user = null, isAdmin = false;
let sprites = [], variants = [];      // database globale
let me = {}, friends = {}, friendUnsubs = {};
let filter = "all", pinned = new Set();

function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("on"),3000)}
const login = () => signInWithPopup(auth,new GoogleAuthProvider()).catch(e=>toast("Login fallito: "+e.code));

/* ---------- Dati globali (visibili a tutti) ---------- */
onSnapshot(collection(db,"sprites"), s => { sprites = s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.name.localeCompare(b.name)); render(); }, e=>toast("Errore lettura: "+e.code));
onSnapshot(doc(db,"config","variants"), s => { variants = s.exists() ? s.data().list : []; render(); });

/* ---------- Auth e dati utente ---------- */
onAuthStateChanged(auth, async u => {
  user = u; isAdmin = !!u && ADMIN_EMAILS.map(e=>e.toLowerCase()).includes((u.email||"").toLowerCase());
  Object.values(friendUnsubs).forEach(f=>f()); friendUnsubs = {}; friends = {}; me = {};
  if (u) {
    await setDoc(doc(db,"users",u.uid),{name:u.displayName||"Utente"},{merge:true});
    onSnapshot(doc(db,"users",u.uid), s => { me = s.data()||{}; syncFriends(); render(); });
  }
  render();
});
function syncFriends(){
  const ids = me.friends||[];
  for (const id of Object.keys(friendUnsubs)) if(!ids.includes(id)){friendUnsubs[id]();delete friendUnsubs[id];delete friends[id];}
  for (const id of ids) if(!friendUnsubs[id]) friendUnsubs[id]=onSnapshot(doc(db,"users",id),s=>{friends[id]=s.data()||{name:"?"};render()},()=>{});
}

/* ---------- Rendering ---------- */
const stateOf = (sid,vk) => (me.states||{})[sid+"__"+vk] || 0;
function visible(sp){
  if(!user||filter==="all"||pinned.has(sp.id)) return true;
  const st=(sp.variants||[]).map(v=>stateOf(sp.id,v));
  return filter==="owned" ? st.some(x=>x>0) : st.some(x=>x===0);
}
function render(){
  $("#auth").innerHTML = user
    ? `<span class="muted">${esc(user.displayName)}${isAdmin?" (admin)":""}</span> <button class="ghost" data-act="logout">Esci</button>`
    : `<button data-act="login">Accedi con Google</button>`;
  let tb = "";
  if(user) tb += `<select id="flt"><option value="all">Tutti</option><option value="owned">Solo posseduti</option><option value="missing">Solo mancanti</option></select>
    <button data-act="friends">👥 Amici</button><button data-act="pdf">📄 PDF</button>`;
  if(isAdmin) tb += `<button data-act="newSprite">＋ Spiritello</button><button data-act="variants">🎨 Varianti</button><button data-act="import">⬆ Importa</button><button data-act="export">⬇ Esporta</button>`;
  $("#toolbar").innerHTML = tb; if($("#flt")) $("#flt").value = filter;
  const vmap = Object.fromEntries(variants.map(v=>[v.key,v]));
  const list = sprites.filter(visible).map(sp => {
    const cells = variants.filter(v=>(sp.variants||[]).includes(v.key)).map(v => {
      const n = stateOf(sp.id,v.key);
      const who = Object.values(friends).filter(f=>((f.states||{})[sp.id+"__"+v.key]||0)>0).map(f=>esc(f.name)).join(", ");
      return `<div class="cell s${n}" data-s="${esc(sp.id)}" data-v="${esc(v.key)}" title="${STATES[n]}">
        <div class="tile"><span class="dot"></span><span class="vname" style="color:${esc(v.color)}">${esc(v.name)}</span></div>
        <div class="fr">${who}</div></div>`;
    }).join("");
    return `<article class="sprite"><div class="bar">
      ${sp.avatar?`<img class="av" src="${esc(sp.avatar)}" alt="" loading="lazy">`:`<div class="av"></div>`}
      <h2>${esc(sp.name)}</h2>
      ${isAdmin?`<button class="ghost" data-act="editSprite" data-s="${esc(sp.id)}">✎</button><button class="danger" data-act="delSprite" data-s="${esc(sp.id)}">🗑</button>`:""}
      </div><div class="cells">${cells||'<span class="muted">Nessuna variante</span>'}</div></article>`;
  }).join("");
  $("#list").innerHTML = list || '<p class="muted">Nessuno spiritello da mostrare.</p>';
}

/* ---------- Eventi ---------- */
document.addEventListener("change", e => { if(e.target.id==="flt"){filter=e.target.value;pinned.clear();render();} });
document.addEventListener("click", async e => {
  const cell = e.target.closest(".cell");
  if(cell && !e.target.closest("dialog")){
    if(!user) return toast("Accedi con Google per segnare i tuoi spiritelli");
    const {s,v}=cell.dataset, n=(stateOf(s,v)+1)%3;
    pinned.add(s);
    await setDoc(doc(db,"users",user.uid),{states:{[s+"__"+v]: n===0?deleteField():n}},{merge:true});
    return;
  }
  const b = e.target.closest("[data-act]"); if(!b) return;
  const a = b.dataset.act, sp = sprites.find(x=>x.id===b.dataset.s);
  ({login, logout:()=>signOut(auth), friends:dlgFriends, pdf:dlgPdf, newSprite:()=>dlgSprite(), editSprite:()=>dlgSprite(sp),
    delSprite:async()=>{ if(confirm(`Eliminare ${sp.name}?`)) await deleteDoc(doc(db,"sprites",sp.id)); },
    variants:dlgVariants, import:dlgImport, export:dlgExport}[a]||(()=>{}))();
});
function dlg(html){const d=$("#dlg");d.innerHTML=html+`<div class="row"><button class="ghost" id="dclose">Chiudi</button></div>`;d.showModal();$("#dclose").onclick=()=>d.close();return d}

/* ---------- Admin: spiritello ---------- */
function dlgSprite(sp){
  const d = dlg(`<h3>${sp?"Modifica":"Nuovo"} spiritello</h3>
    <div class="row"><input id="sn" placeholder="Nome" value="${esc(sp?.name)}" ${sp?"disabled":""}></div>
    <div class="row"><input id="su" placeholder="URL avatar (vuoto = nessuno)" value="${esc(sp?.avatar)}"></div>
    <p class="muted">Varianti presenti:</p><div>${variants.map(v=>`<label class="chk"><input type="checkbox" value="${esc(v.key)}" ${(sp?.variants||[]).includes(v.key)?"checked":""}><span style="color:${esc(v.color)}">${esc(v.name)}</span></label>`).join("")||"Crea prima delle varianti (🎨 Varianti)"}</div>
    <div class="row"><button id="ssave">Salva</button></div>`);
  $("#ssave").onclick = async () => {
    const name = $("#sn").value.trim(); if(!name) return toast("Nome mancante");
    const vs = [...d.querySelectorAll("input[type=checkbox]:checked")].map(c=>c.value);
    await setDoc(doc(db,"sprites",sp?.id||slug(name)),{name:sp?.name||name,avatar:$("#su").value.trim(),variants:vs},{merge:true});
    d.close();
  };
}

/* ---------- Admin: gestione varianti globali ---------- */
const saveVariants = l => setDoc(doc(db,"config","variants"),{list:l});
function dlgVariants(){
  const d = dlg(`<h3>Varianti (valgono per tutti gli spiritelli)</h3>
    ${variants.map((v,i)=>`<div class="row" data-i="${i}"><input type="color" value="${esc(v.color)}"><input value="${esc(v.name)}">
      <button data-a="save">Salva</button><button class="danger" data-a="del">🗑</button></div>`).join("")}
    <hr><h3>Nuova variante</h3>
    <div class="row"><input type="color" id="nc" value="${DEFAULT_VARIANT_COLOR}"><input id="nn" placeholder="Nome">
    <label class="chk"><input type="checkbox" id="nall" checked>aggiungi a tutti gli spiritelli</label><button id="nadd">Crea</button></div>`);
  d.onclick = async e => {
    const r = e.target.closest("[data-i]"), a = e.target.dataset.a; if(!r||!a) return;
    const i=+r.dataset.i, l=variants.map(v=>({...v}));
    if(a==="save"){ l[i].color=r.children[0].value; l[i].name=r.children[1].value.trim()||l[i].name; await saveVariants(l); toast("Salvato"); }
    if(a==="del" && confirm(`Eliminare la variante ${l[i].name} da tutti gli spiritelli?`)){
      const key=l[i].key; l.splice(i,1); await saveVariants(l);
      const b=writeBatch(db); sprites.filter(s=>(s.variants||[]).includes(key)).forEach(s=>b.update(doc(db,"sprites",s.id),{variants:s.variants.filter(x=>x!==key)})); await b.commit(); d.close();
    }
  };
  $("#nadd").onclick = async () => {
    const name=$("#nn").value.trim(), key=slug(name); if(!key) return toast("Nome mancante");
    if(variants.some(v=>v.key===key)) return toast("Esiste già");
    await saveVariants([...variants,{key,name,color:$("#nc").value}]);
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
  const d = dlg(`<h3>Importa spiritelli</h3><p class="muted">Una riga per spiritello: <b>Nome; URL (o -); variante1; variante2…</b><br>Formati: txt, csv, xlsx, ods. Gli spiritelli già esistenti vengono aggiornati.</p>
    <div class="row"><input type="file" id="ifile" accept=".txt,.csv,.xlsx,.xls,.ods"><button id="igo">Importa</button></div>`);
  $("#igo").onclick = async () => {
    const f=$("#ifile").files[0]; if(!f) return toast("Scegli un file");
    let rows=(await readRows(f)).filter(r=>r[0]); if(rows.length&&/^(nome|name)$/i.test(rows[0][0])) rows.shift();
    const vl=variants.map(v=>({...v}));
    const ops=rows.map(r=>{
      const keys=r.slice(2).filter(Boolean).map(n=>{const k=slug(n); if(k&&!vl.some(v=>v.key===k)) vl.push({key:k,name:n,color:DEFAULT_VARIANT_COLOR}); return k;}).filter(Boolean);
      const old=sprites.find(s=>s.id===slug(r[0]));
      return {id:slug(r[0]),name:r[0],avatar:(r[1]&&r[1]!=="-")?r[1]:(old?.avatar||""),variants:[...new Set(keys)]};
    }).filter(o=>o.id);
    await saveVariants(vl);
    for(let i=0;i<ops.length;i+=400){const b=writeBatch(db); ops.slice(i,i+400).forEach(o=>b.set(doc(db,"sprites",o.id),{name:o.name,avatar:o.avatar,variants:o.variants})); await b.commit();}
    d.close(); toast(`Importati ${ops.length} spiritelli`);
  };
}
function dlgExport(){
  const d = dlg(`<h3>Esporta database globale</h3><div class="row"><select id="efmt"><option value="csv">CSV</option><option value="txt">TXT</option><option value="xlsx">Excel (xlsx)</option><option value="ods">ODS</option></select><button id="ego">Scarica</button></div>`);
  $("#ego").onclick = () => {
    const vn=Object.fromEntries(variants.map(v=>[v.key,v.name]));
    const rows=sprites.map(s=>[s.name,s.avatar||"-",...variants.filter(v=>(s.variants||[]).includes(v.key)).map(v=>vn[v.key])]);
    const fmt=$("#efmt").value;
    if(fmt==="csv"||fmt==="txt") save(new Blob(["\uFEFF"+rows.map(r=>r.join(fmt==="csv"?";":"\t")).join("\n")],{type:"text/plain"}),"spiritelli."+fmt);
    else { const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),"Spiritelli"); XLSX.writeFile(wb,"spiritelli."+fmt,{bookType:fmt}); }
  };
}
function save(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}

/* ---------- Amici ---------- */
function dlgFriends(){
  const d = dlg(`<h3>Amici</h3><p>Il tuo UID: <code>${esc(user.uid)}</code> <button class="ghost" id="cuid">Copia</button></p>
    <div class="row"><input id="fuid" placeholder="UID dell'amico"><button id="fadd">Aggiungi</button></div>
    ${(me.friends||[]).map(id=>`<div class="row"><span style="flex:1">${esc(friends[id]?.name||id)}</span><button class="danger" data-rm="${esc(id)}">Rimuovi</button></div>`).join("")}`);
  $("#cuid").onclick=()=>navigator.clipboard?.writeText(user.uid).then(()=>toast("UID copiato"));
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
    const g=[[],[],[]]; (sp.variants||[]).forEach(v=>g[stateOf(sp.id,v)].push(vn[v]||v));
    const txt=`${sp.name}  |  Incoronati: ${g[2].join(", ")||"-"}  |  Posseduti: ${g[1].join(", ")||"-"}  |  Mancanti: ${g[0].join(", ")||"-"}`;
    const lines=pdf.splitTextToSize(txt,182);
    if(y+lines.length*5>285){pdf.addPage();y=16;}
    pdf.text(lines,14,y); y+=lines.length*5+2;
  }
  return pdf.output("blob");
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
