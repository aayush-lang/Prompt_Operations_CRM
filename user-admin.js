// ============================================================
// user-admin.js  —  drop-in User Management panel
//
// Adds an "Add user" form and per-user Deactivate/Reactivate
// buttons to the Settings page, visible ONLY to admins and
// super_admins. All privileged work goes through the
// "manage-users" edge function; nothing sensitive lives here.
//
// This file is self-contained. Load it AFTER the Supabase UMD
// script and app.js. Use the SAME file in both the Recruit app
// (root) and the Sales app (/sales/) — it auto-detects which one
// it's running in for the department default.
// ============================================================

(function () {
  var UA_SUPABASE_URL = 'https://hsudagdnygfiggpahsit.supabase.co';
  var UA_ANON_KEY = 'sb_publishable_oY0LZlb0acdZ7S_Xqiv38A_93cIOdVO';
  var UA_FN_URL = UA_SUPABASE_URL + '/functions/v1/manage-users';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[user-admin] Supabase library not found. Load user-admin.js after the Supabase script.');
    return;
  }

  var uaClient = window.supabase.createClient(UA_SUPABASE_URL, UA_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  var uaRole = null;
  var uaReady = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function uaToken() {
    var r = await uaClient.auth.getSession();
    return (r && r.data && r.data.session) ? r.data.session.access_token : null;
  }

  async function uaCall(body) {
    var token = await uaToken();
    if (!token) throw new Error('You are not signed in.');
    var res = await fetch(UA_FN_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || data.error) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  async function uaInit() {
    var s = await uaClient.auth.getSession();
    var session = s && s.data ? s.data.session : null;
    if (!session || !session.user) return;
    var p = await uaClient.from('profiles').select('role').eq('id', session.user.id).single();
    uaRole = p && p.data ? p.data.role : null;
    uaReady = true;
    if (uaRole === 'admin' || uaRole === 'super_admin') {
      uaEnsureCard();
      uaRenderList();
    }
  }

  function uaEnsureCard() {
    var view = document.getElementById('view-settings');
    if (!view || document.getElementById('ua-card')) return;
    var grid = view.querySelector('.settings-grid') || view;

    var isSales = location.pathname.toLowerCase().indexOf('/sales') !== -1;
    var roles = (uaRole === 'super_admin') ? ['associate', 'admin', 'super_admin'] : ['associate'];

    var card = document.createElement('div');
    card.className = 'settings-card';
    card.id = 'ua-card';
    card.style.gridColumn = '1 / -1';
    card.innerHTML =
      '<div class="settings-card-title">User Management</div>' +
      '<div id="ua-msg" style="display:none;font-size:12px;padding:8px 10px;border-radius:6px;margin-bottom:10px;line-height:1.5"></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:1rem">' +
        '<div style="flex:1;min-width:140px"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">Full name</label>' +
          '<input id="ua-name" class="search-input" style="min-width:unset;width:100%" placeholder="e.g. Anshu Khatri"></div>' +
        '<div style="flex:1;min-width:180px"><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">Email</label>' +
          '<input id="ua-email" class="search-input" style="min-width:unset;width:100%" placeholder="name@gmail.com"></div>' +
        '<div><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">Role</label>' +
          '<select id="ua-role" class="filter-sel">' + roles.map(function (r) { return '<option value="' + r + '">' + r + '</option>'; }).join('') + '</select></div>' +
        '<div><label style="font-size:11px;color:var(--text-3);display:block;margin-bottom:4px">Department</label>' +
          '<select id="ua-dept" class="filter-sel">' +
            '<option value="recruit">recruit</option>' +
            '<option value="sales">sales</option>' +
            '<option value="both">both</option>' +
          '</select></div>' +
        '<button class="btn-primary" id="ua-add-btn">Add user</button>' +
      '</div>' +
      '<div id="ua-list"></div>';

    grid.appendChild(card);

    var deptSel = card.querySelector('#ua-dept');
    if (deptSel) deptSel.value = isSales ? 'sales' : 'recruit';
    card.querySelector('#ua-add-btn').addEventListener('click', uaAddUser);
  }

  function uaMsg(html, kind) {
    var el = document.getElementById('ua-msg');
    if (!el) return;
    var map = { ok: ['#ECFDF5', '#059669'], err: ['#FEF2F2', '#DC2626'], info: ['#EFF6FF', '#2563EB'] };
    var c = map[kind] || map.info;
    el.style.display = 'block';
    el.style.background = c[0];
    el.style.color = c[1];
    el.innerHTML = html;
  }

  async function uaRenderList() {
    var list = document.getElementById('ua-list');
    if (!list) return;
    list.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:10px 0">Loading users…</div>';

    var q = await uaClient.from('profiles')
      .select('id,name,email,role,department,is_active').order('name');
    if (q.error) {
      list.innerHTML = '<div style="font-size:12px;color:var(--red)">Could not load users: ' + esc(q.error.message) + '</div>';
      return;
    }
    var data = q.data || [];
    if (!data.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-3)">No users found.</div>';
      return;
    }

    list.innerHTML = data.map(function (u) {
      var active = u.is_active !== false;
      var canManage = (uaRole === 'super_admin') || (u.role === 'associate');
      var badge = active
        ? '<span style="font-size:10px;background:var(--green-light);color:var(--green);padding:2px 8px;border-radius:10px">Active</span>'
        : '<span style="font-size:10px;background:var(--red-light);color:var(--red);padding:2px 8px;border-radius:10px">Inactive</span>';
      var btn = '';
      if (canManage) {
        btn = active
          ? '<button class="btn-danger-sm" data-ua-deact="' + u.id + '">Deactivate</button>'
          : '<button class="btn-sm" data-ua-react="' + u.id + '">Reactivate</button>';
      }
      return '<div class="team-member-row" style="' + (active ? '' : 'opacity:0.6;') + '">' +
        '<div class="tm-info"><div>' +
          '<div style="font-weight:500">' + esc(u.name || '—') + ' ' + badge + '</div>' +
          '<div style="font-size:11px;color:var(--text-3)">' + esc(u.email || '') + ' · ' + esc(u.role) + ' · ' + esc(u.department || '—') + '</div>' +
        '</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center">' + btn + '</div>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('[data-ua-deact]'), function (b) {
      b.addEventListener('click', function () { uaToggle(b.getAttribute('data-ua-deact'), 'deactivate'); });
    });
    Array.prototype.forEach.call(list.querySelectorAll('[data-ua-react]'), function (b) {
      b.addEventListener('click', function () { uaToggle(b.getAttribute('data-ua-react'), 'reactivate'); });
    });
  }

  async function uaAddUser() {
    var name = document.getElementById('ua-name').value.trim();
    var email = document.getElementById('ua-email').value.trim();
    var role = document.getElementById('ua-role').value;
    var department = document.getElementById('ua-dept').value;
    if (!name || !email) { uaMsg('Enter a name and an email.', 'err'); return; }

    var btn = document.getElementById('ua-add-btn');
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = 'Adding…';
    try {
      var r = await uaCall({ action: 'create', name: name, email: email, role: role, department: department });
      uaMsg('✓ Added <strong>' + esc(email) + '</strong>.<br>Temporary password: <strong>' + esc(r.tempPassword) + '</strong><br>Share this with them and ask them to change it after their first login. It will not be shown again.', 'ok');
      document.getElementById('ua-name').value = '';
      document.getElementById('ua-email').value = '';
      uaRenderList();
    } catch (e) {
      uaMsg('✕ ' + esc(e.message), 'err');
    }
    btn.disabled = false;
    btn.textContent = old;
  }

  async function uaToggle(userId, action) {
    var verb = action === 'deactivate' ? 'deactivate' : 'reactivate';
    if (!confirm('Are you sure you want to ' + verb + ' this user?')) return;
    try {
      await uaCall({ action: action, userId: userId });
      uaMsg('✓ User ' + (action === 'deactivate'
        ? 'deactivated. They can no longer sign in.'
        : 'reactivated. They can sign in again.'), 'ok');
      uaRenderList();
    } catch (e) {
      uaMsg('✕ ' + esc(e.message), 'err');
    }
  }

  // Re-render when the Settings tab is opened, plus once after load / on auth change.
  document.addEventListener('DOMContentLoaded', function () {
    var settingsBtn = document.querySelector('.nav-btn[data-view="settings"]');
    if (settingsBtn) settingsBtn.addEventListener('click', function () {
      if (uaReady) { uaEnsureCard(); uaRenderList(); }
    });
  });
  uaClient.auth.onAuthStateChange(function () { uaInit(); });
  uaInit();
})();
