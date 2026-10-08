// Shared application utilities

function getStudent() {
  const data = sessionStorage.getItem('shsStudent');
  return data ? JSON.parse(data) : null;
}

function setStudent(student) {
  sessionStorage.removeItem('shsFaculty');
  sessionStorage.setItem('shsStudent', JSON.stringify(student));
}

function logout(reason) {
  sessionStorage.removeItem('shsStudent');
  sessionStorage.removeItem('loginRole');
 sessionStorage.removeItem('shsStudentLastActivity');
 const idle = reason === 'idle';
 window.location.href = '../login.html' + (idle ? '?idle=1' : '');
}

function requireAuth() {
 const student = getStudent();
 if (!student) {
    window.location.href = '../login.html';
    return false;
  }
 if (student.mustChangePassword) {
 const page = (window.location.pathname || '').split('/').pop();
 if (page !== 'settings.html') {
 window.location.href = 'settings.html';
 return false;
 }
  }
  return true;
}

function formatStudentName(student) {
  return `${student.lastName}, ${student.firstName} ${student.middleName} (${student.id})`;
}

function getTimeGreeting() {
 const hour = new Date().getHours();
 if (hour < 12) return 'Good morning';
 if (hour < 17) return 'Good afternoon';
 return 'Good evening';
}

function renderStudentHomeWelcome(student) {
 const firstName = (student.firstName || 'Student').trim();
 const schoolYear = student.schoolYear || '2026-2027';
 const gradeLevel = student.gradeLevel || 'Grade 11';
 const strand = student.strandFull || student.strand || 'STEM';
 const semester = student.semester || 'First Semester';
 const section = student.section ? `Section ${student.section}` : '';

 return `
 <div class="home-welcome-copy">
 <p class="home-welcome-greeting">${getTimeGreeting()}, ${firstName}!</p>
 <h1 class="home-welcome-title">Student Portal</h1>
 <p class="home-welcome-desc">
 Manage enrollment, payment, schedule, grades, and forms from here.
 </p>
 <p class="home-welcome-id">${formatStudentName(student)}</p>
 <div class="home-welcome-badges">
 <span class="home-badge">${schoolYear}</span>
 <span class="home-badge">${gradeLevel}</span>
 <span class="home-badge">${strand}</span>
 <span class="home-badge">${semester}</span>
 ${section ? `<span class="home-badge">${section}</span>` : ''}
 </div>
 </div>
 `;
}

function renderStudentHomeQuickLinks() {
 const links = [
 { href: 'enrollment.html', icon: 'enrollment', label: 'Enrollment', desc: 'Subjects and enrollment status' },
 { href: 'accounts.html', icon: 'accounts', label: 'Payment', desc: 'Tuition and payment records' },
 { href: 'schedule.html', icon: 'schedule', label: 'Schedule', desc: 'Your weekly class timetable' },
 { href: 'grades.html', icon: 'grades', label: 'Grades', desc: 'View academic performance' },
 { href: 'curriculum.html', icon: 'curriculum', label: 'Curriculum', desc: 'Subjects per strand and prerequisites' },
 { href: 'forms.html', icon: 'forms', label: 'Forms', desc: 'Download official documents' },
 ];

 return links.map(link => `
 <a href="${link.href}" class="home-quick-card">
 <span class="home-quick-icon">${navIcon(link.icon)}</span>
 <span class="home-quick-label">${link.label}</span>
 <span class="home-quick-desc">${link.desc}</span>
 </a>
 `).join('');
}

function initStudentHome(student) {
 const welcomeEl = document.getElementById('homeWelcome');
 const quickEl = document.getElementById('homeQuickLinks');
 if (welcomeEl) welcomeEl.innerHTML = renderStudentHomeWelcome(student);
 if (quickEl) quickEl.innerHTML = renderStudentHomeQuickLinks();
}

function formatCurrency(amount) {
  return amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderStudentSidebar(activePage) {
  const pages = [
    { id: 'home', label: 'Home', href: 'home.html', icon: 'home' },
    { id: 'enrollment', label: 'Enrollment', href: 'enrollment.html', icon: 'enrollment' },
 { id: 'accounts', label: 'Payment', href: 'accounts.html', icon: 'accounts' },
    { id: 'schedule', label: 'Schedule', href: 'schedule.html', icon: 'schedule' },
    { id: 'grades', label: 'Grades', href: 'grades.html', icon: 'grades' },
 { id: 'curriculum', label: 'Curriculum', href: 'curriculum.html', icon: 'curriculum' },
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
 <span>Enrollment Management System</span>
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

function renderStudentAccountAvatar(student) {
 const photoUrl = student?.profilePhotoUrl;
 if (photoUrl) {
 const safeUrl = String(photoUrl)
 .replace(/&/g, '&amp;')
 .replace(/"/g, '&quot;')
 .replace(/</g, '&lt;');
 return `<img src="${safeUrl}" alt="Student profile photo" class="header-profile-photo">`;
 }
 return navIcon('user');
}

function applyStudentProfilePhoto(url) {
 const btn = document.querySelector('.header-account-wrap .header-icon-btn');
 if (!btn || !url) return;
 const safeUrl = String(url)
 .replace(/&/g, '&amp;')
 .replace(/"/g, '&quot;')
 .replace(/</g, '&lt;');
 btn.innerHTML = `<img src="${safeUrl}" alt="Student profile photo" class="header-profile-photo">`;
 btn.classList.add('has-profile-photo');
}

function updateAccountDropdownPhoto(url) {
 const photoWrap = document.querySelector('.account-dropdown-photo');
 if (!photoWrap || !url) return;
 const safeUrl = String(url)
 .replace(/&/g, '&amp;')
 .replace(/"/g, '&quot;')
 .replace(/</g, '&lt;');
 photoWrap.innerHTML = `<img src="${safeUrl}" alt="" class="account-dropdown-photo-img">`;
}

async function refreshStudentProfilePhoto(student) {
 if (!student?.id) return;
 if (student.profilePhotoUrl) {
 applyStudentProfilePhoto(student.profilePhotoUrl);
 return;
 }
 try {
 const res = await fetch(`/api/student/profile-photo?id=${encodeURIComponent(student.id)}`);
 const data = await res.json();
 if (data.success && data.url) {
 student.profilePhotoUrl = data.url;
 setStudent(student);
 applyStudentProfilePhoto(data.url);
 updateAccountDropdownPhoto(data.url);
 }
 } catch (err) {
 console.warn('Could not load student profile photo:', err);
 }
}

const STUDENT_MODULE_TITLES = {
 home: 'Home',
 enrollment: 'Enrollment',
 accounts: 'Payment',
 schedule: 'Schedule',
 grades: 'Grades',
 curriculum: 'Curriculum',
 forms: 'Forms',
 settings: 'Settings',
};

function formatStudentDisplayName(student) {
 return `${student.lastName}, ${student.firstName} ${student.middleName}`.trim();
}

function renderAccountDropdown(student) {
 const photoHtml = student?.profilePhotoUrl
 ? `<img src="${String(student.profilePhotoUrl).replace(/"/g, '&quot;')}" alt="" class="account-dropdown-photo-img">`
 : `<span class="account-dropdown-photo-fallback">${navIcon('user')}</span>`;

 return `
 <div class="account-dropdown" id="accountDropdown">
 <div class="account-dropdown-header">
 <div class="account-dropdown-photo">${photoHtml}</div>
 <div class="account-dropdown-heading">
 <div class="account-dropdown-name">${formatStudentDisplayName(student)}</div>
 <div class="account-dropdown-id">${student.id}</div>
 </div>
 </div>
 <div class="account-dropdown-info">
 <div class="account-info-row">
 <span>Strand</span>
 <strong>${student.strandFull || student.strand || '—'}</strong>
 </div>
 <div class="account-info-row">
 <span>Grade Level</span>
 <strong>${student.gradeLevel || '—'}</strong>
 </div>
 <div class="account-info-row">
 <span>Section</span>
 <strong>${student.section || '—'}</strong>
 </div>
 <div class="account-info-row">
 <span>School Year</span>
 <strong>${student.schoolYear || '—'} — ${student.semester || '—'}</strong>
 </div>
 <div class="account-info-row">
 <span>Status</span>
 <strong>${student.scholasticStatus || student.enrollmentStatus || 'Enrolled'}</strong>
 </div>
 </div>
 <button type="button" class="account-dropdown-logout" onclick="logout()">Logout</button>
 </div>
 `;
}

function renderStudentHeader(student, activePage = 'home') {
 if (activePage === 'home') {
  const notifCount = typeof INBOX_MESSAGES !== 'undefined' ? INBOX_MESSAGES.length : 0;
 const avatarClass = student?.profilePhotoUrl ? 'header-icon-btn has-profile-photo' : 'header-icon-btn';

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
 <button class="${avatarClass}" type="button" onclick="toggleAccountMenu(event)" title="Account" aria-label="Account">
 ${renderStudentAccountAvatar(student)}
          </button>
 ${renderAccountDropdown(student)}
        </div>
      </div>
    </header>
  `;
 }

 const title = STUDENT_MODULE_TITLES[activePage] || activePage;
 return `
 <header class="student-header student-header-module">
 <h1 class="student-header-title">${title}</h1>
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
 strand: student.strand || student.strandCode || 'STEM',
 strandFull: student.strandFull || student.strand_full || student.strand || 'STEM',
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
 voucherQualified: student.voucherQualified || student.voucher_qualified || false,
 profilePhotoUrl: student.profilePhotoUrl || student.profile_photo_url || '',
 email: student.email || '',
 gender: student.gender || '',
 address: student.address || '',
 contactNumber: student.contactNumber || student.contact_number || '',
 oldStudentReturnee: !!(student.oldStudentReturnee),
 enrollmentStage: student.enrollmentStage || '',
 enrollmentStageLabel: student.enrollmentStageLabel || '',
 mustChangePassword: !!student.mustChangePassword,
 };
}

async function loginStudentRemote(userId, password) {
  try {
    const res = await fetch('/api/auth/student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: userId,
        password: password.trim()
      })
    });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
 console.warn('Student auth API not found — restart server with: python server.py');
      return null;
    }
    const result = JSON.parse(text);
    if (result.success && result.student) {
 loginStudentRemote.lastLockUntil = null;
      return normalizeStudentAccount(result.student);
    }
    if (!result.success && result.error) {
      loginStudentRemote.lastError = result.error + (result.hint ? ` ${result.hint}` : '');
 loginStudentRemote.lastCode = result.code || null;
 loginStudentRemote.lastLockUntil = result.lockUntil || null;
 loginStudentRemote.lastFails = result.failedAttempts || null;
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

 if (errorEl) {
 errorEl.style.display = 'none';
 errorEl.textContent = '';
 }

 document.getElementById('loginTitle').textContent = 'Enrollment Management System';
 document.getElementById('loginSubtitle').textContent = 'Log in to your account';
 document.getElementById('idLabel').textContent = 'Student ID';
 document.getElementById('studentId').placeholder = '2026-00145-SHS-0';
 const birthdateGroup = document.getElementById('birthdateGroup');
 if (birthdateGroup) birthdateGroup.style.display = 'none';
 sessionStorage.setItem('loginRole', 'student');
 initForgotPasswordModal();
 initEnrollmentEntryTypeCard();
 initStudentAuthSlider();
 refreshLoginLockoutUI();

 const params = new URLSearchParams(window.location.search);
 if (params.get('idle') === '1' && errorEl && params.get('submitted') !== '1') {
 errorEl.style.display = 'block';
 errorEl.textContent = 'You were signed out after 15 minutes of inactivity. Please log in again.';
 window.history.replaceState({}, '', 'login.html');
 }
 if (params.get('submitted') === '1' && errorEl) {
 const appNo = params.get('app');
 errorEl.style.display = 'block';
 errorEl.style.background = '#ecfdf5';
 errorEl.style.borderColor = '#86efac';
 errorEl.style.color = '#166534';
 errorEl.innerHTML = appNo
 ? `<strong>Application successfully submitted!</strong><br>Application No: ${appNo}<br>A confirmation email has been sent to your inbox. Please wait for a separate follow-up email informing you whether your application has been approved or not. Once approved, you will receive your Student ID and temporary password. Your Registration Form will be emailed after tuition payment is approved.`
 : '<strong>Application successfully submitted!</strong><br>A confirmation email has been sent. Please wait for a separate follow-up email regarding your application status.';
 window.history.replaceState({}, '', 'login.html');
 }
}

const ADMISSION_ENTRY_TYPE_KEY = 'geranova_admission_entry_type';

function normalizeEnrollmentEntryType(value) {
 const type = String(value || '').toLowerCase();
 return type === 'new' || type === 'transferee' || type === 'returnee' ? type : 'new';
}

function buildEnrollStartUrl(type) {
 const normalized = normalizeEnrollmentEntryType(type);
 if (normalized === 'returnee') {
  return 'enroll-old-student.html';
 }
 return `enroll.html?new=1&type=${encodeURIComponent(normalized)}`;
}

function initStudentAuthSlider() {
 const card = document.getElementById('studentAuthCard');
 const showEnroll = document.getElementById('authShowEnroll');
 const showLogin = document.getElementById('authShowSignIn');
 if (!card || !showEnroll || !showLogin) return;

 function setAuthEnrollView(isEnroll) {
 if (isEnroll) card.classList.add('auth-enroll-active');
 else card.classList.remove('auth-enroll-active');
 syncAuthMobileSwitch(isEnroll);
 }

 showLogin.addEventListener('click', () => setAuthEnrollView(false));
 showEnroll.addEventListener('click', () => setAuthEnrollView(true));

 const mobileLogin = document.getElementById('authMobileLogin');
 const mobileEnroll = document.getElementById('authMobileEnroll');
 mobileLogin?.addEventListener('click', () => setAuthEnrollView(false));
 mobileEnroll?.addEventListener('click', () => setAuthEnrollView(true));

 const params = new URLSearchParams(window.location.search);
 if (params.get('view') === 'enroll') {
 setAuthEnrollView(true);
 window.history.replaceState({}, '', 'login.html');
 }
}

function syncAuthMobileSwitch(isEnroll) {
 const loginBtn = document.getElementById('authMobileLogin');
 const enrollBtn = document.getElementById('authMobileEnroll');
 if (loginBtn) loginBtn.classList.toggle('is-active', !isEnroll);
 if (enrollBtn) enrollBtn.classList.toggle('is-active', isEnroll);
}

function initEnrollmentEntryTypeCard() {
 const card = document.querySelector('.login-enroll-card');
 if (!card) return;

 const radios = card.querySelectorAll('input[name="enrollmentEntryType"]');
 const startBtn = document.getElementById('btnStartEnrollment');
 const noteEl = card.querySelector('.login-enroll-note');
 if (!radios.length) return;

 let saved = 'new';
 try {
 saved = normalizeEnrollmentEntryType(sessionStorage.getItem(ADMISSION_ENTRY_TYPE_KEY));
  } catch (err) {
 saved = 'new';
 }

 radios.forEach((radio) => {
 radio.checked = radio.value === saved;
 });

 function syncEnrollmentLinks() {
 const selected = card.querySelector('input[name="enrollmentEntryType"]:checked');
 const type = normalizeEnrollmentEntryType(selected?.value);
 try {
 sessionStorage.setItem(ADMISSION_ENTRY_TYPE_KEY, type);
    } catch (err) {
 /* ignore */
 }
 const url = buildEnrollStartUrl(type);
 if (startBtn) {
  startBtn.href = url;
  startBtn.textContent = type === 'returnee'
   ? 'Continue — verify Student ID'
   : 'Continue to enrollment';
 }
 if (noteEl) {
  if (type === 'returnee') {
   noteEl.textContent = 'Old Student: verify your existing Student ID. Your Grade 11 records stay intact; Grade 12 enrollment uses your saved information.';
  } else if (type === 'transferee') {
   noteEl.textContent = 'Select your applicant type. Your choice will carry through to Academic Information.';
  } else {
   noteEl.textContent = 'Select your applicant type. Your choice will carry through to Academic Information.';
  }
 }
 }

 radios.forEach((radio) => radio.addEventListener('change', syncEnrollmentLinks));
 syncEnrollmentLinks();
}

function initForgotPasswordModal() {
 const overlay = document.getElementById('forgotPasswordOverlay');
 const openBtn = document.getElementById('forgotPasswordBtn');
 const closeBtn = document.getElementById('forgotPasswordClose');
 const form = document.getElementById('forgotPasswordForm');
 const emailInput = document.getElementById('forgotEmail');
 const errorEl = document.getElementById('forgotPasswordError');
 const submitBtn = document.getElementById('forgotPasswordSubmit');

 if (!overlay || !openBtn || !form) return;

 function closeModal() {
 overlay.hidden = true;
 document.body.classList.remove('forgot-password-open');
 if (errorEl) {
 errorEl.style.display = 'none';
 errorEl.textContent = '';
 }
 }

 function openModal() {
 overlay.hidden = false;
 document.body.classList.add('forgot-password-open');
 if (emailInput) {
 emailInput.value = '';
 emailInput.focus();
 }
 if (errorEl) {
 errorEl.style.display = 'none';
 errorEl.textContent = '';
 }
 }

 openBtn.addEventListener('click', openModal);
 if (closeBtn) closeBtn.addEventListener('click', closeModal);
 overlay.addEventListener('click', (e) => {
 if (e.target === overlay) closeModal();
 });

 form.addEventListener('submit', async (e) => {
 e.preventDefault();
 const email = (emailInput?.value || '').trim();
 if (!email) {
 if (errorEl) {
 errorEl.style.display = 'block';
 errorEl.textContent = 'Please enter your email address.';
 }
 return;
 }

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }
 if (submitBtn) {
 submitBtn.disabled = true;
 submitBtn.textContent = 'Sending...';
 }

 try {
 const res = await fetch('/api/student/forgot-password', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ email })
 });
 const text = await res.text();
 let result = {};
 try {
 result = JSON.parse(text);
 } catch (_) {
 throw new Error('Server unavailable. Restart with: python server.py');
 }

 if (!res.ok || !result.success) {
 if (errorEl) {
 errorEl.style.display = 'block';
 errorEl.textContent = result.error || 'Unable to process your request. Please try again.';
 }
 return;
 }

 closeModal();
 await StudentDialog.alert({
 type: 'success',
 title: 'Check Your Email',
 message: result.message || 'If your email is registered, you will receive a new password shortly.'
 });
 } catch (err) {
 if (errorEl) {
 errorEl.style.display = 'block';
 errorEl.textContent = err.message || 'Something went wrong. Please try again.';
 }
 } finally {
 if (submitBtn) {
 submitBtn.disabled = false;
 submitBtn.textContent = 'Send New Password';
 }
 }
 });
}

const A11Y_STORAGE_KEY = 'shsAccessibilityPrefs';
const ENABLE_ACCESSIBILITY_WIDGET = false;

const defaultA11yPrefs = {
 fontScale: 100,
 seizure: false,
 visual: false,
 adhd: false,
 cognitive: false,
};

let a11yClickListenerAttached = false;

function loadA11yPrefs() {
 try {
 const raw = sessionStorage.getItem(A11Y_STORAGE_KEY);
 if (!raw) return { ...defaultA11yPrefs };
 return { ...defaultA11yPrefs, ...JSON.parse(raw) };
 } catch {
 return { ...defaultA11yPrefs };
 }
}

let a11yPrefs = loadA11yPrefs();

function saveA11yPrefs() {
 sessionStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(a11yPrefs));
}

function applyA11yScale(scale) {
 const factor = scale / 100;
 const main = document.querySelector('.student-main');
 document.documentElement.style.setProperty('--a11y-scale', String(factor));

 if (main) {
 if ('zoom' in main.style) {
 main.style.zoom = factor === 1 ? '' : String(factor);
  } else {
 main.style.fontSize = factor === 1 ? '' : `${scale}%`;
 }
 }
}

function syncA11yBodyClasses() {
 const body = document.body;
 body.classList.toggle('a11y-seizure', a11yPrefs.seizure);
 body.classList.toggle('a11y-visual', a11yPrefs.visual);
 body.classList.toggle('a11y-adhd', a11yPrefs.adhd);
 body.classList.toggle('a11y-cognitive', a11yPrefs.cognitive);
}

function applyA11yPrefs() {
 syncA11yBodyClasses();
 applyA11yScale(a11yPrefs.fontScale);

 const label = document.getElementById('fontSizeLabel');
 if (label) label.textContent = `${a11yPrefs.fontScale}%`;

 document.querySelectorAll('.a11y-toggle[data-profile]').forEach(toggle => {
 const on = Boolean(a11yPrefs[toggle.dataset.profile]);
 toggle.classList.toggle('on', on);
 toggle.setAttribute('aria-checked', on ? 'true' : 'false');
 });
}

function attachA11yListeners() {
 if (a11yClickListenerAttached) return;
 document.addEventListener('click', event => {
 const panel = document.getElementById('a11yPanel');
 const btn = document.getElementById('a11yBtn');
 if (!panel?.classList.contains('open')) return;
 if (panel.contains(event.target) || btn?.contains(event.target)) return;
 panel.classList.remove('open');
 });
 a11yClickListenerAttached = true;
}

function resetA11yEffects() {
 document.body.classList.remove('a11y-seizure', 'a11y-visual', 'a11y-adhd', 'a11y-cognitive');
 const main = document.querySelector('.student-main');
 if (main) {
 main.style.zoom = '';
 main.style.fontSize = '';
 }
 document.documentElement.style.removeProperty('--a11y-scale');
}

function mountAccessibilityWidget() {
 const host = document.getElementById('accessibility');
 if (!ENABLE_ACCESSIBILITY_WIDGET) {
 if (host) host.innerHTML = '';
 resetA11yEffects();
 return;
 }
 if (host) host.innerHTML = renderAccessibility();
 applyA11yPrefs();
 attachA11yListeners();
}

function renderAccessibility() {
  return `
 <button class="accessibility-btn" id="a11yBtn" type="button" title="Accessibility" aria-label="Open accessibility menu" onclick="toggleA11yPanel(event)">
 ${navIcon('accessibility')}
 </button>
 <div class="accessibility-panel" id="a11yPanel" onclick="event.stopPropagation()">
      <div class="a11y-header">
        Accessibility Menu
 <button type="button" class="a11y-close-btn" onclick="toggleA11yPanel(event)" aria-label="Close accessibility menu">
 ${navIcon('close')}
 </button>
      </div>
      <div class="a11y-body">
        <div class="a11y-profile">
 <label for="a11yToggleSeizure">Seizure Safe Profile</label>
 <button type="button" id="a11yToggleSeizure" class="a11y-toggle" role="switch" aria-checked="${a11yPrefs.seizure ? 'true' : 'false'}" data-profile="seizure" onclick="toggleProfile(this)"></button>
        </div>
        <div class="a11y-profile">
 <label for="a11yToggleVisual">Visually Impaired Profile</label>
 <button type="button" id="a11yToggleVisual" class="a11y-toggle" role="switch" aria-checked="${a11yPrefs.visual ? 'true' : 'false'}" data-profile="visual" onclick="toggleProfile(this)"></button>
        </div>
        <div class="a11y-profile">
 <label for="a11yToggleAdhd">ADHD Friendly Profile</label>
 <button type="button" id="a11yToggleAdhd" class="a11y-toggle" role="switch" aria-checked="${a11yPrefs.adhd ? 'true' : 'false'}" data-profile="adhd" onclick="toggleProfile(this)"></button>
        </div>
        <div class="a11y-profile">
 <label for="a11yToggleCognitive">Cognitive & Learning Profile</label>
 <button type="button" id="a11yToggleCognitive" class="a11y-toggle" role="switch" aria-checked="${a11yPrefs.cognitive ? 'true' : 'false'}" data-profile="cognitive" onclick="toggleProfile(this)"></button>
        </div>
        <div class="font-size-control">
          <span>Adjust Font Size</span>
 <button type="button" class="a11y-font-btn" onclick="adjustFontSize(-1)" aria-label="Decrease font size">${navIcon('minus')}</button>
 <span id="fontSizeLabel">${a11yPrefs.fontScale}%</span>
 <button type="button" class="a11y-font-btn" onclick="adjustFontSize(1)" aria-label="Increase font size">${navIcon('plus')}</button>
        </div>
      </div>
    </div>
  `;
}

function toggleA11yPanel(event) {
 if (event) event.stopPropagation();
 document.getElementById('a11yPanel')?.classList.toggle('open');
}

function toggleProfile(el) {
  const profile = el.dataset.profile;
 if (!profile) return;

 const on = !el.classList.contains('on');
 el.classList.toggle('on', on);
 el.setAttribute('aria-checked', on ? 'true' : 'false');
 a11yPrefs[profile] = on;
 syncA11yBodyClasses();
 saveA11yPrefs();
}

function adjustFontSize(delta) {
 a11yPrefs.fontScale = Math.max(80, Math.min(150, a11yPrefs.fontScale + delta * 10));
 applyA11yScale(a11yPrefs.fontScale);
 const label = document.getElementById('fontSizeLabel');
 if (label) label.textContent = `${a11yPrefs.fontScale}%`;
 saveA11yPrefs();
}

let accountMenuListenerAttached = false;

function ensureFontAwesome() {
 if (document.getElementById('fa-css')) return;
 const link = document.createElement('link');
 link.id = 'fa-css';
 link.rel = 'stylesheet';
 link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
 link.crossOrigin = 'anonymous';
 link.referrerPolicy = 'no-referrer';
 document.head.appendChild(link);
}

function updateHeaderNotificationBadge(count) {
 const btn = document.querySelector('.student-header-actions .header-icon-btn[title="Notifications"]');
 if (!btn) return;
 let badge = btn.querySelector('.header-badge');
 if (count > 0) {
 if (!badge) {
 badge = document.createElement('span');
 badge.className = 'header-badge';
 btn.appendChild(badge);
 }
 badge.textContent = count;
 } else if (badge) {
 badge.remove();
 }
}

function applyStudentPortalSettings() {
 try {
 const raw = localStorage.getItem('shsStudentSettings');
 if (!raw) return;
 const prefs = JSON.parse(raw);
 if (prefs.compactSidebar) {
 document.body.classList.add('sidebar-collapsed');
 }
 } catch {
 /* ignore invalid saved settings */
 }
}

function initPage(activePage) {
  if (!requireAuth()) return;
 ensureFontAwesome();
  const student = getStudent();
  document.body.classList.add('student-layout');
 applyStudentPortalSettings();
  document.getElementById('studentSidebarWrap').innerHTML = renderStudentSidebar(activePage);
 document.getElementById('studentHeader').innerHTML = renderStudentHeader(student, activePage);
 const footerEl = document.getElementById('footer');
 if (footerEl) footerEl.remove();
 mountAccessibilityWidget();
  if (!accountMenuListenerAttached) {
    document.addEventListener('click', closeAccountMenu);
    accountMenuListenerAttached = true;
  }
  const infoEl = document.getElementById('studentInfo');
  if (infoEl) infoEl.textContent = formatStudentName(student);
 if (activePage === 'home') {
 initStudentHome(student);
 refreshStudentProfilePhoto(student);
 }
 startStudentIdleLogout();
  return student;
}

const IDLE_LIMIT_MS = 15 * 60 * 1000;
const IDLE_WARN_MS = 60 * 1000;
let _idleWarnEl = null;

function ensureIdleWarning() {
 if (_idleWarnEl) return _idleWarnEl;
 _idleWarnEl = document.createElement('div');
 _idleWarnEl.id = 'idleLogoutWarning';
 _idleWarnEl.className = 'idle-logout-warning';
 _idleWarnEl.hidden = true;
 document.body.appendChild(_idleWarnEl);
 return _idleWarnEl;
}

function startStudentIdleLogout() {
 if (window.__studentIdleStarted) return;
 window.__studentIdleStarted = true;
 const key = 'shsStudentLastActivity';
 const touch = () => {
 sessionStorage.setItem(key, String(Date.now()));
 const el = ensureIdleWarning();
 el.hidden = true;
 };
 touch();
 let lastMove = 0;
 document.addEventListener('mousemove', () => {
 const now = Date.now();
 if (now - lastMove < 15000) return;
 lastMove = now;
 touch();
 }, { passive: true });
 ['click', 'keydown', 'touchstart', 'scroll'].forEach((eventName) => {
 document.addEventListener(eventName, touch, { passive: true });
 });
 document.addEventListener('visibilitychange', () => {
 if (document.visibilityState !== 'visible' || !getStudent()) return;
 const last = Number(sessionStorage.getItem(key) || Date.now());
 if (Date.now() - last >= IDLE_LIMIT_MS) logout('idle');
 });
 setInterval(() => {
 if (!getStudent()) return;
 const last = Number(sessionStorage.getItem(key) || Date.now());
 const idleFor = Date.now() - last;
 if (idleFor >= IDLE_LIMIT_MS) {
 logout('idle');
 return;
 }
 const el = ensureIdleWarning();
 const left = IDLE_LIMIT_MS - idleFor;
 if (left <= IDLE_WARN_MS) {
 el.hidden = false;
 el.textContent = `You will be signed out in ${Math.max(1, Math.ceil(left / 1000))}s because of inactivity.`;
 } else {
 el.hidden = true;
 }
 }, 1000);
}

const LOGIN_LOCK_KEY = 'shsStudentLoginLock';
const LOGIN_LOCK_SECONDS = 30;
const LOGIN_MAX_FAILS = 3;
let _loginLockTimer = null;

function readLoginLockState() {
 try {
  return JSON.parse(localStorage.getItem(LOGIN_LOCK_KEY) || 'null') || { fails: 0, lockUntil: 0 };
 } catch (err) {
  return { fails: 0, lockUntil: 0 };
 }
}

function writeLoginLockState(state) {
 try {
  localStorage.setItem(LOGIN_LOCK_KEY, JSON.stringify(state));
 } catch (err) { /* ignore */ }
}

function clearLoginLockState() {
 try {
  localStorage.removeItem(LOGIN_LOCK_KEY);
 } catch (err) { /* ignore */ }
 if (_loginLockTimer) {
  clearInterval(_loginLockTimer);
  _loginLockTimer = null;
 }
}

function getLoginLockRemainingSec(state) {
 const until = Number(state?.lockUntil || 0);
 if (!until) return 0;
 return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

function setLoginFormDisabled(disabled) {
 const form = document.querySelector('#studentAuthCard form.auth-form');
 if (!form) return;
 form.querySelectorAll('input, button[type="submit"]').forEach((el) => {
  if (el.id === 'forgotPasswordBtn') return;
  el.disabled = !!disabled;
 });
}

function refreshLoginLockoutUI() {
 const errorEl = document.getElementById('loginError');
 const state = readLoginLockState();
 const remaining = getLoginLockRemainingSec(state);
 if (remaining <= 0) {
  if (state.lockUntil) {
   writeLoginLockState({ fails: 0, lockUntil: 0 });
  }
  setLoginFormDisabled(false);
  if (_loginLockTimer) {
   clearInterval(_loginLockTimer);
   _loginLockTimer = null;
  }
  return 0;
 }
 setLoginFormDisabled(true);
 if (errorEl) {
  errorEl.style.display = 'block';
  errorEl.style.background = '';
  errorEl.style.borderColor = '';
  errorEl.style.color = '';
  errorEl.textContent = `Too many failed attempts. Try again in ${remaining}s.`;
 }
 if (!_loginLockTimer) {
  _loginLockTimer = setInterval(() => {
   const left = refreshLoginLockoutUI();
   if (left <= 0 && errorEl && /Too many failed attempts/.test(errorEl.textContent || '')) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
   }
  }, 1000);
 }
 return remaining;
}

function recordLoginFailureClient(serverLockUntil) {
 const state = readLoginLockState();
 if (serverLockUntil) {
  writeLoginLockState({ fails: LOGIN_MAX_FAILS, lockUntil: Number(serverLockUntil) });
  refreshLoginLockoutUI();
  return;
 }
 const fails = Number(state.fails || 0) + 1;
 if (fails >= LOGIN_MAX_FAILS) {
  writeLoginLockState({ fails, lockUntil: Date.now() + LOGIN_LOCK_SECONDS * 1000 });
 } else {
  writeLoginLockState({ fails, lockUntil: 0 });
 }
 refreshLoginLockoutUI();
}

async function handleLogin(e) {
  e.preventDefault();

  const userIdEl = document.getElementById('studentId');
  const passwordEl = document.getElementById('password');
  const errorEl = document.getElementById('loginError');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!userIdEl || !passwordEl || !errorEl) {
    return;
  }

 const remaining = refreshLoginLockoutUI();
 if (remaining > 0) {
 errorEl.style.display = 'block';
 errorEl.textContent = `Too many failed attempts. Try again in ${remaining}s.`;
    return;
  }

  const userId = userIdEl.value.trim().toUpperCase();
  const password = passwordEl.value;

  errorEl.style.display = 'none';
  errorEl.textContent = '';

  if (!userId || !password) {
    errorEl.style.display = 'block';
 errorEl.textContent = 'Please enter your Student ID and password.';
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
  }

  try {
 loginStudentRemote.lastError = '';
 loginStudentRemote.lastCode = null;
 loginStudentRemote.lastLockUntil = null;
 let student = await loginStudentRemote(userId, password);

 if (!student && loginStudentRemote.lastCode === 'LOGIN_LOCKED') {
  const until = loginStudentRemote.lastLockUntil;
  if (until) writeLoginLockState({ fails: LOGIN_MAX_FAILS, lockUntil: Number(until) });
  refreshLoginLockoutUI();
      errorEl.style.display = 'block';
  errorEl.textContent = loginStudentRemote.lastError || `Too many failed attempts. Try again in ${LOGIN_LOCK_SECONDS}s.`;
  loginStudentRemote.lastError = '';
      return;
    }

    if (!student && typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
      try {
 const remote = await SupabaseService.loginStudent(userId, password.trim());
 if (remote && remote.error) {
 errorEl.textContent = remote.message || 'Account access denied.';
 recordLoginFailureClient();
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
      password.trim() === SAMPLE_STUDENT.password
    ) {
      student = normalizeStudentAccount(SAMPLE_STUDENT);
    }

    if (student) {
 clearLoginLockState();
      setStudent(student);
 if (student.mustChangePassword) {
 window.location.href = 'student/settings.html';
 } else {
      window.location.href = 'student/home.html';
 }
      return;
    }

 recordLoginFailureClient(loginStudentRemote.lastLockUntil);
 const state = readLoginLockState();
 const left = getLoginLockRemainingSec(state);
    errorEl.style.display = 'block';
 if (left > 0) {
  errorEl.textContent = `Too many failed attempts. Try again in ${left}s.`;
 } else {
  const fails = Number(state.fails || 0);
  errorEl.textContent = (loginStudentRemote.lastError || 'Invalid Student ID or password.')
   + (fails > 0 ? ` (${fails}/${LOGIN_MAX_FAILS} failed attempts)` : '');
 }
    loginStudentRemote.lastError = '';
  } catch (err) {
    console.error('Login error:', err);
    errorEl.style.display = 'block';
 errorEl.textContent = 'Sign in failed. Please try again.';
  } finally {
 if (submitBtn && getLoginLockRemainingSec(readLoginLockState()) <= 0) {
      submitBtn.disabled = false;
 submitBtn.textContent = 'Login';
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
