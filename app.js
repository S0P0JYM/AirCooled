(function(){
  const LS = {
    users: 'mrs_users',
    customers: 'mrs_customers',
    repairs: 'mrs_repairs',
    session: 'mrs_session'
  };

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function nowISO(){ return new Date().toISOString().slice(0,19).replace('T',' '); }

  // Seed default admin on first load
  function seed() {
    let users = read(LS.users, []);
    if (users.length === 0) {
      users.push({id: 1, username: 'admin', password: 'admin123', role: 'admin', created_at: nowISO()});
      write(LS.users, users);
      const seedMsg = document.getElementById('seedMsg');
      if (seedMsg){ seedMsg.style.display='block'; seedMsg.textContent = 'Default admin created (admin / admin123)'; }
    }
  }

  // Session helpers
  function setSession(obj){ write(LS.session, obj); }
  function getSession(){ return read(LS.session, null); }
  function clearSession(){ localStorage.removeItem(LS.session); }

  // Common guards based on page
  const path = location.pathname.split('/').pop();

  // Initialize per-page
  document.addEventListener('DOMContentLoaded', () => {
    seed();

    if (path === 'index.html' || path === '' ) {
      setupLogin();
    } else if (path === 'dashboard.html') {
      guard(['admin','mechanic'], 'index.html');
      setupDashboard();
    } else if (path === 'customer.html') {
      guard(['customer'], 'index.html');
      setupCustomer();
    }
  });

  function guard(roles, redirectTo){
    const s = getSession();
    if (!s || !roles.includes(s.role)) { location.href = redirectTo; }
  }

  // LOGIN
  function setupLogin(){
    const form = document.getElementById('loginForm');
    const roleSel = document.getElementById('role');
    const identity = document.getElementById('identity');
    const pass = document.getElementById('password');
    const resetBtn = document.getElementById('resetData');
    resetBtn?.addEventListener('click', () => {
      if (confirm('This will clear ALL data stored in localStorage for this app. Continue?')) {
        localStorage.removeItem(LS.users);
        localStorage.removeItem(LS.customers);
        localStorage.removeItem(LS.repairs);
        clearSession();
        location.reload();
      }
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const role = roleSel.value;
      if (role === 'customer') {
        const customers = read(LS.customers, []);
        const found = customers.find(c => c.email.toLowerCase() === identity.value.toLowerCase() && c.password === pass.value);
        if (found) {
          setSession({role:'customer', customer_id: found.id});
          location.href = 'customer.html';
        } else {
          alert('Invalid customer login');
        }
      } else {
        const users = read(LS.users, []);
        const found = users.find(u => u.username.toLowerCase() === identity.value.toLowerCase() && u.password === pass.value);
        if (found) {
          setSession({role: found.role, user_id: found.id, username: found.username});
          location.href = 'dashboard.html';
        } else {
          alert('Invalid admin/mechanic login');
        }
      }
    });
  }

  // DASHBOARD
  function setupDashboard(){
    const s = getSession();
    document.getElementById('who').textContent = s.username ? s.username + ' ('+s.role+')' : s.role;

    const customers = read(LS.customers, []);
    const select = document.getElementById('r_customer');
    select.innerHTML = '<option value="">Select customer...</option>' + customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.email)})</option>`).join('');

    // Create customer
    document.getElementById('customerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const c = {
        id: nextId(LS.customers),
        name: document.getElementById('c_name').value.trim(),
        email: document.getElementById('c_email').value.trim(),
        phone: document.getElementById('c_phone').value.trim(),
        password: document.getElementById('c_pass').value.trim(),
        created_at: nowISO()
      };
      const list = read(LS.customers, []);
      if (list.some(x => x.email.toLowerCase() === c.email.toLowerCase())) {
        return alert('Email already exists');
      }
      list.push(c); write(LS.customers, list);
      showNotice('Customer created.');
      e.target.reset();
      // refresh dropdown
      select.innerHTML = '<option value="">Select customer...</option>' + list.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.email)})</option>`).join('');
    });

    // Create repair
    document.getElementById('repairForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const list = read(LS.repairs, []);
      const r = {
        id: nextId(LS.repairs),
        customer_id: parseInt(document.getElementById('r_customer').value,10),
        vehicle: document.getElementById('r_vehicle').value.trim(),
        issue: document.getElementById('r_issue').value.trim(),
        status: document.getElementById('r_status').value,
        updated_at: nowISO()
      };
      if (!r.customer_id) return alert('Select a customer');
      list.push(r); write(LS.repairs, list);
      showNotice('Repair job created.');
      e.target.reset();
      renderRepairs();
    });

    // Search filter
    document.getElementById('search').addEventListener('input', renderRepairs);

    // Export/Import
    document.getElementById('exportBtn').addEventListener('click', () => {
      const data = {
        users: read(LS.users, []),
        customers: read(LS.customers, []),
        repairs: read(LS.repairs, []),
      };
      download('mechanic_system_backup.json', JSON.stringify(data, null, 2));
    });
    document.getElementById('importInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        if (confirm('Import will overwrite current data. Continue?')) {
          write(LS.users, data.users || []);
          write(LS.customers, data.customers || []);
          write(LS.repairs, data.repairs || []);
          showNotice('Import complete.');
          renderRepairs();
          // refresh customer dropdown
          const list = read(LS.customers, []);
          select.innerHTML = '<option value="">Select customer...</option>' + list.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.email)})</option>`).join('');
        }
      } catch (err) {
        alert('Invalid JSON');
      }
      e.target.value = '';
    });

    renderRepairs();
  }

  function renderRepairs(){
    const tbody = document.querySelector('#repairsTable tbody');
    const repairs = read(LS.repairs, []);
    const customers = read(LS.customers, []);
    const q = (document.getElementById('search').value || '').toLowerCase();

    const rows = repairs
      .map(r => ({...r, customer: customers.find(c => c.id === r.customer_id)}))
      .filter(x => {
        const hay = [
          x.customer?.name, x.customer?.email, x.vehicle, x.issue, x.status, String(x.id)
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
      .sort((a,b) => b.id - a.id)
      .map(x => {
        const opts = ['Received','In Progress','Waiting for Parts','Completed']
          .map(s => `<option ${s===x.status?'selected':''}>${s}</option>`).join('');
        return `<tr>
          <td>${x.id}</td>
          <td>${escapeHtml(x.customer?.name || '—')}</td>
          <td>${escapeHtml(x.vehicle)}</td>
          <td>${escapeHtml(x.issue || '')}</td>
          <td>
            <select data-id="${x.id}" class="statusSel">${opts}</select>
          </td>
          <td>${x.updated_at}</td>
          <td><button class="btn" data-del="${x.id}">Delete</button></td>
        </tr>`;
      }).join('');

    tbody.innerHTML = rows || `<tr><td colspan="7">No repairs yet.</td></tr>`;

    // Bind status change & delete
    tbody.querySelectorAll('.statusSel').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const id = parseInt(e.target.getAttribute('data-id'),10);
        const list = read(LS.repairs, []);
        const item = list.find(r => r.id === id);
        if (item){ item.status = e.target.value; item.updated_at = nowISO(); write(LS.repairs, list); }
        renderRepairs();
      });
    });
    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-del'),10);
        if (confirm('Delete repair #' + id + '?')) {
          const list = read(LS.repairs, []).filter(r => r.id !== id);
          write(LS.repairs, list);
          renderRepairs();
        }
      });
    });
  }

  // CUSTOMER
  function setupCustomer(){
    const s = getSession();
    const customers = read(LS.customers, []);
    const me = customers.find(c => c.id === s.customer_id);
    document.getElementById('custName').textContent = me?.name || 'Customer';
    document.getElementById('custEmail').textContent = me?.email || '';
    document.getElementById('custPhone').textContent = me?.phone || '';

    const repairs = read(LS.repairs, []).filter(r => r.customer_id === s.customer_id).sort((a,b)=>b.id-a.id);
    const rows = repairs.map(r => `<tr>
      <td>${r.id}</td>
      <td>${escapeHtml(r.vehicle)}</td>
      <td>${escapeHtml(r.issue || '')}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${r.updated_at}</td>
    </tr>`).join('');
    document.querySelector('#custRepairs tbody').innerHTML = rows || `<tr><td colspan="5">No repairs found.</td></tr>`;
  }

  // Utils
  function nextId(key){
    const list = read(key, []);
    return list.length ? Math.max.apply(null, list.map(x => x.id)) + 1 : 1;
  }
  function download(filename, text){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type:'application/json'}));
    a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }
  function escapeHtml(s){
    return (s || '').replace(/[&<>'"]/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

})();
