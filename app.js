(() => {
  const DB_KEY = 'safra-organizador-v1';
  const DB_META_KEY = 'safra-organizador-saved-at';
  const IDB_NAME = 'safra-offline-store';
  const IDB_STORE = 'snapshots';
  const LOCAL_FILE_API = location.protocol === 'http:' && ['localhost','127.0.0.1'].includes(location.hostname);
  const localISO = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const todayISO = () => localISO(new Date());
  const monthStart = new Date();
  let currentMonth = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  let selectedDate = todayISO();
  let mode = 'others';
  let activeView = 'calendar';
  let editingId = null;
  let lastCalendarClick = { key: '', time: 0 };
  let toastTimer;
  let participantDrafts = new Map();
  let persistQueue = Promise.resolve();
  const unique = xs => [...new Set(xs.filter(Boolean))];
  const D = window.SafraDomain;
  let data = load();
  let idbPromise;

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const fmtDate = (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => new Intl.DateTimeFormat('pt-BR', opts).format(new Date(`${iso}T12:00:00`));
  const shortDate = iso => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(`${iso}T12:00:00`));
  const brl = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(n || 0));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayUnits = D.DAY_UNITS;
  const workerKey = n => ['pai','ivonei'].includes(String(n||'').trim().toLocaleLowerCase('pt-BR')) ? 'ivonei' : String(n||'').trim().toLocaleLowerCase('pt-BR');
  function employerHue(name) { let hash=0;for(const char of String(name||''))hash=(hash*31+char.charCodeAt(0))>>>0;return 18+(hash%325); }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
      return normalizeData(parsed);
    } catch { return normalizeData({}); }
  }
  function normalizeData(parsed={}) { return {records:Array.isArray(parsed.records)?parsed.records:[],stufas:Array.isArray(parsed.stufas)?parsed.stufas:[],people:{employers:Array.isArray(parsed.people?.employers)?parsed.people.employers:['Nelson','Pai','Edinho','Laurinho','Zé','Rogério','Arildo'],workers:unique([...(Array.isArray(parsed.people?.workers)?parsed.people.workers:['Eros','Nelson','Ivonei','Cauã','Pablo','Darci','Jackson','Rafael','Laurinho','Zé','Arildo']),'Silvani']),buyers:Array.isArray(parsed.people?.buyers)?parsed.people.buyers:['Gabi','Boa Vista','BAT','Premium']}}; }
  function openOfflineDb() {
    if(!('indexedDB' in window))return Promise.reject(new Error('IndexedDB indisponível'));
    if(!idbPromise)idbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open(IDB_NAME,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(IDB_STORE))request.result.createObjectStore(IDB_STORE);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Banco local bloqueado'));});
    return idbPromise;
  }
  async function readOfflineSnapshot() {
    const db=await openOfflineDb();return new Promise((resolve,reject)=>{const request=db.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get('main');request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});
  }
  async function writeOfflineSnapshot(snapshot) {
    const db=await openOfflineDb();return new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,'readwrite');tx.objectStore(IDB_STORE).put(snapshot,'main');tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Gravação local cancelada'));});
  }
  async function persistSnapshot(snapshot) {
    let browserSaved=false,fileSaved=false;
    try{localStorage.setItem(DB_KEY,JSON.stringify(snapshot.data));localStorage.setItem(DB_META_KEY,String(snapshot.savedAt));browserSaved=true;}catch{}
    if(LOCAL_FILE_API)try{const response=await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});fileSaved=response.ok;}catch{}
    let indexedSaved=false;try{await writeOfflineSnapshot(snapshot);indexedSaved=true;}catch{}
    if($('#backup-status'))$('#backup-status').textContent=fileSaved?`Arquivo local salvo · ${new Date(snapshot.savedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:`Salvo neste navegador · ${new Date(snapshot.savedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
    if(LOCAL_FILE_API&&!fileSaved)showToast('Servidor do arquivo não respondeu; dados ficaram só no navegador');
    if(!fileSaved&&!browserSaved&&!indexedSaved)showToast('Não foi possível gravar os dados');
    return fileSaved||browserSaved||indexedSaved;
  }
  function persist() {
    const snapshot={data:JSON.parse(JSON.stringify(data)),savedAt:Date.now()};
    persistQueue=persistQueue.then(()=>persistSnapshot(snapshot),()=>persistSnapshot(snapshot));
    return persistQueue;
  }
  async function restoreOfflineData() {
    if(LOCAL_FILE_API)try{const response=await fetch('/api/data',{cache:'no-store'});if(response.ok){const saved=await response.json();if(saved?.data&&Array.isArray(saved.data.records)&&Array.isArray(saved.data.stufas)){data=normalizeData(saved.data);const snapshot={data,savedAt:Number(saved.savedAt)||Date.now()};try{localStorage.setItem(DB_KEY,JSON.stringify(data));localStorage.setItem(DB_META_KEY,String(snapshot.savedAt));}catch{}try{await writeOfflineSnapshot(snapshot);}catch{}return;}}}catch{}
    let snapshot=null;try{snapshot=await readOfflineSnapshot();}catch{}
    let localSavedAt=0;try{localSavedAt=Number(localStorage.getItem(DB_META_KEY)||0);}catch{}
    if(snapshot?.data&&Number(snapshot.savedAt)>localSavedAt){data=normalizeData(snapshot.data);try{localStorage.setItem(DB_KEY,JSON.stringify(data));localStorage.setItem(DB_META_KEY,String(snapshot.savedAt));}catch{}return;}
    if(!snapshot)await persist();
  }
  function icon(name, size = 16) { return `<svg class="icon" width="${size}" height="${size}" aria-hidden="true"><use href="#${name}"></use></svg>`; }
  function showToast(message) { const t = $('#toast'); t.textContent = message; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
  function mondayStart(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x; }

  function monthRecords() {
    const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
    return data.records.filter(r => r.date.startsWith(key) && belongsToMode(r,mode));
  }
  function belongsToMode(record, selectedMode) { return D.visibleInMode(record,selectedMode); }
  function recordsOn(iso) { return data.records.filter(r => r.date === iso && belongsToMode(r,mode)); }
  function updateSeasonLabel(){const year=D.seasonStartYear(new Date());$('.season-switch span:first-child').innerHTML=`<i></i> ${year} / ${year+1}`;}
  function render() { updateSeasonLabel();renderCalendar(); renderSummary(); renderDayRecords(); renderAltView(); renderPickers(); }

  function renderCalendar() {
    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(currentMonth);
    $('#month-title').textContent = monthName[0].toUpperCase() + monthName.slice(1);
    const first = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const gridStart = new Date(first);gridStart.setDate(first.getDate()-first.getDay());
    const header = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<div class="weekday">${d}</div>`).join('');
    const cells = [];
    const visible = [...data.records.filter(r => belongsToMode(r,mode))];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart); d.setDate(d.getDate() + i);
      const iso = localISO(d);
      const records = visible.filter(r => r.date === iso);
      const muted = d.getMonth() !== currentMonth.getMonth();
      const chips = records.slice(0, 2).map(r => {
        let label = r.mode==='tractor' ? `Trator · ${r.duration==='half'?'meio dia':'dia inteiro'}` : D.familyRecord(r) ? (data.stufas.find(s => s.id === r.stufaId)?.name || 'Nossa estufada') : (r.destination || 'Trabalho');
        const family=D.familyRecord(r);const employer=D.thirdPartyRecord(r);
        return `<div class="event-chip ${family?'ours':''} ${r.mode==='tractor'?'tractor':''} ${employer?'employer-chip':''}" ${employer?`style="--employer-hue:${employerHue(r.destination)}"`:''} data-calendar-record="${r.id}" title="Duplo clique para editar">${esc(label)}</div>`;
      }).join('') + (records.length > 2 ? `<div class="event-chip more">+${records.length - 2} registros</div>` : '');
      cells.push(`<button class="day-cell ${muted ? 'muted' : ''} ${iso === selectedDate ? 'selected' : ''} ${iso === todayISO() ? 'today' : ''}" data-date="${iso}" aria-label="${fmtDate(iso)}${records.length ? `, ${records.length} registros` : ''}"><span class="day-num">${d.getDate()}</span><div class="event-chips">${chips}</div></button>`);
    }
    $('#calendar-grid').innerHTML = header + cells.join('');
    $$('.day-cell').forEach(cell => cell.addEventListener('click', e => {
      const date=cell.dataset.date;const event=e.target.closest('[data-calendar-record]');const key=event?`record:${event.dataset.calendarRecord}`:`day:${date}`;const now=Date.now();
      if(lastCalendarClick.key===key&&now-lastCalendarClick.time<600){lastCalendarClick={key:'',time:0};selectedDate=date;const record=event&&data.records.find(r=>r.id===event.dataset.calendarRecord);openRecord(date,record||null);return;}
      lastCalendarClick={key,time:now};selectedDate=date;renderCalendar();renderDayRecords();
    }));
  }

  function currentSeasonRecords() { const seasonYear=D.seasonStartYear(new Date());return data.records.filter(r=>D.inSeason(r,seasonYear)); }
  function renderSummary() {
    const records = currentSeasonRecords();
    const start = mondayStart(new Date());
    const thisWeek = records.filter(r => { const d = new Date(`${r.date}T12:00:00`); return d >= start && d < new Date(start.getTime() + 7 * 86400000); });
    let cards;
    if (mode === 'tractor') {
      const lends=records.filter(r=>r.mode==='tractor');
      const asDays=r=>r.duration==='half'?0.5:1;
      const weekly=thisWeek.filter(r=>r.mode==='tractor');
      const total=lends.reduce((sum,r)=>sum+asDays(r),0);
      const weekTotal=weekly.reduce((sum,r)=>sum+asDays(r),0);
      cards=[['Empréstimos registrados',`${lends.length}`,'dias no calendário','tractor'],['Dias equivalentes',`${total.toLocaleString('pt-BR')}`,'meios dias somam 0,5','calendar-days'],['Nesta semana',`${weekTotal.toLocaleString('pt-BR')}`,'dias equivalentes','chart-no-axes-column-increasing'],['Meios dias',`${lends.filter(r=>r.duration==='half').length}`,'vezes que emprestamos meio dia','ellipsis']];
    } else if (mode === 'ours') {
      const seasonStufas = D.familyStufasInSeason(data.stufas,D.seasonStartYear(new Date()));
      const done = seasonStufas.filter(s => s.status === 'done').length;
      const weekIds = unique(thisWeek.filter(r=>D.familyRecord(r)&&r.stufaId).map(r => r.stufaId));
      const open = seasonStufas.filter(s => s.status === 'open').length;
      const familyRecords=records.filter(D.familyRecord);
      const workDays = D.sumDays(familyRecords);
      const deals = familyRecords.flatMap(D.participantDeals);
      const owing = deals.filter(d => d.settlement === 'cash' && !d.paid).reduce((sum,d)=>sum+Number(d.amount||0),0);
      const credits=D.exchangeLedger(data.records).reduce((sum,item)=>sum+Math.max(0,item.balance),0);
      cards = [["Estufadas concluídas", `${done}`, 'na safra atual', 'sprout'], ['Em andamento', `${open}`, 'estufada(s) aberta(s)', 'ellipsis'], ['Dias trabalhados', `${D.formatNumber(workDays)}`, 'meios dias somam 0,5', 'calendar-days'], ['Estufadas na semana', `${weekIds.length}`, 'com trabalho registrado', 'chart-no-axes-column-increasing'], ['A pagar', brl(owing), 'aos camaradas', 'arrow-up-right'], ['Troca a receber', `${D.formatNumber(credits)} d`, 'saldo positivo com os parceiros', 'users-round']];
    } else {
      const jobs = records.filter(D.thirdPartyRecord);
      const personallyWorked=records.filter(r=>D.thirdPartyRecord(r)&&D.userWorked(r));
      const amount = jobs.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const unpaid = jobs.filter(r => r.settlement === 'cash' && !r.paid).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      const credit = D.exchangeLedger(data.records).reduce((sum,item)=>sum+Math.max(0,item.balance),0);
      const workedDays=D.sumDays(personallyWorked);
      const stufasDone=D.externalStufaTotals(jobs);
      cards = [['Dias que trabalhei para patrões', `${D.formatNumber(workedDays)}`, 'meios dias somam 0,5', 'calendar-days'], ['Estufadas para patrões', `${D.formatNumber(stufasDone)}`, 'frações somadas separadas dos dias', 'sprout'], ['Valor registrado', brl(amount), 'serviços lançados', 'arrow-up-right'], ['A receber', brl(unpaid), 'do contratante', 'ellipsis'], ['Troca a receber', `${D.formatNumber(credit)} d`, 'saldo positivo com os parceiros', 'users-round']];
    }
    cards.unshift(['Dias trabalhados por Eros', D.formatNumber(D.personalWorkDays(records)), 'safra atual · patrões + nossa colheita', 'users-round']);
    $('#summary-cards').innerHTML = cards.map(([label, value, hint, iconName]) => `<article class="stat-card"><span class="stat-icon">${icon(iconName,15)}</span><span class="stat-label">${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join('');
  }

  function renderDayRecords() {
    const entries = recordsOn(selectedDate);
    $('#selected-day-title').textContent = fmtDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' });
    const stufas = unique(entries.filter(D.familyRecord).map(r => r.stufaId).filter(Boolean)).length;
    $('#selected-day-subtitle').textContent = entries.length ? `${entries.length} ${entries.length === 1 ? 'registro' : 'registros'}${stufas ? ` · ${stufas} estufada${stufas > 1 ? 's' : ''} em andamento` : ''}` : 'Nenhum registro neste dia.';
    if (!entries.length) { $('#day-records').innerHTML = `<div class="empty-day">Sem registros para este dia. Use <strong>Adicionar ao dia</strong> para lançar um trabalho.</div>`; return; }
    $('#day-records').innerHTML = entries.map(r => {
      const duration = r.duration === 'half' ? 'Meio dia' : 'Dia inteiro';
      let title, sub, value, status;
      const countedAsOurs = D.familyRecord(r)&&(mode==='ours'||(mode==='others'&&D.hasWorker(r,'Eros')));
      if (countedAsOurs) {
        const stufa = data.stufas.find(s => s.id === r.stufaId);
        title = stufa?.name || 'Nossa estufada';
        const payInfo = D.participantDeals(r).map(d => `${d.name}: ${d.settlement === 'exchange' ? `${Number(d.exchangeDays??dayUnits(r)).toLocaleString('pt-BR')} dia(s) em troca` : d.settlement === 'none' ? 'sem pagamento' : `${d.paid ? 'pago' : 'a pagar'} ${brl(d.amount)}`}`).join(' · ');
        sub = `${duration} · ${r.workers || 'Equipe não informada'} · ${stufa?.ownerLabel || 'Produção própria'}${payInfo ? ` · ${payInfo}` : ''}`;
        value = stufa?.status === 'done' ? 'Concluída' : 'Em andamento'; status = stufa?.status === 'done' ? 'Concluída' : 'Aberta';
      } else if(r.mode==='tractor') {
        title='Trator emprestado para Pablo';sub=`${duration} · ${r.duration==='half'?'0,5 dia':'1 dia'}${r.notes?` · ${r.notes}`:''}`;value=r.duration==='half'?'0,5 dia':'1 dia';status='Empréstimo';
      } else {
        title = r.destination || 'Trabalho';
        const settle = r.settlement === 'exchange' ? `Troca de dia com ${r.counterparty || '—'}` : r.settlement === 'none' ? 'Sem pagamento' : (r.paid ? 'Pago' : 'A receber');
        sub = `${duration} · ${r.workers || 'Equipe não informada'} · ${settle}${Number(r.stufasDone||0)?` · ${D.formatNumber(r.stufasDone)} estufada(s) concluída(s)`:''}${r.notes ? ` · ${r.notes}` : ''}`;
        value = r.settlement === 'exchange' ? `+${Number(r.exchangeDays??dayUnits(r)).toLocaleString('pt-BR')} dia(s)` : r.settlement === 'none' ? '—' : brl(r.amount); status = r.paid ? 'Pago' : settle;
      }
      const employerMarker=r.mode==='others'&&!r.alsoOurs;
      return `<article class="record-card"><div class="record-marker ${r.mode === 'ours'||r.alsoOurs ? 'ours' : r.mode==='tractor'?'tractor':employerMarker?'employer':''}" ${employerMarker?`style="--employer-hue:${employerHue(r.destination)}"`:''}></div><div class="record-main"><strong>${esc(title)}</strong><small>${esc(sub)}</small></div><div class="record-value">${esc(value)}<small>${esc(status)}</small></div><div class="record-actions"><button class="record-action" data-edit="${r.id}" aria-label="Editar registro">${icon('pencil',16)}</button><button class="record-action danger-icon" data-delete-record="${r.id}" aria-label="Excluir registro">${icon('trash-2',16)}</button></div></article>`;
    }).join('');
    $$('[data-edit]').forEach(btn => btn.addEventListener('click', () => { const r=data.records.find(x=>x.id===btn.dataset.edit); if(r)openRecord(r.date,r); }));
    $$('[data-delete-record]').forEach(btn=>btn.addEventListener('click',()=>removeRecord(btn.dataset.deleteRecord)));
  }

  function renderPickers() {
    const employers = data.people.employers;
    $('#destination-select').innerHTML = employers.map(n => `<option>${esc(n)}</option>`).join('') + '<option value="__new">＋ Adicionar pessoa…</option>';
    $('#counterparty-label select').innerHTML = unique([...data.people.workers,...data.people.employers]).map(n => `<option>${esc(n)}</option>`).join('') + '<option value="__new">＋ Adicionar pessoa…</option>';
    $('#worker-options').innerHTML = unique([...data.people.workers, ...data.people.employers]).map(n => `<option value="${esc(n)}"></option>`).join('');
    const open = data.stufas.filter(s => s.status === 'open');
    $('#stufa-select').innerHTML = open.map(s => `<option value="${s.id}">${esc(s.name)} · desde ${shortDate(s.startDate)}</option>`).join('') + '<option value="__new">＋ Começar estufada…</option>';
    $('#own-stufa-select').innerHTML='<option value="">Não vincular</option><option value="__new">＋ Começar nova estufada</option>'+open.map(s=>`<option value="${s.id}">${esc(s.name)} · desde ${shortDate(s.startDate)}</option>`).join('');
  }

  function paymentRow(name, previous = {}) {
    const row = document.createElement('div'); row.className = 'participant-row'; row.dataset.workerName = name;
    const defaultAmount = $('#record-form').elements.duration.value === 'half' ? 200 : 400;
    row.innerHTML = `<strong class="participant-name">${esc(name)}</strong><select name="participantSettlement" aria-label="Acerto de ${esc(name)}"><option value="cash">Dinheiro</option><option value="exchange">Troca</option><option value="none">Sem pagamento</option></select><input class="participant-amount" name="participantAmount" type="number" min="0" step="0.01" value="${previous.amount ?? defaultAmount}" aria-label="Valor devido a ${esc(name)}"><label class="exchange-days-wrap hidden">Crédito de troca<input class="exchange-days" name="participantExchangeDays" type="number" min="0" step="0.5" value="${previous.exchangeDays ?? dayUnits({duration:$('#record-form').elements.duration.value})}" aria-label="Crédito de troca em dias"></label><label class="paid-check"><input name="participantPaid" type="checkbox" ${previous.paid ? 'checked' : ''}> Pago</label><button type="button" class="remove-participant" aria-label="Desmarcar ${esc(name)}">×</button>`;
    const settlement = row.querySelector('[name="participantSettlement"]'); const amount = row.querySelector('[name="participantAmount"]'); const exchangeDays=row.querySelector('[name="participantExchangeDays"]'); amount.dataset.defaulted=previous.amountDefaulted===true||previous.amount===undefined?'true':'false';exchangeDays.dataset.defaulted=previous.exchangeDaysDefaulted===true||previous.exchangeDays===undefined?'true':'false';
    const normalized=name.toLocaleLowerCase('pt-BR');const familyEntry=isFamilyEntryInForm();const noPayment=familyEntry&&['eros','pai','ivonei','silvani'].includes(normalized);const isPabloExchange=familyEntry&&normalized==='pablo';
    if(noPayment){row.classList.add('no-payment-row');row.querySelector('.paid-check').classList.add('hidden');row.querySelector('.participant-amount').classList.add('hidden');}
    settlement.value=noPayment?'none':isPabloExchange?'exchange':(previous.settlement||'cash');settlement.disabled=noPayment||isPabloExchange;
    settlement.addEventListener('change',()=>{amount.disabled=noPayment||settlement.value!=='cash';amount.classList.toggle('hidden',noPayment||settlement.value!=='cash');row.querySelector('.paid-check').classList.toggle('hidden',noPayment||settlement.value!=='cash');row.querySelector('.exchange-days-wrap').classList.toggle('hidden',settlement.value!=='exchange');row.classList.toggle('exchange-row',settlement.value==='exchange');});
    row.querySelector('.remove-participant').addEventListener('click',()=>{const check=$$('#worker-checklist input[type="checkbox"]').find(input=>input.value===name);if(check)check.checked=false;row.remove();});
    $('#participant-rows').append(row);
    settlement.dispatchEvent(new Event('change'));
  }
  function isFamilyEntryInForm(){return mode==='ours'||(mode==='others'&&Boolean($('#own-stufa-select')?.value));}
  function syncFamilyFields(){
    const linked=mode==='others'&&Boolean($('#own-stufa-select').value);const family=mode==='ours'||linked;
    $('#destination-label').classList.toggle('hidden',mode!=='others'||linked);
    $('#kind-label').classList.toggle('hidden',mode!=='others'||linked);
    $('#amount-label').classList.toggle('hidden',mode!=='others'||linked||$('#record-form').elements.settlement.value!=='cash');
    $('#paid-label').classList.toggle('hidden',mode!=='others'||linked);
    $('#stufas-done-label').classList.toggle('hidden',mode!=='others'||linked);
    $('#counterparty-label').classList.toggle('hidden',mode!=='others'||linked||$('#record-form').elements.settlement.value!=='exchange');
    $('#exchange-days-label').classList.toggle('hidden',mode!=='others'||linked||$('#record-form').elements.settlement.value!=='exchange');
    $('#own-finish-label').classList.toggle('hidden',!linked);
    $('#owner-label').classList.toggle('hidden',$('#own-stufa-select').value!=='__new');
    $('#crop-label').classList.toggle('hidden',$('#own-stufa-select').value!=='__new');
    $('#size-label').classList.toggle('hidden',$('#own-stufa-select').value!=='__new');
    $('#participant-list .payments-title').classList.toggle('hidden',!family);
    $('#participant-list .helper-text').textContent=family?'Ajuste o acerto de cada camarada. Eros, Pai/Ivonei e Silvani não recebem; Pablo compensa a troca automaticamente.':'Equipe apenas informativa: sem pagamento individual neste registro.';
  }
  function refreshParticipantRows(){
    const selected=$$('#worker-checklist input:checked').map(box=>box.value);
    $$('.participant-row').forEach(row=>participantDrafts.set(workerKey(row.dataset.workerName),{settlement:row.querySelector('[name="participantSettlement"]').value,amount:row.querySelector('[name="participantAmount"]').value,amountDefaulted:row.querySelector('[name="participantAmount"]').dataset.defaulted==='true',exchangeDays:row.querySelector('[name="participantExchangeDays"]').value,exchangeDaysDefaulted:row.querySelector('[name="participantExchangeDays"]').dataset.defaulted==='true',paid:row.querySelector('[name="participantPaid"]').checked}));
    $('#participant-rows').innerHTML='';if(isFamilyEntryInForm())selected.forEach(name=>paymentRow(name,participantDrafts.get(workerKey(name))||{}));syncFamilyFields();
  }
  function renderWorkerChecklist(selected = []) {
    const roster=unique([...data.people.workers,...selected]).filter((name,index,all)=>all.findIndex(other=>workerKey(other)===workerKey(name))===index);
    $('#worker-checklist').innerHTML = roster.map(name=>`<label class="worker-check"><input type="checkbox" value="${esc(name)}" ${selected.includes(name)?'checked':''}><span>${esc(name)}</span></label>`).join('');
    $('#worker-checklist').querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{
      refreshParticipantRows();
    }));
  }
  function setupWorkerPicker(){
    const section=$('#participant-list');const heading=$('.participant-heading',section);const search=$('#worker-search');const checklist=$('#worker-checklist');const picker=document.createElement('div');picker.id='worker-picker';picker.className='full-width';picker.append(heading,search,checklist);section.before(picker);const paymentsTitle=document.createElement('div');paymentsTitle.className='payments-title';paymentsTitle.textContent='Acerto individual de cada camarada';section.prepend(paymentsTitle);
  }
  setupWorkerPicker();

  function openRecord(date = selectedDate, record = null) {
    const dialog = $('#record-dialog');
    const form = $('#record-form');
    if(record){mode=record.mode;$$('.mode-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$$('.nav-item[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));const label=mode==='others'?'Para outras pessoas':mode==='ours'?'Nossa colheita':'Trator do Pablo';$('#crumb-view').textContent=label;$('#page-title').textContent=label;}
    editingId = record?.id || null;participantDrafts=new Map();
    form.reset(); form.elements.date.value = date; form.elements.duration.value = 'full';form.elements.exchangeDays.value=1;form.elements.exchangeDays.dataset.defaulted='true';
    $('#dialog-title').textContent = record ? 'Editar registro' : mode==='tractor' ? 'Registrar empréstimo do trator' : mode === 'ours' ? 'Registrar dia de colheita' : 'Registrar trabalho';
    $('#destination-label').classList.toggle('hidden', mode === 'ours');
    $('#stufa-label').classList.toggle('hidden', mode !== 'ours');
    $('#own-link-label').classList.toggle('hidden', mode !== 'others');
    $('#own-finish-label').classList.add('hidden');
    $('#kind-label').classList.toggle('hidden', mode === 'ours');
    $('#amount-label').classList.toggle('hidden', mode === 'ours');
    $('#paid-label').classList.toggle('hidden', mode === 'ours');
    $('#kind-label').classList.toggle('hidden', mode !== 'others');
    $('#amount-label').classList.toggle('hidden', mode !== 'others');
    $('#paid-label').classList.toggle('hidden', mode !== 'others');
    $('#stufas-done-label').classList.toggle('hidden',mode!=='others');
    $('#exchange-days-label').classList.add('hidden');
    $('#others-workers-label').classList.add('hidden');
    $('#participant-list').classList.toggle('hidden', mode === 'tractor');
    $('#worker-picker').classList.toggle('hidden',mode==='tractor');
    $('#destination-label').classList.toggle('hidden',mode!=='others');
    $('#counterparty-label').classList.add('hidden');
    $('#delete-record').classList.toggle('hidden',!record);
    $('#participant-rows').innerHTML = '';
    const selectedWorkers=record?D.workerNames(record):mode==='others'?['Eros']:[];
    if(record&&D.thirdPartyRecord(record)&&selectedWorkers.length===0&&record.teamConfirmed!==true)selectedWorkers.push('Eros');
    renderWorkerChecklist(selectedWorkers);
    $('#crop-label').classList.add('hidden'); $('#size-label').classList.add('hidden'); $('#owner-label').classList.add('hidden');
    if (mode === 'ours' && !record && !data.stufas.some(s => s.status === 'open')) { dialog.close(); openStufa(date); return; }
    renderPickers();
    if (record) {
      form.elements.date.value=record.date; form.elements.duration.value=record.duration; form.elements.notes.value=record.notes||'';
      if(record.mode==='others') { form.elements.destination.value=record.destination; form.elements.settlement.value=record.settlement; form.elements.amount.value=record.amount||''; form.elements.paid.value=record.paid?'yes':'no'; form.elements.stufasDone.value=record.stufasDone||0;form.elements.counterparty.value=record.counterparty||record.destination||data.people.workers[0]||'';form.elements.exchangeDays.value=record.exchangeDays??dayUnits(record);form.elements.exchangeDays.dataset.defaulted=record.exchangeDays===undefined?'true':'false';form.elements.ownStufaId.value=D.familyRecord(record)&&record.mode==='others'?record.stufaId:'';const linkedStufa=data.stufas.find(s=>s.id===record.stufaId);if(linkedStufa&&D.familyRecord(record)&&record.mode==='others'&&!$(`#own-stufa-select option[value="${record.stufaId}"]`))$('#own-stufa-select').insertAdjacentHTML('beforeend',`<option value="${linkedStufa.id}">${esc(linkedStufa.name)} · ${linkedStufa.status==='done'?'concluída':'em andamento'}</option>`);form.elements.ownStufaFinish.value=linkedStufa?.status||'open';$('#own-finish-label').classList.toggle('hidden',!(D.familyRecord(record)&&record.mode==='others')); }
      if(record.mode==='tractor')form.elements.duration.value=record.duration;
      else if(record.mode==='ours') { const stufa=data.stufas.find(s=>s.id===record.stufaId);if(stufa&&!$(`#stufa-select option[value="${record.stufaId}"]`))$('#stufa-select').insertAdjacentHTML('afterbegin',`<option value="${stufa.id}">${esc(stufa.name)} · ${stufa.status==='done'?'concluída':'em andamento'}</option>`);form.elements.stufaId.value=record.stufaId; }
      if(D.familyRecord(record)){const deals=D.participantDeals(record);$('#participant-rows').innerHTML='';deals.forEach(d=>{participantDrafts.set(workerKey(d.name),d);paymentRow(d.name,d);});}
      if(record.mode==='others'){const trade=record.settlement==='exchange',none=record.settlement==='none';$('#counterparty-label').classList.toggle('hidden',!trade);$('#exchange-days-label').classList.toggle('hidden',!trade);$('#amount-label').classList.toggle('hidden',trade||none);}
    }
    syncFamilyFields();
    dialog.showModal();
  }

  async function removeRecord(recordId){const record=data.records.find(r=>r.id===recordId);if(!record)return;if(!confirm('Excluir este registro antigo? Essa ação não pode ser desfeita.'))return;data.records=data.records.filter(r=>r.id!==recordId);if(record.stufaId){const stufa=data.stufas.find(s=>s.id===record.stufaId);const hasSameDay=data.records.some(r=>r.stufaId===record.stufaId&&r.date===record.date);if(stufa&&!hasSameDay)stufa.workDates=stufa.workDates.filter(d=>d!==record.date);if(record.createdStufaByRecord&&!data.records.some(r=>r.stufaId===record.stufaId)){data.stufas=data.stufas.filter(s=>s.id!==record.stufaId);}}await persist();$('#record-dialog').close();editingId=null;render();showToast('Registro excluído');}

  function openStufa(date = selectedDate) { $('#stufa-form').reset(); $('#stufa-form').elements.date.value = date; $('#stufa-dialog').showModal(); }

  function exchangeLedger(){
    return D.exchangeLedger(data.records);
  }

  function workerHistory(name){
    const key=n=>['pai','ivonei'].includes(String(n||'').trim().toLocaleLowerCase('pt-BR'))?'ivonei':String(n||'').trim().toLocaleLowerCase('pt-BR');
    return data.records.filter(r=>D.hasWorker(r,name)||(D.thirdPartyRecord(r)&&D.workerNames(r).length===0&&r.teamConfirmed!==true&&key(name)==='eros')).sort((a,b)=>a.date.localeCompare(b.date));
  }

  function workerProfileMarkup(name){
    const personKey=n=>workerKey(n);const entries=workerHistory(name);const dayTotal=entries.reduce((sum,r)=>sum+dayUnits(r),0);const ownStufas=unique(entries.filter(D.familyRecord).map(r=>r.stufaId).filter(Boolean));
    const rows=entries.map(r=>{
      const deal=D.familyRecord(r)?D.participantDeals(r).find(d=>personKey(d.name)===personKey(name)):null;
      const stufa=data.stufas.find(s=>s.id===r.stufaId);
      const context=r.mode==='tractor'?'Trator · Pablo':D.familyRecord(r)?`${stufa?.name||'Nossa estufada'} · ${stufa?.ownerLabel||''}`:r.destination||'Trabalho';
      const detail=D.thirdPartyRecord(r)&&Number(r.stufasDone||0)?` · ${D.formatNumber(r.stufasDone)} estufada(s) concluída(s)`:'';
      const pay=D.thirdPartyRecord(r)?'Informativo':r.mode==='tractor'?'—':deal?deal.settlement==='exchange'?`Troca · ${D.formatNumber(deal.exchangeDays??dayUnits(r))} dia(s)`:deal.settlement==='none'?'Sem pagamento':deal.paid?'Pago':`Pendente ${brl(deal.amount)}`:'Sem acerto individual';
      const canToggle=D.familyRecord(r)&&deal?.settlement==='cash';
      return `<tr><td>${shortDate(r.date)}</td><td>${esc(context+detail)}</td><td>${r.duration==='half'?'Meio dia':'Dia inteiro'}</td><td>${esc(stufa?.size||'—')}</td><td>${esc(pay)}</td><td>${canToggle?`<button class="quick-paid ${deal.paid?'is-paid':''}" data-profile-toggle="${r.id}" data-worker="${esc(name)}">${deal.paid?'Marcar pendente':'Marcar pago'}</button>`:''}<button class="profile-edit" data-profile-edit="${r.id}" aria-label="Editar registro">${icon('pencil',14)}</button></td></tr>`;
    }).join('');
    return `<details class="worker-profile"><summary><span><strong>${esc(name)}</strong><small>${entries.length} registros · ${D.formatNumber(dayTotal)} dias · ${ownStufas.length} estufadas nossas</small></span><span class="profile-chevron">⌄</span></summary><div class="profile-history">${entries.length?`<div class="profile-table-wrap"><table class="mini-table"><thead><tr><th>Data</th><th>Serviço / estufada</th><th>Período</th><th>Estufa</th><th>Pagamento</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="dialog-copy">Ainda não há dias registrados para esta pessoa.</p>'}</div></details>`;
  }

  function renderAltView() {
    const stats=$('#stats-view'),people=$('#people-view');
    if(activeView==='stats'){
      const year=D.seasonStartYear(new Date());
      const records=currentSeasonRecords();
      const jobs=records.filter(D.thirdPartyRecord);
      const ours=records.filter(D.familyRecord);
      const tractor=records.filter(r=>r.mode==='tractor');
      const stufas=D.familyStufasInSeason(data.stufas,year);
      const personalDays=D.sumDays(jobs.filter(D.userWorked));
      const totalPersonalDays=D.personalWorkDays(records);
      const serviceDays=D.sumDays(jobs);
      const ownDays=D.sumDays(ours);
      const tractorDays=D.sumDays(tractor);
      const externalStufas=D.externalStufaTotals(jobs);
      const received=jobs.filter(r=>r.paid&&r.settlement==='cash').reduce((sum,r)=>sum+(Number(r.amount)||0),0);
      const pending=jobs.filter(r=>!r.paid&&r.settlement==='cash').reduce((sum,r)=>sum+(Number(r.amount)||0),0);
      const peopleDays=D.personDays(records);
      const employerTotals=D.personalDaysByEmployer(jobs);
      const deals=ours.flatMap(D.participantDeals);
      const ownDue=deals.filter(d=>d.settlement==='cash'&&!d.paid).reduce((sum,d)=>sum+(Number(d.amount)||0),0);
      const ledger=exchangeLedger();
      const exchangeHtml=ledger.length?`<table class="mini-table"><thead><tr><th>Pessoa</th><th>A receber</th><th>Devolvido</th><th>Saldo</th></tr></thead><tbody>${ledger.map(x=>`<tr><td>${esc(x.name)}</td><td>${D.formatNumber(x.received)} d</td><td>${D.formatNumber(x.repaid)} d</td><td class="${x.balance>0?'warn':x.balance<0?'ok':''}">${D.formatNumber(x.balance)} d</td></tr>`).join('')}</tbody></table>`:'<p class="dialog-copy">As trocas aparecerão aqui com o saldo por pessoa.</p>';
      const employerRows=[...employerTotals].map(([name,x])=>`<tr><td><span class="employer-tag" style="--employer-hue:${employerHue(name)}">${esc(name)}</span></td><td>${D.formatNumber(x.days)}</td><td>${D.formatNumber(x.serviceDays)}</td><td>${D.formatNumber(x.stufas)}</td><td>${brl(x.paid)}</td><td>${brl(x.pending)}</td></tr>`).join('');
      const peopleRows=peopleDays.map(item=>`<tr><td>${esc(item.name)}</td><td>${D.formatNumber(item.days)}</td></tr>`).join('');
      const openStufas=stufas.filter(s=>s.status==='open');
      stats.innerHTML=`<div class="section-heading"><div><h3>Resumo da safra ${year} / ${year+1}</h3><p>Dias de serviço, dias que você trabalhou e estufadas usam contagens diferentes.</p></div></div><div class="stats-row">${[['Dias que trabalhei para patrões',D.formatNumber(personalDays)],['Dias trabalhados por Eros (total)',D.formatNumber(totalPersonalDays)],['Dias de serviço para patrões',D.formatNumber(serviceDays)],['Estufadas para patrões',D.formatNumber(externalStufas)],['Dias na produção da família',D.formatNumber(ownDays)],['Estufadas da família',stufas.filter(s=>s.status==='done').length],['Dias emprestados do trator',D.formatNumber(tractorDays)]].map(([label,value])=>`<article class="stat-card"><span class="stat-label">${label}</span><strong>${value}</strong></article>`).join('')}</div><div class="stats-detail"><h3>Trabalho e estufadas por patrão</h3>${employerRows?`<table class="mini-table"><thead><tr><th>Patrão</th><th>Dias que trabalhei</th><th>Dias de serviço</th><th>Estufadas</th><th>Recebido</th><th>A receber</th></tr></thead><tbody>${employerRows}</tbody></table>`:'<p class="dialog-copy">Os totais por patrão aparecem após os primeiros registros.</p>'}</div><div class="stats-detail"><h3>Pagamentos e trocas</h3><table class="mini-table"><tbody><tr><th>Recebido de patrões</th><td class="ok">${brl(received)}</td></tr><tr><th>A receber de patrões</th><td class="warn">${brl(pending)}</td></tr><tr><th>A pagar aos camaradas</th><td class="warn">${brl(ownDue)}</td></tr></tbody></table>${exchangeHtml}</div><div class="stats-detail"><h3>Estufadas em andamento</h3>${openStufas.length?openStufas.map(s=>`<div class="record-card"><div class="record-marker ours"></div><div class="record-main"><strong>${esc(s.name)}</strong><small>Iniciada em ${fmtDate(s.startDate)} · ${esc(s.ownerLabel)} · ${esc(s.size||'Tamanho não informado')}</small></div><button class="secondary-button" data-finish="${s.id}">Concluir</button></div>`).join(''):'<p class="dialog-copy">Nenhuma estufada aberta no momento.</p>'}</div><div class="stats-detail"><h3>Dias de trabalho por pessoa</h3>${peopleRows?`<table class="mini-table"><thead><tr><th>Pessoa</th><th>Dias equivalentes</th></tr></thead><tbody>${peopleRows}</tbody></table>`:'<p class="dialog-copy">Os totais aparecem conforme os registros forem lançados.</p>'}</div>`;
      $$('[data-finish]').forEach(button=>button.onclick=async()=>{const stufa=data.stufas.find(item=>item.id===button.dataset.finish);if(stufa){stufa.status='done';stufa.endDate=todayISO();await persist();render();showToast(`${stufa.name} concluída`);}});
    }else{
      const groups=[['employers','Patrões e contratantes'],['workers','Camaradas e trabalhadores'],['buyers','Compradores']];
      const seen=D.workerNames({workers:data.records.flatMap(D.workerNames)}).map(n=>workerKey(n)==='ivonei'?'Ivonei':n);
      const ledger=exchangeLedger();
      if(data.records.some(r=>r.mode==='tractor')&&!ledger.some(item=>workerKey(item.name)==='pablo'))ledger.push({name:'Pablo',received:0,repaid:0,balance:0,items:[]});
      const tradePanel=ledger.length?`<table class="mini-table"><thead><tr><th>Pessoa</th><th>Temos a receber</th><th>Devolvido</th><th>Saldo</th><th>Estufadas na relação</th><th>Trator</th></tr></thead><tbody>${ledger.map(item=>{const linkedStufas=data.records.filter(r=>D.thirdPartyRecord(r)&&[r.counterparty,r.destination].some(name=>workerKey(name)===workerKey(item.name))).reduce((sum,r)=>sum+(Number(r.stufasDone)||0),0);const tractorDays=workerKey(item.name)==='pablo'?D.sumDays(data.records.filter(r=>r.mode==='tractor')):0;return `<tr><td>${esc(item.name)}</td><td>${D.formatNumber(item.received)} d</td><td>${D.formatNumber(item.repaid)} d</td><td class="${item.balance>0?'warn':item.balance<0?'ok':''}">${D.formatNumber(item.balance)} d</td><td>${D.formatNumber(linkedStufas)}</td><td>${D.formatNumber(tractorDays)} d</td></tr>`;}).join('')}</tbody></table>${ledger.map(item=>`<details class="trade-details"><summary>${esc(item.name)} · ${D.formatNumber(item.balance)} dia(s) de saldo</summary><div class="trade-events">${item.items.map(event=>`<button data-trade-record="${event.record.id}"><span>${shortDate(event.date)} · ${event.type}</span><strong>${event.type==='A receber'?'+':'−'}${D.formatNumber(event.days)} d</strong></button>`).join('')}</div></details>`).join('')}`:'<p class="dialog-copy">As trocas aparecerão aqui com dias a receber, devolvidos e saldo individual.</p>';
      people.innerHTML=`<div class="section-heading"><div><h3>Pessoas e vínculos</h3><p>Perfis surgem automaticamente quando alguém aparece em um registro.</p></div></div>${groups.map(([key,title])=>`<div class="people-card"><h3>${title}</h3><div class="people-list">${data.people[key].map((name,index)=>`<span class="person-pill">${esc(name)} <button data-remove-person="${key}:${index}" aria-label="Remover ${esc(name)}">×</button></span>`).join('')}</div><form class="person-form" data-add-person="${key}"><input name="name" placeholder="Adicionar nome" required><button>Adicionar</button></form></div>`).join('')}<div class="stats-detail"><h3>Trocas de dias por pessoa</h3><p class="dialog-copy">Saldo positivo significa que a pessoa ainda deve dias para vocês; saldo negativo significa que vocês devem dias.</p>${tradePanel}</div><div class="stats-detail"><h3>Histórico individual dos camaradas</h3>${seen.length?seen.map(workerProfileMarkup).join(''):'<p class="dialog-copy">Os perfis aparecem assim que os primeiros dias forem lançados.</p>'}</div>`;
      $$('[data-add-person]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const key=form.dataset.addPerson;const name=form.elements.name.value.trim();if(name&&!data.people[key].some(item=>item.toLowerCase()===name.toLowerCase())){data.people[key].push(name);await persist();render();showToast(`${name} adicionado`);}}));
      $$('[data-remove-person]').forEach(button=>button.addEventListener('click',async()=>{const[key,index]=button.dataset.removePerson.split(':');const name=data.people[key][index];if(confirm(`Remover ${name} da lista? Os registros existentes serão mantidos.`)){data.people[key].splice(Number(index),1);await persist();render();}}));
      $$('[data-profile-toggle]').forEach(button=>button.addEventListener('click',async()=>{const record=data.records.find(item=>item.id===button.dataset.profileToggle);if(!record)return;record.workerDeals=D.participantDeals(record).map(({amountDefaulted,exchangeDaysDefaulted,...deal})=>deal);const deal=record.workerDeals.find(item=>workerKey(item.name)===workerKey(button.dataset.worker));if(deal){deal.paid=!deal.paid;await persist();render();}}));
      $$('[data-profile-edit]').forEach(button=>button.addEventListener('click',()=>{const record=data.records.find(item=>item.id===button.dataset.profileEdit);if(record)openRecord(record.date,record);}));
      $$('[data-trade-record]').forEach(button=>button.addEventListener('click',()=>{const record=data.records.find(item=>item.id===button.dataset.tradeRecord);if(record)openRecord(record.date,record);}));
    }
  }

  function changeMode(next) { mode=next;activeView='calendar';$$('.mode-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$$('.nav-item[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$$('.nav-item[data-view]').forEach(b=>b.classList.remove('active'));$('#calendar-view').classList.remove('hidden');$('.below-calendar').classList.remove('hidden');$('#summary-cards').classList.remove('hidden');$('#stats-view').classList.add('hidden');$('#people-view').classList.add('hidden');const heading=mode==='others'?'Para outras pessoas':mode==='ours'?'Nossa colheita':'Trator do Pablo';$('#crumb-view').textContent=heading;$('#page-title').textContent=heading;$('#page-subtitle').textContent=mode==='others'?'Dias, pessoas, pagamentos e trocas de serviço.':mode==='ours'?'Acompanhe estufadas, equipes, pagamentos e trocas.':'Anote os dias em que emprestamos o trator para o Pablo.';render(); }
  function changeView(next) {
    activeView = next;
    const calendar = next === 'calendar';
    $('#calendar-view').classList.toggle('hidden', !calendar); $('.below-calendar').classList.toggle('hidden', !calendar); $('#summary-cards').classList.toggle('hidden', !calendar);
    $('#stats-view').classList.toggle('hidden', next !== 'stats'); $('#people-view').classList.toggle('hidden', next !== 'people');
    const label = next === 'calendar' ? (mode==='others'?'Para outras pessoas':mode==='ours'?'Nossa colheita':'Trator do Pablo') : next === 'stats' ? 'Estatísticas' : 'Pessoas';
    $('#crumb-view').textContent = label; $('#page-title').textContent = label;
    $('#page-subtitle').textContent = next === 'calendar' ? (mode==='tractor'?'Anote os dias em que emprestamos o trator para o Pablo.':'Organize os dias de trabalho e acompanhe as estufadas.') : next === 'stats' ? 'Acompanhe os números importantes da safra.' : 'Gerencie patrões, camaradas e compradores.';
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === next));
    renderAltView();
  }

  function setMobileMenuOpen(open, returnFocus = false) {
    const sidebar = $('#sidebar');
    const toggle = $('#mobile-menu-toggle');
    sidebar.classList.toggle('is-open', open);
    $('#sidebar-backdrop').classList.toggle('is-visible', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    document.body.classList.toggle('menu-open', open);
    if (open) (sidebar.querySelector('.nav-item.active') || sidebar.querySelector('.nav-item'))?.focus({ preventScroll: true });
    else if (returnFocus) toggle.focus({ preventScroll: true });
  }

  function hydrateIcons() {
    $('[data-view="calendar"] .nav-item span, .nav-item[data-view="calendar"] span')?.replaceChildren();
    const targets = [
      ['.nav-item[data-mode="others"] span','arrow-up-right'], ['.nav-item[data-mode="ours"] span','sprout'], ['.nav-item[data-mode="tractor"] span','tractor'], ['.nav-item[data-view="stats"] span','chart-no-axes-column-increasing'], ['.nav-item[data-view="people"] span','users-round'],
      ['#backup-top','arrow-up-from-line'], ['#backup-open','cloud-download'], ['.top-actions .icon-button[title="Ajuda"]','circle-help'],
      ['.mode-tab[data-mode="others"] .mode-icon','arrow-up-right'], ['.mode-tab[data-mode="ours"] .mode-icon','sprout'],
      ['#prev-month','chevron-left'], ['#next-month','chevron-right'], ['.page-heading .primary-button span','plus']
    ];
    for(const [selector,name] of targets){const el=$(selector);if(el)el.innerHTML=icon(name,16);}
    $$('.close-button').forEach(el=>{el.innerHTML=icon('x',17);if(!el.hasAttribute('aria-label'))el.setAttribute('aria-label','Fechar');});
    $('#delete-record')?.prepend(document.createRange().createContextualFragment(icon('trash-2',14)));
    $('#backup-top')?.setAttribute('aria-label','Abrir backup');
    $('.top-actions .icon-button[title="Ajuda"]')?.setAttribute('aria-label','Ajuda');
  }

  $('#prev-month').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() - 1); renderCalendar(); };
  $('#next-month').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() + 1); renderCalendar(); };
  $('#today-button').onclick = () => { currentMonth = new Date(new Date().getFullYear(),new Date().getMonth(),1); selectedDate = todayISO(); render(); };
  $('#mobile-menu-toggle').addEventListener('click', () => setMobileMenuOpen(!$('#sidebar').classList.contains('is-open')));
  $('#sidebar-close').addEventListener('click', () => setMobileMenuOpen(false, true));
  $('#sidebar-backdrop').addEventListener('click', () => setMobileMenuOpen(false, true));
  $('#sidebar .brand').addEventListener('click', () => setMobileMenuOpen(false));
  $$('.sidebar .nav-item').forEach(b => b.addEventListener('click', () => setMobileMenuOpen(false)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('#sidebar').classList.contains('is-open')) setMobileMenuOpen(false, true); });
  window.addEventListener('resize', () => { if (window.innerWidth > 700 && $('#sidebar').classList.contains('is-open')) setMobileMenuOpen(false); });
  $$('.mode-tab,.nav-item[data-mode]').forEach(b => b.addEventListener('click', () => changeMode(b.dataset.mode)));
  $$('.nav-item[data-view]').forEach(b => b.addEventListener('click', () => changeView(b.dataset.view)));
  $('#add-record').onclick = () => openRecord(selectedDate);
  $('#add-day-record').onclick = () => openRecord(selectedDate);
  $('#record-form').elements.settlement.addEventListener('change', e => {
    const trade = e.target.value === 'exchange'; const none = e.target.value === 'none';
    $('#counterparty-label').classList.toggle('hidden', !trade); $('#exchange-days-label').classList.toggle('hidden',!trade); $('#amount-label').classList.toggle('hidden', trade || none);
    if(trade&&$('#record-form').elements.exchangeDays.dataset.defaulted==='true')$('#record-form').elements.exchangeDays.value=dayUnits({duration:$('#record-form').elements.duration.value});
    const currentCounterparty=$('#record-form').elements.counterparty.value.toLocaleLowerCase('pt-BR');if(trade&&['eros','pai','ivonei','silvani',''].includes(currentCounterparty))$('#record-form').elements.counterparty.value=$('#record-form').elements.destination.value;syncFamilyFields();
  });
  $('#add-participant').addEventListener('click', async () => { const n=prompt('Nome do camarada:')?.trim();if(!n)return;let savedName=data.people.workers.find(x=>x.toLowerCase()===n.toLowerCase());if(!savedName){data.people.workers.push(n);savedName=n;}renderPickers();const selected=$$('#worker-checklist input:checked').map(box=>box.value);const wasSelected=selected.includes(savedName);if(!wasSelected)selected.push(savedName);renderWorkerChecklist(selected);if(isFamilyEntryInForm()&&!wasSelected)paymentRow(savedName,participantDrafts.get(workerKey(savedName))||{});await persist();$('#worker-search').dispatchEvent(new Event('input')); });
  $('#worker-search').addEventListener('input', e => { const q=e.target.value.trim().toLocaleLowerCase('pt-BR'); $$('#worker-checklist .worker-check').forEach(row=>row.classList.toggle('hidden',!row.textContent.toLocaleLowerCase('pt-BR').includes(q))); });
  $('#record-form').elements.duration.addEventListener('change', e => {
    $$('.participant-amount').forEach(input => { if (!input.value || input.dataset.defaulted === 'true') { input.value = e.target.value === 'half' ? 200 : 400; input.dataset.defaulted = 'true'; } });
    $$('.exchange-days').forEach(input=>{if(input.dataset.defaulted==='true')input.value=dayUnits({duration:e.target.value});});
    const mainExchange=$('#record-form').elements.exchangeDays;if(mainExchange.dataset.defaulted==='true')mainExchange.value=dayUnits({duration:e.target.value});
  });
  $('#record-form').elements.destination.addEventListener('change', e => { if (e.target.value === '__new') { const n = prompt('Nome do patrão ou contratante:'); if (n?.trim()) data.people.employers.push(n.trim()); renderPickers(); $('#destination-select').value = n?.trim() || data.people.employers[0]; } });
  $('#record-form').elements.counterparty.addEventListener('change', e => { if (e.target.value === '__new') { const n = prompt('Nome da pessoa para troca:'); if (n?.trim()) data.people.workers.push(n.trim()); renderPickers(); $('#record-form').elements.counterparty.value = n?.trim() || data.people.workers[0]; } });
  $('#stufa-select').addEventListener('change', e => { if (e.target.value === '__new') { $('#record-dialog').close(); openStufa(selectedDate); } });
  $('#own-stufa-select').addEventListener('change',()=>refreshParticipantRows());
  $('#delete-record').addEventListener('click',()=>{if(editingId)removeRecord(editingId);});
  $('#record-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.currentTarget; const duration = f.elements.duration.value; const ownTarget=mode==='others'?f.elements.ownStufaId.value:'';const familyEntry=isFamilyEntryInForm();const workerNames = $$('#worker-checklist input:checked').map(box=>box.value); workerNames.forEach(n=>{ if(!data.people.workers.includes(n)) data.people.workers.push(n); });
    const workerDeals = familyEntry ? $$('.participant-row',f).map(row=>({name:row.dataset.workerName,settlement:row.querySelector('[name="participantSettlement"]').value,amount:row.querySelector('[name="participantAmount"]').value===''?(duration==='half'?200:400):Number(row.querySelector('[name="participantAmount"]').value),exchangeDays:row.querySelector('[name="participantExchangeDays"]').value===''?dayUnits({duration}):Number(row.querySelector('[name="participantExchangeDays"]').value),paid:row.querySelector('[name="participantPaid"]').checked})).filter(d=>d.name) : [];
    workerDeals.forEach(d=>{if(!data.people.workers.includes(d.name))data.people.workers.push(d.name);});
    const allWorkerNames = workerNames;
    const date=f.elements.date.value;
    if(!date){showToast('Informe uma data válida');return;}
    let stufaId=mode==='ours'?f.elements.stufaId.value:(ownTarget&&ownTarget!=='__new'?ownTarget:'');
    let createdStufaByRecord=false;
    if(mode==='ours'){
      const stufa=data.stufas.find(s=>s.id===stufaId);if(!stufa){showToast('Escolha uma estufada');return;}stufa.workDates=unique([...(stufa.workDates||[]),date]).sort();
    }else if(mode==='others'&&ownTarget==='__new'){
      const owner=f.elements.owner.value;const number=data.stufas.length+1;const stufa={id:crypto.randomUUID(),name:`Estufada ${String(number).padStart(2,'0')}`,number,startDate:date,status:f.elements.ownStufaFinish.value,owner,ownerLabel:owner==='pai'?'Pro pai':owner==='me'?'Pra mim':'Meio a meio',crop:f.elements.crop.value,size:f.elements.size.value,terrain:'',workDates:[date]};data.stufas.push(stufa);stufaId=stufa.id;createdStufaByRecord=true;
    }else if(mode==='others'&&stufaId){
      const stufa=data.stufas.find(s=>s.id===stufaId);if(stufa){stufa.workDates=unique([...(stufa.workDates||[]),date]).sort();stufa.status=f.elements.ownStufaFinish.value;const previous=data.records.find(r=>r.id===editingId);createdStufaByRecord=!!(previous?.createdStufaByRecord&&previous.stufaId===stufaId);}
    }
    const selfCounterparty=['eros','pai','ivonei','silvani'].includes(String(f.elements.counterparty.value||'').trim().toLocaleLowerCase('pt-BR'));
    const externalWork=mode==='others'&&!familyEntry;
    const record = { id: editingId||crypto.randomUUID(), date, mode, duration, destination: externalWork ? f.elements.destination.value : mode==='tractor'?'Pablo':'', settlement: externalWork ? f.elements.settlement.value : 'none', amount: externalWork ? (f.elements.amount.value===''?(duration==='half'?200:400):Number(f.elements.amount.value)) : 0, paid: externalWork && f.elements.paid.value === 'yes', counterparty: externalWork&&f.elements.settlement.value==='exchange'&&selfCounterparty?f.elements.destination.value:externalWork?f.elements.counterparty.value:'', exchangeDays:externalWork&&f.elements.settlement.value==='exchange'?(f.elements.exchangeDays.value===''?dayUnits({duration}):Number(f.elements.exchangeDays.value)):0,stufasDone:externalWork?Number(f.elements.stufasDone.value)||0:0, workers: unique(allWorkerNames).join(', '), teamConfirmed:true, workerDeals, stufaId, alsoOurs:mode==='others'&&!!stufaId, createdStufaByRecord, notes: f.elements.notes.value.trim() };
    if (record.settlement === 'exchange') record.amount = 0;
    if(editingId){const previous=data.records.find(r=>r.id===editingId);if(previous?.stufaId&&(previous.stufaId!==record.stufaId||previous.date!==record.date)){const old=data.stufas.find(s=>s.id===previous.stufaId);const hasOther=data.records.some(r=>r.id!==editingId&&r.stufaId===previous.stufaId&&r.date===previous.date);if(old&&!hasOther)old.workDates=(old.workDates||[]).filter(d=>d!==previous.date);}if(previous?.createdStufaByRecord&&previous.stufaId!==record.stufaId&&!data.records.some(r=>r.id!==editingId&&r.stufaId===previous.stufaId))data.stufas=data.stufas.filter(s=>s.id!==previous.stufaId);const i=data.records.findIndex(r=>r.id===editingId);data.records[i]={...data.records[i],...record,id:editingId};}
    else data.records.push(record);
    const wasEditing=!!editingId;await persist(); selectedDate = record.date; currentMonth = new Date(Number(record.date.slice(0,4)),Number(record.date.slice(5,7))-1,1); $('#record-dialog').close(); render(); showToast(wasEditing?'Registro atualizado':'Registro salvo'); editingId=null;
  });
  $('#stufa-form').addEventListener('submit', async e => {
    e.preventDefault(); const f=e.currentTarget; const date=f.elements.date.value; const owner=f.elements.owner.value; const n=data.stufas.length+1; const stufa={id:crypto.randomUUID(),name:`Estufada ${String(n).padStart(2,'0')}`,number:n,startDate:date,status:'open',owner:owner,ownerLabel:owner==='pai'?'Pro pai':owner==='me'?'Pra mim':'Meio a meio',crop:f.elements.crop.value,size:f.elements.size.value,terrain:f.elements.terrain.value.trim(),workDates:[]};
    data.stufas.push(stufa); await persist(); selectedDate=date; currentMonth=new Date(Number(date.slice(0,4)),Number(date.slice(5,7))-1,1); $('#stufa-dialog').close(); render(); showToast(`${stufa.name} iniciada · registre o trabalho do dia`); setTimeout(()=>openRecord(date),180);
  });
  $$('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));

  function openBackup() { $('#backup-status').textContent = `${LOCAL_FILE_API?'Arquivo local neste computador':'Armazenamento deste navegador'} · ${data.records.length} registros · ${data.stufas.length} estufadas`; $('#backup-dialog').showModal(); }
  $('#backup-open').onclick = openBackup; $('#backup-top').onclick = openBackup;
  $('#export-data').onclick = () => { const blob=new Blob([JSON.stringify({...data,exportedAt:new Date().toISOString(),schemaVersion:1},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`safra-backup-${todayISO()}.json`; a.click(); URL.revokeObjectURL(a.href); showToast('Backup baixado'); };
  $('#import-data').addEventListener('change', async e => { const file=e.target.files[0]; if(!file)return; try { const parsed=JSON.parse(await file.text()); if(!Array.isArray(parsed.records)||!Array.isArray(parsed.stufas)||!parsed.people) throw new Error('invalid'); if(!confirm(`Restaurar ${parsed.records.length} registros e ${parsed.stufas.length} estufadas? Isso substituirá os registros locais atuais.`)) return; data=normalizeData(parsed); await persist(); render(); showToast('Backup restaurado no arquivo local'); $('#backup-dialog').close(); } catch { showToast('Esse arquivo não parece ser um backup Safra válido'); } finally { e.target.value=''; } });
  async function startApp(){await restoreOfflineData();hydrateIcons();render();changeMode(mode);}
  startApp().catch(()=>{hydrateIcons();render();changeMode(mode);showToast('Não foi possível recuperar o banco local');});
})();




