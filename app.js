// BTX Agenda — PWA offline-first, autosave forte (IndexedDB) e navegação anti-trava.
// PDFs: gerados via "Imprimir → Salvar como PDF" (funciona offline e sem info do software no documento).

const $ = (sel) => document.querySelector(sel);

// ===== Refs
const sidebar = $("#sidebar");
const btnMenu = $("#btnMenu");

const agendaLista = $("#agendaLista");
const pacientesLista = $("#pacientesLista");

const agData = $("#agData");
const agBusca = $("#agBusca");
const pcBusca = $("#pcBusca");

const cfgNome = $("#cfgNome");
const cfgReg = $("#cfgReg");
const cfgContato = $("#cfgContato");
const cfgEndereco = $("#cfgEndereco");

const calMesAno = $("#calMesAno");
const calGrid = $("#calGrid");

const badgeHoje = $("#badgeHoje");
const badgePacientes = $("#badgePacientes");

// ===== State
const STATE = {
  config: { nome:"", reg:"", contato:"", endereco:"" },
  pacientes: [],  // {id, nome, tel}
  agenda: []       // {id, data, hora, pacienteNome, tel, status}
};

// ===== Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try { await navigator.serviceWorker.register("sw.js"); }
    catch(e){ console.warn("SW falhou:", e); }
  });
}

// ===== Sidebar toggle
btnMenu.addEventListener("click", () => sidebar.classList.toggle("open"));

// ===== Event delegation (anti-trava)
document.addEventListener("click", async (e) => {
  const navbtn = e.target.closest("[data-view]");
  const actionbtn = e.target.closest("[data-action]");

  if (navbtn) {
    setView(navbtn.dataset.view);
    sidebar.classList.remove("open");
  }

  if (actionbtn) {
    await handleAction(actionbtn.dataset.action, e);
  }
});

// ===== IndexedDB (memória forte)
const DB_NAME = "btx_agenda_db";
const DB_STORE = "btx_store";

function idbOpen(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Autosave (debounce)
let saveTimer = null;
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 450);
}
async function saveAll(){
  await idbSet("STATE", structuredClone(STATE));
  toast("Autosave ✓");
  renderBadges();
  renderCalendar(); // atualiza bolinhas dos dias com agenda
}

// ===== Views
function setView(name){
  document.querySelectorAll(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("show"));
  const view = $("#view-" + name);
  if (view) view.classList.add("show");
}

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function isoFromDate(d){
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function renderBadges(){
  badgeHoje.textContent = agData.value ? agData.value : "—";
  badgePacientes.textContent = String(STATE.pacientes.length);
}

// ===== Calendar
let calRef = new Date();
function renderCalendar(){
  if (!calMesAno || !calGrid) return;

  const y = calRef.getFullYear();
  const m = calRef.getMonth();

  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  calMesAno.textContent = `${meses[m]} ${y}`;

  const first = new Date(y, m, 1);
  const startDow = first.getDay(); // 0..6
  const start = new Date(y, m, 1 - startDow);

  const hojeISO = todayISO();

  calGrid.innerHTML = "";
  for (let i=0; i<42; i++){
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = isoFromDate(d);

    const inMonth = d.getMonth() === m;
    const has = (STATE.agenda || []).some(a => a.data === iso);

    const el = document.createElement("div");
    el.className = "calDay" + (inMonth ? "" : " muted") + (iso === hojeISO ? " today" : "") + (has ? " has" : "");
    el.textContent = String(d.getDate());
    el.dataset.iso = iso;

    el.addEventListener("click", () => {
      agData.value = iso;
      renderAgenda();
      renderBadges();
      toast(`Dia: ${iso}`);
    });

    calGrid.appendChild(el);
  }
}

// ===== Render lists
function renderAgenda(){
  const data = agData.value || todayISO();
  const q = (agBusca.value || "").trim().toLowerCase();

  const itens = STATE.agenda
    .filter(x => x.data === data)
    .filter(x => !q || (x.pacienteNome||"").toLowerCase().includes(q) || (x.tel||"").includes(q))
    .sort((a,b) => (a.hora||"").localeCompare(b.hora||""));

  if (!itens.length){
    agendaLista.innerHTML = `<div class="empty">Sem agendamentos para essa data.</div>`;
    return;
  }

  agendaLista.innerHTML = itens.map(x => `
    <div class="item">
      <div>
        <strong>${escapeHtml(x.hora || "--:--")} • ${escapeHtml(x.pacienteNome || "Sem nome")}</strong>
        <small>${escapeHtml(x.tel || "")}${x.status ? " • " + escapeHtml(x.status) : ""}</small>
      </div>
      <div class="itemBtns">
        <span class="pill">${escapeHtml(x.status || "confirmado")}</span>
        ${x.tel ? `<a class="btn tiny" href="https://wa.me/${toWa(x.tel)}" target="_blank" rel="noopener">Whats</a>` : ""}
        <button class="btn tiny ghost" data-action="status-ag" data-id="${x.id}">Status</button>
        <button class="btn tiny" data-action="del-ag" data-id="${x.id}">Excluir</button>
      </div>
    </div>
  `).join("");
}

function renderPacientes(){
  const q = (pcBusca.value || "").trim().toLowerCase();

  const itens = STATE.pacientes
    .filter(p => !q || (p.nome||"").toLowerCase().includes(q) || (p.tel||"").includes(q))
    .sort((a,b)=> (a.nome||"").localeCompare(b.nome||""));

  if (!itens.length){
    pacientesLista.innerHTML = `<div class="empty">Cadastre o primeiro paciente.</div>`;
    return;
  }

  pacientesLista.innerHTML = itens.map(p => `
    <div class="item">
      <div>
        <strong>${escapeHtml(p.nome || "Sem nome")}</strong>
        <small>${escapeHtml(p.tel || "")}</small>
      </div>
      <div class="itemBtns">
        <button class="btn tiny" data-action="add-ag-from-paciente" data-id="${p.id}">Agendar</button>
        <button class="btn tiny ghost" data-action="edit-paciente" data-id="${p.id}">Editar</button>
        <button class="btn tiny" data-action="del-paciente" data-id="${p.id}">Excluir</button>
      </div>
    </div>
  `).join("");
}

function renderConfig(){
  cfgNome.value = STATE.config.nome || "";
  cfgReg.value = STATE.config.reg || "";
  cfgContato.value = STATE.config.contato || "";
  cfgEndereco.value = STATE.config.endereco || "";
}

// Inputs -> rerender + autosave
[agBusca, pcBusca].forEach(el => el.addEventListener("input", () => {
  renderAgenda(); renderPacientes();
}));

agData.addEventListener("change", () => {
  renderAgenda();
  renderBadges();
});

[cfgNome, cfgReg, cfgContato, cfgEndereco].forEach(el => {
  el.addEventListener("input", () => {
    STATE.config.nome = cfgNome.value.trim();
    STATE.config.reg = cfgReg.value.trim();
    STATE.config.contato = cfgContato.value.trim();
    STATE.config.endereco = cfgEndereco.value.trim();
    scheduleSave();
  });
});

// ===== Actions
async function handleAction(action, evt){
  // ações que dependem de id
  if (action === "del-ag") {
    const id = evt.target.closest("[data-id]")?.dataset.id;
    STATE.agenda = STATE.agenda.filter(x => x.id !== id);
    renderAgenda(); scheduleSave();
    return;
  }
  if (action === "status-ag") {
    const id = evt.target.closest("[data-id]")?.dataset.id;
    const it = STATE.agenda.find(x => x.id === id);
    if (!it) return;
    const novo = prompt("Status (confirmado / faltou / remarcou):", it.status || "confirmado");
    if (!novo) return;
    it.status = novo.trim();
    renderAgenda(); scheduleSave();
    return;
  }
  if (action === "del-paciente") {
    const id = evt.target.closest("[data-id]")?.dataset.id;
    STATE.pacientes = STATE.pacientes.filter(p => p.id !== id);
    renderPacientes(); scheduleSave();
    return;
  }
  if (action === "edit-paciente") {
    const id = evt.target.closest("[data-id]")?.dataset.id;
    const p = STATE.pacientes.find(x => x.id === id);
    if (!p) return;
    const nome = prompt("Nome:", p.nome || "") ?? "";
    if (!nome.trim()) return;
    const tel = prompt("Telefone/WhatsApp:", p.tel || "") ?? "";
    p.nome = nome.trim();
    p.tel = tel.trim();
    renderPacientes(); scheduleSave();
    return;
  }
  if (action === "add-ag-from-paciente") {
    const id = evt.target.closest("[data-id]")?.dataset.id;
    const p = STATE.pacientes.find(x => x.id === id);
    if (!p) return;
    await quickAgendar(p.nome, p.tel);
    return;
  }

  switch(action){
    case "save":
      await saveAll();
      toast("Salvo ✓");
      break;

    case "hoje":
    case "mes-hoje":
      calRef = new Date();
      agData.value = todayISO();
      renderAgenda();
      renderBadges();
      renderCalendar();
      toast("Hoje ✓");
      break;

    case "mes-prev":
      calRef.setMonth(calRef.getMonth() - 1);
      renderCalendar();
      break;

    case "mes-next":
      calRef.setMonth(calRef.getMonth() + 1);
      renderCalendar();
      break;

    case "novo-paciente":
      await criarPaciente();
      break;

    case "novo-ag":
      await criarAgendamento();
      break;

    case "pdf":
      // PDF geral simples: imprime a agenda do dia selecionado
      printAgendaDia(agData.value || todayISO());
      break;

    case "pdf-agenda":
      printAgendaDia(agData.value || todayISO());
      break;

    case "doc-receita":
      printReceituario();
      break;

    case "doc-atestado":
      printAtestado();
      break;

    case "doc-laudo":
      printLaudo();
      break;

    case "doc-orcamento":
      printOrcamento();
      break;

    case "doc-recibo":
      printRecibo();
      break;

    case "salvar-config":
      scheduleSave();
      toast("Config salva ✓");
      break;

    case "backup":
      exportBackup();
      break;

    case "restore":
      await importBackup();
      break;

    default:
      toast("Ação: " + action);
  }
}

// ===== CRUD
async function criarPaciente(){
  const nome = prompt("Nome do paciente:");
  if (!nome || !nome.trim()) return;
  const tel = prompt("Telefone/WhatsApp (opcional):") || "";
  STATE.pacientes.push({ id: crypto.randomUUID(), nome: nome.trim(), tel: tel.trim() });
  renderPacientes(); scheduleSave();
}

async function criarAgendamento(){
  const data = agData.value || todayISO();
  const hora = prompt("Hora (ex: 14:30):") || "";
  const pacienteNome = prompt("Paciente:") || "";
  if (!pacienteNome.trim()) return;
  const tel = prompt("Telefone/WhatsApp (opcional):") || "";
  const status = "confirmado";

  STATE.agenda.push({
    id: crypto.randomUUID(),
    data,
    hora: hora.trim(),
    pacienteNome: pacienteNome.trim(),
    tel: tel.trim(),
    status
  });

  renderAgenda(); scheduleSave();
}

async function quickAgendar(nome, tel){
  const data = agData.value || todayISO();
  const hora = prompt(`Hora para ${nome} (ex: 14:30):`) || "";
  STATE.agenda.push({
    id: crypto.randomUUID(),
    data,
    hora: hora.trim(),
    pacienteNome: nome,
    tel: (tel || "").trim(),
    status: "confirmado"
  });
  renderAgenda(); scheduleSave();
}

function toWa(tel){
  // mantém só dígitos e prefixa Brasil se faltar
  const digits = String(tel||"").replace(/\D/g,"");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : ("55" + digits);
}

// ===== Backup
function exportBackup(){
  const blob = new Blob([JSON.stringify(STATE)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `btx-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Backup exportado ✓");
}

async function importBackup(){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const txt = await file.text();
    try{
      const data = JSON.parse(txt);
      if (!data || typeof data !== "object") throw new Error("inválido");
      STATE.config = data.config || STATE.config;
      STATE.pacientes = Array.isArray(data.pacientes) ? data.pacientes : [];
      STATE.agenda = Array.isArray(data.agenda) ? data.agenda : [];
      renderAll();
      scheduleSave();
      toast("Backup importado ✓");
    }catch(e){
      alert("Arquivo inválido.");
    }
  };
  input.click();
}

// ===== PRINT / PDF (offline)
function openPrintWindow(title, contentHtml){
  const prof = STATE.config || {};
  const css = `
    @page { size: A4; margin: 14mm; }
    body{ font-family: Arial, Helvetica, sans-serif; color:#111; }
    .frame{ border:1px solid #000; padding:10mm; min-height: 260mm; }
    .hdr{ margin-bottom:8mm; }
    .hdr .n{ font-size:14pt; font-weight:700; }
    .hdr .s{ margin-top:2mm; font-size:10pt; }
    .t{ font-size:14pt; font-weight:700; margin: 6mm 0 2mm; border-bottom:1px solid #000; padding-bottom:2mm; }
    .p{ font-size:12pt; line-height:1.35; white-space: pre-wrap; }
    .sig{ margin-top:18mm; text-align:center; font-size:11pt; }
    .line{ width:60%; margin:0 auto 2mm; border-top:1px solid #000; }
    .muted{ color:#333; font-size:10pt; }
    .row{ margin-top:4mm; }
    table{ width:100%; border-collapse:collapse; font-size:11pt; }
    th,td{ border:1px solid #000; padding:6px; text-align:left; }
    th{ background:#f1f1f1; }
    .noPrint{ margin: 10px 0; font-family: system-ui; }
    @media print { .noPrint{ display:none; } }
  `;

  const win = window.open("", "_blank");
  win.document.open();
  win.document.write(`
    <!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>${css}</style></head>
    <body>
      <div class="noPrint">
        <strong>Dica:</strong> clique em <em>Imprimir</em> e escolha <em>Salvar como PDF</em>.
        <button onclick="window.print()">Imprimir</button>
      </div>
      <div class="frame">
        <div class="hdr">
          <div class="n">${escapeHtml(prof.nome || "Profissional")}</div>
          <div class="s">${escapeHtml([prof.reg, prof.contato].filter(Boolean).join(" • "))}</div>
          <div class="s">${escapeHtml(prof.endereco || "")}</div>
        </div>
        ${contentHtml}
        <div class="sig">
          <div class="line"></div>
          <div>${escapeHtml(prof.nome || "Assinatura")}</div>
          <div class="muted">${escapeHtml(prof.reg || "")}</div>
        </div>
      </div>
      <script>
        setTimeout(()=>{ try{ window.print(); }catch(e){} }, 400);
      </script>
    </body></html>
  `);
  win.document.close();
  win.focus();
}

function dataExtensoISO(iso){
  if (!iso) return "";
  const [y,m,d] = iso.split("-").map(Number);
  const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${d} de ${meses[(m||1)-1]} de ${y}`;
}

function printAgendaDia(dataISO){
  const itens = (STATE.agenda||[])
    .filter(x => x.data === dataISO)
    .sort((a,b)=>(a.hora||"").localeCompare(b.hora||""));

  let rows = "";
  for (const it of itens){
    rows += `<tr>
      <td>${escapeHtml(it.hora||"")}</td>
      <td>${escapeHtml(it.pacienteNome||"")}</td>
      <td>${escapeHtml(it.tel||"")}</td>
      <td>${escapeHtml(it.status||"")}</td>
    </tr>`;
  }
  if (!rows) rows = `<tr><td colspan="4">Sem agendamentos.</td></tr>`;

  const html = `
    <div class="t">Agenda do dia</div>
    <div class="p row"><strong>Data:</strong> ${escapeHtml(dataExtensoISO(dataISO))}</div>
    <div class="row">
      <table>
        <thead><tr><th>Hora</th><th>Paciente</th><th>Contato</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  openPrintWindow(`Agenda ${dataISO}`, html);
}

function printReceituario(){
  const paciente = prompt("Paciente:", "") || "";
  const texto = prompt("Texto do receituário (medicamentos):", "1) 
2) 
3) ") || "";
  const hoje = todayISO();
  const html = `
    <div class="t">Receituário</div>
    <div class="p row"><strong>Paciente:</strong> ${escapeHtml(paciente)}</div>
    <div class="p row"><strong>Data:</strong> ${escapeHtml(dataExtensoISO(hoje))}</div>
    <div class="p row">${escapeHtml(texto)}</div>
  `;
  openPrintWindow("Receituário", html);
}

function printAtestado(){
  const paciente = prompt("Paciente:", "") || "";
  const dias = prompt("Dias de repouso:", "1") || "1";
  const motivo = prompt("Motivo (opcional):", "") || "";
  const hoje = todayISO();

  const texto = `Atesto para os devidos fins que ${paciente || "o(a) paciente"} necessita de ${dias} dia(s) de repouso.` +
    (motivo ? ` Motivo: ${motivo}.` : "");

  const html = `
    <div class="t">Atestado</div>
    <div class="p row">${escapeHtml(texto)}</div>
    <div class="p row"><strong>Data:</strong> ${escapeHtml(dataExtensoISO(hoje))}</div>
  `;
  openPrintWindow("Atestado", html);
}

function printLaudo(){
  const paciente = prompt("Paciente:", "") || "";
  const texto = prompt("Texto do laudo:", "") || "";
  const hoje = todayISO();

  const html = `
    <div class="t">Laudo</div>
    <div class="p row"><strong>Paciente:</strong> ${escapeHtml(paciente)}</div>
    <div class="p row"><strong>Data:</strong> ${escapeHtml(dataExtensoISO(hoje))}</div>
    <div class="p row">${escapeHtml(texto)}</div>
  `;
  openPrintWindow("Laudo", html);
}

function printOrcamento(){
  const paciente = prompt("Paciente:", "") || "";
  const texto = prompt("Texto do orçamento (serviços/valores):", "") || "";
  const hoje = todayISO();

  const html = `
    <div class="t">Orçamento</div>
    <div class="p row"><strong>Paciente:</strong> ${escapeHtml(paciente)}</div>
    <div class="p row"><strong>Data:</strong> ${escapeHtml(dataExtensoISO(hoje))}</div>
    <div class="p row">${escapeHtml(texto)}</div>
  `;
  openPrintWindow("Orçamento", html);
}

function printRecibo(){
  const paciente = prompt("Nome do paciente/cliente:", "") || "";
  const valor = prompt("Valor (ex: R$ 150,00):", "R$ 0,00") || "R$ 0,00";
  const referente = prompt("Referente a (serviço):", "") || "";
  const forma = prompt("Forma de pagamento (opcional):", "Pix") || "";
  const hoje = todayISO();

  const texto =
    `Recebi de ${paciente || "____"} a quantia de ${valor}, referente a: ${referente || "____"}.` +
    (forma ? ` Forma de pagamento: ${forma}.` : "");

  const html = `
    <div class="t">Recibo</div>
    <div class="p row">${escapeHtml(texto)}</div>
    <div class="p row"><strong>Data:</strong> ${escapeHtml(dataExtensoISO(hoje))}</div>
  `;
  openPrintWindow("Recibo", html);
}

// ===== Toast
function toast(msg){
  let el = document.getElementById("toast");
  if (!el){
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.style.display = "none", 1200);
}

// ===== Boot
function renderAll(){
  if (!agData.value) agData.value = todayISO();
  renderAgenda();
  renderPacientes();
  renderConfig();
  renderBadges();
  renderCalendar();
}

(async function boot(){
  const saved = await idbGet("STATE");
  if (saved && typeof saved === "object"){
    STATE.config = saved.config || STATE.config;
    STATE.pacientes = Array.isArray(saved.pacientes) ? saved.pacientes : [];
    STATE.agenda = Array.isArray(saved.agenda) ? saved.agenda : [];
  }
  renderAll();
})();
