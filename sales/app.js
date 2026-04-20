// ── SUPABASE CONFIG (same project as Recruit CRM) ──
const SUPABASE_URL = 'https://hsudagdnygfiggpahsit.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oY0LZlb0acdZ7S_Xqiv38A_93cIOdVO';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// ── SALES CONFIG ──
const STAGES = [
  'Fresh Lead', 'Contacted', 'Interested', 'Enquiry Received',
  'Proposal Shared', 'Negotiation', 'Closed', 'Not Interested', 'DNP'
];
const STAGE_COLORS = {
  'Fresh Lead': '#6366F1', 'Contacted': '#3B82F6', 'Interested': '#10B981',
  'Enquiry Received': '#F59E0B', 'Proposal Shared': '#8B5CF6',
  'Negotiation': '#F97316', 'Closed': '#22C55E',
  'Not Interested': '#EF4444', 'DNP': '#DC2626'
};
const SOURCES = ['LinkedIn', 'Referral', 'Website', 'WhatsApp', 'Ads', 'Cold Call', 'Email', 'Event', 'Other'];
const SERVICES = [
  'Influencer Marketing', '360° Marketing', 'Performance Marketing',
  'Social Media Management', 'SEO / Website', 'Content Production', 'Other'
];

let state = {
  user: null, profile: null, profiles: [], leads: [], filteredLeads: [],
  reminders: [], enquiries: [], activities: [],
  isAdmin: false, isSuperAdmin: false,
  page: 1, pageSize: 20, sortCol: 'created_at', sortDir: 'desc',
  selectedLeads: new Set(),
  currentReminderFilter: 'pending',
  editLeadId: null, editReminderId: null, editEnquiryId: null,
  activeView: 'dashboard', filterDebounce: null,
  dashPeriod: 'all',
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
  state.isSuperAdmin = prof?.role === 'super_admin';
  state.isAdmin = prof?.role === 'admin' || prof?.role === 'super_admin';

  document.getElementById('user-name').textContent = prof?.name?.split(' ')[0] || 'You';
  document.getElementById('user-avatar').textContent = prof?.avatar_initials || '?';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  if (state.isAdmin) document.body.classList.add('is-admin');
  else document.body.classList.remove('is-admin');

  populateSelects();
  await Promise.all([loadProfiles(), loadLeads(), loadReminders(), loadEnquiries(), loadActivities()]);
  renderDashboard(); renderLeads(); renderReminders(); renderEnquiries();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view, btn));
  });
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.col));
  });
  document.getElementById('dash-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  checkReminderPopups();
  setInterval(checkReminderPopups, 60000);

  db.channel('sales-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_leads' }, () => loadLeads().then(() => { renderLeads(); renderDashboard(); }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_reminders' }, () => loadReminders().then(renderReminders))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_enquiries' }, () => loadEnquiries().then(renderEnquiries))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_activities' }, () => loadActivities().then(() => renderDashboard()))
    .subscribe();
}

// ── DATA LOADERS ──
async function loadProfiles() {
  const { data } = await db.from('profiles').select('*').order('name');
  if (data) state.profiles = data;
  populateAssignedSelects();
}

async function loadLeads() {
  let allData = []; let from = 0; const batchSize = 1000;
  while (true) {
    const { data, error } = await db.from('sales_leads')
      .select('*, assigned_profile:profiles!sales_leads_assigned_to_fkey(name,avatar_initials)')
      .order(state.sortCol, { ascending: state.sortDir === 'asc' })
      .range(from, from + batchSize - 1);
    if (error || !data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  if (state.isAdmin) {
    state.leads = allData;
  } else {
    state.leads = allData.filter(l => l.assigned_to === state.user.id);
  }
  applyFilters();
}

async function loadReminders() {
  let query = db.from('sales_reminders')
    .select('*, lead:sales_leads(name,company), assignee:profiles!sales_reminders_assigned_to_fkey(name)')
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true });
  if (!state.isAdmin) query = query.or(`assigned_to.eq.${state.user.id},created_by.eq.${state.user.id}`);
  const { data } = await query;
  if (data) { state.reminders = data; updateReminderBadge(); }
}

async function loadEnquiries() {
  let query = db.from('sales_enquiries').select('*').order('created_at', { ascending: false });
  if (!state.isAdmin) query = query.eq('created_by', state.user.id);
  const { data } = await query;
  if (data) state.enquiries = data;
}

async function loadActivities() {
  const { data } = await db.from('sales_activities').select('*').order('created_at', { ascending: true });
  if (data) state.activities = data;
}

// ── DASHBOARD ──
function getDashRange(period) {
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return today.toISOString();
  if (period === 'week') { const d = new Date(today); d.setDate(d.getDate() - d.getDay()); return d.toISOString(); }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  if (period === 'quarter') { const q = Math.floor(now.getMonth() / 3); return new Date(now.getFullYear(), q * 3, 1).toISOString(); }
  return null;
}

function filterByPeriod(items, dateField, period) {
  const start = getDashRange(period);
  if (!start) return items;
  return items.filter(i => i[dateField] && i[dateField] >= start);
}

function getChartBuckets(period) {
  const now = new Date(); const buckets = [];
  if (period === 'today') {
    for (let h = 0; h < 24; h++) buckets.push({ label: h + ':00', key: String(h).padStart(2, '0') });
  } else if (period === 'week') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const start = new Date(); start.setDate(start.getDate() - start.getDay());
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); buckets.push({ label: days[d.getDay()], key: d.toISOString().split('T')[0] }); }
  } else if (period === 'month') {
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= dim; d++) buckets.push({ label: String(d), key: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0') });
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    for (let m = q * 3; m < q * 3 + 3; m++) { const mn = new Date(now.getFullYear(), m, 1).toLocaleDateString('en-IN', { month: 'short' }); buckets.push({ label: mn, key: now.getFullYear() + '-' + String(m + 1).padStart(2, '0') }); }
  } else {
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); buckets.push({ label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') }); }
  }
  return buckets;
}

function getItemKey(isoStr, period) {
  if (!isoStr) return '';
  if (period === 'today') return isoStr.substring(11, 13);
  if (period === 'week' || period === 'month') return isoStr.substring(0, 10);
  return isoStr.substring(0, 7);
}

function renderBarChart(containerId, buckets, counts, color) {
  const max = Math.max(...Object.values(counts), 1);
  const container = document.getElementById(containerId); if (!container) return;
  const showEvery = buckets.length > 15 ? Math.ceil(buckets.length / 10) : 1;
  let barsHtml = '';
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]; const val = counts[b.key] || 0;
    const h = max > 0 ? Math.round((val / max) * 90) : 0;
    barsHtml += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">'
      + '<span style="font-size:8px;color:var(--text-2);margin-bottom:2px">' + (val > 0 ? val : '') + '</span>'
      + '<div title="' + b.label + ': ' + val + '" style="width:100%;background:' + color + ';border-radius:3px 3px 0 0;height:' + h + 'px;min-height:' + (val > 0 ? '2' : '0') + 'px;transition:height 0.3s"></div>'
      + '<span style="font-size:9px;color:var(--text-3);position:absolute;bottom:-18px;white-space:nowrap;' + (i % showEvery === 0 ? '' : 'visibility:hidden') + '">' + b.label + '</span>'
      + '</div>';
  }
  container.innerHTML = '<div style="display:flex;gap:2px;margin-bottom:4px">'
    + '<div style="width:24px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding-bottom:20px">'
    + '<span style="font-size:9px;color:var(--text-3)">' + max + '</span>'
    + '<span style="font-size:9px;color:var(--text-3)">' + Math.round(max / 2) + '</span>'
    + '<span style="font-size:9px;color:var(--text-3)">0</span></div>'
    + '<div style="flex:1;position:relative">'
    + '<div style="position:absolute;top:0;left:0;right:0;bottom:20px;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none">'
    + '<div style="border-top:1px dashed var(--border);width:100%"></div>'
    + '<div style="border-top:1px dashed var(--border);width:100%"></div>'
    + '<div style="border-top:1px solid var(--border);width:100%"></div></div>'
    + '<div style="display:flex;align-items:flex-end;gap:3px;height:120px;padding-bottom:20px;position:relative">' + barsHtml + '</div></div></div>';
}

function renderDashboard() {
  const period = state.dashPeriod;
  const allLeads = state.isAdmin ? state.leads : state.leads.filter(l => l.assigned_to === state.user.id);
  const filteredLeads = filterByPeriod(allLeads, 'created_at', period);
  const filteredActivities = filterByPeriod(state.activities || [], 'created_at', period);
  const followedUpIds = new Set(filteredActivities.map(a => a.lead_id).filter(Boolean));
  const closed = filteredLeads.filter(l => l.stage === 'Closed');
  const totalVal = filteredLeads.reduce((s, l) => s + (+l.value || 0), 0);
  const conv = filteredLeads.length ? Math.round(closed.length / filteredLeads.length * 100) : 0;
  const periodLabels = { today: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', all: 'All time' };

  document.getElementById('metrics-row').innerHTML =
    '<div class="metric-card"><div class="metric-label">Total Leads</div><div class="metric-value purple">' + filteredLeads.length.toLocaleString('en-IN') + '</div><div class="metric-sub">' + periodLabels[period] + '</div></div>'
    + '<div class="metric-card"><div class="metric-label">Followed Up</div><div class="metric-value" style="color:var(--blue)">' + followedUpIds.size + '</div><div class="metric-sub">Leads with activity</div></div>'
    + '<div class="metric-card"><div class="metric-label">Conversion</div><div class="metric-value green">' + conv + '%</div><div class="metric-sub">' + closed.length + ' closed</div></div>'
    + '<div class="metric-card"><div class="metric-label">Pipeline Value</div><div class="metric-value amber">₹' + formatINR(totalVal) + '</div><div class="metric-sub">Estimated value</div></div>';

  const filterEl = document.getElementById('dash-period-filter');
  if (filterEl) {
    let html = '<div class="dash-period-tabs">';
    ['today', 'week', 'month', 'quarter', 'all'].forEach(p => {
      html += '<button class="dash-period-btn ' + (period === p ? 'active' : '') + '" onclick="setDashPeriod(\'' + p + '\')">' + periodLabels[p] + '</button>';
    });
    html += '</div>';
    filterEl.innerHTML = html;
  }

  const maxS = Math.max(...STAGES.map(s => filteredLeads.filter(l => l.stage === s).length), 1);
  document.getElementById('stage-bars').innerHTML = STAGES.map(s => {
    const c = filteredLeads.filter(l => l.stage === s).length;
    return '<div class="stage-bar-row"><span class="stage-bar-label">' + s + '</span><div class="stage-bar-track"><div class="stage-bar-fill" style="width:' + Math.round(c / maxS * 100) + '%;background:' + STAGE_COLORS[s] + '"></div></div><span class="stage-bar-count">' + c + '</span></div>';
  }).join('');

  const srcMap = {};
  filteredLeads.forEach(l => { if (l.source) { srcMap[l.source] = (srcMap[l.source] || 0) + 1; } });
  document.getElementById('source-chart').innerHTML = Object.entries(srcMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, c]) => '<div class="source-row"><span>' + s + '</span><span class="source-pill">' + c + '</span></div>').join('') || '<div class="empty-state">No source data yet</div>';

  const buckets = getChartBuckets(period);
  const createdCounts = {}; buckets.forEach(b => { createdCounts[b.key] = 0; });
  filteredLeads.forEach(l => { const key = getItemKey(l.created_at, period); if (key in createdCounts) createdCounts[key]++; });
  renderBarChart('leads-created-chart-inner', buckets, createdCounts, '#6366F1');

  const followupCounts = {}; const bucketLeadSets = {};
  buckets.forEach(b => { followupCounts[b.key] = 0; bucketLeadSets[b.key] = new Set(); });
  filteredActivities.forEach(a => { if (!a.lead_id) return; const key = getItemKey(a.created_at, period); if (key in bucketLeadSets) bucketLeadSets[key].add(a.lead_id); });
  buckets.forEach(b => { followupCounts[b.key] = bucketLeadSets[b.key].size; });
  renderBarChart('leads-followup-chart-inner', buckets, followupCounts, '#10B981');

  const today = new Date().toISOString().split('T')[0];
  const due = allLeads.filter(l => l.followup_date === today);
  document.getElementById('followups-today').innerHTML = due.length ? due.slice(0, 5).map(l =>
    '<div class="followup-row"><div><div class="followup-name">' + esc(l.name) + '</div><div class="followup-company">' + esc(l.company || '') + '</div></div><button class="btn-sm" onclick="openLeadDetail(\'' + l.id + '\')">View</button></div>'
  ).join('') : '<div class="empty-state"><div class="empty-state-icon">✓</div>No follow-ups today</div>';

  const perfEl = document.getElementById('team-perf');
  if (perfEl && state.isAdmin) {
    const perfMap = {};
    filteredLeads.forEach(l => {
      if (!l.assigned_to) return;
      const prof = state.profiles.find(p => p.id === l.assigned_to);
      const name = prof?.name || 'Unknown';
      if (!perfMap[name]) perfMap[name] = { total: 0, closed: 0, value: 0 };
      perfMap[name].total++;
      if (l.stage === 'Closed') perfMap[name].closed++;
      perfMap[name].value += (+l.value || 0);
    });
    perfEl.innerHTML = Object.entries(perfMap).sort((a, b) => b[1].total - a[1].total).map(([name, p]) =>
      '<div class="team-row"><span style="font-weight:500">' + name + '</span><div class="team-stats">'
      + '<div class="team-stat"><div class="team-stat-num">' + p.total + '</div><div class="team-stat-lbl">Leads</div></div>'
      + '<div class="team-stat"><div class="team-stat-num">' + p.closed + '</div><div class="team-stat-lbl">Closed</div></div>'
      + '<div class="team-stat"><div class="team-stat-num">₹' + formatINR(p.value) + '</div><div class="team-stat-lbl">Value</div></div>'
      + '</div></div>'
    ).join('') || '<div class="empty-state">Assign leads to see stats</div>';
  }
}

function setDashPeriod(period) { state.dashPeriod = period; renderDashboard(); }

// ── SELECTS ──
function populateSelects() {
  const fstage = document.getElementById('f-stage');
  if (fstage) fstage.innerHTML = '<option value="">All stages</option>' + STAGES.map(s => '<option>' + s + '</option>').join('');
  const fsource = document.getElementById('f-source');
  if (fsource) fsource.innerHTML = '<option value="">All sources</option>' + SOURCES.map(s => '<option>' + s + '</option>').join('');
  const fservice = document.getElementById('f-service');
  if (fservice) fservice.innerHTML = '<option value="">All services</option>' + SERVICES.map(s => '<option>' + s + '</option>').join('');
  const lfstage = document.getElementById('lf-stage');
  if (lfstage) lfstage.innerHTML = STAGES.map(s => '<option>' + s + '</option>').join('');
  const lfsource = document.getElementById('lf-source');
  if (lfsource) lfsource.innerHTML = '<option value=""></option>' + SOURCES.map(s => '<option>' + s + '</option>').join('');
  const lfservice = document.getElementById('lf-service');
  if (lfservice) lfservice.innerHTML = '<option value=""></option>' + SERVICES.map(s => '<option>' + s + '</option>').join('');
  const bstage = document.getElementById('bulk-stage');
  if (bstage) bstage.innerHTML = '<option value="">Move to stage…</option>' + STAGES.map(s => '<option>' + s + '</option>').join('');
}

function populateAssignedSelects() {
  const opts = state.profiles.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
  const lfAssigned = document.getElementById('lf-assigned');
  if (lfAssigned) lfAssigned.innerHTML = '<option value="">Unassigned</option>' + opts;
  const rfAssigned = document.getElementById('rf-assigned');
  if (rfAssigned) rfAssigned.innerHTML = '<option value="">Unassigned</option>' + opts;
  const fAssigned = document.getElementById('f-assigned');
  if (fAssigned) fAssigned.innerHTML = '<option value="">All members</option>' + opts;
  const tl = document.getElementById('team-list');
  if (tl) tl.innerHTML = state.profiles.map(p =>
    '<div class="team-member-row"><div class="tm-info"><div class="tm-avatar">' + (p.avatar_initials || '?') + '</div><div><div style="font-weight:500">' + esc(p.name) + '</div><div style="font-size:11px;color:var(--text-3)">' + esc(p.email) + '</div></div></div><span class="tm-role">' + p.role + '</span></div>'
  ).join('');
}

// ── VIEW SWITCH ──
function switchView(viewName, btn) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + viewName)?.classList.add('active');
  btn?.classList.add('active');
  state.activeView = viewName;
  if (viewName === 'pipeline') renderKanban();
  if (viewName === 'enquiries') renderEnquiries();
  if (viewName === 'settings') loadProfiles().then(() => populateAssignedSelects());
}

// ── FILTERS ──
function applyFilters() {
  const q = (document.getElementById('search-q')?.value || '').toLowerCase();
  const stage = document.getElementById('f-stage')?.value || '';
  const source = document.getElementById('f-source')?.value || '';
  const service = document.getElementById('f-service')?.value || '';
  const assigned = document.getElementById('f-assigned')?.value || '';
  state.filteredLeads = state.leads.filter(l => {
    if (q && !(l.name + ' ' + (l.company || '') + (l.email || '') + (l.phone || '')).toLowerCase().includes(q)) return false;
    if (stage && l.stage !== stage) return false;
    if (source && l.source !== source) return false;
    if (service && l.service !== service) return false;
    if (assigned && l.assigned_to !== assigned) return false;
    return true;
  });
  state.page = 1; state.selectedLeads.clear(); renderLeads();
}
function debounceFilter() { clearTimeout(state.filterDebounce); state.filterDebounce = setTimeout(applyFilters, 250); }
function clearFilters() {
  ['search-q', 'f-stage', 'f-source', 'f-service', 'f-assigned'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  applyFilters();
}
function handleSort(col) {
  if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  else { state.sortCol = col; state.sortDir = 'asc'; }
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === col) th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  loadLeads().then(renderLeads);
}

// ── RENDER LEADS TABLE ──
function renderLeads() {
  const fl = state.filteredLeads; const total = fl.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const start = (state.page - 1) * state.pageSize; const slice = fl.slice(start, start + state.pageSize);
  document.getElementById('leads-count-label').textContent = total.toLocaleString('en-IN') + ' leads' + (total !== state.leads.length ? ' (filtered from ' + state.leads.length.toLocaleString('en-IN') + ')' : '');
  const tbody = document.getElementById('leads-tbody');
  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-row"><div class="empty-state-icon">🔍</div><div>No leads found</div></td></tr>';
  } else {
    tbody.innerHTML = slice.map(l => {
      const prof = l.assigned_profile;
      const fu = l.followup_date; const today = new Date().toISOString().split('T')[0];
      const fuClass = fu && fu < today ? 'color:var(--red)' : fu === today ? 'color:var(--amber)' : '';
      const stageColor = STAGE_COLORS[l.stage] || '#6366F1';
      return '<tr data-id="' + l.id + '" class="' + (state.selectedLeads.has(l.id) ? 'selected' : '') + '">'
        + '<td><input type="checkbox" ' + (state.selectedLeads.has(l.id) ? 'checked' : '') + ' onchange="toggleSelect(\'' + l.id + '\',this)"/></td>'
        + '<td><div class="lead-name">' + esc(l.name) + '</div><div class="lead-company">' + esc(l.company || '—') + '</div></td>'
        + '<td><div class="lead-email" style="font-size:12px">' + esc(l.email || '—') + '</div><div class="lead-phone">' + esc(l.phone || '') + '</div></td>'
        + '<td><span class="stage-badge" style="background:' + stageColor + '22;color:' + stageColor + '">' + l.stage + '</span></td>'
        + '<td style="font-size:12px;color:var(--text-2)">' + esc(l.service || '—') + '</td>'
        + '<td style="font-size:12px;color:var(--text-3)">' + esc(l.source || '—') + '</td>'
        + '<td style="font-size:12px;font-family:\'JetBrains Mono\',monospace">₹' + (+l.value || 0).toLocaleString('en-IN') + '</td>'
        + '<td>' + (prof ? '<div style="display:flex;align-items:center;gap:5px;font-size:12px"><div class="user-avatar" style="width:20px;height:20px;font-size:9px">' + (prof.avatar_initials || '?') + '</div>' + prof.name.split(' ')[0] + '</div>' : '<span style="font-size:12px;color:var(--text-3)">—</span>') + '</td>'
        + '<td style="font-size:12px;' + fuClass + '">' + (fu ? formatDate(fu) : '—') + '</td>'
        + '<td style="font-size:12px;color:var(--text-3)">' + (l.created_at ? formatDate(l.created_at.split('T')[0]) : '—') + '</td>'
        + '<td><div style="display:flex;gap:4px"><button class="btn-sm" onclick="openLeadDetail(\'' + l.id + '\')">View</button><button class="btn-sm" onclick="openEditLead(\'' + l.id + '\')">Edit</button></div></td>'
        + '</tr>';
    }).join('');
  }
  const pag = document.getElementById('pagination');
  pag.innerHTML = '<span class="page-info">' + (start + 1) + '–' + Math.min(start + state.pageSize, total) + ' of ' + total + '</span>';
  if (pages > 1) {
    pag.innerHTML += '<button class="page-btn" onclick="goPage(' + (state.page - 1) + ')" ' + (state.page === 1 ? 'disabled' : '') + '>←</button>';
    for (let i = Math.max(1, state.page - 2); i <= Math.min(pages, state.page + 2); i++) {
      pag.innerHTML += '<button class="page-btn ' + (i === state.page ? 'active' : '') + '" onclick="goPage(' + i + ')">' + i + '</button>';
    }
    pag.innerHTML += '<button class="page-btn" onclick="goPage(' + (state.page + 1) + ')" ' + (state.page === pages ? 'disabled' : '') + '>→</button>';
  }
  const bulk = document.getElementById('bulk-actions');
  const selCount = state.selectedLeads.size;
  bulk.style.display = selCount > 0 ? 'flex' : 'none';
  document.getElementById('selected-count').textContent = selCount + ' selected';
  document.getElementById('select-all').checked = slice.length > 0 && slice.every(l => state.selectedLeads.has(l.id));
}

function goPage(p) { state.page = p; renderLeads(); }
function toggleSelect(id, cb) { if (cb.checked) state.selectedLeads.add(id); else state.selectedLeads.delete(id); renderLeads(); }
function toggleSelectAll(cb) {
  const fl = state.filteredLeads; const start = (state.page - 1) * state.pageSize; const slice = fl.slice(start, start + state.pageSize);
  if (cb.checked) slice.forEach(l => state.selectedLeads.add(l.id));
  else slice.forEach(l => state.selectedLeads.delete(l.id));
  renderLeads();
}

async function bulkMoveStage() {
  const stage = document.getElementById('bulk-stage').value;
  if (!stage || !state.selectedLeads.size) return;
  await db.from('sales_leads').update({ stage, updated_at: new Date().toISOString() }).in('id', [...state.selectedLeads]);
  state.selectedLeads.clear(); await loadLeads(); renderLeads(); renderDashboard();
}

async function bulkDelete() {
  if (!state.selectedLeads.size) return;
  if (!confirm('Delete ' + state.selectedLeads.size + ' leads?')) return;
  await db.from('sales_leads').delete().in('id', [...state.selectedLeads]);
  state.selectedLeads.clear(); await loadLeads(); renderLeads(); renderDashboard();
}

// ── MODALS ──
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function overlayClose(e, el) { if (e.target === el) el.style.display = 'none'; }

// ── LEAD FORM ──
function openAddLead() {
  state.editLeadId = null;
  document.getElementById('lead-modal-title').textContent = 'Add Lead';
  document.getElementById('edit-lead-id').value = '';
  ['lf-name', 'lf-company', 'lf-email', 'lf-phone', 'lf-value', 'lf-city', 'lf-notes', 'lf-followup'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('lf-stage').value = 'Fresh Lead';
  document.getElementById('lf-type').value = 'Prospect';
  document.getElementById('lf-service').value = '';
  document.getElementById('lf-source').value = '';
  document.getElementById('lf-assigned').value = state.user?.id || '';
  openModal('add-lead-modal');
}

function openEditLead(id) {
  const l = state.leads.find(x => x.id === id); if (!l) return;
  state.editLeadId = id;
  document.getElementById('lead-modal-title').textContent = 'Edit Lead';
  document.getElementById('edit-lead-id').value = id;
  document.getElementById('lf-name').value = l.name || '';
  document.getElementById('lf-company').value = l.company || '';
  document.getElementById('lf-email').value = l.email || '';
  document.getElementById('lf-phone').value = l.phone || '';
  document.getElementById('lf-stage').value = l.stage || 'Fresh Lead';
  document.getElementById('lf-type').value = l.type || 'Prospect';
  document.getElementById('lf-service').value = l.service || '';
  document.getElementById('lf-source').value = l.source || '';
  document.getElementById('lf-value').value = l.value || '';
  document.getElementById('lf-city').value = l.city || '';
  document.getElementById('lf-notes').value = l.notes || '';
  document.getElementById('lf-followup').value = l.followup_date || '';
  document.getElementById('lf-assigned').value = l.assigned_to || '';
  openModal('add-lead-modal');
}

async function saveLead() {
  const name = document.getElementById('lf-name').value.trim();
  if (!name) { alert('Name is required'); return; }
  const assignedTo = state.isAdmin ? (document.getElementById('lf-assigned').value || null) : state.user.id;
  const payload = {
    name, company: document.getElementById('lf-company').value,
    email: document.getElementById('lf-email').value,
    phone: document.getElementById('lf-phone').value,
    stage: document.getElementById('lf-stage').value,
    type: document.getElementById('lf-type').value,
    service: document.getElementById('lf-service').value,
    source: document.getElementById('lf-source').value,
    value: +document.getElementById('lf-value').value || 0,
    city: document.getElementById('lf-city').value,
    notes: document.getElementById('lf-notes').value,
    followup_date: document.getElementById('lf-followup').value || null,
    assigned_to: assignedTo, updated_at: new Date().toISOString()
  };
  const editId = state.editLeadId;
  if (editId) {
    const old = state.leads.find(l => l.id === editId);
    await db.from('sales_leads').update(payload).eq('id', editId);
    if (old && old.stage !== payload.stage) {
      await db.from('sales_activities').insert({ lead_id: editId, user_id: state.user.id, type: 'stage_change', text: 'Stage changed from ' + old.stage + ' to ' + payload.stage });
    } else {
      await db.from('sales_activities').insert({ lead_id: editId, user_id: state.user.id, type: 'edit', text: 'Lead updated' });
    }
  } else {
    payload.created_by = state.user.id;
    const { data } = await db.from('sales_leads').insert(payload).select().single();
    if (data) await db.from('sales_activities').insert({ lead_id: data.id, user_id: state.user.id, type: 'created', text: 'Lead created' });
  }
  closeModal('add-lead-modal');
  await loadLeads(); await loadActivities();
  renderLeads(); renderDashboard();
  if (state.activeView === 'pipeline') renderKanban();
}

async function deleteLead(id) {
  if (!confirm('Delete this lead?')) return;
  await db.from('sales_leads').delete().eq('id', id);
  document.getElementById('lead-detail-overlay').style.display = 'none';
  await loadLeads(); renderLeads(); renderDashboard();
  if (state.activeView === 'pipeline') renderKanban();
}

// ── LEAD DETAIL PANEL ──
async function openLeadDetail(id) {
  const l = state.leads.find(x => x.id === id); if (!l) return;
  const { data: acts } = await db.from('sales_activities').select('*, user:profiles(name,avatar_initials)').eq('lead_id', id).order('created_at', { ascending: false });
  const stageColor = STAGE_COLORS[l.stage] || '#6366F1';
  const assignedProf = state.profiles.find(p => p.id === l.assigned_to);
  const actsHtml = (acts || []).map(a =>
    '<div class="activity-item"><div class="activity-dot ' + a.type + '"></div><div class="activity-content"><div class="activity-text">' + (a.type === 'comment' ? '💬 ' : '') + esc(a.text) + '</div><div class="activity-author">' + (a.user?.name || 'System') + ' · ' + formatDateTime(a.created_at) + '</div></div></div>'
  ).join('') || '<div style="font-size:13px;color:var(--text-3)">No activity yet</div>';
  const stageButtons = STAGES.map(s =>
    '<button class="stage-switch-btn ' + (l.stage === s ? 'active' : '') + '" onclick="changeStageFromPanel(\'' + l.id + '\',\'' + s + '\')" style="' + (l.stage === s ? 'background:' + STAGE_COLORS[s] + ';border-color:' + STAGE_COLORS[s] + ';color:white' : '') + '">' + s + '</button>'
  ).join('');
  const profileOpts = state.profiles.map(p => '<option value="' + p.id + '" ' + (p.id === l.assigned_to ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('');
  const assignSection = state.isAdmin ? '<div class="panel-section"><div class="panel-section-title">Assign Owner</div><div style="display:flex;gap:8px;align-items:center"><select id="assign-select" style="flex:1;padding:8px 10px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-2);color:var(--text-1);font-size:13px;outline:none"><option value="">Unassigned</option>' + profileOpts + '</select><button class="btn-primary" onclick="assignLead(\'' + l.id + '\')">Assign</button></div></div>' : '';

  document.getElementById('lead-detail-panel').innerHTML =
    '<div class="panel-header"><div>'
    + '<div style="font-size:17px;font-weight:600">' + esc(l.name) + '</div>'
    + '<div style="font-size:13px;color:var(--text-3)">' + esc(l.company || '') + '</div>'
    + '<div style="margin-top:8px"><span class="stage-badge" style="background:' + stageColor + '22;color:' + stageColor + '">' + l.stage + '</span></div>'
    + '</div><button class="modal-close" onclick="document.getElementById(\'lead-detail-overlay\').style.display=\'none\'">✕</button></div>'
    + '<div class="panel-section"><div class="panel-section-title">Contact Details</div><div class="info-grid">'
    + '<div class="info-field"><div class="info-label">Email</div><div class="info-value">' + esc(l.email || '—') + '</div></div>'
    + '<div class="info-field"><div class="info-label">Phone</div><div class="info-value">' + esc(l.phone || '—') + '</div></div>'
    + '<div class="info-field"><div class="info-label">City</div><div class="info-value">' + esc(l.city || '—') + '</div></div>'
    + '<div class="info-field"><div class="info-label">Service</div><div class="info-value">' + esc(l.service || '—') + '</div></div>'
    + '<div class="info-field"><div class="info-label">Source</div><div class="info-value">' + esc(l.source || '—') + '</div></div>'
    + '<div class="info-field"><div class="info-label">Deal Value</div><div class="info-value" style="font-family:\'JetBrains Mono\',monospace;color:var(--purple)">₹' + (+l.value || 0).toLocaleString('en-IN') + '</div></div>'
    + '<div class="info-field"><div class="info-label">Follow-up</div><div class="info-value">' + (l.followup_date ? formatDate(l.followup_date) : '—') + '</div></div>'
    + '<div class="info-field"><div class="info-label">Assigned To</div><div class="info-value">' + esc(assignedProf?.name || '—') + '</div></div>'
    + '</div>' + (l.notes ? '<div style="margin-top:10px;font-size:13px;color:var(--text-2);background:var(--surface-2);padding:10px;border-radius:var(--radius-sm)">' + esc(l.notes) + '</div>' : '') + '</div>'
    + '<div class="panel-section"><div class="panel-section-title">Move Stage</div><div class="stage-switcher">' + stageButtons + '</div></div>'
    + assignSection
    + '<div class="panel-section"><div class="panel-section-title">Quick Actions</div><div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<button class="btn-sm" onclick="openEditLead(\'' + l.id + '\');document.getElementById(\'lead-detail-overlay\').style.display=\'none\'">Edit</button>'
    + '<button class="btn-sm" onclick="openReminderForLead(\'' + l.id + '\')">+ Reminder</button>'
    + '<button class="btn-sm" onclick="openEnquiryModal(\'' + l.id + '\',true)">+ Enquiry</button>'
    + (state.isAdmin ? '<button class="btn-danger-sm" onclick="deleteLead(\'' + l.id + '\')">Delete</button>' : '')
    + '</div></div>'
    + '<div class="panel-section"><div class="panel-section-title">Activity & Comments</div><div class="activity-list">' + actsHtml + '</div>'
    + '<div class="comment-composer"><textarea class="comment-input" id="comment-input-' + id + '" rows="2" placeholder="Add a comment…"></textarea><button class="btn-primary" style="align-self:flex-end" onclick="postComment(\'' + id + '\')">Post</button></div></div>';
  document.getElementById('lead-detail-overlay').style.display = 'flex';
}

async function assignLead(leadId) {
  const newOwner = document.getElementById('assign-select').value;
  const ownerName = state.profiles.find(p => p.id === newOwner)?.name || 'Unassigned';
  await db.from('sales_leads').update({ assigned_to: newOwner || null, updated_at: new Date().toISOString() }).eq('id', leadId);
  await db.from('sales_activities').insert({ lead_id: leadId, user_id: state.user.id, type: 'edit', text: 'Assigned to ' + ownerName });
  await loadLeads(); renderLeads(); openLeadDetail(leadId);
}

async function changeStageFromPanel(leadId, stage) {
  const old = state.leads.find(l => l.id === leadId);
  await db.from('sales_leads').update({ stage, updated_at: new Date().toISOString() }).eq('id', leadId);
  await db.from('sales_activities').insert({ lead_id: leadId, user_id: state.user.id, type: 'stage_change', text: 'Stage changed from ' + (old?.stage || '?') + ' to ' + stage });
  await loadLeads(); await loadActivities();
  renderLeads(); renderDashboard();
  if (state.activeView === 'pipeline') renderKanban();
  openLeadDetail(leadId);
}

async function postComment(leadId) {
  const inp = document.getElementById('comment-input-' + leadId);
  const text = inp?.value.trim(); if (!text) return;
  await db.from('sales_activities').insert({ lead_id: leadId, user_id: state.user.id, type: 'comment', text });
  inp.value = '';
  await loadActivities(); renderDashboard(); openLeadDetail(leadId);
}

// ── KANBAN ──
function renderKanban() {
  document.getElementById('kanban-board').innerHTML = STAGES.map(stage => {
    const cards = state.leads.filter(l => l.stage === stage);
    return '<div class="kanban-col" data-stage="' + stage + '" ondragover="kanbanDragOver(event,this)" ondrop="kanbanDrop(event,\'' + stage + '\')" ondragleave="kanbanDragLeave(this)">'
      + '<div class="col-header"><div class="col-title-wrap"><div class="col-accent" style="background:' + STAGE_COLORS[stage] + '"></div><span class="col-name">' + stage + '</span></div><span class="col-count">' + cards.length + '</span></div>'
      + '<div class="col-cards">' + cards.map(l =>
        '<div class="kanban-card" draggable="true" data-id="' + l.id + '" ondragstart="kanbanDragStart(event,\'' + l.id + '\')" ondragend="kanbanDragEnd(event)" onclick="openLeadDetail(\'' + l.id + '\')">'
        + '<div class="kcard-name">' + esc(l.name) + '</div>'
        + '<div class="kcard-company">' + esc(l.company || '—') + '</div>'
        + '<div class="kcard-footer"><span class="kcard-value">' + (l.value ? '₹' + (+l.value).toLocaleString('en-IN') : '') + '</span><span class="kcard-service">' + esc(l.service || '') + '</span></div>'
        + '</div>'
      ).join('') + '</div></div>';
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
  await db.from('sales_leads').update({ stage, updated_at: new Date().toISOString() }).eq('id', draggedLeadId);
  await db.from('sales_activities').insert({ lead_id: draggedLeadId, user_id: state.user.id, type: 'stage_change', text: 'Stage moved to ' + stage + ' via board' });
  draggedLeadId = null;
  await loadLeads(); renderKanban(); renderDashboard();
}

// ── ENQUIRIES ──
function renderEnquiries() {
  const list = document.getElementById('enquiries-list'); if (!list) return;
  const enquiries = state.isAdmin ? state.enquiries : state.enquiries.filter(e => e.created_by === state.user.id);
  if (!enquiries.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div>No enquiries yet. Create one from a lead or click "+ New Enquiry".</div></div>';
    return;
  }
  list.innerHTML = enquiries.map(e => {
    const ownerProf = state.isAdmin ? state.profiles.find(p => p.id === e.created_by) : null;
    return '<div class="enquiry-card">'
      + '<div class="enquiry-card-left">'
      + '<div class="enquiry-card-title">' + esc(e.brand_name || 'Untitled Enquiry') + '</div>'
      + '<div class="enquiry-card-meta">' + (e.brief_date ? formatDate(e.brief_date) : '—') + ' · ' + esc(e.client_poc_name || '—') + ' · ' + esc(e.requirement_type || '—') + '</div>'
      + '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">'
      + (e.lead_name ? '<span class="enq-tag" style="background:var(--green-light);color:var(--green)">Lead: ' + esc(e.lead_name) + '</span>' : '')
      + (e.total_budget ? '<span class="enq-tag">Budget: ' + esc(e.total_budget) + '</span>' : '')
      + (ownerProf ? '<span class="enq-tag" style="background:var(--blue-light);color:var(--blue)">' + esc(ownerProf.name) + '</span>' : '')
      + '</div>'
      + '</div>'
      + '<div class="enquiry-card-actions">'
      + '<button class="btn-sm" onclick="viewEnquiry(\'' + e.id + '\')">View</button>'
      + '<button class="btn-sm" onclick="openEnquiryModal(\'' + e.id + '\')">Edit</button>'
      + (state.isAdmin ? '<button class="btn-danger-sm" onclick="deleteEnquiry(\'' + e.id + '\')">Delete</button>' : '')
      + '</div>'
      + '</div>';
  }).join('');
}

function openEnquiryModal(idOrLeadId, isLead = false) {
  let existing = null; let leadData = null;
  if (idOrLeadId && !isLead) {
    existing = state.enquiries.find(e => e.id === idOrLeadId);
  } else if (idOrLeadId && isLead) {
    leadData = state.leads.find(l => l.id === idOrLeadId);
    existing = { lead_id: leadData?.id, lead_name: leadData?.name, brand_name: leadData?.company };
  }
  document.getElementById('enquiry-modal-title').textContent = existing?.id ? 'Edit Enquiry' : 'New Enquiry';
  document.getElementById('enquiry-modal-body').innerHTML = buildEnquiryForm(existing);
  document.getElementById('lead-detail-overlay').style.display = 'none';
  openModal('enquiry-modal');
}

function buildEnquiryForm(e) {
  const v = e || {};
  return '<input type="hidden" id="enq-id" value="' + (v.id || '') + '" />'
    + '<input type="hidden" id="enq-lead-id" value="' + (v.lead_id || '') + '" />'
    + '<input type="hidden" id="enq-lead-name" value="' + esc(v.lead_name || '') + '" />'
    + '<div class="form-grid">'
    + '<div class="form-field"><label>Date</label><input id="enq-date" type="date" value="' + (v.brief_date || '') + '" /></div>'
    + '<div class="form-field"><label>Brand / Company</label><input id="enq-brand" value="' + esc(v.brand_name || '') + '" /></div>'
    + '<div class="form-field"><label>Industry</label><input id="enq-industry" value="' + esc(v.industry || '') + '" /></div>'
    + '<div class="form-field"><label>Client POC Name</label><input id="enq-poc-name" value="' + esc(v.client_poc_name || '') + '" /></div>'
    + '<div class="form-field"><label>Client POC Contact</label><input id="enq-poc-contact" value="' + esc(v.client_poc_contact || '') + '" /></div>'
    + '<div class="form-field"><label>Sales POC</label><select id="enq-sales-poc"><option value="">Select…</option>' + state.profiles.map(p => '<option value="' + esc(p.name) + '" ' + (p.name === v.sales_poc ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></div>'
    + '<div class="form-field"><label>Requirement Type</label><select id="enq-req-type"><option value="">Select…</option>' + SERVICES.map(s => '<option ' + (s === v.requirement_type ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></div>'
    + '<div class="form-field"><label>Total Budget (₹)</label><input id="enq-budget" value="' + esc(v.total_budget || '') + '" /></div>'
    + '<div class="form-field"><label>Campaign Timeline</label><input id="enq-timeline" value="' + esc(v.campaign_timeline || '') + '" /></div>'
    + '<div class="form-field"><label>Client Website</label><input id="enq-website" value="' + esc(v.client_website || '') + '" /></div>'
    + '<div class="form-field full"><label>Client Brief / Notes</label><textarea id="enq-brief" rows="4">' + esc(v.client_brief || '') + '</textarea></div>'
    + '<div class="form-field full"><label>Deliverables</label><input id="enq-deliverables" value="' + esc(v.deliverables || '') + '" /></div>'
    + '<div class="form-field full"><label>References / Competitors</label><input id="enq-references" value="' + esc(v.reference_campaigns || '') + '" /></div>'
    + '</div>';
}

async function saveEnquiry() {
  const payload = {
    lead_id: document.getElementById('enq-lead-id').value || null,
    lead_name: document.getElementById('enq-lead-name').value || null,
    brand_name: document.getElementById('enq-brand').value,
    brief_date: document.getElementById('enq-date').value || null,
    industry: document.getElementById('enq-industry').value,
    client_poc_name: document.getElementById('enq-poc-name').value,
    client_poc_contact: document.getElementById('enq-poc-contact').value,
    sales_poc: document.getElementById('enq-sales-poc').value,
    requirement_type: document.getElementById('enq-req-type').value,
    total_budget: document.getElementById('enq-budget').value,
    campaign_timeline: document.getElementById('enq-timeline').value,
    client_website: document.getElementById('enq-website').value,
    client_brief: document.getElementById('enq-brief').value,
    deliverables: document.getElementById('enq-deliverables').value,
    reference_campaigns: document.getElementById('enq-references').value,
    updated_at: new Date().toISOString(),
  };
  const editId = document.getElementById('enq-id').value;
  if (editId) { await db.from('sales_enquiries').update(payload).eq('id', editId); }
  else { payload.created_by = state.user.id; await db.from('sales_enquiries').insert(payload); }
  closeModal('enquiry-modal');
  await loadEnquiries(); renderEnquiries();
}

function viewEnquiry(id) {
  const e = state.enquiries.find(x => x.id === id); if (!e) return;
  const ownerProf = state.profiles.find(p => p.id === e.created_by);
  function row(label, val) {
    if (!val) return '';
    return '<div class="brief-view-row"><span class="brief-view-label">' + label + '</span><span class="brief-view-value">' + esc(val) + '</span></div>';
  }
  document.getElementById('enquiry-view-panel').innerHTML =
    '<div class="panel-header">'
    + '<div><div style="font-size:17px;font-weight:600">' + esc(e.brand_name || 'Enquiry') + '</div>'
    + '<div style="font-size:13px;color:var(--text-3)">' + (e.brief_date ? formatDate(e.brief_date) : '') + (ownerProf ? ' · ' + esc(ownerProf.name) : '') + '</div></div>'
    + '<button class="modal-close" onclick="document.getElementById(\'enquiry-view-overlay\').style.display=\'none\'">✕</button>'
    + '</div>'
    + '<div class="brief-view-section"><div class="brief-view-title">Basic Info</div>'
    + row('Brand / Company', e.brand_name) + row('Date', e.brief_date ? formatDate(e.brief_date) : '')
    + row('Industry', e.industry) + row('Client POC', e.client_poc_name)
    + row('POC Contact', e.client_poc_contact) + row('Sales POC', e.sales_poc)
    + row('Requirement Type', e.requirement_type) + row('Linked Lead', e.lead_name)
    + '</div>'
    + '<div class="brief-view-section"><div class="brief-view-title">Campaign Details</div>'
    + row('Total Budget', e.total_budget) + row('Campaign Timeline', e.campaign_timeline)
    + row('Deliverables', e.deliverables) + row('Client Website', e.client_website)
    + row('References', e.reference_campaigns)
    + '</div>'
    + (e.client_brief ? '<div class="brief-view-section"><div class="brief-view-title">Client Brief</div><div style="font-size:13px;color:var(--text-2);line-height:1.6">' + esc(e.client_brief) + '</div></div>' : '')
    + '<div class="brief-view-section"><div style="display:flex;gap:8px"><button class="btn-sm" onclick="openEnquiryModal(\'' + e.id + '\')">Edit Enquiry</button></div></div>';
  document.getElementById('enquiry-view-overlay').style.display = 'flex';
}

async function deleteEnquiry(id) {
  if (!confirm('Delete this enquiry?')) return;
  await db.from('sales_enquiries').delete().eq('id', id);
  await loadEnquiries(); renderEnquiries();
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
  const icons = { overdue: '⚠️', today: '📅', upcoming: '🔔', done: '✅' };
  document.getElementById('reminders-list').innerHTML = items.length ? items.map(r => {
    const cls = r.done ? 'done' : r.due_date < today ? 'overdue' : r.due_date === today ? 'today' : 'upcoming';
    return '<div class="reminder-item ' + cls + '"><div class="rem-icon ' + cls + '">' + icons[cls] + '</div>'
      + '<div class="rem-body"><div class="rem-title">' + esc(r.title) + '</div>'
      + '<div class="rem-meta">' + formatDate(r.due_date) + ' at ' + r.due_time + (r.lead ? ' · ' + esc(r.lead.name) : '') + (r.assignee ? ' · ' + esc(r.assignee.name) : '') + '</div>'
      + (r.notes ? '<div class="rem-notes">' + esc(r.notes) + '</div>' : '')
      + '<div class="rem-actions">' + (!r.done ? '<button class="btn-sm" onclick="markReminderDone(\'' + r.id + '\')">✓ Done</button>' : '')
      + '<button class="btn-sm" onclick="openEditReminder(\'' + r.id + '\')">Edit</button>'
      + (r.lead_id ? '<button class="btn-sm" onclick="openLeadDetail(\'' + r.lead_id + '\')">View Lead</button>' : '')
      + '<button class="btn-danger-sm" onclick="deleteReminder(\'' + r.id + '\')">Delete</button></div></div></div>';
  }).join('') : '<div class="empty-state"><div class="empty-state-icon">🔔</div><div>No ' + filter + ' reminders</div></div>';
  document.querySelectorAll('.rem-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.rem-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); state.currentReminderFilter = btn.dataset.filter; renderReminders();
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
  document.getElementById('rf-lead').innerHTML = '<option value="">— none —</option>' + state.leads.map(l => '<option value="' + l.id + '">' + esc(l.name) + (l.company ? ' — ' + esc(l.company) : '') + '</option>').join('');
  document.getElementById('rf-assigned').value = state.user?.id || '';
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
  document.getElementById('rf-title').value = r.title || '';
  document.getElementById('rf-notes').value = r.notes || '';
  document.getElementById('rf-date').value = r.due_date || '';
  document.getElementById('rf-time').value = r.due_time || '10:00';
  document.getElementById('rf-lead').innerHTML = '<option value="">— none —</option>' + state.leads.map(l => '<option value="' + l.id + '" ' + (l.id === r.lead_id ? 'selected' : '') + '>' + esc(l.name) + (l.company ? ' — ' + esc(l.company) : '') + '</option>').join('');
  document.getElementById('rf-assigned').value = r.assigned_to || '';
  openModal('add-reminder-modal');
}

async function saveReminder() {
  const title = document.getElementById('rf-title').value.trim();
  if (!title) { alert('Title is required'); return; }
  const date = document.getElementById('rf-date').value;
  if (!date) { alert('Date is required'); return; }
  const payload = {
    title, lead_id: document.getElementById('rf-lead').value || null,
    assigned_to: document.getElementById('rf-assigned').value || state.user.id,
    due_date: date, due_time: document.getElementById('rf-time').value || '10:00',
    notes: document.getElementById('rf-notes').value, done: false
  };
  const editId = state.editReminderId;
  if (editId) { await db.from('sales_reminders').update(payload).eq('id', editId); }
  else { payload.created_by = state.user.id; await db.from('sales_reminders').insert(payload); }
  closeModal('add-reminder-modal');
  await loadReminders(); renderReminders();
}

async function markReminderDone(id) { await db.from('sales_reminders').update({ done: true }).eq('id', id); await loadReminders(); renderReminders(); }
async function deleteReminder(id) { if (!confirm('Delete?')) return; await db.from('sales_reminders').delete().eq('id', id); await loadReminders(); renderReminders(); }

// ── REMINDER TOAST ──
let currentPopupReminder = null;
function checkReminderPopups() {
  const now = new Date(); const today = now.toISOString().split('T')[0];
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
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
  document.getElementById('toast-sub').textContent = [lead ? 'Lead: ' + lead.name : '', due.notes].filter(Boolean).join(' · ');
  document.getElementById('reminder-toast').style.display = 'flex';
}
function closeToast() { document.getElementById('reminder-toast').style.display = 'none'; }
async function doneReminderToast() { if (currentPopupReminder) await markReminderDone(currentPopupReminder.id); closeToast(); }
function snoozeReminder() {
  if (!currentPopupReminder) return;
  const snooze = new Date(Date.now() + 3600000); const r = currentPopupReminder;
  r._popupShown = false;
  r.due_date = snooze.toISOString().split('T')[0];
  r.due_time = String(snooze.getHours()).padStart(2, '0') + ':' + String(snooze.getMinutes()).padStart(2, '0');
  db.from('sales_reminders').update({ due_date: r.due_date, due_time: r.due_time }).eq('id', r.id);
  closeToast();
}

// ── CSV EXPORT ──
function exportCSV() {
  const headers = ['Name', 'Company', 'Email', 'Phone', 'Stage', 'Type', 'Service', 'Source', 'Value', 'City', 'Follow-up Date', 'Created On', 'Notes'];
  const rows = state.leads.map(l => [l.name, l.company, l.email, l.phone, l.stage, l.type, l.service, l.source, l.value, l.city, l.followup_date, l.created_at?.split('T')[0], l.notes].map(v => '"' + (v || '').toString().replace(/"/g, '""') + '"').join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'prompt_sales_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
}

// ── HELPERS ──
function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function formatINR(n) { if (n >= 100000) return (n / 100000).toFixed(1) + 'L'; if (n >= 1000) return (n / 1000).toFixed(0) + 'K'; return n.toLocaleString('en-IN'); }
function formatDate(dateStr) { if (!dateStr) return ''; const d = new Date(dateStr + 'T00:00:00'); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function formatDateTime(isoStr) { if (!isoStr) return ''; return new Date(isoStr).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

// ── GLOBALS ──
window.handleLogin = handleLogin; window.handleLogout = handleLogout; window.showForgot = showForgot;
window.openModal = openModal; window.closeModal = closeModal; window.overlayClose = overlayClose;
window.openAddLead = openAddLead; window.openEditLead = openEditLead; window.saveLead = saveLead; window.deleteLead = deleteLead;
window.openLeadDetail = openLeadDetail; window.changeStageFromPanel = changeStageFromPanel; window.assignLead = assignLead; window.postComment = postComment;
window.openAddReminder = openAddReminder; window.openReminderForLead = openReminderForLead; window.openEditReminder = openEditReminder; window.saveReminder = saveReminder;
window.markReminderDone = markReminderDone; window.deleteReminder = deleteReminder;
window.doneReminderToast = doneReminderToast; window.snoozeReminder = snoozeReminder; window.closeToast = closeToast;
window.exportCSV = exportCSV;
window.applyFilters = applyFilters; window.debounceFilter = debounceFilter; window.clearFilters = clearFilters;
window.goPage = goPage; window.toggleSelect = toggleSelect; window.toggleSelectAll = toggleSelectAll;
window.bulkMoveStage = bulkMoveStage; window.bulkDelete = bulkDelete;
window.kanbanDragStart = kanbanDragStart; window.kanbanDragEnd = kanbanDragEnd; window.kanbanDragOver = kanbanDragOver; window.kanbanDragLeave = kanbanDragLeave; window.kanbanDrop = kanbanDrop;
window.setDashPeriod = setDashPeriod;
window.openEnquiryModal = openEnquiryModal; window.saveEnquiry = saveEnquiry; window.viewEnquiry = viewEnquiry; window.deleteEnquiry = deleteEnquiry;
window.renderEnquiries = renderEnquiries;

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) { await initApp(session.user); }
})();
