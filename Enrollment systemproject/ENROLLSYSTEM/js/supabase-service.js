// Supabase data and auth service
const SupabaseService = (() => {
  function getClient() {
    return SupabaseClient.getClient();
  }

  function isEnabled() {
    return SupabaseClient.isEnabled();
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

  async function loginStudent(studentId, birthMonth, birthDay, birthYear, password) {
    const { data, error } = await callRpc('authenticate_student', {
      p_student_id: studentId,
      p_birth_month: parseInt(birthMonth, 10),
      p_birth_day: parseInt(birthDay, 10),
      p_birth_year: parseInt(birthYear, 10),
      p_password: password
    });

    if (error || !data) return null;
    if (data.error === 'ACCOUNT_FROZEN' || data.error === 'ACCOUNT_INACTIVE') {
      return { error: data.error, message: data.message };
    }
    return data;
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
      scheduleLabel: `[${item.schedule.slots}] ${item.schedule.section} | ${item.schedule.dayTime}`
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

    if (error) {
      console.error('Failed to load notifications:', error.message);
      return null;
    }

    return Array.isArray(data) ? data : [];
  }

  async function getStudentStrandSchedule(studentId) {
    const { data, error } = await callRpc('get_student_strand_schedule', {
      p_student_id: studentId
    });

    if (error) {
      console.error('Failed to load strand schedule:', error.message);
      return null;
    }

    return Array.isArray(data) ? data : [];
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
    const { data, error } = await callRpc('get_student_grades', {
      p_student_id: studentId
    });
    if (error) {
      console.error('Failed to load grades:', error.message);
      return null;
    }
    return Array.isArray(data) ? data : [];
  }

  return {
    isEnabled,
    loginStudent,
    loginFaculty,
    getEnrollmentOfferings,
    getStudentEnrollment,
    getStudentStrandSchedule,
    getEnrollmentAccess,
    getStudentGrades,
    submitEnrollment,
    getFacultyDashboard,
    getPendingEnrollments,
    getEnrollmentHistory,
    reviewEnrollment,
    getStudentNotifications
  };
})();
