// Student enrollment flow — subjects filtered by strand, grade level, and semester

let activeEnrollmentSubjects = null;
let activeRequiredSubjectCount = null;

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

function supabaseEnrollmentEnabled() {
  return typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled();
}

function getEnrollmentKey(studentId) {
  return 'enrollment_' + studentId + '_2627_1st';
}

function getEnrollmentRecord(studentId) {
  const data = sessionStorage.getItem(getEnrollmentKey(studentId));
  return data ? JSON.parse(data) : null;
}

function saveEnrollmentRecord(studentId, record) {
  sessionStorage.setItem(getEnrollmentKey(studentId), JSON.stringify(record));
}

function clearEnrollmentRecord(studentId) {
  sessionStorage.removeItem(getEnrollmentKey(studentId));
}

function normalizeStrandCode(student) {
  const raw = student.strandCode || student.strand || student.strandFull || 'GAS';
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

function sectionMatchesStudent(sectionName, strandCode, gradeLevel) {
  const section = String(sectionName || '').toUpperCase();
  const code = (strandCode || 'GAS').toUpperCase();
  if (!section.includes(code)) return false;
  if (gradeLevel) {
    const gradeNum = gradeLevel.includes('11') ? '11' : '12';
    if (!section.includes(gradeNum)) return false;
  }
  return true;
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
    .map(subj => ({
      ...subj,
      schedules: trustDb
        ? (subj.schedules || [])
        : (subj.schedules || []).filter(schedule =>
            sectionMatchesStudent(schedule.section, strandCode, gradeLevel)
          )
    }))
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

function mapSupabaseEnrollment(record) {
  return {
    status: record.status,
    subjects: record.subjects || [],
    totalUnits: record.totalUnits || 0,
    enrolledAt: record.enrolledAt || new Date().toLocaleString(),
    schoolYear: record.schoolYear,
    semester: record.semester
  };
}

function isSubmittedEnrollmentStatus(status) {
  return ['pending', 'approved', 'enrolled', 'rejected'].includes(status);
}

function isLockedEnrollmentStatus(status) {
  return ['pending', 'approved', 'enrolled'].includes(status);
}

async function fetchEnrollmentAccess(student) {
  if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
    return SupabaseService.getEnrollmentAccess(student.id);
  }
  try {
    const res = await fetch('/api/enrollment/access?studentId=' + encodeURIComponent(student.id));
    const json = await res.json();
    return json.success ? json.data : null;
  } catch (err) {
    return null;
  }
}

function showBlockedView(student, message) {
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'none';
  const blocked = document.getElementById('enrollmentBlocked');
  const msgEl = document.getElementById('enrollmentBlockedMessage');
  if (blocked) blocked.style.display = 'block';
  if (msgEl) {
    msgEl.innerHTML = `<strong>Enrollment Unavailable</strong><br>${message || 'Please contact the registrar.'}`;
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
  updateStrandStatusBar(student);

  let record = null;
  if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
    record = await SupabaseService.getStudentEnrollment(student.id);
  }

  if (record && record.status === 'pending') {
    showEnrolledView(student, mapSupabaseEnrollment(record));
    return;
  }
  if (record && record.status === 'rejected') {
    showRejectedView(student, record);
    return;
  }
  if (record && (record.status === 'enrolled' || record.status === 'approved')) {
    showEnrolledView(student, mapSupabaseEnrollment(record));
    return;
  }

  const access = await fetchEnrollmentAccess(student);
  if (access && access.canEnroll === false) {
    showBlockedView(student, access.reason);
    return;
  }

  await loadEnrollmentSubjects(student);

  const localRecord = getEnrollmentRecord(student.id);
  if (localRecord && localRecord.status === 'enrolled') {
    showEnrolledView(student, localRecord);
    return;
  }

  showSelectionView(student);
}

function showRejectedView(student, record) {
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'block';
  document.getElementById('enrollmentBlocked').style.display = 'none';
  document.getElementById('enrolledMessage').textContent =
    'Your enrollment was rejected. Please contact the Registrar\'s Office for assistance.';
  const redoBtn = document.getElementById('redoEnrollmentBtn');
  if (redoBtn) redoBtn.style.display = 'none';
  const corBtn = document.querySelector('.btn-cor');
  if (corBtn) corBtn.style.display = 'none';
}

function showSelectionView(student) {
  document.getElementById('enrollmentSelection').style.display = 'block';
  document.getElementById('enrollmentSuccess').style.display = 'none';
  document.getElementById('enrollmentBlocked').style.display = 'none';
  renderSubjectTable(student);
}

function showEnrolledView(student, record) {
  document.getElementById('enrollmentSelection').style.display = 'none';
  document.getElementById('enrollmentSuccess').style.display = 'block';
  document.getElementById('enrollmentBlocked').style.display = 'none';

  const isPending = record.status === 'pending';
  const isEnrolled = record.status === 'enrolled' || record.status === 'approved';

  let message = `You are officially enrolled. (S.Y. ${student.schoolYear} - ${student.semester})`;
  if (isPending) {
    message = 'Your enrollment submission is currently pending review and approval by the Administrator.';
  } else if (record.status === 'approved') {
    message = 'Your enrollment has been approved. (S.Y. ' + student.schoolYear + ' - ' + student.semester + ')';
  }

  document.getElementById('enrolledMessage').textContent = message;

  const redoBtn = document.getElementById('redoEnrollmentBtn');
  if (redoBtn) redoBtn.style.display = isPending || isEnrolled ? 'none' : 'inline-block';

  const corBtn = document.querySelector('.btn-cor');
  if (corBtn) corBtn.style.display = isPending ? 'none' : 'inline-block';
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
  const expectedCount = getRequiredSubjectCount(student);
  const countEl = document.getElementById('offeringCount');

  if (countEl) {
    countEl.textContent = subjects.length;
    countEl.classList.toggle('offering-count-warning', subjects.length !== expectedCount);
  }

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
    const scheduleOptions = (subj.schedules || []).map(s =>
      `<option value="${s.id}">[${s.slots}] ${s.section} | ${s.dayTime}</option>`
    ).join('');

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
  if (schedSel.value) {
    checkbox.disabled = false;
  } else {
    checkbox.disabled = true;
    checkbox.checked = false;
  }
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
  document.getElementById('confirmModal').classList.add('open');
  highlightNumberButton(null);
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('open');
  highlightNumberButton(null);
}

function highlightNumberButton(num) {
  document.querySelectorAll('.confirm-num-btn').forEach(btn => {
    btn.classList.toggle('selected', num !== null && parseInt(btn.dataset.num, 10) === num);
  });
}

async function submitEnrollmentToBackend(studentId, selected) {
  const payload = selected.map(item => ({
    code: item.code,
    units: item.units,
    scheduleId: item.schedule.id,
    scheduleLabel: `[${item.schedule.slots}] ${item.schedule.section} | ${item.schedule.dayTime}`
  }));

  if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
    const result = await SupabaseService.submitEnrollment(studentId, selected);
    if (result.success) return result;
    return result;
  }

  try {
    const res = await fetch('/api/enrollment/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, subjects: payload })
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

async function confirmSubjectCount(num) {
  const student = getStudent();
  const expected = updateSubjectCount();
  const required = getRequiredSubjectCount(student);
  if (num !== expected) {
    await StudentDialog.alert({
      type: 'error',
      title: 'Count Mismatch',
      message: 'The number of subjects you selected did not match. Please try again.'
    });
    highlightNumberButton(num);
    return;
  }

  if (expected !== required) {
    await StudentDialog.alert({
      type: 'warning',
      title: 'Subject Count',
      message: `You must enroll in exactly ${required} subjects.`
    });
    return;
  }

  const selected = getSelectedSubjects();
  if (supabaseEnrollmentEnabled() && selected.some(item => !isUuid(item.schedule.id))) {
    await StudentDialog.alert({
      type: 'error',
      title: 'Invalid Schedules',
      message: 'Some selected schedules are not from the live database. Refresh the page. If the problem continues, ask the registrar to publish class schedules in Supabase.'
    });
    return;
  }

  const totalUnits = selected.reduce((sum, s) => sum + s.units, 0);

  const localRecord = {
    status: 'enrolled',
    subjects: selected.map(s => ({
      code: s.code,
      description: s.description,
      units: s.units,
      schedule: `[${s.schedule.slots}] ${s.schedule.section} | ${s.schedule.dayTime}`
    })),
    totalUnits,
    enrolledAt: new Date().toLocaleString(),
    schoolYear: student.schoolYear,
    semester: student.semester
  };

  const usingBackend = (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled())
    || (typeof fetch !== 'undefined');

  if (usingBackend) {
    const result = await submitEnrollmentToBackend(student.id, selected);
    if (!result.success) {
      let message = result.error || 'Failed to submit enrollment.';
      if (
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
      }
      await StudentDialog.alert({ type: 'error', title: 'Enrollment Failed', message });
      return;
    }

    let remoteRecord = null;
    if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
      remoteRecord = await SupabaseService.getStudentEnrollment(student.id);
    }
    closeConfirmModal();
    showEnrolledView(student, remoteRecord ? mapSupabaseEnrollment(remoteRecord) : { ...localRecord, status: 'pending' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  saveEnrollmentRecord(student.id, localRecord);
  closeConfirmModal();
  showEnrolledView(student, localRecord);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function resetEnrollment() {
  const student = getStudent();
  const confirmed = await StudentDialog.confirm({
    title: 'Reset Enrollment?',
    message: 'You will need to select subjects and schedules again.',
    confirmLabel: 'Reset',
    variant: 'danger'
  });
  if (!confirmed) return;

  clearEnrollmentRecord(student.id);
  showSelectionView(student);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function downloadCOR() {
  const student = getStudent();
  let record = getEnrollmentRecord(student.id);

  if (typeof SupabaseService !== 'undefined' && SupabaseService.isEnabled()) {
    const remoteRecord = await SupabaseService.getStudentEnrollment(student.id);
    if (remoteRecord) record = mapSupabaseEnrollment(remoteRecord);
  }

  if (!record) return;

  const lines = [
    'CERTIFICATE OF REGISTRATION',
    'Geranova Senior High School',
    '=====================================',
    '',
    `Student: ${student.lastName}, ${student.firstName} ${student.middleName}`,
    `Student ID: ${student.id}`,
    `Strand: ${student.strandFull || student.strand}`,
    `Section: ${student.section}`,
    `School Year: ${student.schoolYear}`,
    `Semester: ${student.semester}`,
    `Status: ${record.status === 'pending' ? 'Pending Approval' : 'Officially Enrolled'}`,
    '',
    'ENROLLED SUBJECTS:',
    '-------------------------------------'
  ];

  record.subjects.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.code} - ${s.description} (${s.units} units)`);
    lines.push(`   Schedule: ${s.schedule}`);
  });

  lines.push('-------------------------------------');
  lines.push(`Total Units: ${record.totalUnits}`);
  lines.push(`Date Enrolled: ${record.enrolledAt}`);
  lines.push('');
  lines.push('This is a system-generated Certificate of Registration.');

  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `COR_${student.id}_2627_1st.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function getCurrentEnrollmentRecord(student) {
  return getEnrollmentRecord(student.id);
}
