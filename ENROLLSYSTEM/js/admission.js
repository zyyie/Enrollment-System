// Step-by-step new student admission enrollment

const ADMISSION_STEPS = [
 { id: 1, label: 'Personal Info' },
 { id: 2, label: 'Address' },
 { id: 3, label: 'Academic Info' },
 { id: 4, label: 'Profile Photo' },
 { id: 5, label: 'Schedule & Strand' },
 { id: 6, label: 'Documents' },
 { id: 7, label: 'Payment' },
 { id: 8, label: 'Review & Submit' }
];

const TOTAL_ADMISSION_STEPS = ADMISSION_STEPS.length;

const REQUIRED_DOCUMENTS = [
 { key: 'form_138', label: 'Original Copy of Form 138 (Report Card) signed by the Principal' },
 { key: 'form_137', label: 'Original Copy of Form 137' },
 { key: 'good_moral', label: 'Original Copy of Certificate of Good Moral Character' },
 { key: 'birth_certificate', label: 'Photocopy of Birth Certificate issued by PSA' },
 { key: 'high_school_diploma', label: 'High School Diploma' }
];

const STRANDS = [
 { id: 'STEM', code: 'STEM', name: 'STEM - Science, Technology, Engineering, and Mathematics' },
 { id: 'ABM', code: 'ABM', name: 'Accountancy, Business & Management' },
 { id: 'HUMSS', code: 'HUMSS', name: 'Humanities & Social Sciences' },
 { id: 'ICT', code: 'ICT', name: 'ICT - Information and Communications Technology' },
 { id: 'COOKERY', code: 'COOKERY', name: 'Cookery' },
 { id: 'EIM', code: 'EIM', name: 'EIM - Electrical Installation and Maintenance' }
];

const DRAFT_STORAGE_KEY = 'geranova_admission_draft';
const ADMISSION_ENTRY_TYPE_KEY = 'geranova_admission_entry_type';

const ADMISSION_TYPE_OPTIONS = [
 { value: 'new', label: 'New Student' },
 { value: 'transferee', label: 'Transferee' },
 { value: 'returnee', label: 'Old Student' }
];

let admissionTypeFromEntry = false;
const FILE_DB_NAME = 'geranova_admission_files';
const FILE_DB_VERSION = 1;
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const GCASH_LOGO = 'assets/gcash-logo.png';

function normalizeAdmissionEntryType(value) {
 const type = String(value || '').toLowerCase();
 return ADMISSION_TYPE_OPTIONS.some((opt) => opt.value === type) ? type : '';
}

function getAdmissionTypeLabel(value) {
 const match = ADMISSION_TYPE_OPTIONS.find((opt) => opt.value === value);
 return match ? match.label : String(value || '—');
}

function rememberAdmissionEntryTypeFromUrl() {
 const params = new URLSearchParams(window.location.search);
 const fromUrl = normalizeAdmissionEntryType(params.get('type'));
 if (!fromUrl) return '';
 try {
 sessionStorage.setItem(ADMISSION_ENTRY_TYPE_KEY, fromUrl);
 } catch (err) {
 /* ignore */
 }
 return fromUrl;
}

function readStoredAdmissionEntryType() {
 try {
 return normalizeAdmissionEntryType(sessionStorage.getItem(ADMISSION_ENTRY_TYPE_KEY));
 } catch (err) {
 return '';
 }
}

function applyAdmissionEntryTypeToForm() {
 const type = readStoredAdmissionEntryType();
 if (!type) {
 admissionTypeFromEntry = false;
 return;
 }
 formData.admissionType = type;
 admissionTypeFromEntry = true;
}

function clearAdmissionEntryTypeLock() {
 admissionTypeFromEntry = false;
 try {
 sessionStorage.removeItem(ADMISSION_ENTRY_TYPE_KEY);
 } catch (err) {
 /* ignore */
 }
}

function getDefaultFormData() {
 return {
 lastName: '',
 firstName: '',
 middleName: '',
 birthdate: '',
 gender: '',
 houseNumber: '',
 street: '',
 province: '',
 provinceCode: '',
 city: '',
 cityCode: '',
 barangay: '',
 barangayCode: '',
 address: '',
 contactNumber: '',
 email: '',
 gradeLevel: 'Grade 11',
 strandId: '',
 strandCode: '',
 admissionType: 'new',
 previousSchool: '',
 paymentMode: 'cashier',
 bankCode: '',
 bankReference: '',
 bankSenderName: '',
 gcashReference: '',
 gcashSenderName: '',
 paymentStatus: '',
 paymentAmount: '2500',
 schedulePlanAcknowledged: false,
 subjectSchedules: {}
 };
}

let activeAdmissionSubjects = [];

function admissionSectionMatchesStudent(sectionName, strandCode, gradeLevel) {
 const section = String(sectionName || '').toUpperCase();
 const code = (strandCode || 'STEM').toUpperCase();
 if (!section.includes(code)) return false;
 if (gradeLevel) {
 const gradeNum = gradeLevel.includes('11') ? '11' : '12';
 if (!section.includes(gradeNum)) return false;
 }
 return true;
}

let admissionOfferingsSource = '';
let admissionOfferingsError = '';

function resolveStrandCode() {
 const code = String(formData.strandCode || '').trim().toUpperCase();
 if (code) return code;

 const strandId = String(formData.strandId || '').trim();
 if (!strandId) return '';

 const match = STRANDS.find(
 (strand) => strand.id === strandId || strand.code === strandId
 );
 if (match) {
 formData.strandCode = match.code;
 return match.code;
 }
 return strandId.toUpperCase();
}

function isCurriculumSubjectCode(code) {
 return /^(G11|G12)-/.test(String(code || '').trim());
}

function normalizeAdmissionOfferings(raw, strandCode, gradeLevel) {
 return (raw || [])
 .filter(subj => isCurriculumSubjectCode(subj.code))
 .map(subj => {
 const subStrand = subj.strandCode || subj.strand || strandCode;
 const subGrade = subj.gradeLevel || gradeLevel;
 return {
 ...subj,
 description: subj.description || subj.name || subj.code,
 schedules: (subj.schedules || []).filter(schedule => {
 if (!schedule.id || !(schedule.section || schedule.dayTime)) return false;
 if (typeof formatSectionName !== 'function') return true;
 const name = String(schedule.section || '').trim().toUpperCase();
 const canonical = [
 formatSectionName(subStrand, subGrade, 'A'),
 formatSectionName(subStrand, subGrade, 'B'),
 ].map(value => String(value || '').trim().toUpperCase());
 return canonical.includes(name);
 }),
 };
 })
 .filter(subj => (subj.schedules || []).length > 0);
}

function admissionSupabaseEnabled() {
 return typeof SupabaseService !== 'undefined'
 && SupabaseService.isEnabled
 && SupabaseService.isEnabled();
}

async function fetchAdmissionOfferingsFromServer(strandCode, gradeLevel, semesterCode = '1st') {
 const params = new URLSearchParams({ strandCode, gradeLevel, semesterCode });
 const controller = new AbortController();
 const timeoutId = setTimeout(() => controller.abort(), 30000);
 const res = await fetch('/api/admission/offerings?' + params.toString(), {
 signal: controller.signal,
 cache: 'no-store'
 });
 clearTimeout(timeoutId);
 const json = await res.json().catch(() => ({}));
 if (!res.ok || !json.success) {
 throw new Error(json.error || json.details || json.hint || 'Failed to load admission schedules from Supabase.');
 }
 return {
 offerings: normalizeAdmissionOfferings(json.data || [], strandCode, gradeLevel),
 source: json.source || 'supabase'
 };
}

async function loadAdmissionOfferings() {
 const strandCode = resolveStrandCode();
 const gradeLevel = formData.gradeLevel || 'Grade 11';
 const semesterCode = '1st';
 admissionOfferingsError = '';
 activeAdmissionSubjects = [];

 if (!strandCode) {
 admissionOfferingsError = 'Select your strand in Step 3 first.';
 return false;
 }

 let offerings = null;
 let source = '';

 if (admissionSupabaseEnabled()) {
 try {
 const remote = await SupabaseService.getAdmissionOfferings(strandCode, gradeLevel, semesterCode);
 if (Array.isArray(remote) && remote.length) {
 offerings = normalizeAdmissionOfferings(remote, strandCode, gradeLevel);
 source = 'supabase';
 }
 } catch (err) {
 console.warn('Direct Supabase admission offerings failed:', err);
 }
 }

 if (!offerings || !offerings.length) {
 try {
 const fromServer = await fetchAdmissionOfferingsFromServer(strandCode, gradeLevel, semesterCode);
 offerings = fromServer.offerings;
 source = fromServer.source || 'supabase';
 } catch (err) {
 admissionOfferingsError = err.name === 'AbortError'
 ? 'Schedule request timed out. Please click Retry or refresh the page.'
 : (err.message || 'Could not load schedules from the database.');
 admissionOfferingsSource = '';
 return false;
 }
 }

 if (!offerings.length) {
 admissionOfferingsError = 'No published schedules found for this strand and grade.';
 admissionOfferingsSource = '';
 return false;
 }

 activeAdmissionSubjects = offerings;
 admissionOfferingsSource = source === 'supabase_rest' || source === 'supabase' ? 'supabase' : 'live';
 pruneAdmissionSchedules();
 return true;
}

function getAdmissionSubjectsWithSchedules() {
 return activeAdmissionSubjects;
}

function pruneAdmissionSchedules() {
 if (!formData.subjectSchedules) {
 formData.subjectSchedules = {};
 return;
 }
 const validCodes = new Set(getAdmissionSubjectsWithSchedules().map(subj => subj.code));
 Object.keys(formData.subjectSchedules).forEach(code => {
 if (!validCodes.has(code)) delete formData.subjectSchedules[code];
 });
}

function getSelectedAdmissionSchedule(subj) {
 const schedId = formData.subjectSchedules?.[subj.code];
 return (subj.schedules || []).find(s => String(s.id) === String(schedId)) || null;
}

function admissionContactUnits(subj, schedule = null) {
 const sched = schedule || getSelectedAdmissionSchedule(subj);
 if (sched) {
 const units = ScheduleFormat.contactUnitsFromSchedule(sched);
 if (units != null) return units;
 }
 const fallback = (subj.schedules || [])[0];
 if (fallback) {
 const units = ScheduleFormat.contactUnitsFromSchedule(fallback);
 if (units != null) return units;
 }
 return subj.units ?? subj.lec ?? 1;
}

function updateAdmissionScheduleUnitsDisplay() {
 getAdmissionSubjectsWithSchedules().forEach(subj => {
 const cell = document.querySelector(`[data-units-for="${CSS.escape(subj.code)}"]`);
 if (cell) cell.textContent = admissionContactUnits(subj);
 });
}

function syncAdmissionSchedulesFromDOM() {
 if (!formData.subjectSchedules) formData.subjectSchedules = {};
 document.querySelectorAll('.admission-schedule-select').forEach(sel => {
 const code = sel.dataset.code;
 if (!code) return;
 if (sel.value) formData.subjectSchedules[code] = sel.value;
 else delete formData.subjectSchedules[code];
 });
}

function getAdmissionScheduleSelections() {
 const subjects = activeAdmissionSubjects.length
 ? activeAdmissionSubjects
 : getAdmissionSubjectsWithSchedules();
 return subjects.map(subj => {
 const schedId = formData.subjectSchedules?.[subj.code];
 const schedule = (subj.schedules || []).find(s => String(s.id) === String(schedId));
 return {
 code: subj.code,
 description: subj.description,
 units: admissionContactUnits(subj, schedule),
 type: subj.type || 'core',
 scheduleId: schedId || '',
 section: schedule?.section || '',
 dayTime: schedule?.dayTime || '',
 slots: schedule?.slots ?? null
 };
 }).filter(item => item.scheduleId);
}

function admissionSubjectTypeBadge(subj) {
 if (subj.type === 'specialized' || subj.strand) {
 return `<span class="badge badge-pending subject-type-badge admission-subject-badge">${esc(subj.strand || 'Spec')}</span>`;
 }
 if (subj.type === 'applied') {
 return '<span class="badge badge-approved subject-type-badge admission-subject-badge">Applied</span>';
 }
 return '<span class="badge badge-approved subject-type-badge admission-subject-badge">Core</span>';
}

function formatAdmissionScheduleOption(schedule) {
 return ScheduleFormat.formatDropdownOption(schedule);
}

function updateAdmissionScheduleProgress() {
 const subjects = activeAdmissionSubjects;
 const total = subjects.length;
 const selected = subjects.filter(subj => formData.subjectSchedules?.[subj.code]).length;
 const el = document.getElementById('admissionScheduleProgress');
 if (el) {
 el.textContent = total
 ? `${selected} of ${total} subjects with schedule selected`
 : '';
 }
}

function buildFullAddress(data) {
 return [data.houseNumber, data.street, data.barangay, data.city, data.province]
 .map(v => (v || '').trim())
 .filter(Boolean)
 .join(', ');
}

let currentStep = 1;
const formData = getDefaultFormData();
const fileStore = {};
let stepAutoSaveBound = false;
let draftRestored = false;
let admissionCameraStream = null;
let profileUploadPreviewUrl = null;
let profileCameraPreviewUrl = null;

function getDraftStorage() {
 try {
 return window.sessionStorage;
 } catch (err) {
 console.warn('Session storage unavailable:', err);
 return null;
 }
}

function hasMeaningfulDraft(draft) {
 if (!draft) return false;
 const data = draft.formData || {};
 const hasFields = Boolean(
 data.lastName || data.firstName || data.email || data.contactNumber ||
 data.houseNumber || data.street || data.province || data.previousSchool
 );
 const hasFiles = Array.isArray(draft.savedFileKeys) && draft.savedFileKeys.length > 0;
 return hasFields || hasFiles || (draft.currentStep && draft.currentStep > 1);
}

function showDraftRestoredBanner(step) {
 const banner = document.getElementById('draftBanner');
 const stepEl = document.getElementById('draftStepNum');
 if (!banner) return;

 draftRestored = true;
 if (stepEl) stepEl.textContent = String(step || 1);
 banner.hidden = false;
}

async function initEnrollPage() {
 const params = new URLSearchParams(window.location.search);
 const wantsFresh = params.get('new') === '1';
 rememberAdmissionEntryTypeFromUrl();

 try {
 window.localStorage?.removeItem(DRAFT_STORAGE_KEY);
 } catch (err) {
 /* ignore */
 }

 renderStepIndicator();
 renderStepContent();
 bindStepAutoSave();
 bindNavigation();
 bindDraftBanner();

 if (wantsFresh) {
 window.history.replaceState({}, '', 'enroll.html');
 await resetEnrollmentDraft();
 applyAdmissionEntryTypeToForm();
 } else {
 await loadDraft();
 if (readStoredAdmissionEntryType()) {
 applyAdmissionEntryTypeToForm();
 }
 }

 renderStepIndicator();
 renderStepContent();

 window.addEventListener('beforeunload', saveDraftNow);
 window.addEventListener('pagehide', saveDraftNow);
 document.addEventListener('visibilitychange', () => {
 if (document.visibilityState === 'hidden') {
 saveDraftNow();
 }
 });

 document.getElementById('enrollToastClose')?.addEventListener('click', hideError);
}

function bindDraftBanner() {
 document.getElementById('draftBannerDismiss')?.addEventListener('click', () => {
 const banner = document.getElementById('draftBanner');
 if (banner) banner.hidden = true;
 });

 document.getElementById('draftBannerReset')?.addEventListener('click', async () => {
 if (!window.confirm('Start a new application? Your saved progress will be cleared.')) return;
 clearAdmissionEntryTypeLock();
 await resetEnrollmentDraft();
 draftRestored = false;
 const banner = document.getElementById('draftBanner');
 if (banner) banner.hidden = true;
 renderStepIndicator();
 renderStepContent();
 hideError();
 });
}

async function saveDraftNow() {
 saveCurrentStep();
 persistDraft();
 await persistFiles();
}

function bindStepAutoSave() {
 const container = document.getElementById('stepContent');
 if (!container || stepAutoSaveBound) return;

 container.addEventListener('input', handleAutoSave);
 container.addEventListener('change', handleAutoSave);
 stepAutoSaveBound = true;
}

function getEnrollmentFee() {
 return window.SUPABASE_CONFIG?.enrollmentFee || 2500;
}

async function applyGcashPaymentDetails(data) {
 clearBankPaymentDetails();
 formData.paymentMode = 'gcash';
 formData.paymentStatus = data.paymentStatus || 'submitted';
 formData.gcashReference = data.reference;
 formData.gcashSenderName = data.senderName;
 formData.paymentAmount = String(data.amountPaid);
 if (data.receiptFile) {
 fileStore.gcash_proof = data.receiptFile;
 await persistFiles();
 }
 persistDraft();
 renderStepContent();
}

function clearGcashPaymentDetails() {
 formData.gcashReference = '';
 formData.gcashSenderName = '';
 delete fileStore.gcash_proof;
}

function clearBankPaymentDetails() {
 formData.bankCode = '';
 formData.bankReference = '';
 formData.bankSenderName = '';
 delete fileStore.bank_proof;
}

function clearOnlinePaymentDetails() {
 formData.paymentStatus = '';
 clearGcashPaymentDetails();
 clearBankPaymentDetails();
}

function renderStepIndicator() {
 const el = document.getElementById('stepIndicator');
 if (!el) return;

 el.innerHTML = ADMISSION_STEPS.map(step => `
 <div class="enroll-step-item ${step.id === currentStep ? 'active' : ''} ${step.id < currentStep ? 'done' : ''}">
 <span class="enroll-step-num">${step.id}</span>
 <span class="enroll-step-label">${step.label}</span>
 </div>
 `).join('');
}

function renderStepContent() {
 const container = document.getElementById('stepContent');
 if (!container) return;

 if (currentStep === 5) {
 container.innerHTML = '<p class="enroll-step-desc" style="padding:24px 0;">Loading...</p>';
 updateNavButtons();
 loadAdmissionOfferings()
 .then(() => {
 if (currentStep !== 5) return;
 container.innerHTML = renderScheduleStrandStep();
 bindStepEvents();
 updateNavButtons();
 })
 .catch(err => {
 if (currentStep !== 5) return;
 container.innerHTML = `
 <h2 class="enroll-step-title">Step 5 — Schedule &amp; Strand</h2>
 <p class="admission-schedule-source demo">${escHtml(err.message || 'Could not load schedules.')}</p>
 <button type="button" class="btn-secondary" id="btnRetrySchedules">Retry</button>`;
 bindStepEvents();
 document.getElementById('btnRetrySchedules')?.addEventListener('click', () => renderStepContent());
 updateNavButtons();
 });
 return;
 }

 const steps = {
 1: renderPersonalStep(),
 2: renderAddressStep(),
 3: renderAcademicStep(),
 4: renderProfilePhotoStep(),
 6: renderDocumentsStep(),
 7: renderPaymentStep(),
 8: renderReviewStep()
 };

 container.innerHTML = steps[currentStep] || renderPersonalStep();
 bindStepEvents();
 updateNavButtons();
}

function escHtml(str) {
 return esc(str);
}

function renderPersonalStep() {
 return `
 <h2 class="enroll-step-title">Step 1 — Personal Information</h2>
 <p class="enroll-step-desc">Enter your basic information exactly as it appears on your documents.</p>
 <div class="enroll-form-grid">
 <div class="form-group">
 <label for="lastName">Last Name *</label>
 <input type="text" id="lastName" class="form-control" value="${esc(formData.lastName)}" required>
 </div>
 <div class="form-group">
 <label for="firstName">First Name *</label>
 <input type="text" id="firstName" class="form-control" value="${esc(formData.firstName)}" required>
 </div>
 <div class="form-group">
 <label for="middleName">Middle Name</label>
 <input type="text" id="middleName" class="form-control" value="${esc(formData.middleName)}">
 </div>
 <div class="form-group">
 <label for="birthdate">Birthdate *</label>
 ${dateFieldHtml('birthdate', `value="${esc(formData.birthdate)}" required`)}
 </div>
 <div class="form-group">
 <label for="gender">Gender *</label>
 <select id="gender" class="form-control" required>
 <option value="" disabled ${!formData.gender ? 'selected' : ''} hidden>Select</option>
 <option value="Male" ${formData.gender === 'Male' ? 'selected' : ''}>Male</option>
 <option value="Female" ${formData.gender === 'Female' ? 'selected' : ''}>Female</option>
 </select>
 </div>
 <div class="form-group">
 <label for="contactNumber">Contact Number *</label>
 <input type="tel" id="contactNumber" class="form-control" placeholder="09XXXXXXXXX" maxlength="11" inputmode="numeric" pattern="09[0-9]{9}" value="${esc(formData.contactNumber)}" required>
 <small class="field-hint">11-digit mobile number starting with 09.</small>
 </div>
 <div class="form-group full-width">
 <label for="email">Email Address *</label>
 <input type="email" id="email" class="form-control" placeholder="you@email.com" value="${esc(formData.email)}" required>
 <small class="field-hint">We will send application updates and your Student ID to this email once approved.</small>
 </div>
 </div>
 `;
}

function renderAddressStep() {
 return `
 <h2 class="enroll-step-title">Step 2 — Complete Address</h2>
 <p class="enroll-step-desc">Select your province, city/municipality, and barangay. You can type to search each list quickly.</p>
 <div class="enroll-form-grid">
 <div class="form-group">
 <label for="houseNumber">House / Unit No. *</label>
 <input type="text" id="houseNumber" class="form-control" placeholder="e.g. 123" value="${esc(formData.houseNumber)}" required>
 </div>
 <div class="form-group">
 <label for="street">Street *</label>
 <input type="text" id="street" class="form-control" placeholder="e.g. Mabini Street" value="${esc(formData.street)}" required>
 </div>
 ${typeof AddressSelect !== 'undefined' ? AddressSelect.html() : `
 <div class="form-group">
 <label for="province">Province *</label>
 <input type="text" id="province" class="form-control" value="${esc(formData.province)}" required>
 </div>
 <div class="form-group">
 <label for="city">City / Municipality *</label>
 <input type="text" id="city" class="form-control" value="${esc(formData.city)}" required>
 </div>
 <div class="form-group full-width">
 <label for="barangay">Barangay *</label>
 <input type="text" id="barangay" class="form-control" value="${esc(formData.barangay)}" required>
 </div>`}
 </div>
 `;
}

function renderAcademicStep() {
 const strandOptions = STRANDS.map(s => `
 <option value="${s.id}" data-code="${s.code}" ${formData.strandId === s.id ? 'selected' : ''}>${s.name}</option>
 `).join('');

 const admissionTypeField = admissionTypeFromEntry
 ? `
 <div class="form-group">
 <label for="admissionType">Admission Type *</label>
 <input type="hidden" id="admissionType" value="${esc(formData.admissionType)}">
 <div class="form-control admission-type-locked" id="admissionTypeDisplay">${esc(getAdmissionTypeLabel(formData.admissionType))}</div>
 <small class="field-hint">Same as your choice on the sign-in page. To change, go back to Sign In and pick a different applicant type.</small>
 </div>
 `
 : `
 <div class="form-group">
 <label for="admissionType">Admission Type *</label>
 <select id="admissionType" class="form-control">
 ${ADMISSION_TYPE_OPTIONS.map((opt) => `
 <option value="${opt.value}" ${formData.admissionType === opt.value ? 'selected' : ''}>${opt.label}</option>
 `).join('')}
 </select>
 </div>
 `;

 return `
 <h2 class="enroll-step-title">Step 3 — Academic Information</h2>
 <p class="enroll-step-desc">Select your grade level, preferred strand, and previous school.</p>
 <div class="enroll-form-grid">
 <div class="form-group">
 <label for="gradeLevel">Grade Level *</label>
 <select id="gradeLevel" class="form-control" required>
 <option value="Grade 11" ${formData.gradeLevel === 'Grade 11' ? 'selected' : ''}>Grade 11</option>
 <option value="Grade 12" ${formData.gradeLevel === 'Grade 12' ? 'selected' : ''}>Grade 12</option>
 </select>
 </div>
 ${admissionTypeField}
 <div class="form-group full-width">
 <label for="previousSchool">Previous School *</label>
 <input type="text" id="previousSchool" class="form-control" placeholder="Name of your last school attended" value="${esc(formData.previousSchool)}" required>
 </div>
 <div class="form-group full-width">
 <label for="strandId">Preferred Strand *</label>
 <select id="strandId" class="form-control" required>
 <option value="" disabled ${!formData.strandId ? 'selected' : ''} hidden>Select strand</option>
 ${strandOptions}
 </select>
 </div>
 </div>
 `;
}

function getPrimaryProfilePhotoFile() {
 return fileStore.profile_camera || fileStore.profile_upload || null;
}

function getPrimaryProfilePhotoSrc() {
 if (fileStore.profile_camera) return getProfileCameraPreviewSrc();
 if (fileStore.profile_upload) return getProfileUploadPreviewSrc();
 return '';
}

function renderProfilePhotoReview() {
 const primarySrc = getPrimaryProfilePhotoSrc();
 if (!primarySrc) {
 return '<p class="review-photo-empty">No profile photo uploaded.</p>';
 }

 return `
 <div class="review-photo-grid">
 <figure class="review-photo-item">
 <img src="${primarySrc}" alt="Profile photo" class="review-photo-img">
 <figcaption>Profile Photo</figcaption>
 </figure>
 </div>
 `;
}

function ensureProfilePhotoPair() {
 return Boolean(getPrimaryProfilePhotoFile());
}

function hasProfilePhoto() {
 return Boolean(fileStore.profile_upload || fileStore.profile_camera);
}

function getProfileUploadPreviewSrc() {
 if (fileStore.profile_upload) {
 if (!profileUploadPreviewUrl) {
 profileUploadPreviewUrl = URL.createObjectURL(fileStore.profile_upload);
 }
 return profileUploadPreviewUrl;
 }
 return '';
}

function getProfileCameraPreviewSrc() {
 if (fileStore.profile_camera) {
 if (!profileCameraPreviewUrl) {
 profileCameraPreviewUrl = URL.createObjectURL(fileStore.profile_camera);
 }
 return profileCameraPreviewUrl;
 }
 return '';
}

function renderProfilePhotoStep() {
 const hasUpload = Boolean(fileStore.profile_upload);
 const hasCamera = Boolean(fileStore.profile_camera);
 const uploadSrc = getProfileUploadPreviewSrc();
 const cameraSrc = getProfileCameraPreviewSrc();

 return `
 <h2 class="enroll-step-title">Step 4 — Profile Photo</h2>
 <p class="enroll-step-desc">Upload a photo or take one with your camera. At least one is required to continue.</p>

 <div class="profile-photo-simple">
 <div class="profile-photo-block ${hasUpload ? 'is-done' : ''}">
 <span class="profile-photo-label">Upload Photo</span>
 <div class="profile-photo-preview" id="admissionUploadPreview">
 ${uploadSrc
 ? `<img src="${uploadSrc}" alt="Uploaded photo">`
 : '<span class="photo-placeholder">📷</span>'}
 </div>
 <label class="btn-secondary profile-photo-btn">
 ${hasUpload ? 'Change Photo' : 'Choose Photo'}
 <input type="file" id="profileUploadInput" accept="image/jpeg,image/png,image/webp" hidden>
 </label>
 <span class="profile-photo-hint">${hasUpload ? '✓ Uploaded' : 'JPG or PNG, max 5 MB'}</span>
 </div>

 <p class="profile-photo-or">or</p>

 <div class="profile-photo-block ${hasCamera ? 'is-done' : ''}">
 <span class="profile-photo-label">Take Photo</span>
 <div class="profile-photo-camera-wrap">
 <video id="admissionCameraVideo" autoplay playsinline muted hidden></video>
 <canvas id="admissionCameraCanvas" hidden></canvas>
 <div class="profile-photo-preview" id="admissionCameraPreview">
 ${cameraSrc
 ? `<img src="${cameraSrc}" alt="Captured photo">`
 : '<span class="photo-placeholder">🎥</span>'}
 </div>
 </div>
 <div class="profile-photo-btns">
 <button type="button" class="btn-secondary" id="btnStartAdmissionCamera">Open Camera</button>
 <button type="button" class="btn-primary profile-photo-capture-btn" id="btnCaptureAdmissionPhoto" hidden>Capture Photo</button>
 <button type="button" class="btn-secondary" id="btnRetakeAdmissionPhoto" ${hasCamera ? '' : 'hidden'}>Retake</button>
 </div>
 <span class="profile-photo-hint">${hasCamera ? '✓ Photo captured' : 'Allow camera access when prompted'}</span>
 </div>
 </div>
 `;
}

function renderScheduleStrandStep() {
 const strandName = STRANDS.find(s => s.id === formData.strandId)?.name || formData.strandCode || '—';
 pruneAdmissionSchedules();
 const subjects = getAdmissionSubjectsWithSchedules();
 const scheduleSourceNote = admissionOfferingsSource === 'supabase'
 ? '<p class="admission-schedule-source live"><i class="fas fa-check-circle"></i> Schedule loaded</p>'
 : admissionOfferingsError
 ? `<p class="admission-schedule-source demo">${esc(admissionOfferingsError)}</p>`
 : '';
 const subjectRows = subjects.length
 ? subjects.map((subj, index) => {
 const scheduleOptions = (subj.schedules || []).map(schedule => {
 const selected = String(formData.subjectSchedules?.[subj.code] || '') === String(schedule.id);
 const full = ScheduleFormat.isScheduleFull(schedule);
 const label = formatAdmissionScheduleOption(schedule);
 const disabled = full && !selected ? 'disabled' : '';
 return `<option value="${esc(schedule.id)}" ${selected ? 'selected' : ''} ${disabled}>${esc(label)}</option>`;
 }).join('');

 return `
 <tr data-index="${index}">
 <td class="col-code">${esc(subj.code)}</td>
 <td class="col-desc">${esc(subj.description)} ${admissionSubjectTypeBadge(subj)}</td>
 <td class="col-num" data-units-for="${esc(subj.code)}">${admissionContactUnits(subj)}</td>
 <td class="col-schedule">
 <select class="form-control schedule-select admission-schedule-select" data-index="${index}" data-code="${esc(subj.code)}">
 <option value="">Select schedule...</option>
 ${scheduleOptions}
 </select>
 </td>
 </tr>
 `;
 }).join('')
 : `<tr><td colspan="4" class="empty-offerings">${esc(admissionOfferingsError || 'No schedules available. Complete Step 3 and ask the registrar to publish schedules in Supabase.')}</td></tr>`;

 const selectedCount = subjects.filter(subj => formData.subjectSchedules?.[subj.code]).length;

 return `
 <div class="admission-schedule-step">
 <h2 class="enroll-step-title">Step 5 — Schedule &amp; Strand (1st Semester)</h2>
 <p class="enroll-step-desc">Piliin ang <strong>day at time</strong> para sa bawat subject — galing sa published schedule ng registrar (AI Auto-Schedule).</p>
 ${scheduleSourceNote}

 <div class="review-card">
 <h3>Your Enrollment Plan</h3>
 <p><strong>Grade Level:</strong> ${esc(formData.gradeLevel)}</p>
 <p><strong>Strand:</strong> ${esc(strandName)}</p>
 <p><strong>Semester:</strong> 1st Semester (S.Y. 2026-2027)</p>
 </div>

 <div class="card enrollment-table-card">
 <p class="enrollment-table-label">
 Subjects for ${esc(formData.gradeLevel)} — 1st Semester (${esc(formData.strandCode || 'Strand')}):
 <span class="admission-schedule-progress" id="admissionScheduleProgress">${subjects.length ? `${selectedCount} of ${subjects.length} subjects with schedule selected` : ''}</span>
 </p>
 <div class="table-wrap admission-schedule-table-wrap">
 <table class="enrollment-table admission-schedule-table">
 <thead>
 <tr>
 <th class="col-code">Code</th>
 <th class="col-desc">Description</th>
 <th class="col-num">Units</th>
 <th class="col-schedule">Schedule</th>
 </tr>
 </thead>
 <tbody>${subjectRows}</tbody>
 </table>
 </div>
 </div>

 <div class="enrollment-notes">
 <p><span class="note-prereq">Note:</span> Piliin muna ang schedule sa dropdown bago mag-proceed. Kailangan lahat ng subject may napiling day at time.</p>
 </div>

 <label class="review-agree">
 <input type="checkbox" id="agreeSchedulePlan" ${formData.schedulePlanAcknowledged ? 'checked' : ''}>
 Naiintindihan ko ang aking strand (${esc(formData.strandCode || '—')}) at ang napiling schedule para sa 1st semester subjects.
 </label>
 </div>
 `;
}

function renderDocumentsStep() {
 const uploadedCount = REQUIRED_DOCUMENTS.filter(d => fileStore[d.key]).length;
 const docIcons = {
 form_138: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
 form_137: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/></svg>',
 good_moral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M8 21v-2a4 4 0 0 1 8 0v2"/></svg>',
 birth_certificate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6"/></svg>',
 high_school_diploma: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 3 3 6 3s6-1 6-3v-5"/></svg>'
 };

 const items = REQUIRED_DOCUMENTS.map((doc, index) => {
 const file = fileStore[doc.key];
 const hasFile = Boolean(file);
 return `
 <div class="doc-upload-card ${hasFile ? 'is-uploaded' : ''}" data-key="${doc.key}">
 <div class="doc-upload-index">${index + 1}</div>
 <div class="doc-upload-icon" aria-hidden="true">${docIcons[doc.key] || docIcons.form_138}</div>
 <div class="doc-upload-body">
 <div class="doc-upload-label-row">
 <span class="doc-upload-label">${doc.label}</span>
 <span class="doc-upload-badge ${hasFile ? 'done' : 'pending'}">${hasFile ? 'Uploaded' : 'Required'}</span>
 </div>
 <div class="doc-upload-file-wrap">
 <span class="doc-upload-file ${hasFile ? 'has-file' : ''}" id="fileLabel_${doc.key}">
 ${hasFile ? esc(file.name) : 'PDF, JPG, or PNG — max recommended 10MB'}
 </span>
 </div>
 </div>
 <div class="doc-upload-actions">
 <button type="button" class="doc-action-btn view doc-view-btn" id="viewBtn_${doc.key}" data-key="${doc.key}" style="display:${hasFile ? 'inline-flex' : 'none'}">
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
 View
 </button>
 <label class="doc-action-btn upload doc-upload-btn">
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
 <span class="doc-upload-btn-text">${hasFile ? 'Replace' : 'Upload'}</span>
 <input type="file" id="file_${doc.key}" data-key="${doc.key}" accept=".pdf,.jpg,.jpeg,.png" hidden>
 </label>
 </div>
 </div>
 `;
 }).join('');

 return `
 <h2 class="enroll-step-title">Step 6 — Required Documents</h2>
 <p class="enroll-step-desc">Upload clear copies of each document below. Accepted formats: PDF, JPG, or PNG.</p>

 <div class="doc-upload-progress">
 <div class="doc-upload-progress-text">
 <strong>${uploadedCount}</strong> of <strong>${REQUIRED_DOCUMENTS.length}</strong> documents uploaded
 </div>
 <div class="doc-upload-progress-bar">
 <div class="doc-upload-progress-fill" style="width:${Math.round((uploadedCount / REQUIRED_DOCUMENTS.length) * 100)}%"></div>
 </div>
 </div>

 <div class="doc-requirements-list">
 ${items}
 </div>
 `;
}

function renderPaymentStep() {
 const isGcash = formData.paymentMode === 'gcash';
 const isCashier = formData.paymentMode === 'cashier' || formData.paymentMode === 'bank';
 const isSubmitted = formData.paymentStatus === 'submitted';
 const feeLabel = GcashPayment.formatPeso(getEnrollmentFee());

 return `
 <h2 class="enroll-step-title">Step 7 — Mode of Payment</h2>
 <p class="enroll-step-desc">Choose how you will pay the enrollment fee of <strong>${feeLabel}</strong>.</p>

 <div class="payment-method-list">
 <label class="payment-method-row ${isGcash ? 'selected' : ''}">
 <input type="radio" name="paymentMode" value="gcash" ${isGcash ? 'checked' : ''}>
 <img src="${GCASH_LOGO}" alt="GCash" class="payment-method-logo gcash">
 <span class="payment-method-body">
 <strong>GCash</strong>
 <span>Scan QR code and pay via GCash app</span>
 </span>
 <span class="payment-method-radio" aria-hidden="true"></span>
 </label>

 <label class="payment-method-row ${isCashier ? 'selected' : ''}">
 <input type="radio" name="paymentMode" value="cashier" ${isCashier ? 'checked' : ''}>
 <span class="payment-method-icon cashier" aria-hidden="true">
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
 </span>
 <span class="payment-method-body">
 <strong>Pay at Cashier</strong>
 <span>Pay in person at the school cashier after submitting</span>
 </span>
 <span class="payment-method-radio" aria-hidden="true"></span>
 </label>
 </div>

 <div id="gcashFields" class="payment-detail-panel" style="display:${isGcash ? 'block' : 'none'};">
 <div class="gcash-checkout-card">
 <div class="gcash-checkout-icon">
 <img src="${GCASH_LOGO}" alt="GCash">
 </div>
 <div class="gcash-checkout-meta">
 <p class="gcash-checkout-title">GCash QR Payment</p>
 <p class="gcash-checkout-amount">${feeLabel}</p>
 <p class="gcash-checkout-note">Secure payment via QR scan</p>
 </div>
 </div>

 ${isSubmitted && isGcash ? `
 <div class="gcash-paid-banner">
 <span class="gcash-paid-check">✓</span>
 <div>
 <strong>Payment Details Submitted</strong>
 <p>Ref: ${esc(formData.gcashReference)} · ${esc(formData.gcashSenderName)} · ${GcashPayment.formatPeso(formData.paymentAmount)}</p>
 ${fileStore.gcash_proof ? `<p class="gcash-receipt-name">Receipt: ${esc(fileStore.gcash_proof.name)}</p>` : ''}
 </div>
 </div>
 <button type="button" class="payment-secondary-btn" id="btnEditGcash">Edit Payment Details</button>
 ` : `
 <button type="button" class="gcash-pay-btn full-width" id="btnPayGcash">
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3"/><path d="M20 17v3h-3"/></svg>
 Pay with GCash
 </button>
 <p class="field-hint payment-gcash-hint">Opens QR payment window — scan with your GCash app to complete payment.</p>
 `}
 </div>

 <div id="cashierNote" class="payment-cashier-note" style="display:${isCashier ? 'flex' : 'none'};">
 <span class="payment-cashier-icon" aria-hidden="true">ℹ</span>
 <p>No online payment needed now. After you submit your application, visit the registrar or cashier to pay <strong>${feeLabel}</strong>.</p>
 </div>
 `;
}

function renderReviewStep() {
 const docs = REQUIRED_DOCUMENTS.map(d => `
 <li>${d.label}: <strong>${fileStore[d.key] ? esc(fileStore[d.key].name) : 'Missing'}</strong></li>
 `).join('');

 const payment = formData.paymentMode === 'gcash'
 ? (formData.paymentStatus === 'submitted'
 ? `GCash — Ref: ${esc(formData.gcashReference)} · ${esc(formData.gcashSenderName)} · ${GcashPayment.formatPeso(formData.paymentAmount)}`
 : 'GCash — Payment not yet submitted')
 : 'Pay in person at the Cashier';

 const fullAddress = buildFullAddress(formData) || formData.address || '—';

 return `
 <h2 class="enroll-step-title">Step 8 — Review & Submit</h2>
 <p class="enroll-step-desc">Please review your information before submitting.</p>

 <div class="review-card">
 <h3>Personal Information</h3>
 <p><strong>Name:</strong> ${esc(formData.lastName)}, ${esc(formData.firstName)} ${esc(formData.middleName)}</p>
 <p><strong>Birthdate:</strong> ${esc(formData.birthdate)}</p>
 <p><strong>Gender:</strong> ${esc(formData.gender || '—')}</p>
 <p><strong>Email:</strong> ${esc(formData.email)}</p>
 <p><strong>Contact:</strong> ${esc(formData.contactNumber)}</p>
 </div>

 <div class="review-card">
 <h3>Address</h3>
 <p><strong>House / Unit No.:</strong> ${esc(formData.houseNumber || '—')}</p>
 <p><strong>Street:</strong> ${esc(formData.street || '—')}</p>
 <p><strong>Province:</strong> ${esc(formData.province || '—')}</p>
 <p><strong>City / Municipality:</strong> ${esc(formData.city || '—')}</p>
 <p><strong>Barangay:</strong> ${esc(formData.barangay || '—')}</p>
 <p><strong>Full Address:</strong> ${esc(fullAddress)}</p>
 </div>

 <div class="review-card">
 <h3>Academic Information</h3>
 <p><strong>Grade Level:</strong> ${esc(formData.gradeLevel)}</p>
 <p><strong>Strand:</strong> ${esc(formData.strandCode || '—')}</p>
 <p><strong>Admission Type:</strong> ${esc(getAdmissionTypeLabel(formData.admissionType))}</p>
 <p><strong>Previous School:</strong> ${esc(formData.previousSchool || '—')}</p>
 </div>

 <div class="review-card">
 <h3>Profile Photo</h3>
 ${renderProfilePhotoReview()}
 </div>

 <div class="review-card">
 <h3>Schedule &amp; Strand (1st Semester)</h3>
 <p><strong>Grade:</strong> ${esc(formData.gradeLevel)} · <strong>Strand:</strong> ${esc(formData.strandCode || '—')}</p>
 ${renderAdmissionScheduleReviewTable()}
 </div>

 <div class="review-card">
 <h3>Documents</h3>
 <ul class="review-doc-list">${docs}</ul>
 </div>

 <div class="review-card">
 <h3>Payment</h3>
 <p>${payment}</p>
 </div>

 <label class="review-agree">
 <input type="checkbox" id="agreeTerms">
 I certify that all information and documents submitted are true and correct.
 </label>
 `;
}

function renderAdmissionScheduleReviewTable() {
 activeAdmissionSubjects = getAdmissionSubjectsWithSchedules();
 const selections = getAdmissionScheduleSelections();
 if (!selections.length) {
 return '<p><strong>Preferred schedules:</strong> —</p>';
 }

 const rows = selections.map(item => `
 <tr>
 <td class="col-code">${esc(item.code)}</td>
 <td class="col-desc">${esc(item.description)}</td>
 <td class="col-schedule">${esc(formatAdmissionScheduleOption({
 section: item.section,
 dayTime: item.dayTime,
 slots: item.slots
 }))}</td>
 </tr>
 `).join('');

 return `
 <p><strong>Preferred schedules:</strong> ${selections.length} subject(s)</p>
 <div class="table-wrap admission-review-schedule-table-wrap">
 <table class="enrollment-table admission-review-schedule-table">
 <thead>
 <tr>
 <th class="col-code">Code</th>
 <th class="col-desc">Description</th>
 <th class="col-schedule">Schedule</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 `;
}

function updateDocUploadProgress() {
 const total = REQUIRED_DOCUMENTS.length;
 const uploaded = REQUIRED_DOCUMENTS.filter(d => fileStore[d.key]).length;
 const text = document.querySelector('.doc-upload-progress-text');
 const fill = document.querySelector('.doc-upload-progress-fill');
 if (text) {
 text.innerHTML = `<strong>${uploaded}</strong> of <strong>${total}</strong> documents uploaded`;
 }
 if (fill) {
 fill.style.width = `${Math.round((uploaded / total) * 100)}%`;
 }
}

function bindStepEvents() {
 const todayIso = new Date().toISOString().slice(0, 10);
 bindDateFields(document.getElementById('stepContent'), {
 min: '1960-01-01',
 max: todayIso,
 });

 document.querySelectorAll('.doc-view-btn[data-key]').forEach(btn => {
 btn.addEventListener('click', () => viewUploadedFile(btn.dataset.key));
 });

 document.querySelectorAll('input[type="file"][data-key]').forEach(input => {
 input.addEventListener('change', async e => {
 const key = e.target.dataset.key;
 const file = e.target.files[0];
 if (file) {
 const check = typeof AdmissionValidation !== 'undefined'
 ? AdmissionValidation.validateFile(file, { kind: 'document' })
 : { ok: true };
 if (!check.ok) {
 showError(check.message);
 e.target.value = '';
 return;
 }
 fileStore[key] = file;
 const label = document.getElementById(`fileLabel_${key}`);
 if (label) {
 label.textContent = file.name;
 label.classList.add('has-file');
 }
 const card = document.querySelector(`.doc-upload-card[data-key="${key}"]`);
 if (card) {
 card.classList.add('is-uploaded');
 const badge = card.querySelector('.doc-upload-badge');
 if (badge) {
 badge.textContent = 'Uploaded';
 badge.classList.remove('pending');
 badge.classList.add('done');
 }
 const btnText = card.querySelector('.doc-upload-btn-text');
 if (btnText) btnText.textContent = 'Replace';
 }
 const viewBtn = document.getElementById(`viewBtn_${key}`);
 if (viewBtn) viewBtn.style.display = 'inline-flex';
 updateDocUploadProgress();
 await persistFiles();
 persistDraft();
 }
 });
 });

 document.querySelectorAll('input[name="paymentMode"]').forEach(radio => {
 radio.addEventListener('change', e => {
 formData.paymentMode = e.target.value;
 if (e.target.value === 'cashier') {
 clearOnlinePaymentDetails();
 } else if (e.target.value === 'gcash') {
 clearBankPaymentDetails();
 formData.paymentStatus = '';
 }
 document.querySelectorAll('.payment-method-row').forEach(row => {
 const input = row.querySelector('input[name="paymentMode"]');
 row.classList.toggle('selected', input?.value === e.target.value);
 });
 updatePaymentPanels();
 if (e.target.value === 'gcash') {
 renderStepContent();
 }
 persistDraft();
 });
 });

 document.getElementById('btnPayGcash')?.addEventListener('click', startGcashPayment);
 document.getElementById('btnEditGcash')?.addEventListener('click', startGcashPayment);

 if (currentStep === 2 && typeof AddressSelect !== 'undefined') {
 AddressSelect.mount(formData, (field, name, code) => {
 formData[field] = name || '';
 formData[`${field}Code`] = code || '';
 if (field === 'province') {
 formData.city = '';
 formData.cityCode = '';
 formData.barangay = '';
 formData.barangayCode = '';
 } else if (field === 'city') {
 formData.barangay = '';
 formData.barangayCode = '';
 }
 formData.address = buildFullAddress(formData);
 persistDraft();
 });
 }

 if (currentStep === 4) {
 bindProfilePhotoEvents();
 } else {
 stopAdmissionCamera();
 }

 document.getElementById('agreeSchedulePlan')?.addEventListener('change', e => {
 formData.schedulePlanAcknowledged = e.target.checked;
 persistDraft();
 });

 document.querySelectorAll('.admission-schedule-select').forEach(sel => {
 sel.addEventListener('change', () => {
 syncAdmissionSchedulesFromDOM();
 updateAdmissionScheduleProgress();
 updateAdmissionScheduleUnitsDisplay();
 persistDraft();
 });
 });
}

function stopAdmissionCamera() {
 if (admissionCameraStream) {
 admissionCameraStream.getTracks().forEach(track => track.stop());
 admissionCameraStream = null;
 }
}

function bindProfilePhotoEvents() {
 document.getElementById('profileUploadInput')?.addEventListener('change', async e => {
 const file = e.target.files && e.target.files[0];
 if (!file) return;
 const check = typeof AdmissionValidation !== 'undefined'
 ? AdmissionValidation.validateFile(file, { kind: 'profile' })
 : { ok: file.size <= 5 * 1024 * 1024, message: 'Profile photo must be 5 MB or smaller.' };
 if (!check.ok) {
 showError(check.message);
 e.target.value = '';
 return;
 }
 if (profileUploadPreviewUrl) URL.revokeObjectURL(profileUploadPreviewUrl);
 fileStore.profile_upload = file;
 profileUploadPreviewUrl = URL.createObjectURL(file);
 ensureProfilePhotoPair();
 await persistFiles();
 persistDraft();
 stopAdmissionCamera();
 renderStepContent();
 });

 document.getElementById('btnStartAdmissionCamera')?.addEventListener('click', async () => {
 hideError();
 if (!navigator.mediaDevices?.getUserMedia) {
 showError('Camera is not supported on this browser. Please use Upload Photo instead.');
 return;
 }
 try {
 stopAdmissionCamera();
 admissionCameraStream = await navigator.mediaDevices.getUserMedia({
 video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
 audio: false
 });
 const video = document.getElementById('admissionCameraVideo');
 const preview = document.getElementById('admissionCameraPreview');
 if (video) {
 video.srcObject = admissionCameraStream;
 video.hidden = false;
 await video.play().catch(() => {});
 }
 if (preview) preview.hidden = true;

 const startBtn = document.getElementById('btnStartAdmissionCamera');
 const captureBtn = document.getElementById('btnCaptureAdmissionPhoto');
 if (startBtn) startBtn.hidden = true;
 if (captureBtn) captureBtn.hidden = false;
 } catch (err) {
 showError('Could not open camera. Check browser permissions, or use Upload Photo instead.');
 }
 });

 document.getElementById('btnCaptureAdmissionPhoto')?.addEventListener('click', async () => {
 const video = document.getElementById('admissionCameraVideo');
 const canvas = document.getElementById('admissionCameraCanvas');
 if (!video || !canvas) return;

 const width = video.videoWidth || 320;
 const height = video.videoHeight || 240;
 if (!width || !height) {
 showError('Camera is still loading. Wait a moment and try again.');
 return;
 }

 canvas.width = width;
 canvas.height = height;
 canvas.getContext('2d').drawImage(video, 0, 0, width, height);
 stopAdmissionCamera();
 if (video) {
 video.hidden = true;
 video.srcObject = null;
 }

 const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
 if (!blob) {
 showError('Could not capture photo. Please try again.');
 return;
 }

 if (profileCameraPreviewUrl) URL.revokeObjectURL(profileCameraPreviewUrl);
 fileStore.profile_camera = new File([blob], `profile_camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
 profileCameraPreviewUrl = URL.createObjectURL(blob);
 ensureProfilePhotoPair();
 await persistFiles();
 persistDraft();
 renderStepContent();
 });

 document.getElementById('btnRetakeAdmissionPhoto')?.addEventListener('click', async () => {
 delete fileStore.profile_camera;
 if (profileCameraPreviewUrl) URL.revokeObjectURL(profileCameraPreviewUrl);
 profileCameraPreviewUrl = null;
 await persistFiles();
 persistDraft();
 stopAdmissionCamera();
 renderStepContent();
 });
}

function updatePaymentPanels() {
 const mode = formData.paymentMode;
 const gcashFields = document.getElementById('gcashFields');
 const cashierNote = document.getElementById('cashierNote');
 if (gcashFields) gcashFields.style.display = mode === 'gcash' ? 'block' : 'none';
 if (cashierNote) cashierNote.style.display = (mode === 'cashier' || mode === 'bank') ? 'flex' : 'none';
}

function startGcashPayment() {
 hideError();
 GcashPayment.openModal({
 reference: formData.gcashReference,
 senderName: formData.gcashSenderName,
 amountPaid: formData.paymentAmount,
 receiptFile: fileStore.gcash_proof,
 receiptName: fileStore.gcash_proof?.name,
 }, applyGcashPaymentDetails);
}

function handleAutoSave() {
 saveCurrentStep();
 persistDraft();
}

function viewUploadedFile(key) {
 const file = fileStore[key];
 if (!file) return;
 const url = URL.createObjectURL(file);
 window.open(url, '_blank', 'noopener');
 setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function bindNavigation() {
 document.getElementById('btnPrev')?.addEventListener('click', async () => {
 if (currentStep > 1) {
 stopAdmissionCamera();
 saveCurrentStep();
 await persistFiles();
 persistDraft();
 currentStep -= 1;
 renderStepIndicator();
 renderStepContent();
 }
 });

 document.getElementById('btnNext')?.addEventListener('click', async () => {
 if (!validateStep(currentStep)) return;
 saveCurrentStep();
 await persistFiles();
 persistDraft();
 if (currentStep < TOTAL_ADMISSION_STEPS) {
 currentStep += 1;
 renderStepIndicator();
 renderStepContent();
 }
 });

 document.getElementById('btnSubmit')?.addEventListener('click', submitApplication);
}

function updateNavButtons() {
 const btnPrev = document.getElementById('btnPrev');
 const btnNext = document.getElementById('btnNext');
 const btnSubmit = document.getElementById('btnSubmit');
 const saveHint = document.getElementById('enrollSaveHint');

 if (btnPrev) {
 btnPrev.style.display = currentStep === 1 ? 'none' : 'inline-flex';
 btnPrev.disabled = currentStep === 1;
 }
 if (btnNext) btnNext.style.display = currentStep === TOTAL_ADMISSION_STEPS ? 'none' : 'inline-flex';
 if (btnSubmit) btnSubmit.style.display = currentStep === TOTAL_ADMISSION_STEPS ? 'inline-flex' : 'none';
 if (saveHint) saveHint.hidden = currentStep === TOTAL_ADMISSION_STEPS;
}

function saveCurrentStep() {
 syncField('lastName');
 syncField('firstName');
 syncField('middleName');
 syncField('birthdate');
 syncField('gender');
 syncField('houseNumber');
 syncField('street');
 syncField('province');
 syncField('provinceCode');
 syncField('city');
 syncField('cityCode');
 syncField('barangay');
 syncField('barangayCode');
 syncField('contactNumber');
 syncField('email');
 syncField('gradeLevel');
 syncField('admissionType');
 syncField('previousSchool');
 syncField('gcashReference');
 formData.address = buildFullAddress(formData);

 const strandEl = document.getElementById('strandId');
 if (strandEl) {
 formData.strandId = strandEl.value;
 const nextStrand = strandEl.selectedOptions[0]?.dataset.code || '';
 if (nextStrand && nextStrand !== formData.strandCode) {
 activeAdmissionSubjects = [];
 admissionOfferingsSource = '';
 admissionOfferingsError = '';
 }
 formData.strandCode = nextStrand;
 }

 formData.schedulePlanAcknowledged = Boolean(document.getElementById('agreeSchedulePlan')?.checked);
 if (currentStep === 5) {
 syncAdmissionSchedulesFromDOM();
 }

 const paymentRadio = document.querySelector('input[name="paymentMode"]:checked');
 if (paymentRadio) {
 formData.paymentMode = paymentRadio.value;
 }
}

function syncField(id) {
 const el = document.getElementById(id);
 if (el && id in formData) {
 formData[id] = el.value.trim();
 }
}

function persistDraft() {
 const storage = getDraftStorage();
 if (!storage) return;

 try {
 storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
 formData: { ...formData },
 currentStep,
 savedFileKeys: Object.keys(fileStore),
 savedAt: Date.now()
 }));
 } catch (err) {
 console.warn('Could not save draft:', err);
 }
}

async function resetEnrollmentDraft() {
 const storage = getDraftStorage();
 storage?.removeItem(DRAFT_STORAGE_KEY);
 await clearFiles();
 currentStep = 1;
 activeAdmissionSubjects = [];
 admissionOfferingsSource = '';
 admissionOfferingsError = '';
 Object.assign(formData, getDefaultFormData());
}

async function loadDraft() {
 const storage = getDraftStorage();
 if (!storage) return;

 try {
 const raw = storage.getItem(DRAFT_STORAGE_KEY);
 if (!raw) return;

 const draft = JSON.parse(raw);
 if (draft.savedAt && Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
 await clearDraft();
 return;
 }

 if (draft.formData) Object.assign(formData, draft.formData);
 if (formData.paymentMode === 'bank') {
 formData.paymentMode = 'cashier';
 clearBankPaymentDetails();
 }
 if (!formData.strandCode && formData.strandId) {
 const match = STRANDS.find((strand) => strand.id === formData.strandId);
 if (match) formData.strandCode = match.code;
 }
 if (draft.currentStep) currentStep = Math.min(Math.max(1, draft.currentStep), TOTAL_ADMISSION_STEPS);

 if (currentStep >= 5 && !resolveStrandCode()) currentStep = 3;
 if (currentStep > 1 && !hasMeaningfulDraft(draft)) currentStep = 1;

 if (hasMeaningfulDraft(draft)) {
 showDraftRestoredBanner(currentStep);
 }
 } catch (err) {
 console.warn('Could not load draft:', err);
 }

 await restoreFiles();
}

async function clearDraft() {
 const storage = getDraftStorage();
 storage?.removeItem(DRAFT_STORAGE_KEY);
 await clearFiles();
}

function openFileDB() {
 return new Promise((resolve, reject) => {
 const request = indexedDB.open(FILE_DB_NAME, FILE_DB_VERSION);
 request.onupgradeneeded = () => {
 if (!request.result.objectStoreNames.contains('files')) {
 request.result.createObjectStore('files');
 }
 };
 request.onsuccess = () => resolve(request.result);
 request.onerror = () => reject(request.error);
 });
}

async function persistFiles() {
 if (!window.indexedDB) return;

 try {
 const entries = await Promise.all(
 Object.entries(fileStore).map(async ([key, file]) => ({
 key,
 name: file.name,
 type: file.type || 'application/octet-stream',
 data: await file.arrayBuffer()
 }))
 );

 const db = await openFileDB();
 await new Promise((resolve, reject) => {
 const tx = db.transaction('files', 'readwrite');
 const store = tx.objectStore('files');
 store.clear();
 entries.forEach(entry => store.put(entry, entry.key));
 tx.oncomplete = () => resolve();
 tx.onerror = () => reject(tx.error);
 });
 } catch (err) {
 console.warn('Could not save uploaded files:', err);
 }
}

async function restoreFiles() {
 if (!window.indexedDB) return;

 try {
 const db = await openFileDB();
 const tx = db.transaction('files', 'readonly');
 const store = tx.objectStore('files');
 const records = await new Promise((resolve, reject) => {
 const req = store.getAll();
 req.onsuccess = () => resolve(req.result || []);
 req.onerror = () => reject(req.error);
 });

 records.forEach(record => {
 if (!record?.data) return;
 fileStore[record.key] = new File(
 [record.data],
 record.name || 'document',
 { type: record.type || 'application/octet-stream' }
 );
 });
 } catch (err) {
 console.warn('Could not restore uploaded files:', err);
 }
}

async function clearFiles() {
 if (!window.indexedDB) return;

 try {
 const db = await openFileDB();
 const tx = db.transaction('files', 'readwrite');
 tx.objectStore('files').clear();
 await new Promise((resolve, reject) => {
 tx.oncomplete = () => resolve();
 tx.onerror = () => reject(tx.error);
 });
 } catch (err) {
 console.warn('Could not clear saved files:', err);
 }

 Object.keys(fileStore).forEach(key => delete fileStore[key]);
}

function validateStep(step) {
 hideError();

 if (step === 1) {
 saveCurrentStep();
 if (!formData.lastName || !formData.firstName || !formData.birthdate || !formData.email || !formData.contactNumber || !formData.gender) {
 showError('Please fill in all required personal information fields.');
 return false;
 }
 if (typeof AdmissionValidation !== 'undefined') {
 if (!AdmissionValidation.isValidEmail(formData.email)) {
 showError('Please enter a valid email address.');
 return false;
 }
 if (!AdmissionValidation.isValidContact(formData.contactNumber)) {
 showError('Contact number must be 11 digits starting with 09 (example: 09171234567).');
 return false;
 }
 if (!AdmissionValidation.isValidGender(formData.gender)) {
 showError('Please select your gender.');
 return false;
 }
 const birthCheck = AdmissionValidation.validateBirthdateAge(formData.birthdate);
 if (!birthCheck.ok) {
 showError(birthCheck.message);
 return false;
 }
 } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
 showError('Please enter a valid email address.');
 return false;
 }
 }

 if (step === 2) {
 saveCurrentStep();
 if (!formData.houseNumber || !formData.street || !formData.barangay || !formData.city || !formData.province) {
 showError('Please complete all address fields.');
 return false;
 }
 }

 if (step === 3) {
 saveCurrentStep();
 if (!formData.strandId) {
 showError('Please select a preferred strand.');
 return false;
 }
 if (!formData.previousSchool) {
 showError('Please enter your previous school.');
 return false;
 }
 }

 if (step === 4) {
 if (!hasProfilePhoto()) {
 showError('Please upload a photo or take one with your camera.');
 return false;
 }
 if (typeof AdmissionValidation !== 'undefined' && fileStore.profile_upload) {
 const check = AdmissionValidation.validateFile(fileStore.profile_upload, { kind: 'profile' });
 if (!check.ok) {
 showError(check.message);
 return false;
 }
 }
 ensureProfilePhotoPair();
 stopAdmissionCamera();
 }

 if (step === 5) {
 saveCurrentStep();
 if (!resolveStrandCode()) {
 showError('Please complete Academic Info (Step 3) and select your strand.');
 return false;
 }
 const subjects = getAdmissionSubjectsWithSchedules();
 if (!subjects.length) {
 showError('No subjects with schedules are available for your strand. Please contact the registrar.');
 return false;
 }
 const missing = subjects.filter(subj => !formData.subjectSchedules?.[subj.code]);
 if (missing.length) {
 showError('Please select a day and time schedule for every subject before continuing.');
 return false;
 }
 const fullSections = subjects.filter(subj => {
 const schedId = formData.subjectSchedules?.[subj.code];
 const schedule = (subj.schedules || []).find(s => String(s.id) === String(schedId));
 return ScheduleFormat.isScheduleFull(schedule);
 });
 if (fullSections.length) {
 showError('One or more selected sections are already full. Please choose another section.');
 return false;
 }
 if (!document.getElementById('agreeSchedulePlan')?.checked) {
 showError('Please confirm that you understand your 1st semester schedule and strand plan.');
 return false;
 }
 }

 if (step === 6) {
 const missing = REQUIRED_DOCUMENTS.filter(d => !fileStore[d.key]);
 if (missing.length) {
 showError('Please upload all required documents before continuing.');
 return false;
 }
 if (typeof AdmissionValidation !== 'undefined') {
 for (const doc of REQUIRED_DOCUMENTS) {
 const check = AdmissionValidation.validateFile(fileStore[doc.key], { kind: 'document' });
 if (!check.ok) {
 showError(`${doc.label}: ${check.message}`);
 return false;
 }
 }
 }
 }

 if (step === 7) {
 saveCurrentStep();
 if (formData.paymentMode === 'gcash' && formData.paymentStatus !== 'submitted') {
 showError('Please complete GCash payment and submit your payment details.');
 return false;
 }
 if (formData.paymentMode === 'gcash' && !fileStore.gcash_proof) {
 showError('Please upload your GCash payment receipt.');
 return false;
 }
 if (formData.paymentMode === 'gcash' && typeof AdmissionValidation !== 'undefined' && fileStore.gcash_proof) {
 const check = AdmissionValidation.validateFile(fileStore.gcash_proof, { kind: 'payment' });
 if (!check.ok) {
 showError(check.message);
 return false;
 }
 }
 if (formData.paymentMode === 'bank' && !fileStore.bank_proof) {
 showError('Please upload your bank payment receipt.');
 return false;
 }
 if (formData.paymentMode === 'bank' && typeof AdmissionValidation !== 'undefined' && fileStore.bank_proof) {
 const check = AdmissionValidation.validateFile(fileStore.bank_proof, { kind: 'payment' });
 if (!check.ok) {
 showError(check.message);
 return false;
 }
 }
 }

 if (step === 8) {
 if (!document.getElementById('agreeTerms')?.checked) {
 showError('Please confirm that your information is correct.');
 return false;
 }
 }

 return true;
}

async function submitApplication() {
 if (!validateStep(8)) return;

 saveCurrentStep();
 ensureProfilePhotoPair();
 hideError();

 const btnSubmit = document.getElementById('btnSubmit');
 btnSubmit.disabled = true;
 btnSubmit.textContent = 'Submitting...';

 const payload = new FormData();
 Object.entries(formData).forEach(([key, value]) => {
 if (key === 'subjectSchedules') {
 payload.append(key, JSON.stringify(value || {}));
 return;
 }
 payload.append(key, value);
 });
 payload.append('subjectScheduleDetails', JSON.stringify(getAdmissionScheduleSelections()));

 const documentFileNames = {};
 REQUIRED_DOCUMENTS.forEach(doc => {
 if (fileStore[doc.key]) documentFileNames[doc.key] = fileStore[doc.key].name;
 });
 payload.append('documentFileNames', JSON.stringify(documentFileNames));
 const primaryPhoto = getPrimaryProfilePhotoFile();
 payload.append('profilePhotoFileNames', JSON.stringify({
 profile: primaryPhoto ? primaryPhoto.name : ''
 }));

 if (fileStore.gcash_proof) payload.append('gcashProofFileName', fileStore.gcash_proof.name);

 Object.entries(fileStore).forEach(([key, file]) => {
 if (key === 'profile_upload' || key === 'profile_camera') return;
 payload.append(key, file);
 });
 if (primaryPhoto) {
 payload.append('profile_photo', primaryPhoto);
 }

 try {
 const res = await fetch('/api/admission/submit', { method: 'POST', body: payload });
 const result = await res.json();

 if (!result.success) {
 await saveDraftNow();
 let message = result.error || 'Failed to submit application.';
 if (result.details) message += ` (${result.details})`;
 if (result.hint) message += ` ${result.hint}`;
 message += ' Your progress has been saved — you can continue later.';
 showError(message);
 btnSubmit.disabled = false;
 btnSubmit.textContent = 'Submit Application';
 return;
 }

 clearDraft().catch(() => {});
 clearAdmissionEntryTypeLock();
 showSubmitSuccessModal(result.applicationNumber, result.emailWarning);
 } catch (err) {
 await saveDraftNow();
 showError('Network error. Your progress has been saved — refresh the page to continue where you left off.');
 btnSubmit.disabled = false;
 btnSubmit.textContent = 'Submit Application';
 }
}

function showSubmitSuccessModal(applicationNumber, warning) {
 const overlay = document.getElementById('enrollSubmitSuccess');
 const appNoEl = document.getElementById('submitSuccessAppNo');
 const proceedBtn = document.getElementById('btnProceedSignIn');
 if (!overlay || !appNoEl) return;

 appNoEl.textContent = applicationNumber || '—';

 const note = overlay.querySelector('.enroll-submit-note');
 const defaultNote =
 'A confirmation email has been sent to your inbox. Please wait for a separate follow-up email ' +
 'informing you whether your application has been approved or not. Once approved, you will receive ' +
 'your Student ID and temporary password. Your official Registration Form will be emailed after tuition payment is approved.';

 if (note) {
 if (warning) {
 note.innerHTML =
 `<span class="enroll-submit-warning"><strong>Notice:</strong> ${esc(warning)}</span>` +
 defaultNote;
 } else {
 note.textContent = defaultNote;
 }
 }

 overlay.hidden = false;

 const goToSignIn = () => {
 const app = encodeURIComponent(applicationNumber || '');
 window.location.href = `login.html?role=student&submitted=1&app=${app}`;
 };

 proceedBtn?.addEventListener('click', goToSignIn, { once: true });
}

function val(id) {
 const el = document.getElementById(id);
 return el ? el.value.trim() : '';
}

function esc(str) {
 if (!str) return '';
 return String(str)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

let enrollToastTimer = null;

function showError(msg) {
 const toast = document.getElementById('enrollToast');
 const text = document.getElementById('enrollToastText');
 if (!toast || !text || !msg) return;

 clearTimeout(enrollToastTimer);
 text.textContent = msg;
 toast.classList.add('show');

 enrollToastTimer = setTimeout(() => hideError(), 6000);
}

function hideError() {
 const toast = document.getElementById('enrollToast');
 if (toast) toast.classList.remove('show');
 clearTimeout(enrollToastTimer);
}

document.addEventListener('DOMContentLoaded', initEnrollPage);
