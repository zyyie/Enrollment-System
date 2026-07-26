const FacultyManageApp = (() => {
  let strands = [];
  let teachers = [];
  let strandsWarning = '';

  function esc(str) {
    return AdminApp.escHtml(String(str ?? ''));
  }

  function showMessage(message, type = 'error') {
    let box = document.getElementById('facultyPageMsg');
    if (!box) {
      box = document.createElement('div');
      box.id = 'facultyPageMsg';
      box.className = `admin-page-msg ${type}`;
      document.querySelector('.admin-card')?.prepend(box);
    }
    box.className = `admin-page-msg ${type}`;
    box.innerHTML = esc(message);
  }

  function clearMessage() {
    document.getElementById('facultyPageMsg')?.remove();
  }

  function renderStrandChips(selected = []) {
    const wrap = document.getElementById('teacherStrandChips');
    if (!wrap) return;
    if (!strands.length) {
      wrap.innerHTML = `
        <p class="admin-empty">
          ${strandsWarning || 'No strands loaded.'}
          <br><small>Run <strong>supabase/faculty-strands-rooms.sql</strong> in Supabase SQL Editor, restart server, then refresh.</small>
        </p>`;
      return;
    }
    wrap.innerHTML = strands.map(s => `
      <label class="auto-sched-chip">
        <input type="checkbox" name="teacherStrand" value="${esc(s.code)}" ${selected.includes(s.code) ? 'checked' : ''}>
        ${esc(s.code)}
      </label>
    `).join('');
  }

  function renderTable() {
    const wrap = document.getElementById('teachersTable');
    if (!teachers.length) {
      wrap.innerHTML = '<div class="admin-empty">No professors yet. Click <strong>+ Add Professor</strong> to get started.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>Faculty ID</th><th>Name</th><th>Strands</th><th>Department</th><th>Max Load</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${teachers.map(t => `
            <tr>
              <td><strong>${esc(t.faculty_id)}</strong></td>
              <td>${esc(t.name)}</td>
              <td>${(t.strands || []).map(s => `<span class="strand-badge">${esc(s)}</span>`).join(' ') || '—'}</td>
              <td>${esc(t.department || '—')}</td>
              <td>${esc(t.max_load_units || 24)}</td>
              <td>${AdminApp.statusBadge(t.is_active ? 'Active' : 'Inactive')}</td>
              <td><button type="button" class="admin-btn secondary edit-teacher" data-id="${esc(t.id)}">Edit</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('.edit-teacher').forEach(btn => {
      btn.addEventListener('click', () => openForm(teachers.find(t => t.id === btn.dataset.id)));
    });
  }

  function openForm(teacher = null) {
    clearMessage();
    if (strandsWarning) showMessage(strandsWarning);
    document.getElementById('teacherFormWrap').hidden = false;
    document.getElementById('teacherDbId').value = teacher?.id || '';
    document.getElementById('teacherLastName').value = teacher?.last_name || '';
    document.getElementById('teacherFirstName').value = teacher?.first_name || '';
    document.getElementById('teacherMiddleName').value = teacher?.middle_name || '';
    document.getElementById('teacherEmail').value = teacher?.email || '';
    document.getElementById('teacherDepartment').value = teacher?.department || '';
    document.getElementById('teacherMaxLoad').value = teacher?.max_load_units || 24;
    document.getElementById('teacherPassword').value = '';
    document.getElementById('teacherPassword').placeholder = teacher ? 'Leave blank to keep current' : 'Default: teacher123';
    renderStrandChips(teacher?.strands || []);
    document.getElementById('teacherFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    document.getElementById('teacherFormWrap').hidden = true;
    document.getElementById('teacherForm').reset();
    document.getElementById('teacherDbId').value = '';
  }

  async function loadStrands() {
    const strandRes = await AdminApp.fetchJson('/api/strands');
    strands = strandRes.data || [];
    strandsWarning = strandRes.warning || '';
    if (strandsWarning) showMessage(strandsWarning);
    renderStrandChips();
  }

  async function loadTeachers() {
    const teacherRes = await AdminApp.fetchJson('/api/teachers');
    teachers = teacherRes.data || [];
    renderTable();
  }

  async function loadAll() {
    await loadStrands();
    try {
      await loadTeachers();
    } catch (err) {
      document.getElementById('teachersTable').innerHTML =
        `<div class="admin-empty">${esc(err.message)}</div>`;
    }
  }

  async function saveTeacher(e) {
    e.preventDefault();
    clearMessage();
    const btn = document.getElementById('saveTeacherBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      const selectedStrands = [...document.querySelectorAll('input[name="teacherStrand"]:checked')].map(el => el.value);
      if (!selectedStrands.length) {
        showMessage('Select at least one strand this professor teaches.');
        return;
      }
      const payload = {
        id: document.getElementById('teacherDbId').value || undefined,
        lastName: document.getElementById('teacherLastName').value.trim(),
        firstName: document.getElementById('teacherFirstName').value.trim(),
        middleName: document.getElementById('teacherMiddleName').value.trim(),
        email: document.getElementById('teacherEmail').value.trim(),
        department: document.getElementById('teacherDepartment').value.trim(),
        maxLoadUnits: document.getElementById('teacherMaxLoad').value,
        strands: selectedStrands,
      };
      const password = document.getElementById('teacherPassword').value.trim();
      if (password) payload.password = password;

      const result = await AdminApp.postJson('/api/teachers', payload);
      closeForm();
      await loadAll();
      showMessage(result.message || 'Professor saved successfully.', 'success');
    } catch (err) {
      showMessage(err.message || 'Could not save professor.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save to Database';
    }
  }

  function bindEvents() {
    document.getElementById('openTeacherForm').addEventListener('click', () => openForm());
    document.getElementById('cancelTeacherForm').addEventListener('click', closeForm);
    document.getElementById('teacherForm').addEventListener('submit', saveTeacher);
  }

  async function mount() {
    if (!AdminApp.requireAuth()) return;
    bindEvents();
    await AdminApp.refreshLayout('faculty', 'Faculty');
    try {
      await loadAll();
    } catch (err) {
      document.getElementById('teachersTable').innerHTML =
        `<div class="admin-empty">${esc(err.message)}<br><small>Run supabase/faculty-strands-rooms.sql in Supabase SQL Editor, then restart the server.</small></div>`;
    }
  }

  return { mount };
})();
