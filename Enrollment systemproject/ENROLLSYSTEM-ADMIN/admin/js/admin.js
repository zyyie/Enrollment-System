// Geranova Admin Portal
const AdminApp = (() => {
  const SESSION_KEY = 'shsFaculty';

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getUser() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function requireAuth() {
    if (!getUser()) {
      window.location.href = '../login.html';
      return false;
    }
    return true;
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('loginRole');
    window.location.href = '../index.html';
  }

  function formatName(user) {
    if (!user) return 'Admin';
    return `${user.lastName}, ${user.firstName} ${user.middleName || ''}`.trim();
  }

  function statusBadge(status) {
    const cls = (status || 'pending').toLowerCase();
    return `<span class="admin-badge ${cls}">${status || 'Pending'}</span>`;
  }

  async function fetchJson(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Server API not found. Stop old servers and run: python main.py');
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error('Invalid server response. Restart with: python main.py');
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function postJson(url, body, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (text.trim().startsWith('<')) {
        throw new Error('Server API not found. Stop old servers and run: python main.py');
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error('Invalid server response.');
      }
      if (!res.ok) {
        throw new Error(data.error || data.hint || `Request failed (${res.status})`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function cachePendingAdmissions(list) {
    try {
      sessionStorage.setItem('pendingAdmissionsCache', JSON.stringify(list || []));
    } catch (e) {
      console.warn('Could not cache pending admissions', e);
    }
  }

  function getCachedAdmission(id) {
    try {
      const list = JSON.parse(sessionStorage.getItem('pendingAdmissionsCache') || '[]');
      return list.find(item => item.id === id || item.applicationNumber === id) || null;
    } catch (e) {
      return null;
    }
  }

  function normalizeReviewApp(app) {
    if (!app) return null;

    app.status = String(app.status || 'pending').toLowerCase();
    app.birthdate = app.birthdate || app.birth_date || '';
    app.gender = app.gender || '';
    app.address = app.address || [
      app.addr_house_number || app.houseNumber,
      app.addr_street || app.street,
      app.addr_barangay || app.barangay,
      app.addr_city || app.city,
      app.addr_province || app.province
    ].filter(Boolean).join(', ') || '';
    app.strandCode = app.strandCode || app.strand || '';
    app.gradeLevel = app.gradeLevel || app.grade || '';
    app.admissionType = app.admissionType || app.admission_type || 'new';
    app.paymentAmount = app.paymentAmount || app.payment_amount || '';
    app.paymentStatus = app.paymentStatus || app.payment_status || '';

    if (Array.isArray(app.documents) && app.documents[0]?.label) {
      return app;
    }

    const docs = app.documents && typeof app.documents === 'object' ? app.documents : {};
    const docPaths = {
      form_138: docs.form_138 || app.docForm138Path,
      form_137: docs.form_137 || app.docForm137Path,
      good_moral: docs.good_moral || app.docGoodMoralPath,
      birth_certificate: docs.birth_certificate || app.docBirthCertificatePath,
      high_school_diploma: docs.high_school_diploma || app.docHighSchoolDiplomaPath
    };
    const labels = {
      form_138: 'Original Copy of Form 138 (Report Card) signed by the Principal',
      form_137: 'Original Copy of Form 137',
      good_moral: 'Original Copy of Certificate of Good Moral Character',
      birth_certificate: 'Photocopy of Birth Certificate issued by PSA',
      high_school_diploma: 'High School Diploma'
    };
    app.documents = Object.keys(labels).map(key => {
      const clean = docPaths[key] ? String(docPaths[key]).replace(/\\/g, '/') : null;
      return {
        key,
        label: labels[key],
        path: clean,
        url: clean ? `/${clean.replace(/^\/+/, '')}` : null,
        uploaded: Boolean(clean)
      };
    });
    return app;
  }

  async function loadAdmissionDetail(id) {
    try {
      const result = await fetchJson(`/api/admission/detail?id=${encodeURIComponent(id)}`, 8000);
      if (result.success && result.data) return normalizeReviewApp(result.data);
    } catch (err) {
      console.warn('Detail API unavailable, using fallback:', err.message);
    }

    const cached = getCachedAdmission(id);
    if (cached) return normalizeReviewApp({ ...cached });

    try {
      const full = await fetchJson('/api/admission/pending', 8000);
      const list = full.success && Array.isArray(full.data) ? full.data : [];
      cachePendingAdmissions(list);
      const found = list.find(item => item.id === id || item.applicationNumber === id);
      if (found) return normalizeReviewApp({ ...found });
    } catch (err) {
      console.warn('Full pending fallback failed:', err.message);
    }

    const pending = await loadPendingAdmissions();
    const found = pending.find(item => item.id === id || item.applicationNumber === id);
    if (found) return normalizeReviewApp({ ...found });

    throw new Error('Application not found. Go back and open Review again.');
  }

  async function loadDashboard() {
    const result = await fetchJson('/api/faculty/dashboard', 12000);
    if (result.success && result.data) {
      const d = result.data;
      d.pendingAdmissions = Array.isArray(d.pendingAdmissions) ? d.pendingAdmissions : [];
      return d;
    }
    throw new Error('Dashboard load failed');
  }

  async function loadPendingAdmissions() {
    const result = await fetchJson('/api/admission/pending', 10000);
    const list = result.success && Array.isArray(result.data) ? result.data : [];
    cachePendingAdmissions(list);
    return list;
  }

  async function loadAdmissionHistory() {
    const result = await fetchJson('/api/admission/history', 10000);
    return result.success && Array.isArray(result.data) ? result.data : [];
  }

  function ensureReviewModalRoot() {
    let root = document.getElementById('adminReviewModalRoot');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'adminReviewModalRoot';
    root.innerHTML = `
      <div class="admin-modal-overlay" id="adminReviewModalOverlay" aria-hidden="true">
        <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="adminReviewModalTitle">
          <div class="admin-modal-body" id="adminReviewModalBody"></div>
          <div class="admin-modal-actions" id="adminReviewModalActions"></div>
        </div>
      </div>`;
    document.body.appendChild(root);

    root.querySelector('#adminReviewModalOverlay').addEventListener('click', e => {
      if (e.target.id === 'adminReviewModalOverlay' && root._onCancel) {
        root._onCancel();
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && root.querySelector('#adminReviewModalOverlay').classList.contains('open')) {
        root._onCancel?.();
      }
    });

    return root;
  }

  function closeReviewModal() {
    const overlay = document.getElementById('adminReviewModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('admin-modal-open');
    const root = document.getElementById('adminReviewModalRoot');
    if (root) {
      root._onConfirm = null;
      root._onCancel = null;
    }
  }

  function confirmReviewAction(action, applicantName) {
    return new Promise(resolve => {
      const root = ensureReviewModalRoot();
      const overlay = root.querySelector('#adminReviewModalOverlay');
      const body = root.querySelector('#adminReviewModalBody');
      const actions = root.querySelector('#adminReviewModalActions');
      const isApprove = action === 'approve';

      body.innerHTML = `
        <div class="admin-modal-icon ${isApprove ? 'approve' : 'reject'}">
          <i class="fas ${isApprove ? 'fa-check' : 'fa-times'}"></i>
        </div>
        <h3 id="adminReviewModalTitle">${isApprove ? 'Approve Application?' : 'Reject Application?'}</h3>
        ${applicantName ? `<div class="admin-modal-applicant">${escHtml(applicantName)}</div>` : ''}
        <p>${isApprove
          ? 'A Student ID and temporary password will be generated and emailed to the applicant.'
          : 'The applicant will be notified via email. You may optionally provide a reason below.'}</p>
        ${isApprove ? '' : `
          <div class="admin-modal-reason">
            <label for="adminRejectReason">Reason for rejection (optional)</label>
            <textarea id="adminRejectReason" placeholder="Enter reason..."></textarea>
          </div>`}`;

      actions.innerHTML = isApprove
        ? `
          <button type="button" class="admin-modal-btn-cancel" data-action="cancel">Cancel</button>
          <button type="button" class="admin-modal-btn-approve" data-action="confirm">
            <i class="fas fa-check"></i> Approve
          </button>`
        : `
          <button type="button" class="admin-modal-btn-cancel" data-action="cancel">Cancel</button>
          <button type="button" class="admin-modal-btn-reject" data-action="confirm">
            <i class="fas fa-times"></i> Reject
          </button>`;

      const finish = result => {
        closeReviewModal();
        resolve(result);
      };

      root._onCancel = () => finish({ confirmed: false });
      root._onConfirm = () => {
        const reasonEl = document.getElementById('adminRejectReason');
        const reason = reasonEl ? reasonEl.value.trim() : '';
        finish({ confirmed: true, reason: reason || null });
      };

      actions.querySelector('[data-action="cancel"]').addEventListener('click', root._onCancel);
      actions.querySelector('[data-action="confirm"]').addEventListener('click', root._onConfirm);

      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('admin-modal-open');

      if (!isApprove) {
        setTimeout(() => document.getElementById('adminRejectReason')?.focus(), 100);
      }
    });
  }

  function confirmDialog(options = {}) {
    const {
      title = 'Are you sure?',
      message = '',
      detail = '',
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      variant = 'approve',
      icon = null,
    } = options;

    const iconMap = {
      approve: 'fa-check',
      reject: 'fa-rotate-left',
      info: 'fa-calendar-check',
      warning: 'fa-triangle-exclamation',
    };
    const iconClass = variant === 'reject' ? 'reject' : variant === 'info' ? 'info' : variant === 'warning' ? 'warning' : 'approve';
    const confirmBtnClass = variant === 'reject'
      ? 'admin-modal-btn-reject'
      : variant === 'info'
        ? 'admin-modal-btn-primary'
        : 'admin-modal-btn-approve';

    return new Promise(resolve => {
      const root = ensureReviewModalRoot();
      const overlay = root.querySelector('#adminReviewModalOverlay');
      const body = root.querySelector('#adminReviewModalBody');
      const actions = root.querySelector('#adminReviewModalActions');

      body.innerHTML = `
        <div class="admin-modal-icon ${iconClass}">
          <i class="fas ${icon || iconMap[variant] || 'fa-check'}"></i>
        </div>
        <h3 id="adminReviewModalTitle">${escHtml(title)}</h3>
        ${detail ? `<div class="admin-modal-applicant">${escHtml(detail)}</div>` : ''}
        <p>${escHtml(message)}</p>`;

      actions.innerHTML = `
        <button type="button" class="admin-modal-btn-cancel" data-action="cancel">${escHtml(cancelLabel)}</button>
        <button type="button" class="${confirmBtnClass}" data-action="confirm">${escHtml(confirmLabel)}</button>`;

      const finish = confirmed => {
        closeReviewModal();
        resolve(confirmed);
      };

      root._onCancel = () => finish(false);
      root._onConfirm = () => finish(true);

      actions.querySelector('[data-action="cancel"]').addEventListener('click', root._onCancel);
      actions.querySelector('[data-action="confirm"]').addEventListener('click', root._onConfirm);

      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('admin-modal-open');
    });
  }

  function alertDialog(options = {}) {
    return showReviewMessage({
      type: options.type || 'success',
      title: options.title || 'Done',
      message: options.message || '',
    });
  }

  function showReviewMessage({ type = 'success', title, message }) {
    return new Promise(resolve => {
      const root = ensureReviewModalRoot();
      const overlay = root.querySelector('#adminReviewModalOverlay');
      const body = root.querySelector('#adminReviewModalBody');
      const actions = root.querySelector('#adminReviewModalActions');
      const iconClass = type === 'error' ? 'error' : 'success';

      body.innerHTML = `
        <div class="admin-modal-icon ${iconClass}">
          <i class="fas ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>
        </div>
        <h3 id="adminReviewModalTitle">${title}</h3>
        <p>${message}</p>`;

      actions.innerHTML = `
        <button type="button" class="admin-modal-btn-ok" data-action="ok">OK</button>`;

      const close = () => {
        closeReviewModal();
        resolve();
      };

      root._onCancel = close;
      actions.querySelector('[data-action="ok"]').addEventListener('click', close);

      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('admin-modal-open');
    });
  }

  async function reviewAdmission(applicationId, action, reason = null) {
    const user = getUser();
    if (!user) return { success: false, error: 'Not logged in.' };

    const res = await fetch('/api/admission/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId,
        action,
        facultyId: user.id,
        reason
      })
    });
    return res.json();
  }

  async function handleReviewDecision(reviewId, action, applicantName, container) {
    const confirmation = await confirmReviewAction(action, applicantName);
    if (!confirmation.confirmed) {
      return { cancelled: true };
    }

    const btn = document.getElementById(action === 'approve' ? 'btnApprove' : 'btnReject');
    const originalHtml = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }

    try {
      const result = await reviewAdmission(reviewId, action, confirmation.reason);

      if (!result.success) {
        await showReviewMessage({
          type: 'error',
          title: action === 'approve' ? 'Approval Failed' : 'Rejection Failed',
          message: [result.error, result.details, result.hint].filter(Boolean).join(' ') || 'Something went wrong. Please try again.',
        });
        return result;
      }

      if (action === 'approve') {
        let msg = `Student ID: <strong>${escHtml(result.studentId || '—')}</strong><br>Email sent to <strong>${escHtml(result.email || 'applicant')}</strong>.`;
        if (result.emailSent === false) msg += '<br><br><em>Warning: Email could not be sent.</em>';
        await showReviewMessage({ type: 'success', title: 'Application Approved', message: msg });
      } else {
        await showReviewMessage({
          type: 'success',
          title: 'Application Rejected',
          message: `The applicant has been notified via email.${confirmation.reason ? `<br><br>Reason: ${escHtml(confirmation.reason)}` : ''}`,
        });
      }

      await mountApplicationReview(container, reviewId);
      return result;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }
  }

  const FA_ICONS = {
    dashboard: 'fa-gauge-high',
    strands: 'fa-book',
    request: 'fa-clipboard-check',
    history: 'fa-clock-rotate-left',
    subjects: 'fa-book-open',
    faculty: 'fa-chalkboard-user',
    rooms: 'fa-door-open',
    students: 'fa-users',
    logout: 'fa-right-from-bracket'
  };

  function faIcon(type) {
    const cls = FA_ICONS[type];
    return cls ? `<i class="fas ${cls} admin-nav-fa"></i>` : '';
  }

  function renderSidebar(activePage, pendingCount = 0) {
    const nav = [
      { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: 'dashboard' },
      { id: 'strands', label: 'Strands', href: 'strands.html', icon: 'strands' },
      { id: 'enrollment-request', label: 'Admission Applications', href: 'enrollment-request.html', icon: 'request', badge: pendingCount },
      { id: 'subject-enrollment', label: 'Subject Enrollment', href: 'subject-enrollment-request.html', icon: 'request' },
      { id: 'enrollment-history', label: 'Admission History', href: 'enrollment-history.html', icon: 'history' },
      { id: 'grades-manage', label: 'Grades Management', href: 'grades-manage.html', icon: 'subjects' },
      { id: 'term-settings', label: 'Enrollment Period', href: 'term-settings.html', icon: 'history' },
      { id: 'subjects', label: 'Subjects', href: 'subjects.html', icon: 'subjects' },
      { id: 'auto-schedule', label: 'AI Auto-Schedule', href: 'auto-schedule.html', icon: 'subjects' }
    ];
    const manage = [
      { id: 'faculty', label: 'Faculty', href: 'faculty.html', icon: 'faculty' },
      { id: 'rooms', label: 'Classrooms', href: 'rooms.html', icon: 'rooms' },
      { id: 'students', label: 'Student List', href: 'students.html', icon: 'students' }
    ];

    const navHtml = nav.map(p => `
      <a href="${p.href}" class="admin-nav-link ${p.id === activePage ? 'active' : ''}">
        ${faIcon(p.icon)} ${p.label}
        ${p.badge > 0 ? `<span class="admin-nav-badge">${p.badge}</span>` : ''}
      </a>
    `).join('');

    const manageHtml = manage.map(p => `
      <a href="${p.href}" class="admin-nav-link sub ${p.id === activePage ? 'active' : ''}">
        ${faIcon(p.icon)} ${p.label}
      </a>
    `).join('');

    return `
      <aside class="admin-sidebar" id="adminSidebar">
        <div class="admin-brand">
          <img src="../assets/geranova-logo.png" alt="Logo">
          <span>Geranova EMS</span>
        </div>
        <nav class="admin-nav">
          ${navHtml}
          <div class="admin-nav-section">Manage</div>
          ${manageHtml}
          <a href="#" class="admin-nav-link" onclick="AdminApp.logout(); return false;">${faIcon('logout')} Logout</a>
        </nav>
      </aside>`;
  }

  function icon(type) {
    return faIcon(type);
  }

  function renderDocList(documents) {
    if (!documents?.length) {
      return '<div class="admin-empty">No documents uploaded.</div>';
    }
    return `<div class="admin-doc-list">${documents.map(doc => `
      <div class="admin-doc-item ${doc.uploaded ? '' : 'missing'}">
        <div class="admin-doc-meta">
          <i class="fas ${doc.uploaded ? 'fa-file-pdf' : 'fa-file-circle-xmark'}"></i>
          <div>
            <strong>${doc.label}</strong>
            <small>${doc.uploaded ? 'Uploaded' : 'Missing'}</small>
          </div>
        </div>
        <div class="admin-doc-actions">
          ${doc.url ? `<a href="${doc.url}" target="_blank" rel="noopener"><i class="fas fa-eye"></i> View</a>` : '<span style="color:#94a3b8;font-size:12px;">Not available</span>'}
        </div>
      </div>
    `).join('')}</div>`;
  }

  function renderInfoItem(label, value) {
    const display = value === null || value === undefined || String(value).trim() === '' ? '—' : value;
    return `<div class="admin-info-item"><label>${label}</label><span>${display}</span></div>`;
  }

  function renderApplicationReview(app) {
    const paymentLabel = app.paymentMode === 'gcash'
      ? `GCash · Ref: ${app.gcashReference || '—'}`
      : 'Pay at Cashier';

    return `
      <a href="enrollment-request.html" class="admin-review-back"><i class="fas fa-arrow-left"></i> Back to Review Applications</a>
      <div class="admin-card" style="margin-bottom:16px;">
        <div class="admin-card-head">
          ${app.student}
          ${statusBadge(app.status)}
          <span style="float:right;font-weight:500;font-size:13px;color:#64748b;">${app.applicationNumber || app.id}</span>
        </div>
        <div class="admin-card-body padded">
          <div class="admin-review-grid">
            <div>
              <h3 style="margin:0 0 12px;font-size:15px;color:#1a3a6b;"><i class="fas fa-user"></i> Applicant Information</h3>
              <div class="admin-info-grid">
                ${renderInfoItem('Full Name', app.student)}
                ${renderInfoItem('Birthdate', app.birthdate)}
                ${renderInfoItem('Gender', app.gender)}
                ${renderInfoItem('Email', app.email)}
                ${renderInfoItem('Contact', app.contactNumber)}
                ${renderInfoItem('Address', app.address)}
                ${renderInfoItem('Strand', app.strandCode)}
                ${renderInfoItem('Grade Level', app.gradeLevel)}
                ${renderInfoItem('Admission Type', app.admissionType)}
                ${renderInfoItem('Submitted', app.date)}
              </div>
            </div>
            <div>
              <h3 style="margin:0 0 12px;font-size:15px;color:#1a3a6b;"><i class="fas fa-credit-card"></i> Payment Information</h3>
              <div class="admin-info-grid">
                ${renderInfoItem('Payment Mode', paymentLabel)}
                ${renderInfoItem('Amount', app.paymentAmount ? '₱' + app.paymentAmount : '—')}
                ${renderInfoItem('Payment Status', app.paymentStatus || '—')}
                ${renderInfoItem('GCash Sender', app.gcashSenderName || '—')}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="admin-card" style="margin-bottom:16px;">
        <div class="admin-card-head"><i class="fas fa-folder-open"></i> Uploaded Documents</div>
        <div class="admin-card-body padded">${renderDocList(app.documents)}</div>
      </div>
      ${app.status === 'pending' ? `
      <div class="admin-card">
        <div class="admin-card-head"><i class="fas fa-gavel"></i> Review Decision</div>
        <div class="admin-card-body padded">
          <p style="margin:0 0 14px;color:#64748b;font-size:14px;">Review the applicant information and documents above, then choose to approve or reject this application.</p>
          <div class="admin-review-actions">
            <button class="admin-btn approve" id="btnApprove"><i class="fas fa-check"></i> Approve Application</button>
            <button class="admin-btn reject" id="btnReject"><i class="fas fa-times"></i> Reject Application</button>
          </div>
        </div>
      </div>` : `
      <div class="admin-card">
        <div class="admin-card-body padded">
          <div class="admin-empty">This application has already been <strong>${app.status}</strong>.
          ${app.studentId ? `<br>Student ID: ${app.studentId}` : ''}
          ${app.rejectionReason ? `<br>Reason: ${app.rejectionReason}` : ''}</div>
        </div>
      </div>`}`;
  }

  async function mountApplicationReview(container, applicationId) {
    container.innerHTML = '<div class="admin-empty">Loading application...</div>';
    try {
      await refreshLayout('enrollment-request', 'Review Application');
      const app = await loadAdmissionDetail(applicationId);
      container.innerHTML = renderApplicationReview(app);

      if (app.status !== 'pending') return;

      document.getElementById('btnApprove')?.addEventListener('click', async () => {
        const reviewId = app.id || applicationId;
        if (!reviewId) {
          await showReviewMessage({
            type: 'error',
            title: 'Missing Application',
            message: 'Go back and open Review again.',
          });
          return;
        }
        await handleReviewDecision(reviewId, 'approve', app.student, container);
      });

      document.getElementById('btnReject')?.addEventListener('click', async () => {
        const reviewId = app.id || applicationId;
        if (!reviewId) {
          await showReviewMessage({
            type: 'error',
            title: 'Missing Application',
            message: 'Go back and open Review again.',
          });
          return;
        }
        await handleReviewDecision(reviewId, 'reject', app.student, container);
      });
    } catch (err) {
      await refreshLayout('enrollment-request', 'Review Application');
      container.innerHTML = `<div class="admin-empty">Could not load application.<br>${err.message || ''}<br><br><a href="enrollment-request.html" class="admin-review-back"><i class="fas fa-arrow-left"></i> Back to Review Applications</a></div>`;
    }
  }

  function renderHeader(user, pendingRequests = []) {
    const notifItems = pendingRequests.slice(0, 3).map(r => `
      <div class="notif-item">
        <strong>${r.student || r.applicant || 'Applicant'}</strong>
        <span>${r.studentId || r.applicationNumber || r.id || ''}</span>
      </div>
    `).join('') || '<div class="notif-item"><span>No pending requests</span></div>';

    return `
      <header class="admin-header">
        <button class="admin-menu-toggle" onclick="AdminApp.toggleSidebar()" aria-label="Menu">☰</button>
        <div class="admin-header-left">
          <h1 id="adminPageTitle">Dashboard</h1>
          <p id="adminPageGreet">Welcome back, ${formatName(user)}! Here's an overview of your system.</p>
        </div>
        <div class="admin-header-right">
          <div class="admin-notif-wrap">
            <button class="admin-notif-btn" onclick="AdminApp.toggleNotif(event)" aria-label="Notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              ${pendingRequests.length ? '<span class="admin-notif-dot"></span>' : ''}
            </button>
            <div class="admin-notif-panel" id="adminNotifPanel">
              <h4>Enrollment Requests (${pendingRequests.length})</h4>
              ${notifItems}
              <div class="notif-footer"><a href="enrollment-request.html">Review All Applications</a></div>
            </div>
          </div>
          <div class="admin-user-block">
            <div class="admin-user-name">${formatName(user)}</div>
            <div class="admin-user-meta">Last Login: ${user.lastLogin || '—'}</div>
          </div>
        </div>
      </header>`;
  }

  function initLayout(activePage, pageTitle, pendingCount = 0, pendingList = null) {
    if (!requireAuth()) return null;
    const user = getUser();
    const pendingRequests = Array.isArray(pendingList)
      ? pendingList
      : (pendingCount > 0 ? [{ student: `${pendingCount} pending`, id: '' }] : []);

    document.getElementById('adminSidebarWrap').innerHTML = renderSidebar(activePage, pendingCount);
    document.getElementById('adminHeader').innerHTML = renderHeader(user, pendingRequests);

    if (pageTitle) {
      const t = document.getElementById('adminPageTitle');
      if (t) t.textContent = pageTitle;
    }

    document.addEventListener('click', closeNotif);
    return user;
  }

  async function refreshLayout(activePage, pageTitle) {
    if (!requireAuth()) return [];
    let pending = [];
    try {
      pending = await loadPendingAdmissions();
    } catch (err) {
      console.warn('Could not load pending admissions:', err);
    }
    initLayout(activePage, pageTitle, pending.length, pending);
    return pending;
  }

  function toggleSidebar() {
    document.querySelector('.admin-sidebar')?.classList.toggle('open');
  }

  function toggleNotif(e) {
    e.stopPropagation();
    document.getElementById('adminNotifPanel')?.classList.toggle('open');
  }

  function closeNotif() {
    document.getElementById('adminNotifPanel')?.classList.remove('open');
  }

  function renderDashboardStats(d) {
    return `
      <div class="admin-stats">
        <div class="admin-stat-card">
          <div class="admin-stat-label">Total Students</div>
          <div class="admin-stat-value">${d.totalStudents ?? 0}</div>
          <a href="students.html" class="admin-stat-link">View →</a>
        </div>
        <div class="admin-stat-card green">
          <div class="admin-stat-label">Total Strands</div>
          <div class="admin-stat-value">${d.totalStrands ?? 0}</div>
          <a href="strands.html" class="admin-stat-link">Manage →</a>
        </div>
        <div class="admin-stat-card yellow">
          <div class="admin-stat-label">Pending Enrollments</div>
          <div class="admin-stat-value">${d.pendingEnrollments ?? 0}</div>
          <a href="enrollment-request.html" class="admin-stat-link">Review →</a>
        </div>
        <div class="admin-stat-card purple">
          <div class="admin-stat-label">Total Admissions</div>
          <div class="admin-stat-value">${d.totalAdmissions ?? 0}</div>
          <a href="enrollment-history.html" class="admin-stat-link">Manage →</a>
        </div>
      </div>`;
  }

  function renderQuickActions() {
    return `
      <h2 class="admin-section-title">Quick Actions</h2>
      <div class="admin-quick-actions">
        <div class="admin-quick-card">
          <p>Review new student applications with documents and payment proof.</p>
          <a href="enrollment-request.html" class="admin-qa-btn purple"><i class="fas fa-clipboard-check"></i> Review Applications</a>
        </div>
        <div class="admin-quick-card">
          <p>Create and manage all strands offered in Senior High School.</p>
          <a href="strands.html" class="admin-qa-btn blue">Go to Strands</a>
        </div>
        <div class="admin-quick-card">
          <p>Add and organize subjects for each strand in the curriculum.</p>
          <a href="subjects.html" class="admin-qa-btn green">Go to Subjects</a>
        </div>
      </div>`;
  }

  function renderActivityTable(items) {
    if (!items.length) {
      return '<div class="admin-empty">No enrollment activity yet.</div>';
    }
    return `
      <table class="admin-table">
        <thead><tr><th>Student</th><th>Application / Subject</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>${items.map(a => `
          <tr>
            <td><div class="student-name">${a.student || '—'}</div><div class="student-sub">${a.strand || ''}</div></td>
            <td>${a.subject || '—'}</td>
            <td>${a.date || '—'}</td>
            <td>${statusBadge(a.status)}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  function renderEnrollmentStats(stats) {
    const s = stats || { approved: 0, pending: 0, rejected: 0 };
    const total = s.approved + s.pending + s.rejected || 1;
    const pct = n => Math.round((n / total) * 100);
    return `
      <div class="admin-stat-bar"><div class="bar-label"><span>Approved</span><span>${s.approved} (${pct(s.approved)}%)</span></div><div class="bar-track"><div class="bar-fill green" style="width:${pct(s.approved)}%"></div></div></div>
      <div class="admin-stat-bar"><div class="bar-label"><span>Pending</span><span>${s.pending} (${pct(s.pending)}%)</span></div><div class="bar-track"><div class="bar-fill yellow" style="width:${pct(s.pending)}%"></div></div></div>
      <div class="admin-stat-bar"><div class="bar-label"><span>Rejected</span><span>${s.rejected} (${pct(s.rejected)}%)</span></div><div class="bar-track"><div class="bar-fill red" style="width:${pct(s.rejected)}%"></div></div></div>`;
  }

  function renderStrandTable(strands) {
    if (!strands?.length) return '<div class="admin-empty">No strand data yet.</div>';
    return `
      <table class="admin-table">
        <thead><tr><th>Strand</th><th>Grade</th><th>Applicants</th></tr></thead>
        <tbody>${strands.map(s => `
          <tr><td><strong>${s.name}</strong></td><td>${s.grade || 'Grade 11 & 12'}</td><td>${s.applicants ?? s.subjects ?? 0}</td></tr>
        `).join('')}</tbody>
      </table>`;
  }

  async function mountDashboard(container) {
    container.innerHTML = '<div class="admin-empty">Loading dashboard...</div>';
    try {
      const d = await loadDashboard();
      container.innerHTML = `
        ${renderDashboardStats(d)}
        ${renderQuickActions()}
        <div class="admin-grid">
          <div class="admin-card">
            <div class="admin-card-head">Recent Enrollment Activity</div>
            <div class="admin-card-body" id="dashActivity">${renderActivityTable(d.recentActivity || [])}</div>
          </div>
          <div>
            <div class="admin-card" style="margin-bottom:16px">
              <div class="admin-card-head">Enrollment Statistics</div>
              <div class="admin-card-body padded" id="dashStats">${renderEnrollmentStats(d.enrollmentStats)}</div>
            </div>
            <div class="admin-card">
              <div class="admin-card-head">Strand Distribution</div>
              <div class="admin-card-body" id="dashStrands">${renderStrandTable(d.strandDistribution)}</div>
            </div>
          </div>
        </div>`;
      initLayout('dashboard', 'Dashboard', d.pendingEnrollments || 0);
      refreshLayout('dashboard', 'Dashboard');
    } catch (err) {
      container.innerHTML = `<div class="admin-empty">Could not load dashboard. Make sure <strong>python server.py</strong> is running.</div>`;
      console.error(err);
    }
  }

  return {
    getUser,
    requireAuth,
    logout,
    initLayout,
    refreshLayout,
    toggleSidebar,
    toggleNotif,
    loadDashboard,
    loadPendingAdmissions,
    loadAdmissionHistory,
    loadAdmissionDetail,
    reviewAdmission,
    mountDashboard,
    mountApplicationReview,
    statusBadge,
    formatName,
    fetchJson,
    postJson,
    escHtml,
    confirmDialog,
    alertDialog,
    showReviewMessage
  };
})();
