// Old Student (returnee) Grade 12 enrollment — verify existing ID, prefill, then continuing enrollment.

const OLD_STUDENT_VERIFY_KEY = 'geranova_old_student_verified';

function showOldStudentError(message) {
  const el = document.getElementById('oldStudentError');
  if (!el) return;
  el.style.display = message ? 'block' : 'none';
  el.textContent = message || '';
}

function readBirthdateParts(hiddenInputId) {
  const raw = (document.getElementById(hiddenInputId)?.value || '').trim();
  const parts = raw.split('-');
  if (parts.length !== 3) return null;
  return {
    birthYear: parseInt(parts[0], 10),
    birthMonth: parseInt(parts[1], 10),
    birthDay: parseInt(parts[2], 10),
  };
}

function fillProfileForm(profile, student) {
  document.getElementById('pfStudentId').value = profile.studentId || student.id || '';
  document.getElementById('pfStage').value = profile.enrollmentStageLabel || student.enrollmentStageLabel || '';
  document.getElementById('pfLastName').value = profile.lastName || '';
  document.getElementById('pfFirstName').value = profile.firstName || '';
  document.getElementById('pfMiddleName').value = profile.middleName || '';
  document.getElementById('pfGender').value = profile.gender || '';
  document.getElementById('pfContact').value = profile.contactNumber || '';
  document.getElementById('pfEmail').value = profile.email || '';
  document.getElementById('pfAddress').value = profile.address || '';
  document.getElementById('pfGrade').value = profile.gradeLevel || 'Grade 12';
  document.getElementById('pfSemester').value = profile.semester || '';
  document.getElementById('pfStrand').value = profile.strandFull || profile.strand || '';

  const banner = document.getElementById('stageBanner');
  if (banner) {
    banner.innerHTML = `
      <strong>${profile.enrollmentStageLabel || 'Grade 12 enrollment'}</strong><br>
      Student ID <strong>${profile.studentId}</strong> verified. Previous Grade 11 records stay intact.
      A <em>new</em> enrollment will be created for this Grade 12 term after you submit subject enrollment.
    `;
  }
  document.getElementById('oldStudentSubtitle').textContent =
    `${profile.enrollmentStageLabel || 'Grade 12'} · S.Y. continuing enrollment`;
}

async function verifyOldStudent(event) {
  event.preventDefault();
  showOldStudentError('');
  const studentId = (document.getElementById('oldStudentId')?.value || '').trim().toUpperCase();
  const birth = readBirthdateParts('oldBirthdate');
  if (!studentId || !birth) {
    showOldStudentError('Enter your Student ID and birthdate.');
    return;
  }

  const btn = document.getElementById('btnVerifyOldStudent');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying…';
  }

  try {
    const res = await fetch('/api/enrollment/old-student/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        birthMonth: birth.birthMonth,
        birthDay: birth.birthDay,
        birthYear: birth.birthYear,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showOldStudentError(json.error || 'Verification failed.');
      return;
    }

    const student = normalizeStudentAccount({
      ...json.student,
      oldStudentReturnee: true,
      email: json.profile?.email || json.student?.email || '',
      gender: json.profile?.gender || '',
      address: json.profile?.address || '',
      contactNumber: json.profile?.contactNumber || '',
    });
    student.oldStudentReturnee = true;
    student.enrollmentStage = json.student.enrollmentStage;
    student.enrollmentStageLabel = json.student.enrollmentStageLabel;
    student.birthMonth = String(birth.birthMonth);
    student.birthDay = String(birth.birthDay);
    student.birthYear = String(birth.birthYear);

    try {
      sessionStorage.setItem(OLD_STUDENT_VERIFY_KEY, JSON.stringify({
        verifiedAt: Date.now(),
        studentId: student.id,
        birthMonth: birth.birthMonth,
        birthDay: birth.birthDay,
        birthYear: birth.birthYear,
      }));
    } catch (err) { /* ignore */ }

    setStudent(student);
    sessionStorage.setItem('loginRole', 'student');
    sessionStorage.setItem(ADMISSION_ENTRY_TYPE_KEY, 'returnee');

    document.getElementById('verifyPanel').hidden = true;
    document.getElementById('profilePanel').hidden = false;
    fillProfileForm(json.profile || {}, student);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showOldStudentError(err.message || 'Could not verify Student ID. Is the student server running?');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify & Continue';
    }
  }
}

async function saveProfileAndContinue(event) {
  event.preventDefault();
  showOldStudentError('');
  const student = getStudent();
  if (!student?.id || !student.oldStudentReturnee) {
    showOldStudentError('Verify your Student ID first.');
    document.getElementById('verifyPanel').hidden = false;
    document.getElementById('profilePanel').hidden = true;
    return;
  }

  const payload = {
    studentId: student.id,
    birthMonth: Number(student.birthMonth),
    birthDay: Number(student.birthDay),
    birthYear: Number(student.birthYear),
    lastName: document.getElementById('pfLastName').value.trim(),
    firstName: document.getElementById('pfFirstName').value.trim(),
    middleName: document.getElementById('pfMiddleName').value.trim(),
    gender: document.getElementById('pfGender').value.trim(),
    address: document.getElementById('pfAddress').value.trim(),
    contactNumber: document.getElementById('pfContact').value.trim(),
    email: document.getElementById('pfEmail').value.trim(),
  };

  const btn = document.getElementById('btnSaveContinue');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    const res = await fetch('/api/enrollment/old-student/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      showOldStudentError(json.error || 'Could not update your record.');
      return;
    }

    const updated = normalizeStudentAccount({
      ...json.student,
      oldStudentReturnee: true,
      email: payload.email,
      gender: payload.gender,
      address: payload.address,
      contactNumber: payload.contactNumber,
    });
    updated.oldStudentReturnee = true;
    updated.enrollmentStage = json.student.enrollmentStage || student.enrollmentStage;
    updated.enrollmentStageLabel = json.student.enrollmentStageLabel || student.enrollmentStageLabel;
    updated.birthMonth = student.birthMonth;
    updated.birthDay = student.birthDay;
    updated.birthYear = student.birthYear;
    setStudent(updated);

    // Existing continuing enrollment UI (creates NEW enrollment for current G12 term)
    window.location.href = 'student/enrollment.html?oldStudent=1';
  } catch (err) {
    showOldStudentError(err.message || 'Save failed.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save & Continue to Subject Enrollment';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const birthHidden = document.getElementById('oldBirthdate');
  if (birthHidden) {
    const field = birthHidden.closest('.date-field');
    if (field && typeof bindDateField === 'function') {
      bindDateField(field, { min: '1960-01-01', max: `${new Date().getFullYear()}-12-31` });
    }
  }

  document.getElementById('oldStudentVerifyForm')?.addEventListener('submit', verifyOldStudent);
  document.getElementById('oldStudentProfileForm')?.addEventListener('submit', saveProfileAndContinue);
  document.getElementById('btnBackVerify')?.addEventListener('click', () => {
    document.getElementById('profilePanel').hidden = true;
    document.getElementById('verifyPanel').hidden = false;
    showOldStudentError('');
  });

  // Resume profile step if already verified this session
  const existing = getStudent();
  if (existing?.oldStudentReturnee && existing.id) {
    document.getElementById('verifyPanel').hidden = true;
    document.getElementById('profilePanel').hidden = false;
    fillProfileForm({
      studentId: existing.id,
      enrollmentStageLabel: existing.enrollmentStageLabel,
      lastName: existing.lastName,
      firstName: existing.firstName,
      middleName: existing.middleName,
      gender: existing.gender || '',
      contactNumber: existing.contactNumber || '',
      email: existing.email || '',
      address: existing.address || '',
      gradeLevel: existing.gradeLevel,
      semester: existing.semester,
      strandFull: existing.strandFull || existing.strand,
    }, existing);
  }
});
