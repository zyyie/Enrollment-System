// Step-by-step new student admission enrollment

const ADMISSION_STEPS = [
  { id: 1, label: 'Personal Info' },
  { id: 2, label: 'Address' },
  { id: 3, label: 'Academic Info' },
  { id: 4, label: 'Documents' },
  { id: 5, label: 'Payment' },
  { id: 6, label: 'Review & Submit' }
];

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
  { id: 'GAS', code: 'GAS', name: 'General Academic Strand' },
  { id: 'ICT', code: 'ICT', name: 'ICT - Information and Communications Technology' },
  { id: 'COOKERY', code: 'COOKERY', name: 'Cookery' },
  { id: 'EIM', code: 'EIM', name: 'EIM - Electrical Installation and Maintenance' }
];

const DRAFT_STORAGE_KEY = 'geranova_admission_draft';
const FILE_DB_NAME = 'geranova_admission_files';
const FILE_DB_VERSION = 1;
const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const BANK_OPTIONS = [
  { code: 'bpi', name: 'BPI', subtitle: 'Pay enrollment fee via BPI online transfer' },
  { code: 'unionbank', name: 'UnionBank', subtitle: 'Pay enrollment fee via UnionBank online transfer' }
];

const GCASH_LOGO = 'assets/gcash-logo.png';

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
    paymentAmount: '2500'
  };
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
let paymentView = 'methods';

function getDraftStorage() {
  try {
    return window.localStorage;
  } catch (err) {
    console.warn('Local storage unavailable:', err);
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

  if (wantsFresh) {
    window.history.replaceState({}, '', 'enroll.html');
    await resetEnrollmentDraft();
  } else {
    await loadDraft();
  }

  renderStepIndicator();
  renderStepContent();
  bindStepAutoSave();
  bindNavigation();
  bindDraftBanner();

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

async function applyBankPaymentDetails(data) {
  clearGcashPaymentDetails();
  formData.paymentMode = 'bank';
  formData.bankCode = data.bankCode;
  formData.paymentStatus = data.paymentStatus || 'submitted';
  formData.bankReference = data.reference;
  formData.bankSenderName = data.senderName;
  formData.paymentAmount = String(data.amountPaid);
  if (data.receiptFile) {
    fileStore.bank_proof = data.receiptFile;
    await persistFiles();
  }
  paymentView = 'methods';
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

function getSelectedBankLabel() {
  const fromList = BANK_OPTIONS.find(b => b.code === formData.bankCode)?.name;
  if (fromList) return fromList;
  if (typeof BankPayment !== 'undefined') return BankPayment.getBankLabel(formData.bankCode);
  return formData.bankCode || '';
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

  if (currentStep !== 5) {
    paymentView = 'methods';
  }

  const steps = {
    1: renderPersonalStep(),
    2: renderAddressStep(),
    3: renderAcademicStep(),
    4: renderDocumentsStep(),
    5: renderPaymentStep(),
    6: renderReviewStep()
  };

  container.innerHTML = steps[currentStep] || '';
  bindStepEvents();
  updateNavButtons();
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
        <label for="gender">Gender</label>
        <select id="gender" class="form-control">
          <option value="" disabled ${!formData.gender ? 'selected' : ''} hidden>Select</option>
          <option value="Male" ${formData.gender === 'Male' ? 'selected' : ''}>Male</option>
          <option value="Female" ${formData.gender === 'Female' ? 'selected' : ''}>Female</option>
        </select>
      </div>
      <div class="form-group">
        <label for="contactNumber">Contact Number *</label>
        <input type="tel" id="contactNumber" class="form-control" placeholder="09XXXXXXXXX" value="${esc(formData.contactNumber)}" required>
      </div>
      <div class="form-group full-width">
        <label for="email">Email Address *</label>
        <input type="email" id="email" class="form-control" placeholder="you@email.com" value="${esc(formData.email)}" required>
        <small class="field-hint">Your Student ID will be sent to this email once approved.</small>
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
      <div class="form-group">
        <label for="admissionType">Admission Type *</label>
        <select id="admissionType" class="form-control">
          <option value="new" ${formData.admissionType === 'new' ? 'selected' : ''}>New Student</option>
          <option value="transferee" ${formData.admissionType === 'transferee' ? 'selected' : ''}>Transferee</option>
          <option value="returnee" ${formData.admissionType === 'returnee' ? 'selected' : ''}>Returnee</option>
        </select>
      </div>
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
    <h2 class="enroll-step-title">Step 4 — Required Documents</h2>
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

function renderBankPickerView(feeLabel) {
  const rows = BANK_OPTIONS.map(bank => `
    <button type="button" class="payment-bank-row" data-bank="${bank.code}">
      <span class="payment-bank-logo ${bank.code}" aria-hidden="true">${bank.code === 'bpi' ? 'BPI' : 'UB'}</span>
      <span class="payment-bank-body">
        <strong>${bank.name}</strong>
        <span>${bank.subtitle}</span>
      </span>
      <span class="payment-bank-chevron" aria-hidden="true">›</span>
    </button>
  `).join('');

  return `
    <div class="payment-bank-picker">
      <button type="button" class="payment-bank-back" id="btnPaymentBack">← Back</button>
      <h3 class="payment-bank-picker-title">Select bank account</h3>
      <p class="payment-bank-picker-desc">Choose your bank to pay the enrollment fee of <strong>${feeLabel}</strong>.</p>
      <div class="payment-bank-list">
        ${rows}
      </div>
    </div>
  `;
}

function renderPaymentStep() {
  const isGcash = formData.paymentMode === 'gcash';
  const isBank = formData.paymentMode === 'bank';
  const isCashier = formData.paymentMode === 'cashier';
  const isSubmitted = formData.paymentStatus === 'submitted';
  const feeLabel = GcashPayment.formatPeso(getEnrollmentFee());
  const bankLabel = getSelectedBankLabel();

  if (paymentView === 'banks') {
    return `
      <h2 class="enroll-step-title">Step 5 — Mode of Payment</h2>
      ${renderBankPickerView(feeLabel)}
    `;
  }

  return `
    <h2 class="enroll-step-title">Step 5 — Mode of Payment</h2>
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

      <button type="button" class="payment-method-row payment-method-nav ${isBank ? 'selected' : ''}" id="btnOpenBanks">
        <span class="payment-method-icon bank" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/><path d="M3 9l2-4h14l2 4"/></svg>
        </span>
        <span class="payment-method-body">
          <strong>Bank account</strong>
          <span>${bankLabel ? `Selected: ${bankLabel}` : 'Pay via BPI or UnionBank'}</span>
        </span>
        <span class="payment-method-chevron" aria-hidden="true">›</span>
      </button>

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

    <div id="bankFields" class="payment-detail-panel" style="display:${isBank && formData.bankCode ? 'block' : 'none'};">
      <div class="bank-checkout-card ${formData.bankCode || ''}">
        <div class="payment-bank-logo ${formData.bankCode || 'bpi'}" aria-hidden="true">${formData.bankCode === 'unionbank' ? 'UB' : 'BPI'}</div>
        <div class="gcash-checkout-meta">
          <p class="gcash-checkout-title">${esc(bankLabel)} Transfer</p>
          <p class="gcash-checkout-amount">${feeLabel}</p>
          <p class="gcash-checkout-note">Pay via online or mobile banking transfer</p>
        </div>
      </div>

      ${isSubmitted && isBank ? `
        <div class="gcash-paid-banner">
          <span class="gcash-paid-check">✓</span>
          <div>
            <strong>Payment Details Submitted</strong>
            <p>${esc(bankLabel)} · Ref: ${esc(formData.bankReference)} · ${esc(formData.bankSenderName)} · ${GcashPayment.formatPeso(formData.paymentAmount)}</p>
            ${fileStore.bank_proof ? `<p class="gcash-receipt-name">Receipt: ${esc(fileStore.bank_proof.name)}</p>` : ''}
          </div>
        </div>
        <button type="button" class="payment-secondary-btn" id="btnEditBank">Edit Payment Details</button>
      ` : `
        <button type="button" class="gcash-pay-btn full-width bank-pay-btn" id="btnPayBank">
          Pay via ${esc(bankLabel || 'Bank')}
        </button>
        <p class="field-hint payment-gcash-hint">Enter your transfer details and upload your payment receipt.</p>
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
    : formData.paymentMode === 'bank'
      ? (formData.paymentStatus === 'submitted'
        ? `${esc(getSelectedBankLabel())} — Ref: ${esc(formData.bankReference)} · ${esc(formData.bankSenderName)} · ${GcashPayment.formatPeso(formData.paymentAmount)}`
        : `${esc(getSelectedBankLabel() || 'Bank')} — Payment not yet submitted`)
      : 'Pay in person at the Cashier';

  const fullAddress = buildFullAddress(formData) || formData.address || '—';

  return `
    <h2 class="enroll-step-title">Step 6 — Review & Submit</h2>
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
      <p><strong>Admission Type:</strong> ${esc(formData.admissionType)}</p>
      <p><strong>Previous School:</strong> ${esc(formData.previousSchool || '—')}</p>
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
  bindDateFields(document.getElementById('stepContent'));

  document.querySelectorAll('.doc-view-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => viewUploadedFile(btn.dataset.key));
  });

  document.querySelectorAll('input[type="file"][data-key]').forEach(input => {
    input.addEventListener('change', async e => {
      const key = e.target.dataset.key;
      const file = e.target.files[0];
      if (file) {
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

  document.getElementById('btnOpenBanks')?.addEventListener('click', () => {
    paymentView = 'banks';
    renderStepContent();
  });

  document.getElementById('btnPaymentBack')?.addEventListener('click', () => {
    paymentView = 'methods';
    renderStepContent();
  });

  document.querySelectorAll('.payment-bank-row[data-bank]').forEach(btn => {
    btn.addEventListener('click', () => {
      formData.paymentMode = 'bank';
      formData.bankCode = btn.dataset.bank;
      formData.paymentStatus = '';
      clearGcashPaymentDetails();
      paymentView = 'methods';
      persistDraft();
      renderStepContent();
    });
  });

  document.getElementById('btnPayGcash')?.addEventListener('click', startGcashPayment);
  document.getElementById('btnEditGcash')?.addEventListener('click', startGcashPayment);
  document.getElementById('btnPayBank')?.addEventListener('click', startBankPayment);
  document.getElementById('btnEditBank')?.addEventListener('click', startBankPayment);

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
}

function updatePaymentPanels() {
  const mode = formData.paymentMode;
  const gcashFields = document.getElementById('gcashFields');
  const bankFields = document.getElementById('bankFields');
  const cashierNote = document.getElementById('cashierNote');
  if (gcashFields) gcashFields.style.display = mode === 'gcash' ? 'block' : 'none';
  if (bankFields) bankFields.style.display = mode === 'bank' && formData.bankCode ? 'block' : 'none';
  if (cashierNote) cashierNote.style.display = mode === 'cashier' ? 'flex' : 'none';
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

function startBankPayment() {
  if (!formData.bankCode) {
    paymentView = 'banks';
    renderStepContent();
    return;
  }
  hideError();
  BankPayment.openModal(formData.bankCode, {
    reference: formData.bankReference,
    senderName: formData.bankSenderName,
    amountPaid: formData.paymentAmount,
    receiptFile: fileStore.bank_proof,
    receiptName: fileStore.bank_proof?.name,
  }, applyBankPaymentDetails);
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
    if (currentStep < 6) {
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
  if (btnNext) btnNext.style.display = currentStep === 6 ? 'none' : 'inline-flex';
  if (btnSubmit) btnSubmit.style.display = currentStep === 6 ? 'inline-flex' : 'none';
  if (saveHint) saveHint.hidden = currentStep === 6;
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
    formData.strandCode = strandEl.selectedOptions[0]?.dataset.code || '';
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
  Object.assign(formData, getDefaultFormData());
}

async function loadDraft() {
  const storage = getDraftStorage();
  if (!storage) return;

  try {
    // Migrate legacy sessionStorage drafts
    try {
      const legacy = window.sessionStorage?.getItem(DRAFT_STORAGE_KEY);
      if (legacy && !storage.getItem(DRAFT_STORAGE_KEY)) {
        storage.setItem(DRAFT_STORAGE_KEY, legacy);
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      }
    } catch (err) {
      /* ignore migration errors */
    }

    const raw = storage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return;

    const draft = JSON.parse(raw);
    if (draft.savedAt && Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
      await clearDraft();
      return;
    }

    if (draft.formData) Object.assign(formData, draft.formData);
    if (draft.currentStep) currentStep = draft.currentStep;

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
    if (!formData.lastName || !formData.firstName || !formData.birthdate || !formData.email || !formData.contactNumber) {
      showError('Please fill in all required personal information fields.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
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
    const missing = REQUIRED_DOCUMENTS.filter(d => !fileStore[d.key]);
    if (missing.length) {
      showError('Please upload all required documents before continuing.');
      return false;
    }
  }

  if (step === 5) {
    saveCurrentStep();
    if (formData.paymentMode === 'gcash' && formData.paymentStatus !== 'submitted') {
      showError('Please complete GCash payment and submit your payment details.');
      return false;
    }
    if (formData.paymentMode === 'gcash' && !fileStore.gcash_proof) {
      showError('Please upload your GCash payment receipt.');
      return false;
    }
    if (formData.paymentMode === 'bank') {
      if (!formData.bankCode) {
        showError('Please select a bank account for payment.');
        return false;
      }
      if (formData.paymentStatus !== 'submitted') {
        showError('Please complete bank transfer payment and submit your payment details.');
        return false;
      }
      if (!fileStore.bank_proof) {
        showError('Please upload your bank payment receipt.');
        return false;
      }
    }
  }

  if (step === 6) {
    if (!document.getElementById('agreeTerms')?.checked) {
      showError('Please confirm that your information is correct.');
      return false;
    }
  }

  return true;
}

async function submitApplication() {
  if (!validateStep(6)) return;

  saveCurrentStep();
  hideError();

  const btnSubmit = document.getElementById('btnSubmit');
  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Submitting...';

  const payload = new FormData();
  Object.entries(formData).forEach(([key, value]) => payload.append(key, value));
  Object.entries(fileStore).forEach(([key, file]) => {
    payload.append(key, file);
  });

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
    showSubmitSuccessModal(result.applicationNumber, result.warning);
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
  if (note && warning) {
    note.textContent = warning;
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
