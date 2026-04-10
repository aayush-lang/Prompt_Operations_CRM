import { SUPABASE_URL, SUPABASE_ANON_KEY, FROM_EMAIL } from './supabase.js';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// ── CANDIDATE STAGES ──
const STAGES = [
  'New Candidate','Interested','Not Interested','Forwarded to Client',
  'Selected Round 1','Selected Round 2','Selected Round 3',
  'Joining Date Given','Joined','Face to Face Round',
  'Profile Not Match','DNP','Follow Up Later',
  'Rejected','Feedback Pending','On Hold'
];
const STAGE_COLORS = {
  'New Candidate':'#64748B','Interested':'#10B981','Not Interested':'#EF4444',
  'Forwarded to Client':'#3B82F6','Selected Round 1':'#8B5CF6',
  'Selected Round 2':'#7C3AED','Selected Round 3':'#6D28D9',
  'Joining Date Given':'#F59E0B','Joined':'#22C55E','Face to Face Round':'#06B6D4',
  'Profile Not Match':'#F97316','DNP':'#DC2626','Follow Up Later':'#94A3B8',
  'Rejected':'#B91C1C','Feedback Pending':'#D97706','On Hold':'#6B7280'
};

const EXPERIENCE_OPTIONS = [
  'Fresher','0-1 year','1-2 years','2-3 years','3-5 years',
  '5-7 years','7-10 years','10-15 years','15+ years'
];
const DESIGNATION_OPTIONS = [
  'Intern','Junior Executive','Executive','Senior Executive',
  'Team Lead','Assistant Manager','Manager','Senior Manager',
  'Assistant General Manager','Deputy General Manager','General Manager',
  'Vice President','Senior Vice President','Director','Senior Director',
  'Chief Officer (CXO)','President','Partner','Consultant','Freelancer','Other'
];
const PROFILE_OPTIONS = [
  'Sales','Marketing','Operations','Finance','Human Resources',
  'Information Technology','Engineering','Product Management','Design',
  'Customer Support','Legal','Procurement','Supply Chain','Logistics',
  'Business Development','Strategy','Consulting','Healthcare','Education',
  'Media & Communications','Real Estate','Banking','Insurance','Other'
];
const INDIA_CITIES = [
  'Ahmedabad','Bengaluru','Bhopal','Bhubaneswar','Chandigarh','Chennai',
  'Coimbatore','Delhi','Faridabad','Ghaziabad','Gurgaon','Hyderabad',
  'Indore','Jaipur','Jodhpur','Kanpur','Kochi','Kolkata','Lucknow',
  'Ludhiana','Mangalore','Mumbai','Mysuru','Nagpur','Nashik','Noida',
  'Patna','Pune','Raipur','Rajkot','Ranchi','Surat','Thiruvananthapuram',
  'Vadodara','Varanasi','Visakhapatnam','Remote','Other'
];
const PLATFORM_OPTIONS = ['LinkedIn','Naukri','Shine','Indeed','Other'];

// Stages where only minimal fields are required
const MINIMAL_REQUIRED_STAGES = ['DNP', 'Not Interested'];

let state = {
  user:null, profile:null, profiles:[], leads:[], filteredLeads:[], reminders:[],
  tasks:[], activities:[],
  isAdmin: false,
  page:1, pageSize:20, sortCol:'created_at', sortDir:'desc',
  selectedLeads: new Set(),
  currentReminderFilter:'pending',
  editLeadId:null, editReminderId:null, editTaskId:null,
  activeView:'dashboard', filterDebounce:null,
  dashPeriod:'all', dashCustomStart:'', dashCustomEnd:'', dashAssociate:'',
  joiningMonth: '', joiningYear: new Date().getFullYear(),
};

// ── AUTH ──
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-pw').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('auth-error');
  if (!email || !pw) { showAuthError('Please enter your email and password.'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…'; errEl.style.display = 'none';
  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password: pw });
    if (error) { showAuthError(error.message || 'Invalid credentials.'); btn.disabled = false; btn.textContent = 'Sign in'; return; }
    await initApp(data.user);
  } catch(e) {
    showAuthError('Connection error. Please try again.'); btn.disabled = false; btn.textContent = 'Sign in';
  }
}
async function handleLogout() {
  await db.auth.signOut();
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  state.user = null;
}
function showAuthError(msg) { const el = document.getElementById('auth-error'); el.textContent = msg; el.style.display = 'block'; }
function showForgot() { const email = prompt('Enter your registered email:'); if (!email) return; db.auth.resetPasswordForEmail(email).then(() => alert('Password reset email sent!')); }

// ── INIT ──
async function initApp(user) {
  state.user = user;
  const { data: prof } = await db.from('profiles').select('*').eq('id', user.id).single();
  state.profile = prof;
  state.isAdmin = prof?.role === 'admin';

  document.getElementById('user-name').textContent = prof?.name?.split(' ')[0] || 'You';
  document.getElementById('user-avatar').textContent = prof?.avatar_initials || '?';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  if (state.isAdmin) document.body.classList.add('is-admin');
  else document.body.classList.remove('is-admin');

  await Promise.all([loadProfiles(), loadLeads(), loadReminders(), loadTasks(), loadActivities()]);
  renderDashboard(); renderLeads(); renderReminders(); renderTasks(); renderJoinings();
  populateSelects();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view, btn));
  });
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.col));
  });
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  checkReminderPopups();
  setInterval(checkReminderPopups, 60000);

  db.channel('recruit-changes')
    .on('postgres_changes', { event:'*', schema:'public', table:'leads' }, () => loadLeads().then(() => { renderLeads(); renderDashboard(); renderJoinings(); }))
    .on('postgres_changes', { event:'*', schema:'public', table:'reminders' }, () => loadReminders().then(renderReminders))
    .on('postgres_changes', { event:'*', schema:'public', table:'tasks' }, () => loadTasks().then(renderTasks))
    .on('postgres_changes', { event:'*', schema:'public', table:'activities' }, () => loadActivities().then(() => renderDashboard()))
    .subscribe();
}

// ── DATA LOADERS ──
async function loadProfiles() {
  const { data } = await db.from('profiles').select('*').order('name');
  if (data) state.profiles = data;
  populateAssignedSelects();
}

async function loadLeads() {
  let query = db.from('leads')
    .select('*, assigned_profiles:lead_assignees(profile:profiles(id,name,avatar_initials))')
    .order(state.sortCol, { ascending: state.sortDir === 'asc' });
  const { data, error } = await query;
  if (!error && data) {
    if (state.isAdmin) {
      state.leads = data;
    } else {
      state.leads = data.filter(l =>
        l.assigned_profiles && l.assigned_profiles.some(ap => ap.profile?.id === state.user.id)
      );
    }
    applyFilters();
  }
}

async function loadReminders() {
  let query = db.from('reminders')
    .select('*, lead:leads(name,current_company), assignee:profiles!reminders_assigned_to_fkey(name)')
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true });
  if (!state.isAdmin) query = query.or(`assigned_to.eq.${state.user.id},created_by.eq.${state.user.id}`);
  const { data } = await query;
  if (data) { state.reminders = data; updateReminderBadge(); }
}

async function loadTasks() {
  const { data, error } = await db.from('tasks')
    .select('*, assignees:task_assignees(profile:profiles(id,name,avatar_initials)), lead:leads(name,current_company), creator:profiles!tasks_created_by_fkey(name)')
    .order('created_at', { ascending: false });
  if (!error && data) {
    if (state.isAdmin) {
      state.tasks = data;
    } else {
      state.tasks = data.filter(t =>
        t.assignees && t.assignees.some(a => a.profile?.id === state.user.id)
      );
    }
  }
}

async function loadActivities() {
  const { data } = await db.from('activities').select('*').order('created_at', { ascending: true });
  if (data) state.activities = data;
}

// ── DASHBOARD ──
function getDashRange(period, customStart, customEnd) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'custom') {
    return { start: customStart ? customStart + 'T00:00:00' : null, end: customEnd ? customEnd + 'T23:59:59' : null };
  }
  let start = null;
  if (period === 'today') start = today;
  else if (period === 'week') { const d = new Date(today); d.setDate(d.getDate() - d.getDay()); start = d; }
  else if (period === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (period === 'quarter') { const q = Math.floor(now.getMonth() / 3); start = new Date(now.getFullYear(), q*3, 1); }
  return { start: start ? start.toISOString() : null, end: null };
}

function filterByPeriod(items, dateField, period, customStart, customEnd) {
  const { start, end } = getDashRange(period, customStart, customEnd);
  if (!start) return items;
  return items.filter(i => {
    if (!i[dateField]) return false;
    if (i[dateField] < start) return false;
    if (end && i[dateField] > end) return false;
    return true;
  });
}

function getChartBuckets(period) {
  const now = new Date();
  const buckets = [];
  if (period === 'today') {
    for (let h = 0; h < 24; h++) buckets.push({ label: h+':00', key: String(h).padStart(2,'0') });
  } else if (period === 'week') {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const start = new Date(); start.setDate(start.getDate() - start.getDay());
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate()+i); buckets.push({ label: days[d.getDay()], key: d.toISOString().split('T')[0] }); }
  } else if (period === 'month') {
    const dim = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    for (let d = 1; d <= dim; d++) buckets.push({ label: String(d), key: now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(d).padStart(2,'0') });
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth()/3);
    for (let m = q*3; m < q*3+3; m++) { const mn = new Date(now.getFullYear(),m,1).toLocaleDateString('en-IN',{month:'short'}); buckets.push({ label:mn, key:now.getFullYear()+'-'+String(m+1).padStart(2,'0') }); }
  } else {
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth()-i, 1); buckets.push({ label: d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}), key: d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0') }); }
  }
  return buckets;
}

function getItemKey(isoStr, period) {
  if (!isoStr) return '';
  if (period === 'today') return isoStr.substring(11,13);
  if (period === 'week' || period === 'month') return isoStr.substring(0,10);
  return isoStr.substring(0,7);
}

function renderBarChart(containerId, buckets, counts, color) {
  const max = Math.max(...Object.values(counts), 1);
  const container = document.getElementById(containerId);
  if (!container) return;
  const showEvery = buckets.length > 15 ? Math.ceil(buckets.length/10) : 1;
  let barsHtml = '';
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const val = counts[b.key] || 0;
    const h = max > 0 ? Math.round((val/max)*90) : 0;
    const showLabel = i % showEvery === 0;
    barsHtml += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">'
      +'<span style="font-size:8px;color:var(--text-2);margin-bottom:2px">'+(val>0?val:'')+'</span>'
      +'<div title="'+b.label+': '+val+'" style="width:100%;background:'+color+';border-radius:3px 3px 0 0;height:'+h+'px;min-height:'+(val>0?'2':'0')+'px;transition:height 0.3s"></div>'
      +'<span style="font-size:9px;color:var(--text-3);position:absolute;bottom:-18px;white-space:nowrap;'+(showLabel?'':'visibility:hidden')+'">'+b.label+'</span>'
      +'</div>';
  }
  container.innerHTML = '<div style="display:flex;gap:2px;margin-bottom:4px">'
    +'<div style="width:24px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding-bottom:20px">'
    +'<span style="font-size:9px;color:var(--text-3)">'+max+'</span>'
    +'<span style="font-size:9px;color:var(--text-3)">'+Math.round(max/2)+'</span>'
    +'<span style="font-size:9px;color:var(--text-3)">0</span></div>'
    +'<div style="flex:1;position:relative">'
    +'<div style="position:absolute;top:0;left:0;right:0;bottom:20px;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none">'
    +'<div style="border-top:1px dashed var(--border);width:100%"></div>'
    +'<div style="border-top:1px dashed var(--border);width:100%"></div>'
    +'<div style="border-top:1px solid var(--border);width:100%"></div></div>'
    +'<div style="display:flex;align-items:flex-end;gap:3px;height:120px;padding-bottom:20px;position:relative">'+barsHtml+'</div></div></div>';
}

function renderDashboard() {
  const period = state.dashPeriod;
  let allLeads = state.leads;
  if (state.isAdmin && state.dashAssociate) {
    allLeads = allLeads.filter(l =>
      l.assigned_profiles && l.assigned_profiles.some(ap => ap.profile?.id === state.dashAssociate)
    );
  }
  const filteredLeads = filterByPeriod(allLeads, 'created_at', period, state.dashCustomStart, state.dashCustomEnd);
  const filteredActivities = filterByPeriod(state.activities||[], 'created_at', period, state.dashCustomStart, state.dashCustomEnd);
  const followedUpLeadIds = new Set(filteredActivities.map(a => a.lead_id).filter(Boolean));
  const won = filteredLeads.filter(l => l.stage === 'Joined');
  const periodLabels = { today:'Today', week:'This week', month:'This month', quarter:'This quarter', all:'All time', custom:'Custom range' };

  document.getElementById('metrics-row').innerHTML =
    '<div class="metric-card"><div class="metric-label">Total Candidates</div><div class="metric-value purple">'+filteredLeads.length.toLocaleString('en-IN')+'</div><div class="metric-sub">'+periodLabels[period]+'</div></div>'
    +'<div class="metric-card"><div class="metric-label">Followed Up</div><div class="metric-value" style="color:var(--blue)">'+followedUpLeadIds.size.toLocaleString('en-IN')+'</div><div class="metric-sub">Candidates with activity</div></div>'
    +'<div class="metric-card"><div class="metric-label">Joined</div><div class="metric-value green">'+won.length+'</div><div class="metric-sub">Successfully placed</div></div>'
    +'<div class="metric-card"><div class="metric-label">Forwarded to Client</div><div class="metric-value amber">'+filteredLeads.filter(l=>l.stage==='Forwarded to Client').length+'</div><div class="metric-sub">Profiles submitted</div></div>';

  const filterEl = document.getElementById('dash-period-filter');
  if (filterEl) {
    let html = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
    html += '<div class="dash-period-tabs">';
    ['today','week','month','quarter','all','custom'].forEach(p => {
      html += '<button class="dash-period-btn '+(period===p?'active':'')+'" onclick="setDashPeriod(\''+p+'\')">'+periodLabels[p]+'</button>';
    });
    html += '</div>';
    if (period === 'custom') {
      html += '<div style="display:flex;gap:8px;align-items:center;margin-left:8px">'
        +'<input type="date" id="dash-custom-start" value="'+state.dashCustomStart+'" onchange="setDashCustomRange()" style="padding:5px 8px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:12px;background:var(--surface);color:var(--text-1)">'
        +'<span style="font-size:12px;color:var(--text-3)">to</span>'
        +'<input type="date" id="dash-custom-end" value="'+state.dashCustomEnd+'" onchange="setDashCustomRange()" style="padding:5px 8px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:12px;background:var(--surface);color:var(--text-1)">'
        +'</div>';
    }
    if (state.isAdmin) {
      const assocOpts = '<option value="">All associates</option>' + state.profiles.map(p => '<option value="'+p.id+'" '+(state.dashAssociate===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('');
      html += '<select onchange="setDashAssociate(this.value)" style="padding:5px 10px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:12px;background:var(--surface);color:var(--text-1);margin-left:8px">'+assocOpts+'</select>';
    }
    html += '</div>';
    filterEl.innerHTML = html;
  }

  const maxS = Math.max(...STAGES.map(s => filteredLeads.filter(l => l.stage===s).length), 1);
  document.getElementById('stage-bars').innerHTML = STAGES.map(s => {
    const c = filteredLeads.filter(l => l.stage===s).length;
    return '<div class="stage-bar-row"><span class="stage-bar-label">'+s+'</span><div class="stage-bar-track"><div class="stage-bar-fill" style="width:'+Math.round(c/maxS*100)+'%;background:'+STAGE_COLORS[s]+'"></div></div><span class="stage-bar-count">'+c+'</span></div>';
  }).join('');

  const profMap = {};
  filteredLeads.forEach(l => { if (l.profile) { profMap[l.profile] = (profMap[l.profile]||0)+1; } });
  document.getElementById('source-chart').innerHTML = Object.entries(profMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([s,c]) => '<div class="source-row"><span>'+s+'</span><span class="source-pill">'+c+'</span></div>').join('') || '<div class="empty-state">No profile data yet</div>';

  const buckets = getChartBuckets(period === 'custom' ? 'all' : period);
  const createdCounts = {}; buckets.forEach(b => { createdCounts[b.key]=0; });
  filteredLeads.forEach(l => { const key = getItemKey(l.created_at, period==='custom'?'all':period); if (key in createdCounts) createdCounts[key]++; });
  renderBarChart('leads-created-chart-inner', buckets, createdCounts, '#6366F1');

  const followupCounts = {}; const bucketLeadSets = {};
  buckets.forEach(b => { followupCounts[b.key]=0; bucketLeadSets[b.key]=new Set(); });
  filteredActivities.forEach(a => { if (!a.lead_id) return; const key = getItemKey(a.created_at, period==='custom'?'all':period); if (key in bucketLeadSets) bucketLeadSets[key].add(a.lead_id); });
  buckets.forEach(b => { followupCounts[b.key] = bucketLeadSets[b.key].size; });
  renderBarChart('leads-followup-chart-inner', buckets, followupCounts, '#10B981');

  const today = new Date().toISOString().split('T')[0];
  const due = allLeads.filter(l => l.followup_date === today);
  document.getElementById('followups-today').innerHTML = due.length ? due.slice(0,5).map(l =>
    '<div class="followup-row"><div><div class="followup-name">'+esc(l.name)+'</div><div class="followup-company">'+esc(l.current_company||'')+'</div></div><button class="btn-sm" onclick="openLeadDetail(\''+l.id+'\')">View</button></div>'
  ).join('') : '<div class="empty-state"><div class="empty-state-icon">✓</div>No follow-ups today</div>';

  const perfEl = document.getElementById('team-perf');
  if (perfEl) {
    if (state.isAdmin) {
      const perfMap = {};
      filteredLeads.forEach(l => {
        if (!l.assigned_profiles) return;
        l.assigned_profiles.forEach(ap => {
          const name = ap.profile?.name || 'Unknown';
          if (!perfMap[name]) perfMap[name] = { total:0, joined:0, forwarded:0 };
          perfMap[name].total++;
          if (l.stage === 'Joined') perfMap[name].joined++;
          if (l.stage === 'Forwarded to Client') perfMap[name].forwarded++;
        });
      });
      perfEl.innerHTML = Object.entries(perfMap).sort((a,b)=>b[1].total-a[1].total).map(([name,p]) =>
        '<div class="team-row"><span style="font-weight:500">'+name+'</span><div class="team-stats">'
        +'<div class="team-stat"><div class="team-stat-num">'+p.total+'</div><div class="team-stat-lbl">Total</div></div>'
        +'<div class="team-stat"><div class="team-stat-num">'+p.forwarded+'</div><div class="team-stat-lbl">Forwarded</div></div>'
        +'<div class="team-stat"><div class="team-stat-num">'+p.joined+'</div><div class="team-stat-lbl">Joined</div></div>'
        +'</div></div>'
      ).join('') || '<div class="empty-state">Assign candidates to see stats</div>';
    } else {
      perfEl.closest('.dash-card')?.style && (perfEl.closest('.dash-card').style.display = 'none');
    }
  }
}

function setDashPeriod(period) { state.dashPeriod = period; renderDashboard(); }
function setDashCustomRange() {
  const s = document.getElementById('dash-custom-start'); const e = document.getElementById('dash-custom-end');
  if (s) state.dashCustomStart = s.value; if (e) state.dashCustomEnd = e.value;
  renderDashboard();
}
function setDashAssociate(val) { state.dashAssociate = val; renderDashboard(); }

// ── JOININGS TAB ──
function renderJoinings() {
  const el = document.getElementById('joinings-list');
  if (!el) return;

  const joined = state.leads.filter(l => l.stage === 'Joined');

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();

  const monthSel = document.getElementById('joining-month');
  const yearSel = document.getElementById('joining-year');
  if (monthSel && !monthSel.innerHTML) {
    monthSel.innerHTML = '<option value="">All months</option>' + monthNames.map((m,i) => '<option value="'+(i+1)+'" '+(i+1===now.getMonth()+1?'selected':'')+'>'+m+'</option>').join('');
    state.joiningMonth = String(now.getMonth()+1);
  }
  if (yearSel && !yearSel.innerHTML) {
    const years = [];
    for (let y = now.getFullYear(); y >= now.getFullYear()-3; y--) years.push(y);
    yearSel.innerHTML = years.map(y => '<option value="'+y+'" '+(y===state.joiningYear?'selected':'')+'>'+y+'</option>').join('');
  }

  const selMonth = +(document.getElementById('joining-month')?.value || state.joiningMonth || 0);
  const selYear = +(document.getElementById('joining-year')?.value || state.joiningYear);

  let filtered = joined;
  if (selMonth && selYear) {
    filtered = joined.filter(l => {
      const d = new Date(l.updated_at || l.created_at);
      return d.getMonth()+1 === selMonth && d.getFullYear() === selYear;
    });
  }

  const byAssoc = {};
  filtered.forEach(l => {
    const assignees = l.assigned_profiles ? l.assigned_profiles.map(ap => ap.profile).filter(Boolean) : [];
    if (assignees.length) {
      assignees.forEach(p => {
        if (!byAssoc[p.name]) byAssoc[p.name] = [];
        byAssoc[p.name].push(l);
      });
    } else {
      if (!byAssoc['Unassigned']) byAssoc['Unassigned'] = [];
      byAssoc['Unassigned'].push(l);
    }
  });

  const totalEl = document.getElementById('joinings-total');
  if (totalEl) totalEl.textContent = filtered.length + ' joined';

  if (!filtered.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div>No joinings for this period</div></div>';
    return;
  }

  el.innerHTML = Object.entries(byAssoc).map(([assoc, leads]) =>
    '<div class="joining-group">'
    +'<div class="joining-group-header"><span class="joining-assoc-name">'+esc(assoc)+'</span><span class="joining-assoc-count">'+leads.length+' joined</span></div>'
    +'<table class="data-table" style="margin-bottom:0">'
    +'<thead><tr><th>Name</th><th>Company Applied For</th><th>Designation</th><th>Profile</th><th>Joining Salary</th><th>Location</th><th>Date</th></tr></thead>'
    +'<tbody>'+leads.map(l =>
      '<tr>'
      +'<td><div class="lead-name">'+esc(l.name)+'</div></td>'
      +'<td style="font-size:12px;color:var(--text-2)">'+esc(l.current_company||'—')+'</td>'
      +'<td style="font-size:12px">'+esc(l.designation||'—')+'</td>'
      +'<td style="font-size:12px">'+esc(l.profile||'—')+'</td>'
      +'<td style="font-size:12px;font-family:\'JetBrains Mono\',monospace">'+(l.joining_salary?'₹'+formatINR(+l.joining_salary):'—')+'</td>'
      +'<td style="font-size:12px;color:var(--text-3)">'+esc(l.location||'—')+'</td>'
      +'<td style="font-size:12px;color:var(--text-3)">'+(l.updated_at?formatDate(l.updated_at.split('T')[0]):'—')+'</td>'
      +'</tr>'
    ).join('')+'</tbody></table></div>'
  ).join('');
}

function exportJoiningsCSV() {
  if (!state.isAdmin) { alert('Only admins can export this report.'); return; }
  const joined = state.leads.filter(l => l.stage === 'Joined');
  const selMonth = +(document.getElementById('joining-month')?.value || 0);
  const selYear = +(document.getElementById('joining-year')?.value || state.joiningYear);
  let filtered = joined;
  if (selMonth && selYear) {
    filtered = joined.filter(l => {
      const d = new Date(l.updated_at || l.created_at);
      return d.getMonth()+1 === selMonth && d.getFullYear() === selYear;
    });
  }
  const headers = ['Name','Phone','Email','Company Applied For','Designation','Profile','Location','Joining Salary','Associate','Joined Date'];
  const rows = filtered.map(l => {
    const assignees = l.assigned_profiles ? l.assigned_profiles.map(ap => ap.profile?.name).filter(Boolean).join('; ') : '';
    return [l.name,l.phone,l.email,l.current_company,l.designation,l.profile,l.location,l.joining_salary||'',assignees,l.updated_at?.split('T')[0]||'']
      .map(v => '"'+(v||'').toString().replace(/"/g,'""')+'"').join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'joinings_'+selYear+(selMonth?'_'+String(selMonth).padStart(2,'0'):'')+'.csv';
  a.click();
}

// ── SELECTS ──
function populateSelects() {
  const fstage = document.getElementById('f-stage');
  if (fstage) fstage.innerHTML = '<option value="">All stages</option>' + STAGES.map(s => '<option>'+s+'</option>').join('');
  const fprofile = document.getElementById('f-profile');
  if (fprofile) fprofile.innerHTML = '<option value="">All profiles</option>' + PROFILE_OPTIONS.map(s => '<option>'+s+'</option>').join('');
  const floc = document.getElementById('f-location');
  if (floc) floc.innerHTML = '<option value="">All locations</option>' + INDIA_CITIES.map(c => '<option>'+c+'</option>').join('');
  const freloc = document.getElementById('f-relocation');
  if (freloc) freloc.innerHTML = '<option value="">Any relocation</option><option value="Yes">Willing to relocate</option><option value="No">Not willing</option>';

  const expEl = document.getElementById('lf-experience');
  if (expEl) expEl.innerHTML = '<option value=""></option>' + EXPERIENCE_OPTIONS.map(o => '<option>'+o+'</option>').join('');
  const desEl = document.getElementById('lf-designation');
  if (desEl) desEl.innerHTML = '<option value=""></option>' + DESIGNATION_OPTIONS.map(o => '<option>'+o+'</option>').join('');
  const profEl = document.getElementById('lf-profile');
  if (profEl) profEl.innerHTML = '<option value=""></option>' + PROFILE_OPTIONS.map(o => '<option>'+o+'</option>').join('');
  const locEl = document.getElementById('lf-location');
  if (locEl) locEl.innerHTML = '<option value=""></option>' + INDIA_CITIES.map(c => '<option>'+c+'</option>').join('');
  const platEl = document.getElementById('lf-platform');
  if (platEl) platEl.innerHTML = '<option value=""></option>' + PLATFORM_OPTIONS.map(o => '<option>'+o+'</option>').join('');
  ['lf-relocate','lf-remote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<option value=""></option><option>Yes</option><option>No</option>';
  });
  const lfstage = document.getElementById('lf-stage');
  if (lfstage) lfstage.innerHTML = STAGES.map(s => '<option>'+s+'</option>').join('');
  const bstage = document.getElementById('bulk-stage');
  if (bstage) bstage.innerHTML = '<option value="">Move to stage…</option>' + STAGES.map(s => '<option>'+s+'</option>').join('');
}

function populateAssignedSelects() {
  const opts = state.profiles.map(p => '<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
  const rfAssigned = document.getElementById('rf-assigned');
  if (rfAssigned) rfAssigned.innerHTML = '<option value="">Unassigned</option>'+opts;
  const tl = document.getElementById('team-list');
  if (tl) tl.innerHTML = state.profiles.map(p =>
    '<div class="team-member-row"><div class="tm-info"><div class="tm-avatar">'+(p.avatar_initials||'?')+'</div><div><div style="font-weight:500">'+esc(p.name)+'</div><div style="font-size:11px;color:var(--text-3)">'+esc(p.email)+'</div></div></div><span class="tm-role">'+p.role+'</span></div>'
  ).join('');
  const baSelect = document.getElementById('bulk-assign-select');
  if (baSelect) baSelect.innerHTML = '<option value="">Select associate…</option>'+opts;
  const fAssigned = document.getElementById('f-assigned');
  if (fAssigned) fAssigned.innerHTML = '<option value="">All members</option>'+opts;
}

// ── VIEW SWITCH ──
function switchView(viewName, btn) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-'+viewName)?.classList.add('active');
  btn?.classList.add('active');
  state.activeView = viewName;
  if (viewName === 'pipeline') renderKanban();
  if (viewName === 'tasks') renderTasks();
  if (viewName === 'joinings') renderJoinings();
  if (viewName === 'settings') loadProfiles().then(() => populateAssignedSelects());
}

// ── FILTERS ──
function applyFilters() {
  const q = (document.getElementById('search-q')?.value||'').toLowerCase();
  const stage = document.getElementById('f-stage')?.value||'';
  const profile = document.getElementById('f-profile')?.value||'';
  const location = document.getElementById('f-location')?.value||'';
  const relocation = document.getElementById('f-relocation')?.value||'';
  const assigned = document.getElementById('f-assigned')?.value||'';
  const ctcMin = +(document.getElementById('f-ctc-min')?.value||0);
  const ctcMax = +(document.getElementById('f-ctc-max')?.value||0);
  const dateFrom = document.getElementById('f-date-from')?.value||'';
  const dateTo = document.getElementById('f-date-to')?.value||'';

  state.filteredLeads = state.leads.filter(l => {
    if (q && !(l.name+' '+(l.current_company||'')+(l.email||'')+(l.phone||'')).toLowerCase().includes(q)) return false;
    if (stage && l.stage !== stage) return false;
    if (profile && l.profile !== profile) return false;
    if (location && l.location !== location) return false;
    if (relocation && l.willing_to_relocate !== relocation) return false;
    if (assigned) {
      const hasAssignee = l.assigned_profiles && l.assigned_profiles.some(ap => ap.profile?.id === assigned);
      if (!hasAssignee) return false;
    }
    if (ctcMin > 0 && (+l.current_ctc||0) < ctcMin) return false;
    if (ctcMax > 0 && (+l.current_ctc||0) > ctcMax) return false;
    if (dateFrom && l.created_at && l.created_at.split('T')[0] < dateFrom) return false;
    if (dateTo && l.created_at && l.created_at.split('T')[0] > dateTo) return false;
    return true;
  });
  state.page = 1;
  state.selectedLeads.clear();
  renderLeads();
}
function debounceFilter() { clearTimeout(state.filterDebounce); state.filterDebounce = setTimeout(applyFilters, 250); }
function clearFilters() {
  ['search-q','f-stage','f-profile','f-location','f-relocation','f-assigned','f-ctc-min','f-ctc-max','f-date-from','f-date-to'].forEach(id => { const el = document.getElementById(id); if (el) el.value=''; });
  applyFilters();
}
function handleSort(col) {
  if (state.sortCol === col) state.sortDir = state.sortDir==='asc'?'desc':'asc';
  else { state.sortCol = col; state.sortDir = 'asc'; }
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.dataset.col === col) th.classList.add(state.sortDir==='asc'?'sort-asc':'sort-desc');
  });
  loadLeads().then(renderLeads);
}

// ── RENDER LEADS TABLE ──
function renderLeads() {
  const fl = state.filteredLeads;
  const total = fl.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const start = (state.page-1) * state.pageSize;
  const slice = fl.slice(start, start+state.pageSize);

  document.getElementById('leads-count-label').textContent = total.toLocaleString('en-IN')+' candidates'+(total !== state.leads.length?' (filtered from '+state.leads.length.toLocaleString('en-IN')+')':'');

  const tbody = document.getElementById('leads-tbody');
  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-row"><div class="empty-state-icon">🔍</div><div>No candidates found</div></td></tr>';
  } else {
    tbody.innerHTML = slice.map(l => {
      const assignees = l.assigned_profiles ? l.assigned_profiles.map(ap => ap.profile).filter(Boolean) : [];
      const assigneeHtml = assignees.length
        ? assignees.map(p => '<div class="user-avatar" style="width:20px;height:20px;font-size:9px" title="'+esc(p.name)+'">'+(p.avatar_initials||'?')+'</div>').join('')
        : '<span style="font-size:12px;color:var(--text-3)">—</span>';
      const fu = l.followup_date;
      const today = new Date().toISOString().split('T')[0];
      const fuClass = fu && fu < today ? 'color:var(--red)' : fu === today ? 'color:var(--amber)' : '';
      const stageColor = STAGE_COLORS[l.stage] || '#6366F1';
      return '<tr data-id="'+l.id+'" class="'+(state.selectedLeads.has(l.id)?'selected':'')+'">'
        +'<td><input type="checkbox" '+(state.selectedLeads.has(l.id)?'checked':'')+' onchange="toggleSelect(\''+l.id+'\',this)"/></td>'
        +'<td><div class="lead-name">'+esc(l.name)+'</div><div class="lead-company">'+esc(l.current_company||'—')+'</div></td>'
        +'<td><div class="lead-email" style="font-size:12px">'+esc(l.email||'—')+'</div><div class="lead-phone">'+esc(l.phone||'')+'</div></td>'
        +'<td><span class="stage-badge" style="background:'+stageColor+'22;color:'+stageColor+'">'+l.stage+'</span></td>'
        +'<td style="font-size:12px;color:var(--text-2)">'+esc(l.profile||'—')+'</td>'
        +'<td style="font-size:12px;color:var(--text-3)">'+esc(l.location||'—')+'</td>'
        +'<td style="font-size:12px;font-family:\'JetBrains Mono\',monospace">'+(l.current_ctc?'₹'+formatINR(+l.current_ctc):'—')+'</td>'
        +'<td><div style="display:flex;gap:3px;flex-wrap:wrap">'+assigneeHtml+'</div></td>'
        +'<td style="font-size:12px;'+fuClass+'">'+(fu?formatDate(fu):'—')+'</td>'
        +'<td style="font-size:12px;color:var(--text-3)">'+(l.created_at?formatDate(l.created_at.split('T')[0]):'—')+'</td>'
        +'<td><div style="display:flex;gap:4px"><button class="btn-sm" onclick="openLeadDetail(\''+l.id+'\')">View</button><button class="btn-sm" onclick="openEditLead(\''+l.id+'\')">Edit</button></div></td>'
        +'</tr>';
    }).join('');
  }

  const pag = document.getElementById('pagination');
  pag.innerHTML = '<span class="page-info">'+(start+1)+'–'+Math.min(start+state.pageSize,total)+' of '+total+'</span>';
  if (pages > 1) {
    pag.innerHTML += '<button class="page-btn" onclick="goPage('+(state.page-1)+')" '+(state.page===1?'disabled':'')+'>←</button>';
    for (let i = Math.max(1, state.page-2); i <= Math.min(pages, state.page+2); i++) {
      pag.innerHTML += '<button class="page-btn '+(i===state.page?'active':'')+'" onclick="goPage('+i+')">'+i+'</button>';
    }
    pag.innerHTML += '<button class="page-btn" onclick="goPage('+(state.page+1)+')" '+(state.page===pages?'disabled':'')+'>→</button>';
  }

  const bulk = document.getElementById('bulk-actions');
  const selCount = state.selectedLeads.size;
  bulk.style.display = selCount > 0 ? 'flex' : 'none';
  document.getElementById('selected-count').textContent = selCount+' selected';
  document.getElementById('select-all').checked = slice.length > 0 && slice.every(l => state.selectedLeads.has(l.id));
}

function goPage(p) { state.page = p; renderLeads(); }
function toggleSelect(id, cb) { if (cb.checked) state.selectedLeads.add(id); else state.selectedLeads.delete(id); renderLeads(); }
function toggleSelectAll(cb) {
  const fl = state.filteredLeads;
  const start = (state.page-1)*state.pageSize;
  const slice = fl.slice(start, start+state.pageSize);
  if (cb.checked) slice.forEach(l => state.selectedLeads.add(l.id));
  else slice.forEach(l => state.selectedLeads.delete(l.id));
  renderLeads();
}

async function bulkMoveStage() {
  const stage = document.getElementById('bulk-stage').value;
  if (!stage || !state.selectedLeads.size) return;
  const ids = [...state.selectedLeads];
  await db.from('leads').update({ stage, updated_at: new Date().toISOString() }).in('id', ids);
  state.selectedLeads.clear();
  await loadLeads(); renderLeads(); renderDashboard();
}

async function bulkAssign() {
  if (!state.isAdmin) return;
  const profileId = document.getElementById('bulk-assign-select').value;
  if (!profileId || !state.selectedLeads.size) { alert('Select an associate and at least one candidate.'); return; }
  const ids = [...state.selectedLeads];
  const rows = ids.map(leadId => ({ lead_id: leadId, profile_id: profileId }));
  await db.from('lead_assignees').upsert(rows, { onConflict: 'lead_id,profile_id' });
  state.selectedLeads.clear();
  await loadLeads(); renderLeads();
  alert('Assigned '+ids.length+' candidate(s).');
}

async function bulkDelete() {
  if (!state.selectedLeads.size) return;
  if (!confirm('Delete '+state.selectedLeads.size+' candidates?')) return;
  const ids = [...state.selectedLeads];
  await db.from('leads').delete().in('id', ids);
  state.selectedLeads.clear();
  await loadLeads(); renderLeads(); renderDashboard();
}

// ── MODALS ──
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function overlayClose(e, el) { if (e.target === el) el.style.display = 'none'; }

// ── LEAD FORM ──
function openAddLead() {
  state.editLeadId = null;
  document.getElementById('lead-modal-title').textContent = 'Add Candidate';
  document.getElementById('edit-lead-id').value = '';
  ['lf-name','lf-phone','lf-email','lf-current-ctc','lf-expected-ctc','lf-joining-salary','lf-current-company','lf-notes','lf-followup'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['lf-experience','lf-designation','lf-profile','lf-location','lf-relocate','lf-remote','lf-platform'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('lf-stage').value = 'New Candidate';
  openModal('add-lead-modal');
}

function openEditLead(id) {
  const l = state.leads.find(x => x.id === id); if (!l) return;
  state.editLeadId = id;
  document.getElementById('lead-modal-title').textContent = 'Edit Candidate';
  document.getElementById('edit-lead-id').value = id;
  document.getElementById('lf-name').value = l.name||'';
  document.getElementById('lf-phone').value = l.phone||'';
  document.getElementById('lf-email').value = l.email||'';
  document.getElementById('lf-current-ctc').value = l.current_ctc||'';
  document.getElementById('lf-expected-ctc').value = l.expected_ctc||'';
  document.getElementById('lf-joining-salary').value = l.joining_salary||'';
  document.getElementById('lf-current-company').value = l.current_company||'';
  document.getElementById('lf-experience').value = l.experience||'';
  document.getElementById('lf-designation').value = l.designation||'';
  document.getElementById('lf-profile').value = l.profile||'';
  document.getElementById('lf-location').value = l.location||'';
  document.getElementById('lf-relocate').value = l.willing_to_relocate||'';
  document.getElementById('lf-remote').value = l.remote_preference||'';
  document.getElementById('lf-platform').value = l.platform||'';
  document.getElementById('lf-notes').value = l.notes||'';
  document.getElementById('lf-stage').value = l.stage||'New Candidate';
  document.getElementById('lf-followup').value = l.followup_date||'';
  openModal('add-lead-modal');
}

async function saveLead() {
  const name = document.getElementById('lf-name').value.trim();
  const email = document.getElementById('lf-email').value.trim();
  const phone = document.getElementById('lf-phone').value.trim();
  const designation = document.getElementById('lf-designation').value;
  const location = document.getElementById('lf-location').value;
  const current_ctc = document.getElementById('lf-current-ctc').value;
  const experience = document.getElementById('lf-experience').value;
  const stage = document.getElementById('lf-stage').value;
  const profile = document.getElementById('lf-profile').value;
  const current_company = document.getElementById('lf-current-company').value.trim();

  const missing = [];

  // ── Always required (all stages) ──
  if (!name) missing.push('Full Name');
  if (!email) missing.push('Email ID');
  if (!phone) missing.push('Phone Number');
  if (!profile) missing.push('Profile / Function');
  if (!current_company) missing.push('Company Applied For');
  if (!stage) missing.push('Candidate Status');

  // ── Minimal stages: DNP and Not Interested — only the above 6 fields required ──
  const isMinimalStage = MINIMAL_REQUIRED_STAGES.includes(stage);

  // ── All other stages require these additional fields ──
  if (!isMinimalStage) {
    if (!designation) missing.push('Designation');
    if (!location) missing.push('Location');
    if (!current_ctc) missing.push('Current Package');
    if (!experience) missing.push('Total Experience');
  }

  if (missing.length) {
    alert('Please fill in required fields:\n• ' + missing.join('\n• '));
    return;
  }

  const payload = {
    name, phone, email,
    current_ctc: +current_ctc||null,
    expected_ctc: +document.getElementById('lf-expected-ctc').value||null,
    joining_salary: +document.getElementById('lf-joining-salary').value||null,
    current_company,
    experience, designation,
    profile,
    location,
    willing_to_relocate: document.getElementById('lf-relocate').value,
    remote_preference: document.getElementById('lf-remote').value,
    platform: document.getElementById('lf-platform').value,
    notes: document.getElementById('lf-notes').value,
    stage,
    followup_date: document.getElementById('lf-followup').value||null,
    updated_at: new Date().toISOString()
  };

  const editId = state.editLeadId;
  if (editId) {
    const old = state.leads.find(l => l.id === editId);
    const { error: updateError } = await db.from('leads').update(payload).eq('id', editId);
    if (updateError) { alert('Failed to update candidate:\n' + updateError.message); return; }
    if (old && old.stage !== payload.stage) {
      await db.from('activities').insert({ lead_id: editId, user_id: state.user.id, type:'stage_change', text:'Stage changed from '+old.stage+' to '+payload.stage });
    } else {
      await db.from('activities').insert({ lead_id: editId, user_id: state.user.id, type:'edit', text:'Candidate updated' });
    }
  } else {
    payload.created_by = state.user.id;
    const { data, error: insertError } = await db.from('leads').insert(payload).select().single();
    if (insertError) {
      alert('Failed to save candidate. Please check the following:\n\n' + insertError.message + '\n\nIf this keeps happening, contact your admin.');
      return;
    }
    if (data) {
      await db.from('activities').insert({ lead_id: data.id, user_id: state.user.id, type:'created', text:'Candidate added' });
      if (!state.isAdmin) {
        await db.from('lead_assignees').insert({ lead_id: data.id, profile_id: state.user.id });
      }
    }
  }
  closeModal('add-lead-modal');
  await loadLeads(); await loadActivities();
  renderLeads(); renderDashboard(); renderJoinings();
  if (state.activeView === 'pipeline') renderKanban();
}

async function deleteLead(id) {
  if (!confirm('Delete this candidate?')) return;
  await db.from('leads').delete().eq('id', id);
  document.getElementById('lead-detail-overlay').style.display = 'none';
  await loadLeads(); renderLeads(); renderDashboard(); renderJoinings();
  if (state.activeView === 'pipeline') renderKanban();
}

// ── LEAD DETAIL PANEL ──
async function openLeadDetail(id) {
  const l = state.leads.find(x => x.id === id); if (!l) return;
  const { data: acts } = await db.from('activities').select('*, user:profiles(name,avatar_initials)').eq('lead_id', id).order('created_at', { ascending: false });
  const stageColor = STAGE_COLORS[l.stage] || '#6366F1';
  const assignees = l.assigned_profiles ? l.assigned_profiles.map(ap => ap.profile).filter(Boolean) : [];

  const actsHtml = (acts||[]).map(a =>
    '<div class="activity-item"><div class="activity-dot '+a.type+'"></div><div class="activity-content"><div class="activity-text">'+(a.type==='comment'?'💬 ':'')+esc(a.text)+'</div><div class="activity-author">'+(a.user?.name||'System')+' · '+formatDateTime(a.created_at)+'</div></div></div>'
  ).join('') || '<div style="font-size:13px;color:var(--text-3)">No activity yet</div>';

  const stageButtons = STAGES.map(s =>
    '<button class="stage-switch-btn '+(l.stage===s?'active':'')+'" onclick="changeStageFromPanel(\''+l.id+'\',\''+s+'\')" style="'+(l.stage===s?'background:'+STAGE_COLORS[s]+';border-color:'+STAGE_COLORS[s]+';color:white':'')+'">'+s+'</button>'
  ).join('');

  const profileOpts = state.profiles.map(p => '<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
  const assignSection = state.isAdmin ? `
    <div class="panel-section">
      <div class="panel-section-title">Assign Associates</div>
      <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">Currently: ${assignees.length ? assignees.map(p=>esc(p.name)).join(', ') : 'None'}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="assign-select" style="flex:1;padding:8px 10px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text-1);font-size:13px;outline:none">
          <option value="">Select associate…</option>${profileOpts}
        </select>
        <button class="btn-primary" onclick="assignLead('${l.id}')">Add</button>
      </div>
      ${assignees.length ? '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">'+assignees.map(p=>'<span style="background:var(--purple-light);color:var(--purple);padding:3px 10px;border-radius:12px;font-size:12px;display:flex;align-items:center;gap:6px">'+esc(p.name)+'<button onclick="removeAssignee(\''+l.id+'\',\''+p.id+'\')" style="background:none;border:none;color:inherit;cursor:pointer;font-size:14px;padding:0;line-height:1">×</button></span>').join('')+'</div>' : ''}
    </div>` : '';

  document.getElementById('lead-detail-panel').innerHTML =
    '<div class="panel-header"><div>'
    +'<div style="font-size:17px;font-weight:600">'+esc(l.name)+'</div>'
    +'<div style="font-size:13px;color:var(--text-3)">'+esc(l.current_company||'')+(l.designation?' · '+esc(l.designation):'')+'</div>'
    +'<div style="margin-top:8px"><span class="stage-badge" style="background:'+stageColor+'22;color:'+stageColor+'">'+l.stage+'</span></div>'
    +'</div><button class="modal-close" onclick="document.getElementById(\'lead-detail-overlay\').style.display=\'none\'">✕</button></div>'
    +'<div class="panel-section"><div class="panel-section-title">Contact & Profile</div><div class="info-grid">'
    +'<div class="info-field"><div class="info-label">Phone</div><div class="info-value">'+esc(l.phone||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Email</div><div class="info-value" style="font-size:12px">'+esc(l.email||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Profile</div><div class="info-value">'+esc(l.profile||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Designation</div><div class="info-value">'+esc(l.designation||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Experience</div><div class="info-value">'+esc(l.experience||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Location</div><div class="info-value">'+esc(l.location||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Current CTC</div><div class="info-value" style="font-family:\'JetBrains Mono\',monospace">'+(l.current_ctc?'₹'+formatINR(+l.current_ctc):'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Expected CTC</div><div class="info-value" style="font-family:\'JetBrains Mono\',monospace">'+(l.expected_ctc?'₹'+formatINR(+l.expected_ctc):'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Joining Salary</div><div class="info-value" style="font-family:\'JetBrains Mono\',monospace">'+(l.joining_salary?'₹'+formatINR(+l.joining_salary):'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Relocate?</div><div class="info-value">'+esc(l.willing_to_relocate||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Remote?</div><div class="info-value">'+esc(l.remote_preference||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Platform</div><div class="info-value">'+esc(l.platform||'—')+'</div></div>'
    +'<div class="info-field"><div class="info-label">Company Applied For</div><div class="info-value">'+esc(l.current_company||'—')+'</div></div>'
    +'</div>'+(l.notes?'<div style="margin-top:10px;font-size:13px;color:var(--text-2);background:var(--surface-2);padding:10px;border-radius:var(--radius-sm)">'+esc(l.notes)+'</div>':'')+'</div>'
    +'<div class="panel-section"><div class="panel-section-title">Candidate Status</div><div class="stage-switcher">'+stageButtons+'</div></div>'
    + assignSection
    +'<div class="panel-section"><div class="panel-section-title">Quick Actions</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-sm" onclick="openEditLead(\''+l.id+'\');document.getElementById(\'lead-detail-overlay\').style.display=\'none\'">Edit</button><button class="btn-sm" onclick="openReminderForLead(\''+l.id+'\')">+ Reminder</button>'+(state.isAdmin?'<button class="btn-danger-sm" onclick="deleteLead(\''+l.id+'\')">Delete</button>':'')+'</div></div>'
    +'<div class="panel-section"><div class="panel-section-title">Activity & Comments</div><div class="activity-list">'+actsHtml+'</div><div class="comment-composer"><textarea class="comment-input" id="comment-input-'+id+'" rows="2" placeholder="Add a comment or note…"></textarea><button class="btn-primary" style="align-self:flex-end" onclick="postComment(\''+id+'\')">Post</button></div></div>';

  document.getElementById('lead-detail-overlay').style.display = 'flex';
}

async function assignLead(leadId) {
  const profileId = document.getElementById('assign-select').value; if (!profileId) return;
  await db.from('lead_assignees').upsert({ lead_id: leadId, profile_id: profileId }, { onConflict: 'lead_id,profile_id' });
  const pName = state.profiles.find(p => p.id === profileId)?.name || 'someone';
  await db.from('activities').insert({ lead_id: leadId, user_id: state.user.id, type:'edit', text:'Assigned to '+pName });
  await loadLeads(); renderLeads(); openLeadDetail(leadId);
}

async function removeAssignee(leadId, profileId) {
  await db.from('lead_assignees').delete().eq('lead_id', leadId).eq('profile_id', profileId);
  await loadLeads(); renderLeads(); openLeadDetail(leadId);
}

async function changeStageFromPanel(leadId, stage) {
  const old = state.leads.find(l => l.id === leadId);
  await db.from('leads').update({ stage, updated_at: new Date().toISOString() }).eq('id', leadId);
  await db.from('activities').insert({ lead_id: leadId, user_id: state.user.id, type:'stage_change', text:'Stage changed from '+(old?.stage||'?')+' to '+stage });
  await loadLeads(); await loadActivities();
  renderLeads(); renderDashboard(); renderJoinings();
  if (state.activeView === 'pipeline') renderKanban();
  openLeadDetail(leadId);
}

async function postComment(leadId) {
  const inp = document.getElementById('comment-input-'+leadId);
  const text = inp?.value.trim(); if (!text) return;
  await db.from('activities').insert({ lead_id: leadId, user_id: state.user.id, type:'comment', text });
  inp.value = '';
  await loadActivities(); renderDashboard(); openLeadDetail(leadId);
}

// ── KANBAN ──
function renderKanban() {
  document.getElementById('kanban-board').innerHTML = STAGES.map(stage => {
    const cards = state.leads.filter(l => l.stage === stage);
    return '<div class="kanban-col" data-stage="'+stage+'" ondragover="kanbanDragOver(event,this)" ondrop="kanbanDrop(event,\''+stage+'\')" ondragleave="kanbanDragLeave(this)">'
      +'<div class="col-header"><div class="col-title-wrap"><div class="col-accent" style="background:'+STAGE_COLORS[stage]+'"></div><span class="col-name">'+stage+'</span></div><span class="col-count">'+cards.length+'</span></div>'
      +'<div class="col-cards">'+cards.map(l =>
        '<div class="kanban-card" draggable="true" data-id="'+l.id+'" ondragstart="kanbanDragStart(event,\''+l.id+'\')" ondragend="kanbanDragEnd(event)" onclick="openLeadDetail(\''+l.id+'\')">'
        +'<div class="kcard-name">'+esc(l.name)+'</div>'
        +'<div class="kcard-company">'+esc(l.current_company||'—')+'</div>'
        +'<div class="kcard-footer"><span class="kcard-value">'+esc(l.profile||'')+'</span><span class="kcard-service">'+esc(l.location||'')+'</span></div>'
        +'</div>'
      ).join('')+'</div></div>';
  }).join('');
}

let draggedLeadId = null;
function kanbanDragStart(e, id) { draggedLeadId = id; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
function kanbanDragEnd(e) { e.target.classList.remove('dragging'); }
function kanbanDragOver(e, col) { e.preventDefault(); col.classList.add('drag-target'); }
function kanbanDragLeave(col) { col.classList.remove('drag-target'); }
async function kanbanDrop(e, stage) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-target'));
  if (!draggedLeadId) return;
  const old = state.leads.find(l => l.id === draggedLeadId);
  if (old?.stage === stage) return;
  await db.from('leads').update({ stage, updated_at: new Date().toISOString() }).eq('id', draggedLeadId);
  await db.from('activities').insert({ lead_id: draggedLeadId, user_id: state.user.id, type:'stage_change', text:'Stage moved to '+stage+' via board' });
  draggedLeadId = null;
  await loadLeads(); renderKanban(); renderDashboard(); renderJoinings();
}

// ── TASKS ──
function renderTasks() {
  const list = document.getElementById('tasks-list');
  if (!list) return;
  const filter = document.getElementById('task-filter')?.value || 'open';
  let tasks = state.tasks;
  if (filter === 'open') tasks = tasks.filter(t => !t.done);
  else if (filter === 'done') tasks = tasks.filter(t => t.done);

  if (!tasks.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><div>No tasks found</div></div>';
    return;
  }
  list.innerHTML = tasks.map(t => {
    const assignees = t.assignees ? t.assignees.map(a => a.profile).filter(Boolean) : [];
    const assigneeChips = assignees.map(p =>
      '<span style="background:var(--purple-light);color:var(--purple);padding:2px 8px;border-radius:10px;font-size:11px">'+esc(p.name)+'</span>'
    ).join('');
    const today = new Date().toISOString().split('T')[0];
    const dueCls = t.due_date && t.due_date < today && !t.done ? 'color:var(--red)' : 'color:var(--text-3)';
    const canEdit = state.isAdmin;
    return '<div class="task-card '+(t.done?'task-done':'')+'">'
      +'<div class="task-card-left">'
      +'<input type="checkbox" '+(t.done?'checked':'')+' onchange="toggleTaskDone(\''+t.id+'\',this)" style="margin-top:3px;cursor:pointer">'
      +'<div style="flex:1"><div class="task-title">'+esc(t.title)+'</div>'
      +(t.notes?'<div class="task-notes">'+esc(t.notes)+'</div>':'')
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center">'
      +(t.lead?'<span style="font-size:11px;color:var(--text-3)">📋 '+esc(t.lead.name)+'</span>':'')
      +(t.due_date?'<span style="font-size:11px;'+dueCls+'">📅 '+formatDate(t.due_date)+'</span>':'')
      +(t.priority?'<span class="task-priority task-priority-'+t.priority.toLowerCase()+'">'+t.priority+'</span>':'')
      +'</div>'
      +'<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap">'+assigneeChips+'</div>'
      +'</div></div>'
      +(canEdit?'<div class="task-card-actions"><button class="btn-sm" onclick="openEditTask(\''+t.id+'\')">Edit</button><button class="btn-danger-sm" onclick="deleteTask(\''+t.id+'\')">Delete</button></div>':'')
      +'</div>';
  }).join('');
}

function openAddTask() {
  state.editTaskId = null;
  document.getElementById('task-modal-title').textContent = 'New Task';
  document.getElementById('edit-task-id').value = '';
  document.getElementById('ta-title').value = '';
  document.getElementById('ta-notes').value = '';
  document.getElementById('ta-due').value = '';
  document.getElementById('ta-priority').value = 'Medium';
  renderTaskAssigneeCheckboxes([]);
  document.getElementById('ta-lead').innerHTML = '<option value="">— No candidate —</option>'
    + state.leads.map(l => '<option value="'+l.id+'">'+esc(l.name)+(l.current_company?' — '+esc(l.current_company):'')+'</option>').join('');
  openModal('add-task-modal');
}

function openEditTask(id) {
  const t = state.tasks.find(x => x.id === id); if (!t) return;
  state.editTaskId = id;
  document.getElementById('task-modal-title').textContent = 'Edit Task';
  document.getElementById('edit-task-id').value = id;
  document.getElementById('ta-title').value = t.title||'';
  document.getElementById('ta-notes').value = t.notes||'';
  document.getElementById('ta-due').value = t.due_date||'';
  document.getElementById('ta-priority').value = t.priority||'Medium';
  document.getElementById('ta-lead').innerHTML = '<option value="">— No candidate —</option>'
    + state.leads.map(l => '<option value="'+l.id+'" '+(l.id===t.lead_id?'selected':'')+'>'+esc(l.name)+(l.current_company?' — '+esc(l.current_company):'')+'</option>').join('');
  const assignedIds = t.assignees ? t.assignees.map(a => a.profile?.id).filter(Boolean) : [];
  renderTaskAssigneeCheckboxes(assignedIds);
  openModal('add-task-modal');
}

function renderTaskAssigneeCheckboxes(selectedIds) {
  const container = document.getElementById('ta-assignees-list');
  if (!container) return;
  container.innerHTML = state.profiles.map(p =>
    '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px">'
    +'<input type="checkbox" name="task-assignee" value="'+p.id+'" '+(selectedIds.includes(p.id)?'checked':'')+'>'
    +'<div class="tm-avatar" style="width:24px;height:24px;font-size:10px">'+(p.avatar_initials||'?')+'</div>'
    +esc(p.name)+'</label>'
  ).join('');
}

async function saveTask() {
  const title = document.getElementById('ta-title').value.trim();
  if (!title) { alert('Task title is required'); return; }
  const payload = {
    title,
    notes: document.getElementById('ta-notes').value,
    due_date: document.getElementById('ta-due').value||null,
    priority: document.getElementById('ta-priority').value,
    lead_id: document.getElementById('ta-lead').value||null,
    done: false,
    updated_at: new Date().toISOString()
  };
  const checkedAssignees = [...document.querySelectorAll('input[name="task-assignee"]:checked')].map(el => el.value);
  const editId = state.editTaskId;
  let taskId;
  if (editId) {
    await db.from('tasks').update(payload).eq('id', editId);
    taskId = editId;
    await db.from('task_assignees').delete().eq('task_id', taskId);
  } else {
    payload.created_by = state.user.id;
    const { data } = await db.from('tasks').insert(payload).select().single();
    taskId = data?.id;
  }
  if (taskId && checkedAssignees.length) {
    const rows = checkedAssignees.map(pid => ({ task_id: taskId, profile_id: pid }));
    await db.from('task_assignees').insert(rows);
  }
  closeModal('add-task-modal');
  await loadTasks(); renderTasks();
}

async function toggleTaskDone(id, cb) {
  await db.from('tasks').update({ done: cb.checked, updated_at: new Date().toISOString() }).eq('id', id);
  await loadTasks(); renderTasks();
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  await db.from('tasks').delete().eq('id', id);
  await loadTasks(); renderTasks();
}

// ── REMINDERS ──
function renderReminders() {
  const today = new Date().toISOString().split('T')[0];
  const filter = state.currentReminderFilter;
  let items = state.reminders.filter(r => {
    if (filter === 'done') return r.done;
    if (filter === 'overdue') return !r.done && r.due_date < today;
    if (filter === 'today') return !r.done && r.due_date === today;
    return !r.done;
  });
  const icons = { overdue:'⚠️', today:'📅', upcoming:'🔔', done:'✅' };
  document.getElementById('reminders-list').innerHTML = items.length ? items.map(r => {
    const cls = r.done ? 'done' : r.due_date < today ? 'overdue' : r.due_date === today ? 'today' : 'upcoming';
    return '<div class="reminder-item '+cls+'"><div class="rem-icon '+cls+'">'+icons[cls]+'</div>'
      +'<div class="rem-body"><div class="rem-title">'+esc(r.title)+'</div>'
      +'<div class="rem-meta">'+formatDate(r.due_date)+' at '+r.due_time+(r.lead?' · '+esc(r.lead.name):'')+(r.assignee?' · '+esc(r.assignee.name):'')+'</div>'
      +(r.notes?'<div class="rem-notes">'+esc(r.notes)+'</div>':'')
      +'<div class="rem-actions">'+(!r.done?'<button class="btn-sm" onclick="markReminderDone(\''+r.id+'\')">✓ Done</button>':'')
      +'<button class="btn-sm" onclick="openEditReminder(\''+r.id+'\')">Edit</button>'
      +(r.lead_id?'<button class="btn-sm" onclick="openLeadDetail(\''+r.lead_id+'\')">View candidate</button>':'')
      +'<button class="btn-danger-sm" onclick="deleteReminder(\''+r.id+'\')">Delete</button></div></div></div>';
  }).join('') : '<div class="empty-state"><div class="empty-state-icon">🔔</div><div>No '+filter+' reminders</div></div>';

  document.querySelectorAll('.rem-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.rem-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentReminderFilter = btn.dataset.filter;
      renderReminders();
    };
  });
}

function updateReminderBadge() {
  const today = new Date().toISOString().split('T')[0];
  const overdue = state.reminders.filter(r => !r.done && r.due_date <= today).length;
  const badge = document.getElementById('reminder-count');
  if (badge) { if (overdue > 0) { badge.style.display = 'inline-block'; badge.textContent = overdue; } else badge.style.display = 'none'; }
}

function openAddReminder() {
  state.editReminderId = null;
  document.getElementById('reminder-modal-title').textContent = 'Add Reminder';
  document.getElementById('edit-reminder-id').value = '';
  document.getElementById('rf-title').value = '';
  document.getElementById('rf-notes').value = '';
  document.getElementById('rf-date').value = '';
  document.getElementById('rf-time').value = '10:00';
  document.getElementById('rf-lead').innerHTML = '<option value="">— none —</option>'
    + state.leads.map(l => '<option value="'+l.id+'">'+esc(l.name)+(l.current_company?' — '+esc(l.current_company):'')+'</option>').join('');
  const rfAssigned = document.getElementById('rf-assigned');
  if (rfAssigned) {
    const opts = state.profiles.map(p => '<option value="'+p.id+'" '+(p.id===state.user.id?'selected':'')+'>'+esc(p.name)+'</option>').join('');
    rfAssigned.innerHTML = '<option value="">Unassigned</option>'+opts;
  }
  openModal('add-reminder-modal');
}
function openReminderForLead(leadId) {
  openAddReminder();
  document.getElementById('rf-lead').value = leadId;
  document.getElementById('lead-detail-overlay').style.display = 'none';
}
function openEditReminder(id) {
  const r = state.reminders.find(x => x.id === id); if (!r) return;
  state.editReminderId = id;
  document.getElementById('reminder-modal-title').textContent = 'Edit Reminder';
  document.getElementById('edit-reminder-id').value = id;
  document.getElementById('rf-title').value = r.title||'';
  document.getElementById('rf-notes').value = r.notes||'';
  document.getElementById('rf-date').value = r.due_date||'';
  document.getElementById('rf-time').value = r.due_time||'10:00';
  document.getElementById('rf-lead').innerHTML = '<option value="">— none —</option>'
    + state.leads.map(l => '<option value="'+l.id+'" '+(l.id===r.lead_id?'selected':'')+'>'+esc(l.name)+(l.current_company?' — '+esc(l.current_company):'')+'</option>').join('');
  const rfAssigned = document.getElementById('rf-assigned');
  if (rfAssigned) {
    const opts = state.profiles.map(p => '<option value="'+p.id+'" '+(p.id===r.assigned_to?'selected':'')+'>'+esc(p.name)+'</option>').join('');
    rfAssigned.innerHTML = '<option value="">Unassigned</option>'+opts;
  }
  openModal('add-reminder-modal');
}
async function saveReminder() {
  const title = document.getElementById('rf-title').value.trim();
  if (!title) { alert('Title is required'); return; }
  const date = document.getElementById('rf-date').value;
  if (!date) { alert('Date is required'); return; }
  const payload = {
    title,
    lead_id: document.getElementById('rf-lead').value||null,
    assigned_to: document.getElementById('rf-assigned').value||state.user.id,
    due_date: date,
    due_time: document.getElementById('rf-time').value||'10:00',
    notes: document.getElementById('rf-notes').value,
    done: false
  };
  const editId = state.editReminderId;
  if (editId) { await db.from('reminders').update(payload).eq('id', editId); }
  else { payload.created_by = state.user.id; await db.from('reminders').insert(payload); }
  closeModal('add-reminder-modal');
  await loadReminders(); renderReminders();
}
async function markReminderDone(id) { await db.from('reminders').update({ done: true }).eq('id', id); await loadReminders(); renderReminders(); }
async function deleteReminder(id) { if (!confirm('Delete?')) return; await db.from('reminders').delete().eq('id', id); await loadReminders(); renderReminders(); }

// ── REMINDER TOAST ──
let currentPopupReminder = null;
function checkReminderPopups() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const hhmm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  const due = state.reminders.find(r => {
    if (r.done || r._popupShown) return false;
    if (r.due_date > today) return false;
    if (r.due_date < today) return true;
    return r.due_time <= hhmm;
  });
  if (!due) return;
  due._popupShown = true; currentPopupReminder = due;
  const lead = state.leads.find(l => l.id === due.lead_id);
  document.getElementById('toast-title').textContent = due.title;
  document.getElementById('toast-sub').textContent = [lead?'Candidate: '+lead.name:'', due.notes].filter(Boolean).join(' · ');
  document.getElementById('reminder-toast').style.display = 'flex';
}
function closeToast() { document.getElementById('reminder-toast').style.display = 'none'; }
async function doneReminderToast() { if (currentPopupReminder) await markReminderDone(currentPopupReminder.id); closeToast(); }
function snoozeReminder() {
  if (!currentPopupReminder) return;
  const snooze = new Date(Date.now() + 3600000); const r = currentPopupReminder;
  r._popupShown = false;
  r.due_date = snooze.toISOString().split('T')[0];
  r.due_time = String(snooze.getHours()).padStart(2,'0')+':'+String(snooze.getMinutes()).padStart(2,'0');
  db.from('reminders').update({ due_date: r.due_date, due_time: r.due_time }).eq('id', r.id);
  closeToast();
}

// ── CSV IMPORT / EXPORT ──
function exportCSV() {
  const headers = ['Name','Phone','Email','Current CTC','Expected CTC','Joining Salary','Company Applied For','Experience','Designation','Profile','Location','Willing to Relocate','Remote Preference','Platform','Stage','Follow-up Date','Created On','Notes'];
  const rows = state.leads.map(l => [
    l.name,l.phone,l.email,l.current_ctc,l.expected_ctc,l.joining_salary,l.current_company,
    l.experience,l.designation,l.profile,l.location,l.willing_to_relocate,
    l.remote_preference,l.platform,l.stage,l.followup_date,l.created_at?.split('T')[0],l.notes
  ].map(v => '"'+(v||'').toString().replace(/"/g,'""')+'"').join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'prompt_recruit_'+new Date().toISOString().split('T')[0]+'.csv';
  a.click();
}

function parseCSVLine(line) {
  const cells = []; let cur = '', inQ = false;
  for (let i = 0; i <= line.length; i++) {
    const ch = line[i];
    if (ch==='"' && !inQ) { inQ=true; }
    else if (ch==='"' && inQ && line[i+1]==='"') { cur+='"'; i++; }
    else if (ch==='"' && inQ) { inQ=false; }
    else if ((ch===',' || i===line.length) && !inQ) { cells.push(cur.trim()); cur=''; }
    else { cur+=ch||''; }
  }
  return cells;
}

function importCSV(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const lines = e.target.result.split('\n').filter(l => l.trim());
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const fieldMap = {
      name:['name','full name','candidate name'],phone:['phone','mobile','number'],
      email:['email','mail id','email address'],current_ctc:['current ctc','currentctc'],
      expected_ctc:['expected ctc','expectedctc'],joining_salary:['joining salary','joining package'],
      current_company:['current company','company','company applied for'],experience:['experience','total experience'],
      designation:['designation','title'],profile:['profile','function'],
      location:['location','city'],willing_to_relocate:['willing to relocate','relocate'],
      remote_preference:['remote preference','remote'],platform:['platform','source platform'],
      stage:['stage','status'],followup_date:['follow-up date','followup date'],notes:['notes','comments']
    };
    const colIndex = {};
    Object.entries(fieldMap).forEach(([key, aliases]) => {
      const idx = headers.findIndex(h => aliases.includes(h));
      if (idx !== -1) colIndex[key] = idx;
    });
    const rows = lines.slice(1).map(line => parseCSVLine(line));
    const toInsert = rows.filter(r => r.length >= 1 && r[colIndex.name||0]?.trim()).map(r => ({
      name:(r[colIndex.name]||'Unknown').trim(),phone:(r[colIndex.phone]!=null?r[colIndex.phone]:'').trim(),
      email:(r[colIndex.email]!=null?r[colIndex.email]:'').trim(),
      current_ctc:+((r[colIndex.current_ctc]||'').replace(/[^0-9.]/g,''))||null,
      expected_ctc:+((r[colIndex.expected_ctc]||'').replace(/[^0-9.]/g,''))||null,
      joining_salary:+((r[colIndex.joining_salary]||'').replace(/[^0-9.]/g,''))||null,
      current_company:(r[colIndex.current_company]!=null?r[colIndex.current_company]:'').trim(),
      experience:(r[colIndex.experience]!=null?r[colIndex.experience]:'').trim(),
      designation:(r[colIndex.designation]!=null?r[colIndex.designation]:'').trim(),
      profile:(r[colIndex.profile]!=null?r[colIndex.profile]:'').trim(),
      location:(r[colIndex.location]!=null?r[colIndex.location]:'').trim(),
      willing_to_relocate:(r[colIndex.willing_to_relocate]||'').trim()||null,
      remote_preference:(r[colIndex.remote_preference]||'').trim()||null,
      platform:(r[colIndex.platform]||'').trim()||null,
      stage:STAGES.includes((r[colIndex.stage]||'').trim())?(r[colIndex.stage]||'').trim():'New Candidate',
      notes:(r[colIndex.notes]!=null?r[colIndex.notes]:'').trim(),
      created_by:state.user.id
    }));
    if (!toInsert.length) { alert('No valid rows found.'); return; }
    if (!confirm('Import '+toInsert.length+' candidates?')) return;
    let imported=0, errors=0;
    for (let i=0; i<toInsert.length; i+=100) {
      const batch = toInsert.slice(i,i+100);
      const result = await db.from('leads').insert(batch);
      if (result.error) errors+=batch.length; else imported+=batch.length;
    }
    await loadLeads(); renderLeads(); renderDashboard();
    alert(errors>0?'Imported '+imported+'. '+errors+' failed.':'✓ Imported '+imported+' candidates!');
  };
  reader.readAsText(file);
  event.target.value='';
}

// ── SETTINGS ──
async function inviteTeamMember() {
  const email = document.getElementById('invite-email').value.trim(); if (!email) return;
  alert('Go to Supabase → Authentication → Users → Add user\n\nEmail: '+email);
  document.getElementById('invite-email').value='';
}

// ── HELPERS ──
function esc(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatINR(n) { if (n>=100000) return (n/100000).toFixed(1)+'L'; if (n>=1000) return (n/1000).toFixed(0)+'K'; return n.toLocaleString('en-IN'); }
function formatDate(dateStr) { if (!dateStr) return ''; const d = new Date(dateStr+'T00:00:00'); return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
function formatDateTime(isoStr) { if (!isoStr) return ''; return new Date(isoStr).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); }
function toggleAdvancedFilters() { const el=document.getElementById('advanced-filters'); if(el) el.style.display=el.style.display==='none'?'flex':'none'; }

// ── GLOBALS ──
window.handleLogin=handleLogin; window.handleLogout=handleLogout; window.showForgot=showForgot;
window.openModal=openModal; window.closeModal=closeModal; window.overlayClose=overlayClose;
window.openAddLead=openAddLead; window.openEditLead=openEditLead; window.saveLead=saveLead; window.deleteLead=deleteLead;
window.openLeadDetail=openLeadDetail; window.changeStageFromPanel=changeStageFromPanel; window.assignLead=assignLead; window.removeAssignee=removeAssignee; window.postComment=postComment;
window.openAddReminder=openAddReminder; window.openReminderForLead=openReminderForLead; window.openEditReminder=openEditReminder; window.saveReminder=saveReminder; window.markReminderDone=markReminderDone; window.deleteReminder=deleteReminder;
window.doneReminderToast=doneReminderToast; window.snoozeReminder=snoozeReminder; window.closeToast=closeToast;
window.exportCSV=exportCSV; window.importCSV=importCSV;
window.applyFilters=applyFilters; window.debounceFilter=debounceFilter; window.clearFilters=clearFilters;
window.toggleAdvancedFilters=toggleAdvancedFilters;
window.goPage=goPage; window.toggleSelect=toggleSelect; window.toggleSelectAll=toggleSelectAll;
window.bulkMoveStage=bulkMoveStage; window.bulkDelete=bulkDelete; window.bulkAssign=bulkAssign;
window.kanbanDragStart=kanbanDragStart; window.kanbanDragEnd=kanbanDragEnd; window.kanbanDragOver=kanbanDragOver; window.kanbanDragLeave=kanbanDragLeave; window.kanbanDrop=kanbanDrop;
window.setDashPeriod=setDashPeriod; window.setDashCustomRange=setDashCustomRange; window.setDashAssociate=setDashAssociate;
window.openAddTask=openAddTask; window.openEditTask=openEditTask; window.saveTask=saveTask; window.toggleTaskDone=toggleTaskDone; window.deleteTask=deleteTask; window.renderTasks=renderTasks;
window.inviteTeamMember=inviteTeamMember;
window.renderJoinings=renderJoinings; window.exportJoiningsCSV=exportJoiningsCSV;

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) { await initApp(session.user); }
})();
