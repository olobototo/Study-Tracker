// ==========================================
// 1. CONFIGURACIÓN DB (VERSION 29)
// ==========================================
let db;
const DB_NAME = "StudyTrackerDB";
const DB_VERSION = 29;

const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onupgradeneeded = function(event) {
    db = event.target.result;
    // Crear almacenes si no existen
    if (!db.objectStoreNames.contains("sessions")) { 
        const s = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true }); 
        s.createIndex("fecha_str", "fecha_str", { unique: false }); 
    }
    if (!db.objectStoreNames.contains("subjects")) { 
        const s = db.createObjectStore("subjects", { keyPath: "id", autoIncrement: true }); 
        s.createIndex("nombre", "nombre", { unique: true }); 
    }
    if (!db.objectStoreNames.contains("events")) { 
        const e = db.createObjectStore("events", { keyPath: "id", autoIncrement: true }); 
        e.createIndex("fecha", "fecha", { unique: false }); 
    }
    if (!db.objectStoreNames.contains("tasks")) { 
        const t = db.createObjectStore("tasks", { keyPath: "id", autoIncrement: true }); 
        t.createIndex("materia", "materia", { unique: false }); 
    }
    // Limpieza de versiones antiguas
    if (db.objectStoreNames.contains("files")) db.deleteObjectStore("files");
};

request.onsuccess = function(event) {
    db = event.target.result;
    console.log("StudyTracker v29 Ready");
    refreshAllData();
    initCalendarControls();
};

request.onerror = e => console.error("Error DB:", e);

// ==========================================
// 2. VARIABLES GLOBALES
// ==========================================
let activeSubject = null;
let startTime, tInterval, difference, running = false, paused = false;
const display = document.getElementById('display');
let currentCalendarDate = new Date();
let selectedDateStr = null; 
let isYearView = false;
let charts = {}; 
let currentModalSubject = null;
let heatmapYear = new Date().getFullYear(); 
let sessionCompletedTasks = [];
let currentRankingMode = 'all';
let sessionToEditId = null;

// ==========================================
// 3. GESTIÓN DE MATERIAS
// ==========================================
function addSubject() {
    const name = document.getElementById('newSubjectName').value.trim();
    const color = document.getElementById('newSubjectColor').value;
    if (!name) return alert("Escribe un nombre");
    const newSub = { nombre: name, fecha_creacion: new Date(), aprobada: false, color: color };
    db.transaction(["subjects"], "readwrite").objectStore("subjects").add(newSub).onsuccess = () => {
        document.getElementById('newSubjectName').value = ""; refreshAllData();
    };
}
function deleteSubject(id, nombre) {
    if(confirm(`¿Borrar "${nombre}"?`)) db.transaction(["subjects"], "readwrite").objectStore("subjects").delete(id).onsuccess = () => refreshAllData();
}
function toggleSubjectStatus(id, currentStatus) {
    const store = db.transaction(["subjects"], "readwrite").objectStore("subjects");
    store.get(id).onsuccess = (e) => {
        const d = e.target.result; d.aprobada = !currentStatus; store.put(d).onsuccess = () => refreshAllData();
    };
}

// ==========================================
// 4. LÓGICA DE ESTUDIO
// ==========================================
function selectSubject(subjectObj) {
    activeSubject = subjectObj;
    sessionCompletedTasks = [];
    document.documentElement.style.setProperty('--accent', subjectObj.color || '#89b4fa');
    
    document.getElementById('selectionArea').classList.add('hidden');
    document.getElementById('widgetsArea').classList.add('hidden');
    document.getElementById('timerContainer').classList.remove('hidden');
    document.getElementById('currentSubjectTitle').innerText = subjectObj.nombre;
    
    setMode('timer');
    loadTasksForTimer();
    renderCountdowns(subjectObj.nombre, 'subjectCountdownGrid');
    document.getElementById('subjectCountdownWidget').classList.remove('hidden');
}

function deselectSubject() {
    if(running) return alert("Detén el cronómetro primero.");
    activeSubject = null;
    document.documentElement.style.setProperty('--accent', '#89b4fa');
    document.getElementById('timerContainer').classList.add('hidden');
    document.getElementById('selectionArea').classList.remove('hidden');
    document.getElementById('widgetsArea').classList.remove('hidden');
    document.getElementById('subjectCountdownWidget').classList.add('hidden');
    refreshAllData();
    resetTimerState();
}

function setMode(mode) {
    const viewTimer = document.getElementById('viewTimer');
    const viewManual = document.getElementById('viewManual');
    const btnTimer = document.getElementById('btnModeTimer');
    const btnManual = document.getElementById('btnModeManual');
    if (mode === 'timer') {
        viewTimer.classList.remove('hidden'); viewManual.classList.add('hidden');
        btnTimer.classList.add('active'); btnManual.classList.remove('active');
        if(!running && difference > 0) document.getElementById('saveArea').classList.remove('hidden');
    } else {
        if (running) return alert("Pausa el cronómetro.");
        viewTimer.classList.add('hidden'); viewManual.classList.remove('hidden');
        btnTimer.classList.remove('active'); btnManual.classList.add('active');
        document.getElementById('saveArea').classList.add('hidden');
        document.getElementById('manualDate').valueAsDate = new Date();
    }
}

document.getElementById('startBtn').addEventListener('click', () => {
    if(!running){
        startTime = (paused) ? new Date().getTime() - difference : new Date().getTime();
        tInterval = setInterval(() => { updatedTime = new Date().getTime(); difference = updatedTime - startTime; display.innerHTML = formatTime(difference); }, 1000);
        running = true; paused = false; toggleControls(true);
    }
});
document.getElementById('pauseBtn').addEventListener('click', () => { if (running) { clearInterval(tInterval); running = false; paused = true; toggleControls(false); } });
document.getElementById('stopBtn').addEventListener('click', () => {
    clearInterval(tInterval); running = false; paused = false;
    document.getElementById('finalTime').innerText = display.innerHTML;
    document.getElementById('saveArea').classList.remove('hidden');
    toggleControls(false, true);
});
document.getElementById('discardBtn').addEventListener('click', () => { resetTimerState(); document.getElementById('saveArea').classList.add('hidden'); });
document.getElementById('saveDbBtn').addEventListener('click', () => saveSession(difference, display.innerHTML, new Date()));

function saveManualSession() {
    const dVal = document.getElementById('manualDate').value;
    const h = parseInt(document.getElementById('manualHours').value) || 0;
    const m = parseInt(document.getElementById('manualMinutes').value) || 0;
    if (!dVal || (h===0 && m===0)) return alert("Datos inválidos");
    const ms = (h * 3600000) + (m * 60000);
    const txt = `${h < 10 ? "0"+h : h}:${m < 10 ? "0"+m : m}:00`;
    const dObj = new Date(dVal);
    const userDate = new Date(dObj.valueOf() + dObj.getTimezoneOffset() * 60000);
    saveSession(ms, txt, userDate, dVal);
}
function saveSession(ms, txt, dateObj, dateStrOverride = null) {
    if (!activeSubject) return;
    const fechaStr = dateStrOverride || dateObj.toISOString().split('T')[0];
    const newSession = { materia: activeSubject.nombre, fecha_str: fechaStr, fecha_display: dateObj.toLocaleDateString(), duracion_ms: ms, duracion_txt: txt };
    db.transaction(["sessions"], "readwrite").objectStore("sessions").add(newSession).onsuccess = () => {
        alert("Guardado!"); resetTimerState(); deselectSubject(); 
    };
}
function deleteSession(id) { if(confirm("¿Borrar?")) db.transaction(["sessions"], "readwrite").objectStore("sessions").delete(id).onsuccess = () => refreshAllData(); }

// --- EDICIÓN SESIONES ---
function openEditSessionModal(id) {
    sessionToEditId = id;
    const tx = db.transaction(["sessions"], "readonly");
    tx.objectStore("sessions").get(id).onsuccess = e => {
        const s = e.target.result;
        if(!s) return;
        document.getElementById('editSessionDate').value = s.fecha_str;
        const totalMin = Math.floor(s.duracion_ms / 60000);
        document.getElementById('editSessionHours').value = Math.floor(totalMin / 60);
        document.getElementById('editSessionMinutes').value = totalMin % 60;
        document.getElementById('editSessionModal').classList.remove('hidden');
    };
}
function closeEditSessionModal() { document.getElementById('editSessionModal').classList.add('hidden'); sessionToEditId = null; }
function saveEditedSession() {
    if (!sessionToEditId) return;
    const dVal = document.getElementById('editSessionDate').value;
    const h = parseInt(document.getElementById('editSessionHours').value) || 0;
    const m = parseInt(document.getElementById('editSessionMinutes').value) || 0;
    if (!dVal) return alert("Fecha inválida");
    const ms = (h * 3600000) + (m * 60000);
    const txt = `${h < 10 ? "0"+h : h}:${m < 10 ? "0"+m : m}:00`;
    const dObj = new Date(dVal);
    const dateDisplay = new Date(dObj.valueOf() + dObj.getTimezoneOffset() * 60000).toLocaleDateString();
    const tx = db.transaction(["sessions"], "readwrite");
    const store = tx.objectStore("sessions");
    store.get(sessionToEditId).onsuccess = e => {
        const data = e.target.result;
        data.fecha_str = dVal; data.fecha_display = dateDisplay; data.duracion_ms = ms; data.duracion_txt = txt;
        store.put(data).onsuccess = () => { closeEditSessionModal(); refreshAllData(); };
    };
}

// --- TAREAS ---
function loadTasksForTimer() {
    if(!activeSubject) return;
    const list = document.getElementById('timerTaskList');
    const container = document.getElementById('timerTasksArea');
    
    db.transaction("tasks").objectStore("tasks").index("materia").getAll(activeSubject.nombre).onsuccess = e => {
        list.innerHTML = "";
        const tasks = e.target.result.filter(t => !t.completada || sessionCompletedTasks.includes(t.id));
        if(tasks.length === 0) { container.classList.add('hidden'); return; }
        container.classList.remove('hidden');
        tasks.forEach(t => {
            const isStruck = t.completada ? 'strikethrough' : '';
            list.innerHTML += `<li class="task-item ${isStruck}"><input type="checkbox" class="task-check" ${t.completada?'checked disabled':''} onchange="markTaskDoneInSession(${t.id})"><span class="task-text">${t.texto}</span></li>`;
        });
    };
}
function markTaskDoneInSession(id) {
    const store = db.transaction(["tasks"], "readwrite").objectStore("tasks");
    store.get(id).onsuccess = e => { const t = e.target.result; t.completada = true; sessionCompletedTasks.push(id); store.put(t).onsuccess = () => loadTasksForTimer(); };
}
function addTaskFromModal() {
    const txt = document.getElementById('newTaskInput').value.trim();
    if(!txt) return;
    db.transaction(["tasks"], "readwrite").objectStore("tasks").add({ materia: currentModalSubject.nombre, texto: txt, completada: false, fecha: new Date() }).onsuccess = () => {
        document.getElementById('newTaskInput').value = ""; renderSubjectTasks(currentModalSubject.nombre);
    };
}
function toggleTask(id, status) {
    const store = db.transaction(["tasks"], "readwrite").objectStore("tasks");
    store.get(id).onsuccess = e => { const t = e.target.result; t.completada = !status; store.put(t).onsuccess = () => renderSubjectTasks(currentModalSubject.nombre); };
}
function deleteTask(id) {
    db.transaction(["tasks"], "readwrite").objectStore("tasks").delete(id).onsuccess = () => renderSubjectTasks(currentModalSubject.nombre);
}
function renderSubjectTasks(subjectName) {
    const list = document.getElementById('taskListModal');
    db.transaction("tasks").objectStore("tasks").index("materia").getAll(subjectName).onsuccess = e => {
        list.innerHTML = "";
        const tasks = e.target.result;
        if(tasks.length === 0) list.innerHTML = "<p style='text-align:center; color:#585b70'>Sin tareas.</p>";
        tasks.forEach(t => {
            list.innerHTML += `<li class="task-item ${t.completada?'completed':''}"><input type="checkbox" class="task-check" ${t.completada?'checked':''} onchange="toggleTask(${t.id}, ${t.completada})"><span class="task-text">${t.texto}</span><button onclick="deleteTask(${t.id})" class="btn-task-delete"><span class="material-icons">delete</span></button></li>`;
        });
    };
}

// --- MODALES ---
function openSubjectStatsModal(subjectObj) {
    currentModalSubject = subjectObj;
    document.getElementById('subjectStatsModal').classList.remove('hidden');
    document.getElementById('modalSubjectTitle').innerText = subjectObj.nombre;
    document.getElementById('modalSubjectTitle').style.color = subjectObj.color || 'var(--accent)';
    renderSubjectSpecificStats(subjectObj.nombre, subjectObj.color);
}
function openSubjectTasksModal(subjectObj) {
    currentModalSubject = subjectObj;
    document.getElementById('subjectTasksModal').classList.remove('hidden');
    document.getElementById('modalTasksTitle').innerText = "Tareas: " + subjectObj.nombre;
    renderSubjectTasks(subjectObj.nombre);
}
function closeSubjectStatsModal() { document.getElementById('subjectStatsModal').classList.add('hidden'); }
function closeSubjectTasksModal() { document.getElementById('subjectTasksModal').classList.add('hidden'); }

function renderSubjectSpecificStats(subjectName, color) {
    const tx = db.transaction(["sessions"], "readonly");
    tx.objectStore("sessions").getAll().onsuccess = e => {
        const allSessions = e.target.result.filter(s => s.materia === subjectName);
        const calcTop = (sessions) => {
            const map = {}; sessions.forEach(s => map[s.fecha_str] = (map[s.fecha_str]||0) + s.duracion_ms);
            const sorted = Object.entries(map).sort((a,b) => b[1] - a[1]).slice(0,3);
            const medals = ["🥇", "🥈", "🥉"];
            if(sorted.length === 0) return "<p style='color:#a6adc8; grid-column:1/-1; text-align:center;'>Sin datos.</p>";
            return sorted.map(([date, ms], i) => { const [y,m,d] = date.split('-'); return `<div class="medal-card"><span class="medal-icon">${medals[i]}</span><span class="medal-date">${d}/${m}/${y}</span><span class="medal-hours">${(ms/3600000).toFixed(1)}h</span></div>`; }).join('');
        };
        document.getElementById('modalTop3Grid').innerHTML = calcTop(allSessions);
        renderChartsForContainer(allSessions, 'subBarWeek', 'subBarMonth', 'subBarYear', color);
    };
}

// ==========================================
// 6. CALENDARIO & WIDGETS
// ==========================================
function renderCountdowns(subjectFilter = null, targetGridId = 'countdownGrid') {
    const grid = document.getElementById(targetGridId);
    if (!grid) return;
    const container = targetGridId === 'countdownGrid' ? document.getElementById('countdownWidget') : document.getElementById('subjectCountdownWidget');
    
    db.transaction(["events"], "readonly").objectStore("events").getAll().onsuccess = e => {
        grid.innerHTML = "";
        const todayStr = new Date().toISOString().split('T')[0];
        let events = e.target.result.filter(ev => ev.fecha >= todayStr);
        if (subjectFilter) { events = events.filter(ev => ev.materia === subjectFilter); } 
        else { events = events.filter(ev => !ev.materia || ev.materia === ""); }
        
        const upcoming = events.sort((a,b) => new Date(a.fecha) - new Date(b.fecha)).slice(0, 3);
        if(upcoming.length === 0) { container.classList.add('hidden'); return; }
        
        container.classList.remove('hidden');
        upcoming.forEach(ev => {
            const diff = Math.ceil((new Date(ev.fecha) - new Date(todayStr)) / 86400000);
            const color = ev.tipo === 'exam' ? 'var(--red)' : (ev.tipo === 'work' ? '#fab387' : '#cba6f7');
            const [y,m,d] = ev.fecha.split('-');
            grid.innerHTML += `<div class="countdown-card" style="border-left-color:${color}"><div class="countdown-subject">${ev.materia||'General'}</div><div class="countdown-title">${ev.titulo}</div><div class="countdown-days">${diff===0?'HOY':diff+' días'}</div><div class="countdown-date">${d}/${m}</div></div>`;
        });
    };
}

function initCalendarControls() {
    const s = document.getElementById('calMonthSelect'); s.innerHTML="";
    ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"].forEach((m,i)=>{
        const o=document.createElement('option'); o.value=i; o.innerText=m; s.appendChild(o);
    });
    updateCalendarInputs();
}
function updateCalendarInputs() {
    document.getElementById('calMonthSelect').value = currentCalendarDate.getMonth();
    document.getElementById('calYearInput').value = currentCalendarDate.getFullYear();
    // Actualizar también el display de año anual por si acaso
    const yDisplay = document.getElementById('annualYearDisplay');
    if(yDisplay) yDisplay.innerText = currentCalendarDate.getFullYear();
}
function changeCalendarDate(dir) {
    if (isYearView) {
        currentCalendarDate.setFullYear(currentCalendarDate.getFullYear() + dir);
        renderYearView();
    } else {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + dir);
        renderCalendar();
    }
    updateCalendarInputs();
}
function jumpToDate() {
    currentCalendarDate.setMonth(parseInt(document.getElementById('calMonthSelect').value));
    currentCalendarDate.setFullYear(parseInt(document.getElementById('calYearInput').value));
    renderCalendar();
}
function changeMonth(d) { changeCalendarDate(d); } // Alias legacy

function toggleViewMode() {
    isYearView = !isYearView;
    const btn = document.getElementById('viewModeBtn');
    btn.innerText = isYearView ? "📅 Volver" : "📅 Vista Anual";
    
    document.getElementById('calendarGrid').classList.toggle('hidden');
    document.getElementById('yearGrid').classList.toggle('hidden');
    
    // Toggle controles específicos
    const selectors = document.getElementById('calendarSelectors');
    const yearDisplay = document.getElementById('annualYearDisplay');
    
    if (isYearView) {
        if(selectors) selectors.classList.add('hidden');
        if(yearDisplay) yearDisplay.classList.remove('hidden');
        renderYearView();
    } else {
        if(selectors) selectors.classList.remove('hidden');
        if(yearDisplay) yearDisplay.classList.add('hidden');
        renderCalendar();
    }
    updateCalendarInputs();
}

function renderCalendar() {
    if(isYearView) return;
    const g = document.getElementById('calendarGrid'); 
    
    const y=currentCalendarDate.getFullYear(), m=currentCalendarDate.getMonth();
    let startDay = new Date(y,m,1).getDay(); startDay=startDay===0?6:startDay-1;
    const days=new Date(y,m+1,0).getDate();
    const todayStr=new Date().toISOString().split('T')[0];

    const tx=db.transaction(["sessions","events","subjects"],"readonly");
    Promise.all([
        new Promise(r=>tx.objectStore("sessions").getAll().onsuccess=e=>r(e.target.result)),
        new Promise(r=>tx.objectStore("events").getAll().onsuccess=e=>r(e.target.result)),
        new Promise(r=>tx.objectStore("subjects").getAll().onsuccess=e=>r(e.target.result))
    ]).then(([sess,evs,subs])=>{
        // LIMPIEZA BLINDADA
        g.innerHTML = "";
        
        ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].forEach(d=>g.innerHTML+=`<div class="weekday-header">${d}</div>`);
        const subjectColors = {}; subs.forEach(s=>subjectColors[s.nombre]=s.color||'#89b4fa');
        
        for(let i=0;i<startDay;i++)g.innerHTML+=`<div></div>`;
        for(let d=1;d<=days;d++){
            const dStr=`${y}-${(m+1).toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
            const daySess=sess.filter(s=>s.fecha_str===dStr);
            const dayEvs=evs.filter(e=>e.fecha===dStr);
            
            let indHtml="";
            if(dayEvs.length>0){
                indHtml+=`<div class="indicator-row-events">`;
                dayEvs.forEach(e=>{const c=e.tipo==='exam'?'var(--red)':(e.tipo==='work'?'var(--orange)':'var(--purple)');indHtml+=`<span class="indicator-icon" style="color:${c}">●</span>`;});
                indHtml+=`</div>`;
            }
            if(daySess.length>0){
                const mats=[...new Set(daySess.map(s=>s.materia))];
                let bc='var(--green)'; if(mats.length===1)bc=subjectColors[mats[0]]||'var(--green)';
                indHtml+=`<div class="indicator-bar" style="background-color:${bc}"></div>`;
            }
            let cls=`calendar-day`; if(dStr===todayStr)cls+=` today`; if(dStr===selectedDateStr)cls+=` selected`;
            const div=document.createElement('div'); div.className=cls;
            div.innerHTML=`<div class="day-number">${d}</div><div class="indicators">${indHtml}</div>`;
            div.onclick=()=>openDayModal(dStr); g.appendChild(div);
        }
    });
}

function renderYearView() {
    const g=document.getElementById('yearGrid'); 
    const y=currentCalendarDate.getFullYear();
    const mNames=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    db.transaction(["events"],"readonly").objectStore("events").getAll().onsuccess=e=>{
        g.innerHTML = ""; // LIMPIEZA
        const evs=e.target.result;
        mNames.forEach((name,i)=>{
            const monthEvs=evs.filter(x=>x.fecha.startsWith(`${y}-${(i+1).toString().padStart(2,'0')}`));
            const exams=monthEvs.filter(x=>x.tipo==='exam').length;
            const works=monthEvs.filter(x=>x.tipo==='work').length;
            const gens=monthEvs.filter(x=>x.tipo==='general').length;
            let statsHtml="";
            if(exams>0) statsHtml+=`<div class="month-stat-item"><span style="color:var(--red)">●</span> ${exams} Exámenes</div>`;
            if(works>0) statsHtml+=`<div class="month-stat-item"><span style="color:#fab387">●</span> ${works} Entregas</div>`;
            if(gens>0) statsHtml+=`<div class="month-stat-item"><span style="color:#cba6f7">●</span> ${gens} Otros</div>`;
            if(statsHtml==="") statsHtml=`<div style="opacity:0.3; font-size:0.7rem;">-</div>`;
            const c=document.createElement('div'); c.className="mini-month-card";
            c.innerHTML=`<div class="mini-month-title">${name}</div><div class="mini-month-stats">${statsHtml}</div>`;
            c.onclick=()=>{currentCalendarDate.setMonth(i); toggleViewMode();};
            g.appendChild(c);
        });
    };
}

function openDayModal(ds) {
    selectedDateStr=ds; renderCalendar(); document.getElementById('dayDetails').classList.remove('hidden');
    const [y,m,d]=ds.split('-'); document.getElementById('selectedDateTitle').innerText=`Detalles del ${d}/${m}/${y}`;
    loadSubjectsToEventDropdown();
    const tx=db.transaction(["sessions","events","subjects"],"readonly");
    tx.objectStore("subjects").getAll().onsuccess=eSubs=>{
        const subMap={}; eSubs.target.result.forEach(s=>subMap[s.nombre]={color:s.color,aprobada:s.aprobada});
        tx.objectStore("sessions").getAll().onsuccess=e=>{
            const s=e.target.result.filter(x=>x.fecha_str===ds);
            const l=document.getElementById('dayStudyList'); l.innerHTML=s.length?"":"<li style='color:#a6adc8;'>Nada.</li>";
            s.forEach(x=>{
                const meta=subMap[x.materia]||{color:'#89b4fa',aprobada:false};
                l.innerHTML+=`<div class="day-history-card ${meta.aprobada?'approved':''}" style="border-left-color:${meta.color}"><div class="history-subject">${meta.aprobada?'🏆':''} ${x.materia}</div><div class="history-time">${x.duracion_txt}</div></div>`;
            });
        };
        tx.objectStore("events").getAll().onsuccess=e=>{
            const ev=e.target.result.filter(x=>x.fecha===ds);
            const l=document.getElementById('dayEventsList'); l.innerHTML=ev.length?"":"<li style='color:#a6adc8;'>Sin eventos.</li>";
            ev.forEach(x=>{
                const c=x.tipo==='exam'?'var(--red)':(x.tipo==='work'?'var(--orange)':'var(--purple)');
                l.innerHTML+=`<div class="event-item"><div class="event-info"><span class="event-dot" style="color:${c}">●</span><span>${x.materia?`<strong>[${x.materia}]</strong> `:''}${x.titulo}</span></div><button onclick="deleteEvent(${x.id})" class="btn-task-delete"><span class="material-icons">delete</span></button></div>`;
            });
        };
    };
}
function addEvent() {
    const t=document.getElementById('newEventTitle').value;
    const type=document.getElementById('newEventType').value;
    const sub=document.getElementById('newEventSubject').value;
    if(!t||!selectedDateStr)return;
    db.transaction(["events"],"readwrite").objectStore("events").add({titulo:t, tipo:type, fecha:selectedDateStr, materia:sub}).onsuccess=()=>{
        document.getElementById('newEventTitle').value=""; openDayModal(selectedDateStr); 
        // No llamamos a refreshAllData para evitar parpadeos, renderCalendar se actualiza en openDayModal
    };
}
function deleteEvent(id){if(confirm("Borrar?"))db.transaction(["events"],"readwrite").objectStore("events").delete(id).onsuccess=()=>{openDayModal(selectedDateStr);};}

// ==========================================
// 8. INTERFAZ Y REFRESH
// ==========================================
function refreshAllData() {
    if(!db) return;
    loadSubjectsToGrid(); loadSubjectsToManagementList(); loadSubjectsToEventDropdown();
    updateStatsAndStreak(); renderCountdowns();
}

function loadSubjectsToGrid() {
    const g=document.getElementById('subjectGrid'); const msg=document.getElementById('noSubjectsMsg'); 
    db.transaction("subjects").objectStore("subjects").getAll().onsuccess=e=>{
        g.innerHTML=""; // LIMPIEZA
        const subs=e.target.result;
        if(subs.length===0) { g.classList.add('hidden'); msg.classList.remove('hidden'); }
        else {
            g.classList.remove('hidden'); msg.classList.add('hidden');
            subs.forEach(s=>{
                const c=document.createElement('div'); c.className=`card-btn ${s.aprobada?'approved':''}`;
                c.style.borderColor = s.aprobada ? 'var(--green)' : 'transparent';
                c.innerHTML=`<span class='material-icons' style='font-size:2rem;color:${s.aprobada?'var(--green)':(s.color||'var(--accent)')}'>menu_book</span><h3>${s.nombre}</h3>`;
                c.onclick=()=>selectSubject(s); g.appendChild(c);
            });
        }
    };
}
function loadSubjectsToManagementList(){
    const l=document.getElementById('subjectsListManagement'); 
    db.transaction("subjects").objectStore("subjects").getAll().onsuccess=e=>{
        l.innerHTML=""; // LIMPIEZA
        e.target.result.forEach(s=>{
            l.innerHTML+=`
            <li class="manage-subject-item" style="border-left-color:${s.aprobada?'var(--green)':(s.color||'transparent')}">
                <span style="${s.aprobada?'color:var(--green);font-weight:bold;':''}">${s.nombre} ${s.aprobada?'(Finalizada)':''}</span>
                <div class="subject-actions">
                    <button class="action-btn btn-tasks" onclick='openSubjectTasksByName("${s.nombre}")' title="Tareas"><span class="material-icons" style="font-size:1.2rem">assignment</span></button>
                    <button class="action-btn btn-stats" onclick='openSubjectStatsByName("${s.nombre}")' title="Stats"><span class="material-icons" style="font-size:1.2rem">bar_chart</span></button>
                    <button class="action-btn btn-approve ${s.aprobada?'is-approved':''}" onclick="toggleSubjectStatus(${s.id},${s.aprobada})" title="Aprobar"><span class="material-icons" style="font-size:1.2rem">${s.aprobada?'check_circle':'radio_button_unchecked'}</span></button>
                    <button class="action-btn btn-delete" onclick="deleteSubject(${s.id},'${s.nombre}')" title="Borrar"><span class="material-icons" style="font-size:1.2rem">delete</span></button>
                </div>
            </li>`;
        });
    };
}
function openSubjectStatsByName(name) { db.transaction("subjects").objectStore("subjects").index("nombre").get(name).onsuccess = e => { if(e.target.result) openSubjectStatsModal(e.target.result); }; }
function openSubjectTasksByName(name) { db.transaction("subjects").objectStore("subjects").index("nombre").get(name).onsuccess = e => { if(e.target.result) openSubjectTasksModal(e.target.result); }; }
function loadSubjectsToEventDropdown(){
    const s=document.getElementById('newEventSubject'); 
    db.transaction("subjects").objectStore("subjects").getAll().onsuccess=e=>{
        s.innerHTML='<option value="">-- Sin Materia (General) --</option>'; // LIMPIEZA
        e.target.result.forEach(x=>s.innerHTML+=`<option value="${x.nombre}">${x.nombre}</option>`);
    };
}

function switchRankingTab(type) {
    currentRankingMode = type;
    document.querySelectorAll('.rank-tab').forEach(b => b.classList.remove('active'));
    const labels = { 'all': 'Histórico', 'month': 'Este Mes', 'semester': 'Semestral' };
    Array.from(document.querySelectorAll('.rank-tab')).find(b => b.innerText === labels[type]).classList.add('active');
    updateStatsAndStreak();
}

// ==========================================
// 9. ESTADÍSTICAS GLOBALES & HEATMAP
// ==========================================
function updateStatsAndStreak() {
    const tx = db.transaction(["sessions", "subjects"], "readonly");
    Promise.all([
        new Promise(r => tx.objectStore("subjects").getAll().onsuccess = e => r(e.target.result)),
        new Promise(r => tx.objectStore("sessions").getAll().onsuccess = e => r(e.target.result))
    ]).then(([subjects, sessions]) => {
        const subjectMeta = {}; 
        subjects.forEach(s => subjectMeta[s.nombre] = { color: s.color || '#89b4fa', aprobada: s.aprobada });

        renderHeatmap(sessions, subjectMeta);
        calculateGlobalTopStats(sessions);

        let streak=0; let checkDate = new Date(); let dateStr = checkDate.toISOString().split('T')[0];
        const daysWithStudy = new Set(sessions.map(s => s.fecha_str));
        if (!daysWithStudy.has(dateStr)) { checkDate.setDate(checkDate.getDate() - 1); dateStr = checkDate.toISOString().split('T')[0]; }
        while (daysWithStudy.has(dateStr)) { streak++; checkDate.setDate(checkDate.getDate() - 1); dateStr = checkDate.toISOString().split('T')[0]; }
        document.getElementById('streakDisplay').innerText = streak + (streak===1?" Día":" Días");

        const sortedDays = Array.from(daysWithStudy).sort();
        let maxStreak=0; let tempStreak=0; let prevDate=null;
        if(sortedDays.length>0) { sortedDays.forEach(dayStr=>{ const d=new Date(dayStr); if(prevDate && Math.ceil(Math.abs(d-prevDate)/86400000)===1) tempStreak++; else tempStreak=1; if(tempStreak>maxStreak)maxStreak=tempStreak; prevDate=d; }); }
        document.getElementById('bestStreakDisplay').innerText = maxStreak + (maxStreak===1?" Día":" Días");

        let filteredSessions = sessions;
        if (currentRankingMode === 'month') { const nowMonth = new Date().toISOString().slice(0, 7); filteredSessions = sessions.filter(s => s.fecha_str.startsWith(nowMonth)); } 
        else if (currentRankingMode === 'semester') { const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6); filteredSessions = sessions.filter(s => new Date(s.fecha_str) >= sixMonthsAgo); }

        const container = document.getElementById('generalRanking'); container.innerHTML = "";
        const map = {}; let totalGlobal = 0;
        filteredSessions.forEach(s => { map[s.materia] = (map[s.materia] || 0) + s.duracion_ms; totalGlobal += s.duracion_ms; });
        const sorted = Object.entries(map).sort((a,b) => b[1] - a[1]);
        if(sorted.length === 0) container.innerHTML = "<p style='color:#a6adc8;text-align:center'>Sin datos en este periodo.</p>";
        else sorted.forEach(([materia, ms], index) => {
            const pct = ((ms/totalGlobal)*100).toFixed(1); const hours = (ms/3600000).toFixed(1); const meta = subjectMeta[materia] || { color: '#89b4fa', aprobada: false }; const goldClass = meta.aprobada ? 'gold-rank' : ''; const nameStyle = meta.aprobada ? 'color:var(--gold); font-weight:bold;' : `color:${meta.color}`;
            container.innerHTML += `<div class="ranking-item ${goldClass}"><div class="ranking-pos">#${index+1}</div><div style="width:130px; ${nameStyle}">${materia}</div><div class="ranking-bar-bg"><div class="ranking-bar-fill" style="width:${pct}%; background:${meta.color}"></div></div><div style="font-size:0.9rem; color:#cdd6f4;">${hours}h</div></div>`;
        });

        renderPieCharts(sessions, subjectMeta);
        renderChartsForContainer(sessions, 'barWeekdays', 'barMonthly', 'barYearly');

        const tb = document.getElementById('sessionsListDisplay'); tb.innerHTML="";
        [...sessions].reverse().slice(0,20).forEach(s => tb.innerHTML+=`<tr><td>${s.fecha_display}</td><td>${s.materia}</td><td>${s.duracion_txt}</td><td><div class="action-cell"><button class="btn-row-edit" onclick="openEditSessionModal(${s.id})"><span class="material-icons">edit</span></button><button class="btn-row-delete" onclick="deleteSession(${s.id})"><span class="material-icons">delete</span></button></div></td></tr>`);
    });
}

function calculateGlobalTopStats(sessions) {
    const dayMap = {}; sessions.forEach(s => dayMap[s.fecha_str] = (dayMap[s.fecha_str] || 0) + s.duracion_ms);
    const topDays = Object.entries(dayMap).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const daysContainer = document.getElementById('globalTopDays');
    daysContainer.innerHTML = topDays.length ? "" : "<p style='color:#a6adc8'>Sin datos.</p>";
    topDays.forEach(([date, ms], i) => { const [y,m,d] = date.split('-'); daysContainer.innerHTML += `<div class="top-item"><span class="top-rank">#${i+1}</span><span class="top-label">${d}/${m}/${y}</span><span class="top-value">${(ms/3600000).toFixed(1)}h</span></div>`; });

    const monthMap = {}; const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    sessions.forEach(s => { const d = new Date(s.fecha_str); const key = `${d.getFullYear()}-${d.getMonth()}`; monthMap[key] = (monthMap[key] || 0) + s.duracion_ms; });
    const sortedMonths = Object.entries(monthMap).sort((a,b)=>b[1]-a[1]);
    const topMonths = sortedMonths.slice(0,3);
    
    const monthsContainer = document.getElementById('globalTopMonths');
    monthsContainer.innerHTML = topMonths.length ? "" : "<p style='color:#a6adc8'>Sin datos.</p>";
    topMonths.forEach(([key, ms], i) => { const [year, monthIdx] = key.split('-'); const label = `${monthNames[parseInt(monthIdx)]} ${year}`; monthsContainer.innerHTML += `<div class="top-item"><span class="top-rank">#${i+1}</span><span class="top-label">${label}</span><span class="top-value">${(ms/3600000).toFixed(1)}h</span></div>`; });

    window.fullMonthRanking = sortedMonths.map(([key, ms], i) => { const [year, monthIdx] = key.split('-'); return `<div class="top-item"><span class="top-rank">#${i+1}</span><span class="top-label">${monthNames[parseInt(monthIdx)]} ${year}</span><span class="top-value">${(ms/3600000).toFixed(1)}h</span></div>`; }).join('');
}
function toggleAllMonths() { document.getElementById('allMonthsModal').classList.remove('hidden'); document.getElementById('allMonthsList').innerHTML = window.fullMonthRanking || "<p>Sin datos.</p>"; }
function changeHeatmapYear(dir) { heatmapYear += dir; updateStatsAndStreak(); }
function renderHeatmap(sessions, subjectMeta) {
    document.getElementById('heatmapYearDisplay').innerText = heatmapYear;
    const grid = document.getElementById('heatmapGrid'); const monthsLabel = document.getElementById('heatmapMonths');
    grid.innerHTML = ""; monthsLabel.innerHTML = "";
    const startDate = new Date(heatmapYear, 0, 1); const endDate = new Date(heatmapYear, 11, 31);
    const dayMap = {}; sessions.forEach(s => { if(s.fecha_str.startsWith(heatmapYear)) { dayMap[s.fecha_str] = (dayMap[s.fecha_str] || 0) + s.duracion_ms; } });
    let currentMonth = -1;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().split('T')[0]; const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); 
        const totalMs = dayMap[iso] || 0; const hours = totalMs / 3600000;
        let opacity = 0.1; if (hours > 0) opacity = 0.4; if (hours > 1) opacity = 0.6; if (hours > 3) opacity = 0.8; if (hours > 5) opacity = 1;
        const color = hours > 0 ? "rgba(137, 180, 250, " + opacity + ")" : "#313244"; const title = `${iso}: ${hours.toFixed(1)}h`;
        if(d.getMonth() !== currentMonth && d.getDate() < 8) { currentMonth = d.getMonth(); const mName = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][currentMonth]; const span = document.createElement('span'); span.innerText = mName; span.style.left = `${(currentMonth / 12 * 100)}%`; span.className = "month-label"; monthsLabel.appendChild(span); }
        const div = document.createElement('div'); div.className = "heatmap-day"; div.style.backgroundColor = color; div.title = title; div.style.gridRow = dayOfWeek; grid.appendChild(div);
    }
}

function renderPieCharts(sessions, subjectMeta) {
    const totalMap={}; sessions.forEach(s=>totalMap[s.materia]=(totalMap[s.materia]||0)+s.duracion_ms);
    const colorsAll = Object.keys(totalMap).map(m => subjectMeta[m]?.color || '#89b4fa');
    createPieChart('pieAllTime', totalMap, colorsAll);
    const weekMap={}; const wAgo=new Date(); wAgo.setDate(wAgo.getDate()-7);
    sessions.filter(s=>new Date(s.fecha_str)>=wAgo).forEach(s=>weekMap[s.materia]=(weekMap[s.materia]||0)+s.duracion_ms);
    const colorsWeek = Object.keys(weekMap).map(m => subjectMeta[m]?.color || '#89b4fa');
    createPieChart('pieWeekly', weekMap, colorsWeek);
}
function renderChartsForContainer(sessions, idWeek, idMonth, idYear, overrideColor = null) {
    const days=[0,0,0,0,0,0,0]; sessions.forEach(s=>days[new Date(s.fecha_str).getDay()]+=s.duracion_ms);
    createBarChart(idWeek, ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'], [...days.slice(1),days[0]], overrideColor);
    const months=new Array(12).fill(0); sessions.forEach(s=>months[new Date(s.fecha_str).getMonth()]+=s.duracion_ms);
    createBarChart(idMonth, ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"], months, overrideColor);
    const years={}; sessions.forEach(s=>{const y=new Date(s.fecha_str).getFullYear(); years[y]=(years[y]||0)+s.duracion_ms;});
    createBarChart(idYear, Object.keys(years), Object.values(years), overrideColor);
}
function createPieChart(id, map, colors) {
    destroyChart(id); const ctx=document.getElementById(id).getContext('2d');
    charts[id] = new Chart(ctx, { type:'doughnut', data:{labels:Object.keys(map), datasets:[{data:Object.values(map).map(x=>(x/3600000).toFixed(1)), backgroundColor: colors || '#89b4fa', borderWidth:0}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{color:'#cdd6f4'}}}}});
}
function createBarChart(id, lbs, d, color) {
    destroyChart(id); const ctx=document.getElementById(id).getContext('2d');
    const bg = color || '#89b4fa';
    charts[id] = new Chart(ctx, { type:'bar', data:{labels:lbs, datasets:[{label:'Horas', data:d.map(x=>(x/3600000).toFixed(1)), backgroundColor: bg, borderRadius:4}]}, options:{responsive:true, maintainAspectRatio:false, scales:{y:{grid:{color:'#45475a'},ticks:{color:'#a6adc8'}},x:{grid:{display:false},ticks:{color:'#a6adc8'}}}, plugins:{legend:{display:false}}}});
}
function destroyChart(id){ if(charts[id]) charts[id].destroy(); }
function hardReset(){ if(confirm("¿Borrar todo?")) { db.close(); indexedDB.deleteDatabase(DB_NAME).onsuccess=()=>location.reload(); } }

// --- IMPORTAR / EXPORTAR (COMPLETO Y EXPANDIDO) ---
async function exportData() {
    const btn = document.querySelector('.btn-config[onclick="exportData()"]');
    if(btn) btn.innerText="⏳ Exportando...";
    
    try {
        const stores = ["subjects", "sessions", "events", "tasks"];
        const exportData = {};
        
        // Ejecutar promesas secuenciales para asegurar lectura completa
        const tx = db.transaction(stores, "readonly");
        
        for (const storeName of stores) {
            exportData[storeName] = await new Promise((resolve, reject) => {
                const req = tx.objectStore(storeName).getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `StudyTracker_Backup_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        
    } catch(e) {
        console.error("Error exportando:", e);
        alert("Error al exportar datos.");
    } finally {
        if(btn) btn.innerText="⬇ Exportar";
    }
}

async function importData(inputElement) {
    if(!inputElement.files[0]) return;
    if(!confirm("⚠️ Importar datos fusionará la información con la actual. ¿Continuar?")) {
        inputElement.value = "";
        return;
    }

    const file = inputElement.files[0];
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            const stores = ["subjects", "sessions", "events", "tasks"];
            const tx = db.transaction(stores, "readwrite");
            
            let count = 0;
            
            stores.forEach(storeName => {
                if (data[storeName] && Array.isArray(data[storeName])) {
                    const store = tx.objectStore(storeName);
                    data[storeName].forEach(item => {
                        // Eliminar ID para evitar conflictos de claves primarias
                        delete item.id; 
                        store.put(item);
                        count++;
                    });
                }
            });
            
            tx.oncomplete = () => {
                alert(`¡Importación exitosa! Se añadieron ${count} elementos.`);
                refreshAllData();
                inputElement.value = ""; // Reset input
            };
            
            tx.onerror = (err) => {
                console.error("Error transacción importación:", err);
                alert("Error al importar datos.");
            };
            
        } catch(err) {
            console.error(err);
            alert("Error al leer el archivo JSON.");
        }
    };
    reader.readAsText(file);
}

function showSection(id) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));
    document.getElementById(id).classList.remove('hidden');
    
    // Close Modals
    closeSubjectStatsModal(); closeSubjectTasksModal();
    document.getElementById('dayDetails').classList.add('hidden');

    if (id === 'timer-section') {
        if (activeSubject) {
            document.getElementById('selectionArea').classList.add('hidden');
            document.getElementById('widgetsArea').classList.add('hidden');
            document.getElementById('timerContainer').classList.remove('hidden');
            renderCountdowns(activeSubject.nombre, 'subjectCountdownGrid');
        } else {
            document.getElementById('selectionArea').classList.remove('hidden');
            document.getElementById('widgetsArea').classList.remove('hidden');
            document.getElementById('timerContainer').classList.add('hidden');
            loadSubjectsToGrid(); 
            renderCountdowns();
        }
    }
    
    if(id==='stats-section') updateStatsAndStreak();
    if(id==='subjects-section') refreshAllData();
    if(id==='calendar-section') renderCalendar();
}
function formatTime(ms) { let s=Math.floor((ms/1000)%60), m=Math.floor((ms/60000)%60), h=Math.floor((ms/3600000)%24); return (h<10?"0"+h:h)+":"+(m<10?"0"+m:m)+":"+(s<10?"0"+s:s); }
function resetTimerState() { clearInterval(tInterval); display.innerHTML="00:00:00"; running=false; paused=false; difference=0; toggleControls(false,false); document.getElementById('saveArea').classList.add('hidden'); }
function toggleControls(r,f=false) { document.getElementById('startBtn').disabled=r||f; document.getElementById('pauseBtn').disabled=!r; document.getElementById('stopBtn').disabled=!r; }