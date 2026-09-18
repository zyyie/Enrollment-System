// Student enrollment flow — subjects filtered by strand, grade level, and semester

let activeEnrollmentSubjects = null;
let activeRequiredSubjectCount = null;
let enrollmentPhotoState = { uploadDone: false, cameraDone: false };
let cameraStream = null;

const enrollmentPaymentState = {
  paymentMode: 'cashier',
  paymentStatus: '',
  gcashReference: '',
  gcashSenderName: '',
  paymentAmount: '',
  gcashProofFile: null,
};

function getEnrollmentFee() {
  return window.SUPABASE_CONFIG?.enrollmentFee || 2500;
}

function resolveAssetUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
  return '/' + String(path).replace(/^\.?\//, '');
}

function getSemesterLabel(student) {
  return normalizeSemesterCode(student) === '1st' ? '1st Semester' : '2nd Semester';
}

function getEnrollmentTermKey(student) {
  const sy = (student.schoolYear || '2627').replace(/\D/g, '').slice(-4) || '2627';
  return `${student.id}_${sy}_${normalizeSemesterCode(student)}`;
}

function getEnrollmentKey(student) {
  const profile = typeof student === 'object' && student ? student : { id: student, schoolYear: '2026-2027', semesterCode: '1st' };
  return 'enrollment_' + getEnrollmentTermKey(profile);
}

function getPhotoStorageKey(studentId) {
  return 'enrollment_photos_' + studentId;
}

function getRequiredSubjectCount(student) {
  if (activeRequiredSubjectCount != null) return activeRequiredSubjectCount;
  if (typeof requiredSubjectsCount === 'function' && student) {
    return requiredSubjectsCount(
      normalizeStrandCode(student),
      normalizeGradeLevel(student),
      normalizeSemesterCode(student)
    );
  }
  return (getEnrollmentSubjectsList() || []).length || 0;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function filterOfferingsByTerm(student, offerings) {
  if (typeof subjectsForTerm !== 'function') return offerings || [];
  const allowed = new Set(
    subjectsForTerm(
      normalizeStrandCode(student),
      normalizeGradeLevel(student),
      normalizeSemesterCode(student)
    ).map(subj => subj.code)
  );
  return (offerings || []).filter(subj => allowed.has(subj.code));
}

function enrollmentMatchesCurrentTerm(student, record) {
  if (!record) return false;
  if (isLockedEnrollmentStatus(record.status)) return true;
  const subjects = record.subjects;
  if (!Array.isArray(subjects) || !subjects.length) return false;
  if (typeof subjectsForTerm !== 'function') return true;
  const sem = record.semesterCode || normalizeSemesterCode(student);
  const allowed = new Set(
    subjectsForTerm(
      normalizeStrandCode(student),
      normalizeGradeLevel(student),
      sem
    ).map(subj => subj.code)
  );
  return subjects.every(subj => allowed.has(subj.code));
}

function isValidLockedEnrollment(student, record) {
  return Boolean(
    record
    && isLockedEnrollmentStatus(record.status)
    && enrollmentMatchesCurrentTerm(student, record)
  );
}

function supabaseEnrollmentEnabled() {
  return typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled();
}

function getEnrollmentRecord(student) {
  const data = sessionStorage.getItem(getEnrollmentKey(student));
  return data ? JSON.parse(data) : null;
}

function saveEnrollmentRecord(student, record) {
  const payload = {
    ...record,
    semesterCode: record?.semesterCode || normalizeSemesterCode(student),
    schoolYear: record?.schoolYear || student?.schoolYear || '2026-2027',
  };
  sessionStorage.setItem(getEnrollmentKey(student), JSON.stringify(payload));
}

function clearEnrollmentRecord(student) {
  sessionStorage.removeItem(getEnrollmentKey(student));
  clearPhotoState(typeof student === 'object' ? student.id : student);
}

function loadPhotoState(studentId) {
  try {
    const data = sessionStorage.getItem(getPhotoStorageKey(studentId));
    return data ? JSON.parse(data) : { uploadDone: false, cameraDone: false };
  } catch (err) {
    return { uploadDone: false, cameraDone: false };
  }
}

function savePhotoStateToStorage(studentId, state) {
  enrollmentPhotoState = { ...state };
  sessionStorage.setItem(getPhotoStorageKey(studentId), JSON.stringify(enrollmentPhotoState));
}

function clearPhotoState(studentId) {
  sessionStorage.removeItem(getPhotoStorageKey(studentId));
  enrollmentPhotoState = { uploadDone: false, cameraDone: false };
  stopCamera();
}

function updatePageTitle(student) {
  const titleEl = document.getElementById('enrollmentPageTitle');
  if (titleEl) {
    const sy = student.schoolYear || '2026-2027';
    titleEl.textContent = `Registration (S.Y. ${sy} — ${getSemesterLabel(student)})`;
  }
}

function buildEnrollmentStepChips(student) {
  const grade = normalizeGradeLevel(student);
  const sem = getSemesterLabel(student);
  return [
    { num: 1, label: 'Upload Photo' },
    { num: 2, label: 'Take Photo' },
    { num: 3, label: 'Select Schedules' },
    { num: 4, label: 'Save & Assess' },
    { num: 5, label: 'Mode of Payment' },
    { num: 6, label: 'Confirm' },
    { num: 7, label: 'Print COR' },
  ];
}

function renderEnrollmentStepGuide(student) {
  const guideSub = document.getElementById('enrollmentGuideSub');
  const track = document.getElementById('enrollmentStepTrack');
  const grade = normalizeGradeLevel(student);
  const sem = getSemesterLabel(student);
  const strand = student.strandFull || student.strand || normalizeStrandCode(student);

  if (guideSub) {
    guideSub.textContent = `Follow each step to complete your ${grade} — ${sem} enrollment (${strand} strand). You must finish Steps 1–2 before selecting subjects.`;
  }

  if (track) {
    const chips = buildEnrollmentStepChips(student);
    const activeStep = !enrollmentPhotoState.uploadDone ? 1
      : !enrollmentPhotoState.cameraDone ? 2 : 3;
    track.innerHTML = chips.map(chip => {
      let cls = 'enrollment-step-chip';
      if (chip.num < activeStep || (chip.num === 1 && enrollmentPhotoState.uploadDone) || (chip.num === 2 && enrollmentPhotoState.cameraDone)) {
        if (chip.num <= 2 && ((chip.num === 1 && enrollmentPhotoState.uploadDone) || (chip.num === 2 && enrollmentPhotoState.cameraDone))) {
          cls += ' done';
        } else if (chip.num === 3 && enrollmentPhotoState.uploadDone && enrollmentPhotoState.cameraDone) {
          cls += ' active';
        }
      } else if (chip.num === activeStep) {
        cls += ' active';
      }
      return `<span class="${cls}"><span class="chip-num">${chip.num}</span>${chip.label}</span>`;
    }).join('');
  }

  const hint = document.getElementById('subjectSelectionHint');
  if (hint) {
    hint.textContent = enrollmentPhotoState.uploadDone && enrollmentPhotoState.cameraDone
      ? `Select schedules and subjects for ${grade} — ${sem}.`
      : 'Complete Steps 1 and 2 first to unlock subject selection.';
  }
}

function updateEnrollmentStepUI(student) {
  renderEnrollmentStepGuide(student);

  const step1 = document.getElementById('enrollmentStep1');
  const step2 = document.getElementById('enrollmentStep2');
  const stepSubjects = document.getElementById('enrollmentStepSubjects');
  const step1Status = document.getElementById('step1Status');
  const step2Status = document.getElementById('step2Status');
  const step3Status = document.getElementById('step3Status');
  const saveBtn = document.getElementById('saveAssessBtn');
  const startCameraBtn = document.getElementById('startCameraBtn');

  if (step1) {
    step1.classList.toggle('completed', enrollmentPhotoState.uploadDone);
  }
  if (step1Status) {
    step1Status.textContent = enrollmentPhotoState.uploadDone ? 'Done' : 'Pending';
    step1Status.className = 'enrollment-step-status' + (enrollmentPhotoState.uploadDone ? ' done' : '');
  }

  if (step2) {
    step2.classList.toggle('locked', !enrollmentPhotoState.uploadDone);
    step2.classList.toggle('completed', enrollmentPhotoState.cameraDone);
  }
  if (step2Status) {
    if (!enrollmentPhotoState.uploadDone) {
      step2Status.textContent = 'Locked';
      step2Status.className = 'enrollment-step-status locked';
    } else {
      step2Status.textContent = enrollmentPhotoState.cameraDone ? 'Done' : 'Pending';
      step2Status.className = 'enrollment-step-status' + (enrollmentPhotoState.cameraDone ? ' done' : '');
    }
  }
  if (startCameraBtn) startCameraBtn.disabled = !enrollmentPhotoState.uploadDone;

  const photosReady = enrollmentPhotoState.uploadDone && enrollmentPhotoState.cameraDone;
  if (stepSubjects) {
    stepSubjects.classList.toggle('locked', !photosReady);
  }
  if (step3Status) {
    step3Status.textContent = photosReady ? 'Active' : 'Locked';
    step3Status.className = 'enrollment-step-status' + (photosReady ? '' : ' locked');
  }
  if (saveBtn) saveBtn.disabled = !photosReady;
}

function initPhotoSteps(student) {
  enrollmentPhotoState = loadPhotoState(student.id);
  updateEnrollmentStepUI(student);

  const uploadInput = document.getElementById('uploadPhotoInput');
  if (uploadInput && !uploadInput.dataset.bound) {
    uploadInput.dataset.bound = '1';
    uploadInput.addEventListener('change', onUploadPhotoSelected);
  }

  if (enrollmentPhotoState.uploadPreview) {
    showUploadPreview(enrollmentPhotoState.uploadPreview);
  }
  if (enrollmentPhotoState.cameraPreview) {
    showCameraPreview(enrollmentPhotoState.cameraPreview);
  }

  loadEnrollmentPhotosFromBackend(student);
}

async function loadEnrollmentPhotosFromBackend(student) {
  if (typeof SupabaseService === 'undefined') return;

  let remote = null;
  if (SupabaseService.isEnabled()) {
    remote = await SupabaseService.getEnrollmentPhotos(student.id);
  } else {
    try {
      const res = await fetch('/api/enrollment/photos?studentId=' + encodeURIComponent(student.id));
      const json = await res.json();
      if (json.success) remote = json.data;
    } catch (_) {}
  }

  if (!remote) return;

  enrollmentPhotoState.uploadDone = !!remote.uploadDone;
  enrollmentPhotoState.cameraDone = !!remote.cameraDone;
  if (remote.uploadUrl || remote.uploadPath) {
    enrollmentPhotoState.uploadPreview = remote.uploadUrl || remote.uploadPath;
    showUploadPreview(enrollmentPhotoState.uploadPreview);
    const confirmBtn = document.getElementById('confirmUploadBtn');
    if (confirmBtn) confirmBtn.disabled = false;
  }
  if (remote.cameraUrl || remote.cameraPath) {
    enrollmentPhotoState.cameraPreview = remote.cameraUrl || remote.cameraPath;
    showCameraPreview(enrollmentPhotoState.cameraPreview);
  }
  savePhotoStateToStorage(student.id, enrollmentPhotoState);
  updateEnrollmentStepUI(student);
}

function triggerUploadPhoto() {
  const input = document.getElementById('uploadPhotoInput');
  if (input) input.click();
}

function onUploadPhotoSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    StudentDialog.alert({ type: 'warning', title: 'File Too Large', message: 'Photo must be 5 MB or smaller.' });
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    showUploadPreview(reader.result);
    const confirmBtn = document.getElementById('confirmUploadBtn');
    if (confirmBtn) confirmBtn.disabled = false;
    enrollmentPhotoState.pendingUpload = reader.result;
  };
  reader.readAsDataURL(file);
}

function showUploadPreview(dataUrl) {
  const img = document.getElementById('uploadPhotoImg');
  const placeholder = document.querySelector('#uploadPhotoPreview .photo-placeholder');
  if (img) {
    img.src = dataUrl;
    img.style.display = 'block';
  }
  if (placeholder) placeholder.style.display = 'none';
}

async function confirmUploadPhoto() {
  const student = getStudent();
  if (!enrollmentPhotoState.pendingUpload && !enrollmentPhotoState.uploadPreview) return;

  const dataUrl = enrollmentPhotoState.pendingUpload || enrollmentPhotoState.uploadPreview;
  if (typeof SupabaseService !== 'undefined' && (SupabaseService.isEnabled() || typeof fetch !== 'undefined')) {
    const result = await SupabaseService.saveEnrollmentPhoto(student.id, 'upload', dataUrl);
    if (!result.success) {
      await StudentDialog.alert({ type: 'error', title: 'Upload Failed', message: result.error || 'Could not save photo to server.' });
      return;
    }
    if (result.data) {
      enrollmentPhotoState.uploadDone = !!result.data.uploadDone;
      enrollmentPhotoState.cameraDone = !!result.data.cameraDone;
      if (result.data.uploadUrl) enrollmentPhotoState.uploadPreview = result.data.uploadUrl;
    }
  } else {
    enrollmentPhotoState.uploadPreview = dataUrl;
    enrollmentPhotoState.uploadDone = true;
  }

  delete enrollmentPhotoState.pendingUpload;
  savePhotoStateToStorage(student.id, enrollmentPhotoState);
  updateEnrollmentStepUI(student);
}

async function startCamera() {
  const video = document.getElementById('cameraVideo');
  const preview = document.getElementById('cameraPhotoPreview');
  const startBtn = document.getElementById('startCameraBtn');
  const captureBtn = document.getElementById('capturePhotoBtn');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    if (video) {
      video.srcObject = cameraStream;
      video.style.display = 'block';
    }
    if (preview) preview.style.display = 'none';
    if (startBtn) startBtn.style.display = 'none';
    if (captureBtn) {
      captureBtn.style.display = 'inline-block';
      captureBtn.disabled = false;
    }
  } catch (err) {
    await StudentDialog.alert({
      type: 'warning',
      title: 'Camera Unavailable',
      message: 'Could not access your camera. Please allow camera permission or use Step 1 (Upload Photo) instead.'
    });
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  const video = document.getElementById('cameraVideo');
  if (video) {
    video.srcObject = null;
    video.style.display = 'none';
  }
}

function capturePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  if (!video || !canvas) return;
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  stopCamera();
  showCameraPreview(dataUrl);
  enrollmentPhotoState.pendingCamera = dataUrl;

  const preview = document.getElementById('cameraPhotoPreview');
  if (preview) preview.style.display = 'flex';
  const captureBtn = document.getElementById('capturePhotoBtn');
  const confirmBtn = document.getElementById('confirmCameraBtn');
  const retakeBtn = document.getElementById('retakePhotoBtn');
  if (captureBtn) captureBtn.style.display = 'none';
  if (confirmBtn) {
    confirmBtn.style.display = 'inline-block';
    confirmBtn.disabled = false;
  }
  if (retakeBtn) {
    retakeBtn.style.display = 'inline-block';
    retakeBtn.disabled = false;
  }
}

function showCameraPreview(dataUrl) {
  const img = document.getElementById('cameraPhotoImg');
  const placeholder = document.querySelector('#cameraPhotoPreview .photo-placeholder');
  if (img) {
    img.src = dataUrl;
    img.style.display = 'block';
  }
  if (placeholder) placeholder.style.display = 'none';
}

async function confirmCameraPhoto() {
  const student = getStudent();
  if (!enrollmentPhotoState.pendingCamera && !enrollmentPhotoState.cameraPreview) return;

  const dataUrl = enrollmentPhotoState.pendingCamera || enrollmentPhotoState.cameraPreview;
  if (typeof SupabaseService !== 'undefined' && (SupabaseService.isEnabled() || typeof fetch !== 'undefined')) {
    const result = await SupabaseService.saveEnrollmentPhoto(student.id, 'camera', dataUrl);
    if (!result.success) {
      await StudentDialog.alert({ type: 'error', title: 'Photo Save Failed', message: result.error || 'Could not save captured photo to server.' });
      return;
    }
    if (result.data) {
      enrollmentPhotoState.uploadDone = !!result.data.uploadDone;
      enrollmentPhotoState.cameraDone = !!result.data.cameraDone;
      if (result.data.cameraUrl) enrollmentPhotoState.cameraPreview = result.data.cameraUrl;
    }
  } else {
    enrollmentPhotoState.cameraPreview = dataUrl;
    enrollmentPhotoState.cameraDone = true;
  }

  delete enrollmentPhotoState.pendingCamera;
  savePhotoStateToStorage(student.id, enrollmentPhotoState);
  updateEnrollmentStepUI(student);
}

function retakeCameraPhoto() {
  enrollmentPhotoState.pendingCamera = null;
  const img = document.getElementById('cameraPhotoImg');
  const placeholder = document.querySelector('#cameraPhotoPreview .photo-placeholder');
  if (img) {
    img.src = '';
    img.style.display = 'none';
  }
  if (placeholder) placeholder.style.display = 'block';
  const confirmBtn = document.getElementById('confirmCameraBtn');
  const retakeBtn = document.getElementById('retakePhotoBtn');
  const startBtn = document.getElementById('startCameraBtn');
  if (confirmBtn) {
    confirmBtn.style.display = 'none';
    confirmBtn.disabled = true;
  }
  if (retakeBtn) retakeBtn.style.display = 'none';
  if (startBtn) {
    startBtn.style.display = 'inline-block';
    startBtn.disabled = false;
  }
}

function getNextSemesterLabel(currentSem) {
  return currentSem === '1st' ? '2nd Semester' : '1st Semester (next school year)';
}

function updateOfferingCount(student) {
  const countEl = document.getElementById('offeringCount');
  const subjects = getEnrollmentSubjectsList();
  const expectedCount = getRequiredSubjectCount(student);
  if (countEl) {
    countEl.textContent = subjects.length;
    countEl.classList.toggle('offering-count-warning', subjects.length !== expectedCount);
  }
}

function renderEnrolledSubjectsTable(subjects) {
  if (!Array.isArray(subjects) || !subjects.length) return '';
  const rows = subjects.map(subj => `
    <tr>
      <td>${subj.code || '—'}</td>
      <td>${subj.description || '—'}</td>
      <td>${subj.schedule || subj.scheduleLabel || '—'}</td>
    </tr>
  `).join('');
  return `
    <br><strong>Enrolled Subjects &amp; Schedules</strong>
    <table class="enrolled-subjects-table">
      <thead>
        <tr><th>Code</th><th>Subject</th><th>Schedule</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function getRegistrationCertificateUrl(studentId) {
  return `/api/student/registration-certificate?id=${encodeURIComponent(studentId || '')}`;
}

function openRegistrationCertificate(studentId) {
  const id = studentId || getStudent()?.id;
  if (!id) return;
  window.open(getRegistrationCertificateUrl(id), '_blank', 'noopener,noreferrer');
}

async function showWaitingView(student, record, access) {
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'none';
  document.getElementById('enrollmentBlocked').style.display = 'none';
  const waiting = document.getElementById('enrollmentWaiting');
  if (waiting) waiting.style.display = 'block';

  const grade = normalizeGradeLevel(student);
  const sem = record?.semester || (access && access.semesterName) || getSemesterLabel(student);
  const semCode = record?.semesterCode || normalizeSemesterCode(student);
  const nextSem = (access && access.nextSemesterLabel) || getNextSemesterLabel(semCode);
  const status = (record && record.status) || (access && access.currentEnrollmentStatus) || 'enrolled';
  const isPending = status === 'pending';
  const isApproved = status === 'approved' || status === 'enrolled';

  const titleEl = document.getElementById('enrollmentWaitingTitle');
  const msgEl = document.getElementById('enrollmentWaitingMessage');
  const detailsEl = document.getElementById('enrollmentWaitingDetails');

  if (titleEl) {
    if (isPending) {
      titleEl.textContent = 'Enrollment Submitted — Pending Approval';
    } else if (isApproved) {
      titleEl.textContent = 'Enrollment Approved — Complete Payment';
    } else {
      titleEl.textContent = `Already Enrolled — ${grade} ${sem}`;
    }
  }

  if (msgEl) {
    if (isPending) {
      msgEl.textContent = 'Na-submit mo na ang enrollment mo para sa term na ito. Hintayin ang approval ng Administrator. Pag na-approve na, magbayad sa Payment / Accounts at hintayin ang payment approval bago matanggap ang Registration Form sa email.';
    } else if (isApproved) {
      msgEl.textContent = 'Na-approve na ang enrollment mo. Kung nakapag-submit ka na ng payment, hintayin ang payment approval ng Registrar. Kung hindi pa, pumunta sa Payment / Accounts para magbayad. Ise-send ang Registration Form sa email pag na-approve ang payment.';
    } else {
      msgEl.textContent = `Tapos ka nang mag-enroll sa ${grade} — ${sem}. Hindi ka na pwedeng mag-enroll ulit sa term na ito. Maghintay hanggang buksan ng Admin ang enrollment para sa ${nextSem}.`;
    }
  }

  try {
    await loadEnrollmentSubjects(student);
  } catch (err) {
    console.warn('Could not load offerings for enrolled view:', err);
  }
  updateOfferingCount(student);

  const termEl = document.getElementById('termInfo');
  if (termEl && sem) {
    termEl.textContent = `${grade} · ${sem}`;
  }

  if (detailsEl) {
    const strand = student.strandFull || student.strand || normalizeStrandCode(student);
    const corNote = isPending
      ? 'Pag na-approve ang enrollment at payment mo, maaari mo nang i-download ang Certificate of Registration sa Payment o Forms page.'
      : 'Available ang Certificate of Registration sa Forms page.';
    const enrolledSubjects = record?.subjects?.length
      ? record.subjects
      : (getEnrollmentSubjectsList() || []).map(subj => ({
        code: subj.code,
        description: subj.description,
        schedule: (subj.schedules || [])[0]
          ? ScheduleFormat.formatDropdownOption(subj.schedules[0])
          : '—',
      }));
    detailsEl.innerHTML = `
      <strong>Enrollment Summary</strong><br>
      Grade Level: ${grade}<br>
      Semester: ${sem}<br>
      Strand: ${strand}<br>
      Status: ${isPending ? 'Pending Review' : (status === 'approved' ? 'Approved' : 'Enrolled')}<br>
      COR: ${corNote}
      ${renderEnrolledSubjectsTable(enrolledSubjects)}
      <br><em>Ang susunod na enrollment period ay ia-announce ng Registrar. Babalik ang Enrollment module kapag naka-open na ang ${nextSem}.</em>
    `;
  }
}

function hideWaitingView() {
  const waiting = document.getElementById('enrollmentWaiting');
  if (waiting) waiting.style.display = 'none';
}

function normalizeStrandCode(student) {
  const raw = student.strandCode || student.strand || student.strandFull || 'STEM';
  return String(raw).split('-')[0].trim().toUpperCase();
}

function normalizeSemesterCode(student) {
  const raw = student.semesterCode || student.semester || 'First Semester';
  const text = String(raw).toLowerCase();
  if (raw === '1st' || text.includes('first') || text.includes('1st')) return '1st';
  if (raw === '2nd' || text.includes('second') || text.includes('2nd')) return '2nd';
  return '1st';
}

function normalizeGradeLevel(student) {
  return student.gradeLevel || student.grade_level || 'Grade 12';
}

function isCanonicalSectionName(sectionName, strandCode, gradeLevel) {
  if (typeof sectionSlotLetterFromSchedule !== 'function') return true;
  return sectionSlotLetterFromSchedule({ section: sectionName }, strandCode, gradeLevel) != null;
}

function sectionMatchesStudent(sectionName, strandCode, gradeLevel) {
  return isCanonicalSectionName(sectionName, strandCode, gradeLevel);
}

function applyStudentSubjectFilters(student, subjects, options = {}) {
  const strandCode = normalizeStrandCode(student);
  const gradeLevel = normalizeGradeLevel(student);
  const semesterCode = normalizeSemesterCode(student);
  const trustDb = options.trustDb === true;

  return (subjects || [])
    .filter(subj => {
      if (!trustDb) {
      if (subj.gradeLevel && subj.gradeLevel !== gradeLevel) return false;
      if (subj.semester && subj.semester !== semesterCode) return false;
      const subStrand = subj.strand || subj.strandCode;
        if (subStrand != null && String(subStrand).toUpperCase() !== strandCode) return false;
      }
      return (subj.schedules || []).length > 0;
    })
    .map(subj => {
      const subStrand = subj.strandCode || subj.strand || strandCode;
      const subGrade = subj.gradeLevel || gradeLevel;
      return {
      ...subj,
      schedules: (subj.schedules || []).filter(schedule =>
          isCanonicalSectionName(schedule.section, subStrand, subGrade)
        ),
      };
    })
    .filter(subj => (subj.schedules || []).length > 0);
}

function filterDemoSubjectsByStrand(strandCode, gradeLevel, semesterCode) {
  const catalog = typeof ENROLLMENT_SUBJECTS_DEMO !== 'undefined'
    ? ENROLLMENT_SUBJECTS_DEMO
    : (typeof ENROLLMENT_SUBJECTS !== 'undefined' ? ENROLLMENT_SUBJECTS : []);
  return applyStudentSubjectFilters(
    {
      strand: strandCode,
      gradeLevel: gradeLevel || 'Grade 12',
      semester: semesterCode || '1st'
    },
    catalog
  );
}

function getEnrollmentSubjectsList() {
  return activeEnrollmentSubjects || [];
}

/** Locked section slot A/B for this enrollment (one virtue block for all subjects). */
let lockedEnrollmentSectionSlot = null;

function schedulesVisibleForRow(subj, strandCode, gradeLevel) {
  const list = (subj.schedules || []).filter(schedule =>
    isCanonicalSectionName(schedule.section, strandCode, gradeLevel)
  );
  if (!lockedEnrollmentSectionSlot) return list;
  return list.filter(s =>
    sectionSlotLetterFromSchedule(s, strandCode, gradeLevel) === lockedEnrollmentSectionSlot
  );
}

function updateEnrollmentSectionInfo() {
  const el = document.getElementById('sectionInfo');
  if (!el) return;
  if (!lockedEnrollmentSectionSlot) {
    el.textContent = '—';
    return;
  }
  const student = getStudent();
  const name = sectionSlotName(
    normalizeStrandCode(student),
    normalizeGradeLevel(student),
    lockedEnrollmentSectionSlot,
  );
  el.textContent = name;
}

function syncEnrollmentSchedulesToSection(slot, skipIndex) {
  const student = getStudent();
  const strandCode = normalizeStrandCode(student);
  const gradeLevel = normalizeGradeLevel(student);
  const subjects = getEnrollmentSubjectsList();

  subjects.forEach((subj, i) => {
    if (skipIndex != null && i === skipIndex) return;
    const sel = document.querySelector(`.schedule-select[data-index="${i}"]`);
    const checkbox = document.querySelector(`.subject-check[data-index="${i}"]`);
    if (!sel) return;
    const match = (subj.schedules || []).find(s =>
      sectionSlotLetterFromSchedule(s, strandCode, gradeLevel) === slot
      && !ScheduleFormat.isScheduleFull(s)
    );
    if (match) {
      sel.value = match.id;
      if (checkbox) {
        checkbox.disabled = false;
      }
    } else {
      sel.value = '';
      if (checkbox) {
        checkbox.disabled = true;
        checkbox.checked = false;
      }
    }
  });
  updateSubjectCount();
  updateEnrollmentSectionInfo();
}

async function fetchEnrollmentOfferingsFromServer(student) {
  const params = new URLSearchParams({
    studentId: student.id,
    strandCode: normalizeStrandCode(student),
    gradeLevel: normalizeGradeLevel(student),
    semesterCode: normalizeSemesterCode(student)
  });
  const res = await fetch('/api/enrollment/offerings?' + params.toString());
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || json.details || 'Failed to load subject offerings');
  }
  return applyStudentSubjectFilters(student, json.data || [], { trustDb: true });
}

async function loadEnrollmentSubjects(student) {
  const strandCode = normalizeStrandCode(student);
  const gradeLevel = normalizeGradeLevel(student);
  const semesterCode = normalizeSemesterCode(student);
  let offerings = null;
  let lastError = null;
  const usingSupabase = supabaseEnrollmentEnabled();

  if (usingSupabase) {
    const remote = await SupabaseService.getEnrollmentOfferings(student.id);
    if (Array.isArray(remote)) {
      offerings = filterOfferingsByTerm(
        student,
        applyStudentSubjectFilters(student, remote, { trustDb: true })
      );
      if (!offerings.length && remote.length) {
        console.warn('Offerings returned from DB but none matched current term after filter.');
      }
    } else if (remote === null) {
      lastError = 'Could not load offerings from Supabase.';
    }
  }

  if (!offerings || !offerings.length) {
    try {
      const fromServer = await fetchEnrollmentOfferingsFromServer(student);
      offerings = filterOfferingsByTerm(
        student,
        applyStudentSubjectFilters(student, fromServer, { trustDb: true })
      );
    } catch (err) {
      lastError = err.message;
      console.warn('Server offerings fallback failed:', err.message);
    }
  }

  if ((!offerings || !offerings.length) && !usingSupabase) {
    offerings = filterDemoSubjectsByStrand(strandCode, gradeLevel, semesterCode);
  }

  lockedEnrollmentSectionSlot = null;
  activeEnrollmentSubjects = offerings || [];
  activeRequiredSubjectCount = activeEnrollmentSubjects.length;
  activeEnrollmentLoadError = lastError;
  updateRequiredSubjectsLabel(student);
  return activeEnrollmentSubjects;
}

let activeEnrollmentLoadError = null;

function updateRequiredSubjectsLabel(student) {
  const el = document.getElementById('requiredSubjectsLabel');
  if (el && student) {
    const count = getRequiredSubjectCount(student);
    el.textContent = count ? `${count} Subjects Required` : 'Subjects Required';
  }
}

function applyAccessToStudent(student, access) {
  if (!student || !access) return student;
  if (access.semesterCode) student.semesterCode = access.semesterCode;
  if (access.semesterName) student.semester = access.semesterName;
  if (access.enrollmentOpen !== undefined) student.enrollmentOpen = access.enrollmentOpen;
  if (typeof setStudent === 'function') setStudent(student);
  return student;
}

function mapSupabaseEnrollment(record) {
  const semester = record.semester || '';
  const semCode = String(record.semesterCode || semester).toLowerCase().includes('second') || semester === '2nd'
    ? '2nd'
    : String(record.semesterCode || semester).toLowerCase().includes('2nd') ? '2nd' : '1st';
  return {
    status: record.status,
    subjects: record.subjects || [],
    totalUnits: record.totalUnits || 0,
    enrolledAt: record.enrolledAt || new Date().toLocaleString(),
    schoolYear: record.schoolYear,
    semester,
    semesterCode: record.semesterCode || semCode,
  };
}

function isSubmittedEnrollmentStatus(status) {
  return ['pending', 'approved', 'enrolled', 'rejected'].includes(status);
}

function isLockedEnrollmentStatus(status) {
  return ['pending', 'approved', 'enrolled'].includes(status);
}

async function fetchEnrollmentAccess(student) {
  try {
    const res = await fetch('/api/enrollment/access?studentId=' + encodeURIComponent(student.id));
    const json = await res.json();
    if (json.success && json.data) return json.data;
  } catch (err) {
    // fall through to Supabase direct call
  }
  if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
    return SupabaseService.getEnrollmentAccess(student.id);
  }
  return null;
}

function showCompletedView(student, access) {
  hideWaitingView();
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'none';
  const blocked = document.getElementById('enrollmentBlocked');
  const msgEl = document.getElementById('enrollmentBlockedMessage');
  if (blocked) blocked.style.display = 'block';
  if (msgEl) {
    msgEl.innerHTML = `
      <strong>Grade 12 — 2nd Semester Completed</strong><br>
      Natapos mo na ang apat na enrollment stages ng Enrollment Management System (Grade 11 Sem 1 → Grade 11 Sem 2 → Grade 12 Sem 1 → Grade 12 Sem 2).<br><br>
      Wala nang bagong enrollment na available sa account na ito. Para sa concerns, makipag-ugnayan sa Registrar's Office.
    `;
  }
}

function showBlockedView(student, message, access) {
  hideWaitingView();
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'none';
  const blocked = document.getElementById('enrollmentBlocked');
  const msgEl = document.getElementById('enrollmentBlockedMessage');
  if (blocked) blocked.style.display = 'block';

  const sem = getSemesterLabel(student);
  const nextSem = (access && access.nextSemesterLabel) || getNextSemesterLabel(normalizeSemesterCode(student));
  const alreadySubmitted = message && (
    message.includes('already have a submission')
    || message.includes('already enrolled')
    || message.includes('already have an enrollment submission')
  );

  if (msgEl) {
    if (alreadySubmitted) {
      msgEl.innerHTML = `
        <strong>Enrollment Complete for ${sem}</strong><br>
        Naka-enroll ka na para sa term na ito. Hindi ka na pwedeng mag-enroll ulit dito.<br><br>
        Maghintay hanggang buksan ng Admin ang enrollment para sa <strong>${nextSem}</strong>.
        Ia-announce ito ng Registrar's Office.
      `;
    } else {
      msgEl.innerHTML = `<strong>Enrollment Unavailable</strong><br>${message || 'Please contact the registrar.'}`;
    }
  }
}

function updateStrandStatusBar(student) {
  const strandEl = document.getElementById('strandInfo');
  const termEl = document.getElementById('termInfo');
  if (strandEl) {
    strandEl.textContent = student.strandFull || student.strand || normalizeStrandCode(student);
  }
  if (termEl) {
    termEl.textContent = `${normalizeGradeLevel(student)} · ${normalizeSemesterCode(student) === '1st' ? '1st Semester' : '2nd Semester'}`;
  }
}

async function initEnrollmentPage(student) {
  let record = null;
  if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
    record = await SupabaseService.getStudentEnrollment(student.id);
  }
  const mappedRecord = record ? mapSupabaseEnrollment(record) : null;
  let localRecord = getEnrollmentRecord(student);

  const access = await fetchEnrollmentAccess(student);
  applyAccessToStudent(student, access);
  updatePageTitle(student);
  updateStrandStatusBar(student);
  hideWaitingView();

  if (access && (access.isLifecycleCompleted || access.lifecycleStage === 'completed' || access.progressionStatus === 'graduated')) {
    showCompletedView(student, access);
    return;
  }

  if (isValidLockedEnrollment(student, mappedRecord)) {
    await showWaitingView(student, mappedRecord, access);
    return;
  }
  if (record && record.status === 'rejected') {
    showRejectedView(student, record);
    return;
  }

  if (isValidLockedEnrollment(student, localRecord)) {
    await showWaitingView(student, localRecord, access);
    return;
  }

  if (access && access.canEnroll === false) {
    if (access.currentEnrollmentStatus && isLockedEnrollmentStatus(access.currentEnrollmentStatus)) {
      if (!access.invalidPreviousEnrollment) {
        const accessRecord = {
          status: access.currentEnrollmentStatus,
          semester: access.semesterName,
          semesterCode: access.semesterCode,
          subjects: mappedRecord?.subjects || localRecord?.subjects || [],
        };
        await showWaitingView(student, accessRecord, access);
        return;
      }
    } else {
      showBlockedView(student, access.reason, access);
      return;
    }
  }

  await loadEnrollmentSubjects(student);
  updateOfferingCount(student);

  if (localRecord && localRecord.status === 'enrolled' && enrollmentMatchesCurrentTerm(student, localRecord)) {
    await showWaitingView(student, localRecord, access);
    return;
  }

  showSelectionView(student);
}

function showRejectedView(student, record) {
  hideWaitingView();
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'block';
  document.getElementById('enrollmentBlocked').style.display = 'none';
  document.getElementById('enrolledMessage').textContent =
    'Your enrollment was rejected. Please contact the Registrar\'s Office for assistance.';
  const redoBtn = document.getElementById('redoEnrollmentBtn');
  if (redoBtn) redoBtn.style.display = 'none';
}

function showSelectionView(student) {
  hideWaitingView();
  document.getElementById('enrollmentSelection').style.display = 'block';
  document.getElementById('enrollmentSuccess').style.display = 'none';
  document.getElementById('enrollmentBlocked').style.display = 'none';
  renderSubjectTable(student);
}

function showEnrolledView(student, record) {
  hideWaitingView();
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'block';
  document.getElementById('enrollmentBlocked').style.display = 'none';

  const isPending = record.status === 'pending';

  let message = `You are officially enrolled for S.Y. ${student.schoolYear} - ${student.semester}. Complete payment in Payment / Accounts. The Registration Form will be emailed after admin payment approval.`;
  if (isPending) {
    message = 'Your enrollment submission is pending review and approval by the Administrator. After approval, complete payment and wait for payment approval before the Registration Form is emailed.';
  } else if (record.status === 'approved') {
    message = 'Your enrollment has been approved. Complete payment in Payment / Accounts. The Registration Form will be emailed after admin payment approval.';
  }

  document.getElementById('enrolledMessage').textContent = message;

  const redoBtn = document.getElementById('redoEnrollmentBtn');
  if (redoBtn) redoBtn.style.display = 'none';
}

function subjectTypeBadge(subj) {
  const isSpecialized = subj.type === 'specialized' || subj.strand;
  if (isSpecialized) {
    const label = subj.strandCode || subj.strand || 'Specialized';
    return `<span class="badge badge-pending subject-type-badge">${label}</span>`;
  }
  if (subj.type === 'applied') {
    return '<span class="badge badge-approved subject-type-badge">Applied</span>';
  }
  return '<span class="badge badge-approved subject-type-badge">Core</span>';
}

function renderSubjectTable(student) {
  const tbody = document.getElementById('subjectBody');
  const subjects = getEnrollmentSubjectsList();
  const strandCode = normalizeStrandCode(student);
  const gradeLevel = normalizeGradeLevel(student);
  updateOfferingCount(student);

  if (!subjects.length) {
    const hint = supabaseEnrollmentEnabled()
      ? (activeEnrollmentLoadError
        ? `Database error: ${activeEnrollmentLoadError} Run <strong>enrollment-workflow.sql</strong> in Supabase, then refresh.`
        : 'Schedules are being restored automatically. Refresh the page in a few seconds, or ask the registrar to run <strong>enrollment-workflow.sql</strong> and save schedules in Admin → Auto Schedule.')
      : 'Contact the registrar.';
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-offerings">
          No subjects available for ${normalizeGradeLevel(student)} ${normalizeSemesterCode(student) === '1st' ? '1st' : '2nd'} Sem
          (${strandCode}). ${hint}
        </td>
      </tr>
    `;
    updateSubjectCount();
    return;
  }

  tbody.innerHTML = subjects.map((subj, i) => {
    const scheduleOptions = schedulesVisibleForRow(subj, strandCode, gradeLevel).map(s => {
      const full = ScheduleFormat.isScheduleFull(s);
      const label = ScheduleFormat.formatDropdownOption(s);
      return `<option value="${s.id}" ${full ? 'disabled' : ''}>${label}</option>`;
    }).join('');

    return `
      <tr data-index="${i}">
        <td class="col-check">
          <input type="checkbox" class="subject-check" data-index="${i}" disabled onchange="updateSubjectCount()">
        </td>
        <td>${subj.code}</td>
        <td>${subj.description} ${subjectTypeBadge(subj)}</td>
        <td class="col-num">${subj.lec}</td>
        <td class="col-num">${subj.lab}</td>
        <td class="col-num">${subj.units}</td>
        <td class="col-schedule">
          <select class="form-control schedule-select" data-index="${i}" onchange="onScheduleChange(${i})">
            <option value="">Select schedule...</option>
            ${scheduleOptions}
          </select>
        </td>
      </tr>
    `;
  }).join('');

  updateSubjectCount();
}

function onScheduleChange(index) {
  const schedSel = document.querySelector(`.schedule-select[data-index="${index}"]`);
  const checkbox = document.querySelector(`.subject-check[data-index="${index}"]`);
  const subjects = getEnrollmentSubjectsList();
  const subj = subjects[index];
  const schedule = (subj?.schedules || []).find(s => String(s.id) === String(schedSel?.value));

  if (!schedSel.value || !schedule || ScheduleFormat.isScheduleFull(schedule)) {
    if (!document.querySelector('.schedule-select')?.value) {
      lockedEnrollmentSectionSlot = null;
      updateEnrollmentSectionInfo();
    }
    checkbox.disabled = true;
    checkbox.checked = false;
    updateSubjectCount();
    return;
  }

  const slot = sectionSlotLetterFromSchedule(schedule, normalizeStrandCode(getStudent()), normalizeGradeLevel(getStudent()));
  if (!slot) return;
  lockedEnrollmentSectionSlot = slot;
  renderSubjectTable(getStudent());
  syncEnrollmentSchedulesToSection(slot, null);
  const againSel = document.querySelector(`.schedule-select[data-index="${index}"]`);
  const againCb = document.querySelector(`.subject-check[data-index="${index}"]`);
  if (againSel) againSel.value = schedule.id;
  if (againCb) againCb.disabled = false;
  updateSubjectCount();
}

function getSelectedSubjects() {
  const selected = [];
  const subjects = getEnrollmentSubjectsList();

  document.querySelectorAll('.subject-check:checked').forEach(cb => {
    const idx = parseInt(cb.dataset.index, 10);
    const subj = subjects[idx];
    const schedSel = document.querySelector(`.schedule-select[data-index="${idx}"]`);
    const schedId = schedSel.value;
    if (!schedId) return;

    const schedule = (subj.schedules || []).find(s => String(s.id) === String(schedId));
    if (!schedule) return;

    selected.push({ ...subj, schedule });
  });

  return selected;
}

function updateSubjectCount() {
  const checked = document.querySelectorAll('.subject-check:checked');
  const count = checked.length;
  const el = document.getElementById('selectedCount');
  if (el) el.textContent = count;

  const atMax = count >= getRequiredSubjectCount(getStudent());
  document.querySelectorAll('.subject-check').forEach(cb => {
    const idx = cb.dataset.index;
    const schedSel = document.querySelector(`.schedule-select[data-index="${idx}"]`);
    const hasSchedule = schedSel && schedSel.value;
    if (cb.checked) {
      cb.disabled = false;
    } else if (!hasSchedule) {
      cb.disabled = true;
    } else {
      cb.disabled = atMax;
    }
  });

  return count;
}

function saveAndAssess() {
  const student = getStudent();
  const checked = document.querySelectorAll('.subject-check:checked');
  const count = checked.length;

  if (count === 0) {
    StudentDialog.alert({
      type: 'warning',
      title: 'Select Subjects',
      message: 'Please select a schedule and check at least one subject to enroll.'
    });
    return;
  }

  const required = getRequiredSubjectCount(student);
  if (count !== required) {
    StudentDialog.alert({
      type: 'warning',
      title: 'Subject Count',
      message: `You must enroll in exactly ${required} subjects for this semester. Currently selected: ${count}.`
    });
    return;
  }

  let missingSchedule = false;
  checked.forEach(cb => {
    const idx = cb.dataset.index;
    const schedSel = document.querySelector(`.schedule-select[data-index="${idx}"]`);
    if (!schedSel.value) missingSchedule = true;
  });

  if (missingSchedule) {
    StudentDialog.alert({
      type: 'warning',
      title: 'Schedule Required',
      message: 'Please select a schedule for all checked subjects before proceeding.'
    });
    return;
  }

  document.getElementById('confirmSubjectCount').textContent = count;
  openPaymentModal();
}

function formatEnrollmentPeso(amount) {
  if (typeof GcashPayment !== 'undefined' && GcashPayment.formatPeso) {
    return GcashPayment.formatPeso(amount);
  }
  return '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function updateEnrollmentPaymentMethodUI() {
  const isGcash = enrollmentPaymentState.paymentMode === 'gcash';
  const isCashier = enrollmentPaymentState.paymentMode === 'cashier';
  const fee = getEnrollmentFee();
  const feeLabel = formatEnrollmentPeso(fee);

  document.querySelectorAll('#enrollmentPaymentMethods .payment-method-row').forEach(row => {
    const mode = row.dataset.mode;
    row.classList.toggle('selected', mode === enrollmentPaymentState.paymentMode);
    const input = row.querySelector('input[type="radio"]');
    if (input) input.checked = mode === enrollmentPaymentState.paymentMode;
  });

  const gcashPanel = document.getElementById('enrollmentGcashPanel');
  const cashierPanel = document.getElementById('enrollmentCashierPanel');
  const feeEl = document.getElementById('paymentFeeLabel');
  const amountEl = document.getElementById('enrollmentGcashAmount');
  if (feeEl) feeEl.textContent = feeLabel;
  if (amountEl) amountEl.textContent = feeLabel;
  if (gcashPanel) gcashPanel.style.display = isGcash ? 'block' : 'none';
  if (cashierPanel) cashierPanel.style.display = isCashier ? 'flex' : 'none';

  const submittedEl = document.getElementById('enrollmentGcashSubmitted');
  const payBtn = document.getElementById('btnEnrollmentPayGcash');
  const isSubmitted = enrollmentPaymentState.paymentStatus === 'submitted';

  if (submittedEl && payBtn) {
    if (isGcash && isSubmitted) {
      submittedEl.style.display = 'block';
      submittedEl.innerHTML = `
        <div class="gcash-paid-banner">
          <span class="gcash-paid-check">✓</span>
          <div>
            <strong>Payment Details Submitted</strong>
            <p>Ref: ${enrollmentPaymentState.gcashReference} · ${enrollmentPaymentState.gcashSenderName} · ${formatEnrollmentPeso(enrollmentPaymentState.paymentAmount)}</p>
            ${enrollmentPaymentState.gcashProofFile ? `<p class="gcash-receipt-name">Receipt: ${enrollmentPaymentState.gcashProofFile.name}</p>` : ''}
          </div>
        </div>
        <button type="button" class="payment-secondary-btn" id="btnEditEnrollmentGcash">Edit Payment Details</button>
      `;
      payBtn.style.display = 'none';
      submittedEl.querySelector('#btnEditEnrollmentGcash')?.addEventListener('click', openEnrollmentGcashModal);
    } else {
      submittedEl.style.display = 'none';
      submittedEl.innerHTML = '';
      payBtn.style.display = isGcash ? 'inline-flex' : 'none';
    }
  }
}

function setEnrollmentPaymentError(message) {
  const el = document.getElementById('enrollmentPaymentError');
  if (el) el.textContent = message || '';
}

function bindEnrollmentPaymentModalEvents() {
  if (bindEnrollmentPaymentModalEvents.bound) return;
  bindEnrollmentPaymentModalEvents.bound = true;

  document.querySelectorAll('input[name="enrollmentPaymentMode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      enrollmentPaymentState.paymentMode = e.target.value;
      if (enrollmentPaymentState.paymentMode !== 'gcash') {
        enrollmentPaymentState.paymentStatus = '';
      }
      updateEnrollmentPaymentMethodUI();
      setEnrollmentPaymentError('');
    });
  });

  document.getElementById('btnEnrollmentPayGcash')?.addEventListener('click', openEnrollmentGcashModal);
  document.getElementById('btnProceedToConfirm')?.addEventListener('click', proceedToConfirmFromPayment);
}

async function openEnrollmentGcashModal() {
  if (typeof GcashPayment === 'undefined') {
    setEnrollmentPaymentError('GCash payment module failed to load. Please refresh the page.');
    return;
  }

  const cfg = await GcashPayment.loadConfig();
  if (cfg) {
    cfg.qrImage = resolveAssetUrl(cfg.qrImage);
  }

  GcashPayment.openModal({
    reference: enrollmentPaymentState.gcashReference,
    senderName: enrollmentPaymentState.gcashSenderName,
    amountPaid: enrollmentPaymentState.paymentAmount || getEnrollmentFee(),
    receiptFile: enrollmentPaymentState.gcashProofFile,
  }, data => {
    enrollmentPaymentState.paymentMode = 'gcash';
    enrollmentPaymentState.paymentStatus = data.paymentStatus || 'submitted';
    enrollmentPaymentState.gcashReference = data.reference;
    enrollmentPaymentState.gcashSenderName = data.senderName;
    enrollmentPaymentState.paymentAmount = String(data.amountPaid);
    enrollmentPaymentState.gcashProofFile = data.receiptFile || null;
    updateEnrollmentPaymentMethodUI();
    setEnrollmentPaymentError('');
  });
}

function openPaymentModal() {
  bindEnrollmentPaymentModalEvents();
  updateEnrollmentPaymentMethodUI();
  setEnrollmentPaymentError('');
  document.getElementById('paymentModal')?.classList.add('open');
}

function closePaymentModal() {
  document.getElementById('paymentModal')?.classList.remove('open');
  setEnrollmentPaymentError('');
}

function validateEnrollmentPaymentStep() {
  if (enrollmentPaymentState.paymentMode === 'gcash') {
    if (enrollmentPaymentState.paymentStatus !== 'submitted') {
      setEnrollmentPaymentError('Please complete GCash payment and submit your payment details.');
      return false;
    }
    if (!enrollmentPaymentState.gcashProofFile) {
      setEnrollmentPaymentError('Please upload your GCash payment receipt.');
      return false;
    }
    if (typeof AdmissionValidation !== 'undefined') {
      const check = AdmissionValidation.validateFile(enrollmentPaymentState.gcashProofFile, { kind: 'payment' });
      if (!check.ok) {
        setEnrollmentPaymentError(check.message);
        return false;
      }
    }
  }
  setEnrollmentPaymentError('');
  return true;
}

function proceedToConfirmFromPayment() {
  if (!validateEnrollmentPaymentStep()) return;
  closePaymentModal();
  document.getElementById('confirmModal').classList.add('open');
  highlightNumberButton(null);
}

function getEnrollmentPaymentPayload() {
  return {
    paymentMode: enrollmentPaymentState.paymentMode || 'cashier',
    gcashReference: enrollmentPaymentState.gcashReference || '',
    gcashSenderName: enrollmentPaymentState.gcashSenderName || '',
    paymentAmount: enrollmentPaymentState.paymentAmount || String(getEnrollmentFee()),
    gcashProofFile: enrollmentPaymentState.gcashProofFile || null,
  };
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('open');
  highlightNumberButton(null);
  setConfirmSubmitting(false);
}

function setConfirmSubmitting(active, message) {
  const grid = document.getElementById('numberGrid');
  const statusEl = document.getElementById('confirmSubmitStatus');
  if (grid) grid.classList.toggle('is-busy', !!active);
  document.querySelectorAll('.confirm-num-btn').forEach(btn => {
    btn.classList.toggle('is-submitting', !!active && btn.classList.contains('selected'));
    btn.disabled = !!active;
  });
  if (statusEl) statusEl.textContent = active ? (message || 'Submitting enrollment...') : '';
}

async function showEnrollmentAlert(options) {
  closeConfirmModal();
  closePaymentModal();
  if (typeof StudentDialog !== 'undefined' && StudentDialog.alert) {
    await StudentDialog.alert(options);
  } else {
    window.alert((options.title ? options.title + '\n\n' : '') + (options.message || ''));
  }
}

function highlightNumberButton(num) {
  document.querySelectorAll('.confirm-num-btn').forEach(btn => {
    btn.classList.toggle('selected', num !== null && parseInt(btn.dataset.num, 10) === num);
  });
}

async function submitEnrollmentToBackend(studentId, selected, payment) {
  const payload = selected.map(item => ({
    code: item.code,
    units: item.units,
    scheduleId: item.schedule.id,
    scheduleLabel: ScheduleFormat.formatDropdownOption(item.schedule)
  }));

  const paymentInfo = payment || getEnrollmentPaymentPayload();
  const paymentMode = paymentInfo.paymentMode || 'cashier';
  const useFormData = paymentMode === 'gcash' && paymentInfo.gcashProofFile;

  if (useFormData) {
    try {
      const form = new FormData();
      form.append('studentId', studentId);
      form.append('subjects', JSON.stringify(payload));
      form.append('paymentMode', 'gcash');
      form.append('gcashReference', paymentInfo.gcashReference);
      form.append('gcashSenderName', paymentInfo.gcashSenderName);
      form.append('paymentAmount', paymentInfo.paymentAmount);
      form.append('gcash_proof', paymentInfo.gcashProofFile);
      const res = await fetch('/api/enrollment/submit', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        const msg = json.error || json.details || 'Failed to submit enrollment.';
        return { success: false, error: json.hint ? `${msg}\n\n${json.hint}` : msg };
      }
      return { success: true, data: json };
    } catch (err) {
      return { success: false, error: err.message || 'Network error during enrollment submit.' };
    }
  }

  const jsonBody = {
    studentId,
    subjects: payload,
    paymentMode,
  };
  if (paymentMode === 'gcash') {
    jsonBody.gcashReference = paymentInfo.gcashReference;
    jsonBody.gcashSenderName = paymentInfo.gcashSenderName;
    jsonBody.paymentAmount = paymentInfo.paymentAmount;
  }

  if (typeof fetch !== 'undefined') {
  try {
    const res = await fetch('/api/enrollment/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonBody)
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      const msg = json.error || json.details || 'Failed to submit enrollment.';
      return { success: false, error: json.hint ? `${msg}\n\n${json.hint}` : msg };
    }
    return { success: true, data: json };
  } catch (err) {
    return { success: false, error: err.message || 'Network error during enrollment submit.' };
  }
  }

  if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
    const result = await SupabaseService.submitEnrollment(studentId, selected);
    if (result.success) return result;
    return result;
  }

  return { success: false, error: 'Enrollment submit is unavailable.' };
}

async function confirmSubjectCount(num) {
  if (confirmSubjectCount._busy) return;

  const student = getStudent();
  if (!student) {
    await showEnrollmentAlert({
      type: 'error',
      title: 'Session Expired',
      message: 'Please sign in again to continue enrollment.',
    });
    return;
  }

  const confirmCount = parseInt(document.getElementById('confirmSubjectCount')?.textContent || '0', 10);
  const currentCount = updateSubjectCount();
  const required = getRequiredSubjectCount(student);

  if (num !== confirmCount || num !== currentCount) {
    await showEnrollmentAlert({
      type: 'error',
      title: 'Count Mismatch',
      message: `The number you clicked (${num}) does not match your selected subjects (${currentCount}). Close and try again.`,
    });
    highlightNumberButton(num);
    return;
  }

  if (currentCount !== required) {
    await showEnrollmentAlert({
      type: 'warning',
      title: 'Subject Count',
      message: `You must enroll in exactly ${required} subjects. Currently selected: ${currentCount}.`,
    });
    return;
  }

  if (!validateEnrollmentPaymentStep()) {
    await showEnrollmentAlert({
      type: 'warning',
      title: 'Payment Required',
      message: document.getElementById('enrollmentPaymentError')?.textContent
        || 'Please complete the Mode of Payment step before submitting.',
    });
    openPaymentModal();
    return;
  }

  const selected = getSelectedSubjects();
  if (!selected.length) {
    await showEnrollmentAlert({
      type: 'error',
      title: 'No Subjects Selected',
      message: 'Please select your subjects and schedules again.',
    });
    return;
  }

  if (selected.some(item => ScheduleFormat.isScheduleFull(item.schedule))) {
    await showEnrollmentAlert({
      type: 'error',
      title: 'Section Full',
      message: 'One or more selected sections are already full. Please choose another section.',
    });
    return;
  }
  if (supabaseEnrollmentEnabled() && selected.some(item => !isUuid(item.schedule.id))) {
    await showEnrollmentAlert({
      type: 'error',
      title: 'Invalid Schedules',
      message: 'Some selected schedules are not from the live database. Refresh the page. If the problem continues, ask the registrar to publish class schedules in Supabase.',
    });
    return;
  }

  highlightNumberButton(num);
  confirmSubjectCount._busy = true;
  setConfirmSubmitting(true, 'Submitting enrollment...');

  try {
  const totalUnits = selected.reduce((sum, s) => sum + s.units, 0);

  const localRecord = {
    status: 'enrolled',
    subjects: selected.map(s => ({
      code: s.code,
      description: s.description,
      units: s.units,
        schedule: ScheduleFormat.formatDropdownOption(s.schedule)
    })),
    totalUnits,
    enrolledAt: new Date().toLocaleString(),
    schoolYear: student.schoolYear,
    semester: student.semester
  };

  const usingBackend = (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled())
    || (typeof fetch !== 'undefined');

  if (usingBackend) {
      const result = await submitEnrollmentToBackend(student.id, selected, getEnrollmentPaymentPayload());
    if (!result.success) {
        let message = result.error || 'Failed to submit enrollment.';
        if (/photo|step 1|step 2|upload photo|take photo/i.test(message)) {
          message = 'Please complete Upload Photo and Take Photo before submitting enrollment. If those steps are not shown, contact the registrar office.';
        } else if (
          message.includes('does not exist')
          || message.includes('column')
          || message.includes('recipient_id')
          || message.includes('violates not-null')
          || message.includes('foreign key constraint')
          || message.includes('notifications')
        ) {
          message += ' Run enrollment-workflow.sql in Supabase SQL Editor, then try again.';
        } else if (message.includes('Invalid schedule')) {
          message += ' Ask the registrar to publish schedules for your strand and grade level.';
        } else if (/gcash|receipt|payment/i.test(message)) {
          message += ' Go back to Mode of Payment and complete your payment details.';
          openPaymentModal();
        }
        await showEnrollmentAlert({ type: 'error', title: 'Enrollment Failed', message });
      return;
    }

    let remoteRecord = null;
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
      remoteRecord = await SupabaseService.getStudentEnrollment(student.id);
    }
    closeConfirmModal();
      closePaymentModal();
      const finalRecord = remoteRecord ? mapSupabaseEnrollment(remoteRecord) : { ...localRecord, status: 'pending' };
      saveEnrollmentRecord(student, finalRecord);
      clearPhotoState(student.id);
      showWaitingView(student, finalRecord);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

    saveEnrollmentRecord(student, { ...localRecord, status: 'pending' });
    clearPhotoState(student.id);
  closeConfirmModal();
    showWaitingView(student, { ...localRecord, status: 'pending' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    await showEnrollmentAlert({
      type: 'error',
      title: 'Enrollment Failed',
      message: err?.message || 'Something went wrong while submitting. Please try again.',
    });
  } finally {
    confirmSubjectCount._busy = false;
    setConfirmSubmitting(false);
  }
}

window.confirmSubjectCount = confirmSubjectCount;

async function resetEnrollment() {
  const student = getStudent();

  const record = getEnrollmentRecord(student);
  if (record && isLockedEnrollmentStatus(record.status)) {
    await StudentDialog.alert({
      type: 'info',
      title: 'Cannot Reset',
      message: 'Naka-enroll ka na para sa term na ito. Maghintay hanggang buksan ng Admin ang susunod na semester.'
    });
    return;
  }

  const confirmed = await StudentDialog.confirm({
    title: 'Reset Enrollment?',
    message: 'You will need to select subjects and schedules again.',
    confirmLabel: 'Reset',
    variant: 'danger'
  });
  if (!confirmed) return;

  clearEnrollmentRecord(student);
  showSelectionView(student);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function downloadCOR() {
  const student = getStudent();
  if (!student) return;
  openRegistrationCertificate(student.id);
}

function getCurrentEnrollmentRecord(student) {
  return getEnrollmentRecord(student);
}

window.openRegistrationCertificate = openRegistrationCertificate;
window.downloadCOR = downloadCOR;
