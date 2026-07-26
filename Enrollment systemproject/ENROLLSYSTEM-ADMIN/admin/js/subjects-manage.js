const SubjectsManageApp = (() => {
  let strands = [];
  let subjects = [];

  function esc(str) {
    return AdminApp.escHtml(String(str ?? ''));
  }

  function showMessage(message, type = 'error') {
    let box = document.getElementById('subjectsPageMsg');
    if (!box) {
      box = document.createElement('div');
      box.id = 'subjectsPageMsg';
      box.className = `admin-page-msg ${type}`;
      document.querySelector('.admin-card')?.prepend(box);
    }
    box.className = `admin-page-msg ${type}`;
    box.innerHTML = esc(message);
  }

  function clearMessage() {
    document.getElementById('subjectsPageMsg')?.remove();
  }

  function renderStrandOptions(selected = '') {
    const select = document.getElementById('subjectStrand');
    if (!select) return;
    const sel = (selected || '').toUpperCase();
    select.innerHTML = `<option value="">All Strands (Core)</option>${strands.map(s => `
      <option value="${esc(s.code)}" ${sel === s.code ? 'selected' : ''}>${esc(s.code)} — ${esc(s.name || s.code)}</option>
    `).join('')}`;
  }

  function renderTable() {
    const wrap = document.getElementById('subjectsTable');
    if (!subjects.length) {
      wrap.innerHTML = '<div class="admin-empty">No subjects yet. Click <strong>+ Add Subject</strong> to get started.</div>';
      return;
    }
    wrap.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr><th>Code</th><th>Subject</th><th>Strand</th><th>Grade</th><th>Units</th><th></th></tr>
        </thead>
        <tbody>
          ${subjects.map(s => `
            <tr>
              <td><strong>${esc(s.code)}</strong></td>
              <td>${esc(s.name)}</td>
              <td>${esc(s.strand)}</td>
              <td>${esc(s.gradeLevel)}</td>
              <td>${esc(s.units)}</td>
              <td><button type="button" class="admin-btn secondary edit-subject" data-id="${esc(s.id)}">Edit</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p class="admin-table-foot">${subjects.length} subject(s) total</p>`;

    wrap.querySelectorAll('.edit-subject').forEach(btn => {
      btn.addEventListener('click', () => openForm(subjects.find(s => s.id === btn.dataset.id)));
    });
  }

  function openForm(subject = null) {
    clearMessage();
    document.getElementById('subjectFormWrap').hidden = false;
    document.getElementById('subjectDbId').value = subject?.id || '';
    document.getElementById('subjectCode').value = subject?.code || '';
    document.getElementById('subjectName').value = subject?.name || '';
    document.getElementById('subjectGrade').value = subject?.gradeLevel || 'Grade 12';
    document.getElementById('subjectUnits').value = subject?.units || 3;
    document.getElementById('subjectLec').value = subject?.lecHours ?? subject?.units ?? 3;
    document.getElementById('subjectLab').value = subject?.labHours || 0;
    renderStrandOptions(subject?.strandCode || (subject?.strand === 'All Strands' ? '' : subject?.strand));
    document.getElementById('subjectFormWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeForm() {
    document.getElementById('subjectFormWrap').hidden = true;
    document.getElementById('subjectForm').reset();
    document.getElementById('subjectDbId').value = '';
  }

  async function loadStrands() {
    const res = await AdminApp.fetchJson('/api/strands');
    strands = res.data || [];
    if (res.warning) showMessage(res.warning);
    renderStrandOptions();
  }

  async function loadSubjects() {
    const res = await AdminApp.fetchJson('/api/subjects');
    subjects = res.data || [];
    renderTable();
  }

  async function loadAll() {
    await loadStrands();
    await loadSubjects();
  }

  async function saveSubject(e) {
    e.preventDefault();
    clearMessage();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving...';
    }
    try {
      const result = await AdminApp.postJson('/api/subjects', {
        id: document.getElementById('subjectDbId').value || undefined,
        code: document.getElementById('subjectCode').value.trim(),
        name: document.getElementById('subjectName').value.trim(),
        strandCode: document.getElementById('subjectStrand').value,
        gradeLevel: document.getElementById('subjectGrade').value,
        units: document.getElementById('subjectUnits').value,
        lecHours: document.getElementById('subjectLec').value,
        labHours: document.getElementById('subjectLab').value,
      });
      closeForm();
      await loadSubjects();
      showMessage(result.message || 'Subject saved successfully.', 'success');
    } catch (err) {
      showMessage(err.message || 'Could not save subject.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save to Database';
      }
    }
  }

  function bindEvents() {
    document.getElementById('openSubjectForm').addEventListener('click', () => openForm());
    document.getElementById('cancelSubjectForm').addEventListener('click', closeForm);
    document.getElementById('subjectForm').addEventListener('submit', saveSubject);
  }

  async function mount() {
    if (!AdminApp.requireAuth()) return;
    bindEvents();
    await AdminApp.refreshLayout('subjects', 'Subjects');
    try {
      await loadAll();
    } catch (err) {
      document.getElementById('subjectsTable').innerHTML =
        `<div class="admin-empty">${esc(err.message)}<br><small>Run supabase/faculty-strands-rooms.sql in Supabase SQL Editor, then restart the server.</small></div>`;
    }
  }

  return { mount };
})();
