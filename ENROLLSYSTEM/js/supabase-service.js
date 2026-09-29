// Supabase data and auth service
const SupabaseService = (() => {
  function getClient() {
    return SupabaseClient.getClient();
  }

  function isEnabled() {
    return SupabaseClient.isEnabled();
  }

  function normalizeJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  function isNetworkError(message) {
    if (!message) return true;
    const text = String(message).toLowerCase();
    return text.includes('failed to fetch')
      || text.includes('network')
      || text.includes('typeerror')
      || text.includes('fetch');
  }

  async function fetchFromServer(path) {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function callRpc(name, params = {}) {
    const client = getClient();
    if (!client) return { data: null, error: { message: 'Supabase is not configured' } };

    try {
      const { data, error } = await client.rpc(name, params);
      return { data, error };
    } catch (err) {
      console.warn(`Supabase RPC failed (${name}):`, err);
      return { data: null, error: { message: err.message || 'Network error' } };
    }
  }

  async function loginStudent(studentId, password, birthMonth, birthDay, birthYear) {
    // Birthdate is optional (login UI no longer requires it). Prefer server /api/auth/student.
    const pwd = String(password || '').trim();
    const sid = String(studentId || '').trim().toUpperCase();
    if (!sid || !pwd) return null;

    const hasBirth = birthMonth && birthDay && birthYear;
    if (hasBirth) {
      const { data, error } = await callRpc('authenticate_student', {
        p_student_id: sid,
        p_birth_month: parseInt(birthMonth, 10),
        p_birth_day: parseInt(birthDay, 10),
        p_birth_year: parseInt(birthYear, 10),
        p_password: pwd
      });
      if (!error && data) {
        if (data.error === 'ACCOUNT_FROZEN' || data.error === 'ACCOUNT_INACTIVE') {
          return { error: data.error, message: data.message };
        }
        if (data.id) return data;
      }
    }

    // Password-only REST fallback (same as server auth path).
    try {
      const client = getClient();
      if (!client) return null;
      const { data: students, error: sErr } = await client
        .from('students')
        .select('*, strands(code,name), sections(name)')
        .eq('student_id', sid)
        .limit(5);
      if (!sErr && Array.isArray(students)) {
        for (const row of students) {
          if (String(row.password || '').trim() !== pwd) continue;
          if (row.is_active === false) continue;
          const status = String(row.account_status || 'active').toLowerCase();
          if (status === 'frozen') {
            return {
              error: 'ACCOUNT_FROZEN',
              message: 'Your account has been frozen. Please contact the registrar\'s office.'
            };
          }
          if (status === 'inactive') {
            return {
              error: 'ACCOUNT_INACTIVE',
              message: 'Your account is inactive. Please contact the registrar\'s office.'
            };
          }
          const birth = String(row.birthdate || '2000-01-01').slice(0, 10).split('-');
          const strands = row.strands || {};
          const sections = row.sections || {};
          return {
            id: row.student_id,
            supabaseId: row.id,
            lastName: row.last_name || '',
            firstName: row.first_name || '',
            middleName: row.middle_name || '',
            birthMonth: String(parseInt(birth[1], 10) || 1),
            birthDay: String(parseInt(birth[2], 10) || 1),
            birthYear: String(parseInt(birth[0], 10) || 2000),
            gradeLevel: row.grade_level || 'Grade 11',
            strand: strands.code || 'STEM',
            strandFull: strands.name || strands.code || 'STEM',
            section: sections.name || '',
            track: row.track || 'Academic',
            admissionStatus: row.admission_status || 'approved',
            accountStatus: row.account_status || 'active',
            password: pwd
          };
        }
      }
    } catch (err) {
      console.warn('Supabase password-only student login failed:', err);
    }
    return null;
  }

  async function loginFaculty(facultyId, password) {
    const { data, error } = await callRpc('authenticate_faculty', {
      p_faculty_id: facultyId,
      p_password: password
    });

    if (error || data == null) return null;

    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return parsed && parsed.id ? parsed : null;
      } catch (err) {
        return null;
      }
    }

    return data && data.id ? data : null;
  }

  async function getEnrollmentOfferings(studentId) {
    const { data, error } = await callRpc('get_enrollment_offerings', {
      p_student_id: studentId
    });

    if (error) {
      console.error('Failed to load enrollment offerings:', error.message);
      return null;
    }

    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.subjects)) return data.subjects;
    return [];
  }

  async function getAdmissionOfferings(strandCode, gradeLevel, semesterCode = '1st') {
    const { data, error } = await callRpc('get_admission_offerings', {
      p_strand_code: String(strandCode || '').trim().toUpperCase(),
      p_grade_level: String(gradeLevel || 'Grade 11').trim(),
      p_semester_code: String(semesterCode || '1st').trim()
    });

    if (error) {
      console.warn('Failed to load admission offerings:', error.message);
      return null;
    }

    return normalizeJsonArray(data);
  }

  async function getStudentEnrollment(studentId) {
    const { data, error } = await callRpc('get_student_enrollment', {
      p_student_id: studentId
    });

    if (error) {
      console.error('Failed to load enrollment record:', error.message);
      return null;
    }

    return data;
  }

  async function submitEnrollment(studentId, subjects) {
    const payload = subjects.map(item => ({
      code: item.code,
      units: item.units,
      scheduleId: item.schedule.id,
      scheduleLabel: ScheduleFormat.formatDropdownOption(item.schedule)
    }));

    const { data, error } = await callRpc('submit_student_enrollment', {
      p_student_id: studentId,
      p_subjects: payload
    });

    if (error) {
      const msg = error.message || error.details || 'Enrollment validation failed';
      console.error('Failed to submit enrollment:', msg);
      return { success: false, error: msg };
    }

    return { success: true, data };
  }

  async function getFacultyDashboard() {
    const { data, error } = await callRpc('get_faculty_dashboard');
    if (error) {
      console.error('Failed to load faculty dashboard:', error.message);
      return null;
    }
    return data;
  }

  async function getPendingEnrollments() {
    const { data, error } = await callRpc('get_pending_enrollments');
    if (error) {
      console.error('Failed to load pending enrollments:', error.message);
      return null;
    }
    return Array.isArray(data) ? data : [];
  }

  async function getEnrollmentHistory() {
    const { data, error } = await callRpc('get_enrollment_history');
    if (error) {
      console.error('Failed to load enrollment history:', error.message);
      return null;
    }
    return Array.isArray(data) ? data : [];
  }

  async function reviewEnrollment(enrollmentId, facultyId, action, reason = null) {
    const { data, error } = await callRpc('review_enrollment', {
      p_enrollment_id: enrollmentId,
      p_faculty_id: facultyId,
      p_action: action,
      p_reason: reason
    });

    if (error) {
      console.error('Failed to review enrollment:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  }

  async function getStudentNotifications(studentId) {
    const { data, error } = await callRpc('get_student_notifications', {
      p_student_id: studentId
    });

    if (!error && Array.isArray(data)) {
      return data;
    }

    const json = await fetchFromServer(
      '/api/student/notifications?studentId=' + encodeURIComponent(studentId)
    );
    if (json && json.success && Array.isArray(json.data)) {
      return json.data;
    }

    return [];
  }

  async function submitStudentFeedback(studentId, subject, message) {
    try {
      const res = await fetch('/api/student/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subject, message }),
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message || 'Unable to submit feedback.' };
    }
  }

  async function getStudentStrandSchedule(studentId) {
    const { data, error } = await callRpc('get_student_strand_schedule', {
      p_student_id: studentId
    });

    if (!error) {
      if (data && typeof data === 'object' && !Array.isArray(data) && 'schedule' in data) {
        return {
          enrollmentStatus: data.enrollmentStatus || 'unknown',
          message: data.message || null,
          schedule: normalizeJsonArray(data.schedule),
        };
      }

      if (Array.isArray(data)) {
        return { enrollmentStatus: 'unknown', message: null, schedule: data };
      }
    } else {
      console.warn('Schedule RPC fallback:', error.message);
    }

    const json = await fetchFromServer(
      '/api/student/schedule?studentId=' + encodeURIComponent(studentId)
    );
    if (json && json.success && json.data) {
      const payload = json.data;
      if (payload && typeof payload === 'object' && 'schedule' in payload) {
        return {
          enrollmentStatus: payload.enrollmentStatus || 'unknown',
          message: payload.message || null,
          schedule: normalizeJsonArray(payload.schedule),
        };
      }
    }

    if (error && isNetworkError(error.message)) {
      return {
        enrollmentStatus: 'none',
        message: 'You have not enrolled for this semester yet. Go to Enrollment to select your subjects.',
        schedule: [],
      };
    }

    return {
      enrollmentStatus: 'error',
      message: error
        ? (error.message || 'Unable to load schedule from the server.')
        : 'Unable to load your class schedule. Please try again or contact the registrar.',
      schedule: [],
    };
  }

  async function getEnrollmentAccess(studentId) {
    const { data, error } = await callRpc('get_student_enrollment_access', {
      p_student_id: studentId
    });
    if (error) {
      console.error('Failed to load enrollment access:', error.message);
      return null;
    }
    return data;
  }

  async function getStudentGrades(studentId) {
    const json = await fetchFromServer(
      '/api/student/grades?studentId=' + encodeURIComponent(studentId)
    );
    if (json && json.success && json.data) {
      const payload = json.data;
      if (Array.isArray(payload)) {
        return { enrollmentStatus: 'unknown', message: null, terms: payload };
      }
      return {
        enrollmentStatus: payload.enrollmentStatus || 'unknown',
        message: payload.message || null,
        terms: normalizeJsonArray(payload.terms),
      };
    }

    const { data, error } = await callRpc('get_student_grades', {
      p_student_id: studentId
    });

    if (!error) {
      if (data && typeof data === 'object' && !Array.isArray(data) && 'terms' in data) {
        return {
          enrollmentStatus: data.enrollmentStatus || 'unknown',
          message: data.message || null,
          terms: normalizeJsonArray(data.terms),
        };
      }

      if (Array.isArray(data)) {
        return { enrollmentStatus: 'unknown', message: null, terms: data };
      }
    } else {
      console.warn('Grades RPC fallback:', error.message);
    }

    return {
      enrollmentStatus: 'none',
      message: 'You have not enrolled for this semester yet. Go to Enrollment to select your subjects.',
      terms: [],
    };
  }

  async function getEnrollmentPhotos(studentId) {
    const { data, error } = await callRpc('get_student_enrollment_photos', {
      p_student_id: studentId
    });
    if (!error && data) return data;

    const json = await fetchFromServer('/api/enrollment/photos?studentId=' + encodeURIComponent(studentId));
    if (json && json.success) return json.data;
    return { uploadDone: false, cameraDone: false, photosReady: false };
  }

  async function saveEnrollmentPhoto(studentId, photoType, dataUrl) {
    try {
      const res = await fetch('/api/enrollment/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, photoType, dataUrl })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json.error || 'Failed to save enrollment photo' };
      }
      return { success: true, data: json.data };
    } catch (err) {
      return { success: false, error: err.message || 'Network error saving photo' };
    }
  }

  return {
    isEnabled,
    loginStudent,
    loginFaculty,
    getEnrollmentOfferings,
    getAdmissionOfferings,
    getStudentEnrollment,
    getStudentStrandSchedule,
    getEnrollmentAccess,
    getEnrollmentPhotos,
    saveEnrollmentPhoto,
    getStudentGrades,
    submitEnrollment,
    getFacultyDashboard,
    getPendingEnrollments,
    getEnrollmentHistory,
    reviewEnrollment,
    getStudentNotifications,
    submitStudentFeedback
  };
})();
