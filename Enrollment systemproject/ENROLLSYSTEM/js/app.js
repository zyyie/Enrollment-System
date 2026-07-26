// Shared application utilities

function getStudent() {
  const data = sessionStorage.getItem('shsStudent');
  return data ? JSON.parse(data) : null;
}

function setStudent(student) {
  sessionStorage.removeItem('shsFaculty');
  sessionStorage.setItem('shsStudent', JSON.stringify(student));
}

function logout() {
  sessionStorage.removeItem('shsStudent');
  sessionStorage.removeItem('loginRole');
  window.location.href = '../login.html';
}

function requireAuth() {
  if (!getStudent()) {
    window.location.href = '../login.html';
    return false;
  }
  return true;
}

function formatStudentName(student) {
  return `${student.lastName}, ${student.firstName} ${student.middleName} (${student.id})`;
}

function formatCurrency(amount) {
  return amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderStudentSidebar(activePage) {
  const pages = [
    { id: 'home', label: 'Home', href: 'home.html', icon: 'home' },
    { id: 'enrollment', label: 'Enrollment', href: 'enrollment.html', icon: 'enrollment' },
    { id: 'accounts', label: 'Accounts', href: 'accounts.html', icon: 'accounts' },
    { id: 'schedule', label: 'Schedule', href: 'schedule.html', icon: 'schedule' },
    { id: 'grades', label: 'Grades', href: 'grades.html', icon: 'grades' },
    { id: 'forms', label: 'Forms', href: 'forms.html', icon: 'forms' }
  ];

  const navLinks = pages.map(p => `
    <a href="${p.href}" class="student-nav-link ${p.id === activePage ? 'active' : ''}">
      ${navIcon(p.icon)}
      ${p.label}
    </a>
  `).join('');

  return `
    <aside class="student-sidebar" id="studentSidebar">
      <div class="student-sidebar-brand">
        <img src="../assets/geranova-logo.png" alt="Geranova Senior High School Logo" class="school-logo xs">
        <span>Geranova Senior High School</span>
      </div>
      <nav class="student-sidebar-nav">
        ${navLinks}
        <a href="settings.html" class="student-nav-link settings-link ${activePage === 'settings' ? 'active' : ''}">
          ${navIcon('settings')}
          Settings
        </a>
        <a href="#" class="student-nav-link logout-link" onclick="logout(); return false;">
          ${navIcon('logout')} Logout
        </a>
      </nav>
    </aside>
    <div class="student-sidebar-overlay" id="studentSidebarOverlay" onclick="toggleStudentSidebar()"></div>
  `;
}

function renderStudentHeader(student) {
  const notifCount = typeof INBOX_MESSAGES !== 'undefined' ? INBOX_MESSAGES.length : 0;

  return `
    <header class="student-header">
      <button class="header-icon-btn student-menu-toggle" type="button" onclick="toggleStudentSidebar()" aria-label="Toggle menu" title="Menu">
        ${navIcon('menu')}
      </button>
      <div class="student-header-actions">
        <button class="header-icon-btn" type="button" onclick="goToNotifications()" title="Notifications" aria-label="Notifications">
          ${navIcon('bell')}
          ${notifCount ? `<span class="header-badge">${notifCount}</span>` : ''}
        </button>
        <div class="header-account-wrap" onclick="event.stopPropagation()">
          <button class="header-icon-btn" type="button" onclick="toggleAccountMenu(event)" title="Account" aria-label="Account">
            ${navIcon('user')}
          </button>
          <div class="account-dropdown" id="accountDropdown">
            <div class="account-dropdown-name">${formatStudentName(student)}</div>
            <button type="button" class="account-dropdown-logout" onclick="logout()">Logout</button>
          </div>
        </div>
      </div>
    </header>
  `;
}

function goToNotifications() {
  window.location.href = 'home.html';
}

function toggleAccountMenu(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('accountDropdown');
  if (dropdown) dropdown.classList.toggle('open');
}

function closeAccountMenu() {
  const dropdown = document.getElementById('accountDropdown');
  if (dropdown) dropdown.classList.remove('open');
}

function toggleStudentSidebar() {
  const sidebar = document.getElementById('studentSidebar');
  const overlay = document.getElementById('studentSidebarOverlay');
  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  if (isMobile) {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
    return;
  }

  document.body.classList.toggle('sidebar-collapsed');
}

function getLoginRole() {
  return 'student';
}

function normalizeStudentAccount(student) {
  if (!student) return null;

  if (typeof student === 'string') {
    try {
      student = JSON.parse(student);
    } catch (err) {
      return null;
    }
  }

  const id = student.id || student.student_id || student.studentId;
  if (!id) return null;

  return {
    id,
    lastName: student.lastName || student.last_name || '',
    firstName: student.firstName || student.first_name || '',
    middleName: student.middleName || student.middle_name || '',
    birthMonth: String(student.birthMonth || student.birth_month || ''),
    birthDay: String(student.birthDay || student.birth_day || ''),
    birthYear: String(student.birthYear || student.birth_year || ''),
    gradeLevel: student.gradeLevel || student.grade_level || 'Grade 11',
    strand: student.strand || student.strandCode || 'GAS',
    strandFull: student.strandFull || student.strand_full || student.strand || 'GAS',
    section: student.section || '',
    track: student.track || 'Academic',
    admissionStatus: student.admissionStatus || student.admission_status || 'New',
    scholasticStatus: student.scholasticStatus || student.scholastic_status || 'Regular',
    schoolYear: student.schoolYear || student.school_year || '2026-2027',
    semester: student.semester || 'First Semester',
    semesterCode: student.semesterCode || student.semester_code || '1st',
    enrollmentOpen: student.enrollmentOpen ?? student.enrollment_open ?? true,
    accountStatus: student.accountStatus || student.account_status || 'active',
    progressionStatus: student.progressionStatus || student.progression_status || 'in_progress',
    grade11Completed: student.grade11Completed ?? student.grade11_completed ?? false,
    voucherQualified: student.voucherQualified || student.voucher_qualified || false
  };
}

async function loginStudentRemote(userId, birthMonth, birthDay, birthYear, password) {
  try {
    const res = await fetch('/api/auth/student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: userId,
        birthMonth,
        birthDay,
        birthYear,
        password: password.trim()
      })
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      console.warn('Student auth API not found — restart server with: python main.py');
      return null;
    }
    const result = JSON.parse(text);
    if (result.success && result.student) {
      return normalizeStudentAccount(result.student);
    }
    if (!result.success && result.error) {
      loginStudentRemote.lastError = result.error + (result.hint ? ` ${result.hint}` : '');
      loginStudentRemote.lastCode = result.code || null;
    }
  } catch (err) {
    console.warn('Server student login unavailable:', err);
  }
  return null;
}

function initStudentLoginPage() {
  sessionStorage.setItem('loginRole', 'student');
  const params = new URLSearchParams(window.location.search);
  if (params.get('role') === 'faculty') {
    const adminUrl = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.adminPortalUrl) || 'http://localhost:8001';
    window.location.href = `${adminUrl.replace(/\/$/, '')}/login.html`;
    return;
  }
  initLoginPage();
}

function initLoginPage() {
  const errorEl = document.getElementById('loginError');
  const birthdateInput = document.getElementById('birthdate');

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  if (birthdateInput) {
    const field = birthdateInput.closest('.date-field');
    if (field) {
      bindDateField(field, { min: '1960-01-01', max: `${new Date().getFullYear()}-12-31` });
    }
  }

  const enrollNowLink = document.getElementById('enrollNowLink');
  document.getElementById('loginTitle').textContent = 'Geranova Senior High School';
  document.getElementById('loginSubtitle').textContent = 'Sign in to your account';
  document.getElementById('idLabel').textContent = 'Student ID';
  document.getElementById('studentId').placeholder = '2026-00145-SHS-0';
  document.getElementById('birthdateGroup').style.display = 'block';
  if (birthdateInput) birthdateInput.setAttribute('required', '');
  if (enrollNowLink) enrollNowLink.style.display = '';
  sessionStorage.setItem('loginRole', 'student');

  const params = new URLSearchParams(window.location.search);
  if (params.get('submitted') === '1' && errorEl) {
    const appNo = params.get('app');
    errorEl.style.display = 'block';
    errorEl.style.background = '#ecfdf5';
    errorEl.style.borderColor = '#86efac';
    errorEl.style.color = '#166534';
    errorEl.innerHTML = appNo
      ? `<strong>Application successfully submitted!</strong><br>Application No: ${appNo}<br>Sign in once your application is approved and your Student ID is issued.`
      : '<strong>Application successfully submitted!</strong><br>Sign in once your application is approved and your Student ID is issued.';
    window.history.replaceState({}, '', 'login.html');
  }
}

function renderFooter() {
  return `
    <footer class="site-footer">
      <span>For questions and comments, email us at <a href="mailto:support@enrollmentsystem.edu.ph">support@enrollmentsystem.edu.ph</a></span>
      <span>
        <a href="#">Enrollment System</a> |
        <a href="#">Terms of Use</a> |
        <a href="#">Privacy Statement</a> |
        Version 01.07.26.A
      </span>
    </footer>
  `;
}

function renderAccessibility() {
  return `
    <button class="accessibility-btn" id="a11yBtn" title="Accessibility" onclick="toggleA11yPanel()">♿</button>
    <div class="accessibility-panel" id="a11yPanel">
      <div class="a11y-header">
        Accessibility Menu
        <button onclick="toggleA11yPanel()">✕</button>
      </div>
      <div class="a11y-body">
        <div class="a11y-profile">
          <label>Seizure Safe Profile</label>
          <div class="a11y-toggle" data-profile="seizure" onclick="toggleProfile(this)"></div>
        </div>
        <div class="a11y-profile">
          <label>Visually Impaired Profile</label>
          <div class="a11y-toggle" data-profile="visual" onclick="toggleProfile(this)"></div>
        </div>
        <div class="a11y-profile">
          <label>ADHD Friendly Profile</label>
          <div class="a11y-toggle" data-profile="adhd" onclick="toggleProfile(this)"></div>
        </div>
        <div class="a11y-profile">
          <label>Cognitive & Learning Profile</label>
          <div class="a11y-toggle" data-profile="cognitive" onclick="toggleProfile(this)"></div>
        </div>
        <div class="font-size-control">
          <span>Adjust Font Size</span>
          <button onclick="adjustFontSize(-1)">−</button>
          <span id="fontSizeLabel">100%</span>
          <button onclick="adjustFontSize(1)">+</button>
        </div>
      </div>
    </div>
  `;
}

function toggleA11yPanel() {
  document.getElementById('a11yPanel').classList.toggle('open');
}

function toggleProfile(el) {
  el.classList.toggle('on');
  const profile = el.dataset.profile;
  if (profile === 'seizure') {
    document.body.classList.toggle('reduce-motion');
  }
  if (profile === 'visual') {
    document.body.classList.toggle('high-contrast');
  }
}

let fontScale = 100;
function adjustFontSize(delta) {
  fontScale = Math.max(80, Math.min(150, fontScale + delta * 10));
  document.documentElement.style.fontSize = fontScale + '%';
  document.getElementById('fontSizeLabel').textContent = fontScale + '%';
}

let accountMenuListenerAttached = false;

function initPage(activePage) {
  if (!requireAuth()) return;
  const student = getStudent();
  document.body.classList.add('student-layout');
  document.getElementById('studentSidebarWrap').innerHTML = renderStudentSidebar(activePage);
  document.getElementById('studentHeader').innerHTML = renderStudentHeader(student);
  document.getElementById('footer').innerHTML = renderFooter();
  document.getElementById('accessibility').innerHTML = renderAccessibility();
  if (!accountMenuListenerAttached) {
    document.addEventListener('click', closeAccountMenu);
    accountMenuListenerAttached = true;
  }
  const infoEl = document.getElementById('studentInfo');
  if (infoEl) infoEl.textContent = formatStudentName(student);
  return student;
}

async function handleLogin(e) {
  e.preventDefault();

  const userIdEl = document.getElementById('studentId');
  const passwordEl = document.getElementById('password');
  const birthdateEl = document.getElementById('birthdate');
  const errorEl = document.getElementById('loginError');
  const role = getLoginRole();
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!userIdEl || !passwordEl || !errorEl) {
    return;
  }

  const userId = userIdEl.value.trim().toUpperCase();
  const birthdateValue = birthdateEl ? birthdateEl.value : '';
  const password = passwordEl.value;
  let birthMonth = '';
  let birthDay = '';
  let birthYear = '';

  if (birthdateValue) {
    const [year, month, day] = birthdateValue.split('-');
    birthYear = String(parseInt(year, 10));
    birthMonth = String(parseInt(month, 10));
    birthDay = String(parseInt(day, 10));
  }

  errorEl.style.display = 'none';
  errorEl.textContent = '';

  if (!userId || !password) {
    errorEl.style.display = 'block';
    errorEl.textContent = 'Please enter your ID and password.';
    return;
  }

  if (role === 'student' && !birthdateValue) {
    errorEl.style.display = 'block';
    errorEl.textContent = 'Please select your birthdate.';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
  }

  try {
    let student = await loginStudentRemote(userId, birthMonth, birthDay, birthYear, password);

    if (!student && typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
      try {
        const remote = await SupabaseService.loginStudent(
          userId, birthMonth, birthDay, birthYear, password.trim()
        );
        if (remote && remote.error) {
          errorEl.textContent = remote.message || 'Account access denied.';
          return;
        }
        student = normalizeStudentAccount(remote);
      } catch (err) {
        console.warn('Supabase student login failed:', err);
      }
    }

    if (
      !student &&
      typeof SAMPLE_STUDENT !== 'undefined' &&
      userId === SAMPLE_STUDENT.id &&
      birthMonth === SAMPLE_STUDENT.birthMonth &&
      birthDay === SAMPLE_STUDENT.birthDay &&
      birthYear === SAMPLE_STUDENT.birthYear &&
      password.trim() === SAMPLE_STUDENT.password
    ) {
      student = normalizeStudentAccount(SAMPLE_STUDENT);
    }

    if (student) {
      setStudent(student);
      window.location.href = 'student/home.html';
      return;
    }

    errorEl.style.display = 'block';
    errorEl.textContent = loginStudentRemote.lastError || 'Invalid Student ID, birthdate, or password.';
    loginStudentRemote.lastError = '';
  } catch (err) {
    console.error('Login error:', err);
    errorEl.style.display = 'block';
    errorEl.textContent = 'Sign in failed. Please try again.';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
    }
  }
}

function populateBirthdateSelects() {
  // Birthdate now uses a single date input on the login form.
}

const StudentDialog = (() => {
  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureRoot() {
    let root = document.getElementById('studentDialogRoot');
    if (root) return root;

    root = document.createElement('div');
    root.id = 'studentDialogRoot';
    root.innerHTML = `
      <div class="student-dialog-overlay" id="studentDialogOverlay" hidden>
        <div class="student-dialog" role="dialog" aria-modal="true" aria-labelledby="studentDialogTitle">
          <div class="student-dialog-icon" id="studentDialogIcon" aria-hidden="true">!</div>
          <h2 id="studentDialogTitle"></h2>
          <p id="studentDialogMessage"></p>
          <div class="student-dialog-actions" id="studentDialogActions"></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    return root;
  }

  function iconFor(type) {
    if (type === 'success') return '✓';
    if (type === 'warning') return '!';
    if (type === 'error') return '×';
    return 'i';
  }

  function show({ type = 'info', title, message, buttons }) {
    ensureRoot();
    const overlay = document.getElementById('studentDialogOverlay');
    const icon = document.getElementById('studentDialogIcon');
    const titleEl = document.getElementById('studentDialogTitle');
    const messageEl = document.getElementById('studentDialogMessage');
    const actions = document.getElementById('studentDialogActions');

    icon.className = `student-dialog-icon is-${type}`;
    icon.textContent = iconFor(type);
    titleEl.textContent = title || 'Notice';
    messageEl.innerHTML = escHtml(message || '').replace(/\n/g, '<br>');

    actions.innerHTML = (buttons || []).map(btn => `
      <button type="button" class="student-dialog-btn ${btn.className || ''}" data-action="${btn.action || 'close'}">
        ${escHtml(btn.label)}
      </button>
    `).join('');

    overlay.hidden = false;
    document.body.classList.add('student-dialog-open');

    return new Promise(resolve => {
      actions.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => {
          overlay.hidden = true;
          document.body.classList.remove('student-dialog-open');
          resolve(button.dataset.action === 'confirm');
        }, { once: true });
      });
    });
  }

  function alert({ type = 'info', title, message }) {
    return show({
      type,
      title,
      message,
      buttons: [{ label: 'OK', action: 'close', className: 'is-primary' }]
    });
  }

  function confirm({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'primary' }) {
    return show({
      type: variant === 'danger' ? 'warning' : 'info',
      title,
      message,
      buttons: [
        { label: cancelLabel, action: 'close', className: 'is-secondary' },
        { label: confirmLabel, action: 'confirm', className: variant === 'danger' ? 'is-danger' : 'is-primary' }
      ]
    });
  }

  return { alert, confirm };
})();
