-- Bridge admission schedules (Step 5) → student enrollment record
-- Run ONCE in Supabase SQL Editor.
--
-- Problem: students pick 1st-sem schedules during admission (enroll.html) but after
-- approval the Enrollment module asks them to enroll again because no row exists in
-- enrollments / enrollment_subjects.
--
-- Fix: on admission approval (and lazy sync for existing approved students), create
-- an enrolled record from preferred_subject_schedules.

CREATE OR REPLACE FUNCTION create_enrollment_from_admission(
  p_student_uuid UUID,
  p_application_id UUID,
  p_faculty UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_semester UUID;
  v_enrollment UUID;
  v_total_units INT := 0;
  v_section UUID;
  v_subject_code TEXT;
  v_schedule_id TEXT;
  v_subject UUID;
  v_schedule UUID;
  v_units INT;
  v_schedule_label TEXT;
  v_schedules JSONB;
BEGIN
  IF p_student_uuid IS NULL OR p_application_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT preferred_subject_schedules
  INTO v_schedules
  FROM admission_applications
  WHERE id = p_application_id;

  SELECT id INTO v_semester FROM semesters WHERE is_current = TRUE LIMIT 1;
  IF v_semester IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT e.id INTO v_enrollment
  FROM enrollments e
  WHERE e.student_id = p_student_uuid
    AND e.semester_id = v_semester
  LIMIT 1;

  IF v_enrollment IS NOT NULL THEN
    RETURN v_enrollment;
  END IF;

  IF v_schedules IS NULL
     OR jsonb_typeof(v_schedules) IS DISTINCT FROM 'object'
     OR v_schedules = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  SELECT cs.section_id INTO v_section
  FROM jsonb_each_text(v_schedules) pref(key, val)
  JOIN class_schedules cs ON cs.id = NULLIF(TRIM(pref.val), '')::uuid
  GROUP BY cs.section_id
  ORDER BY COUNT(*) DESC, cs.section_id
  LIMIT 1;

  INSERT INTO enrollments (
    enrollment_number,
    student_id,
    semester_id,
    section_id,
    status,
    total_units,
    enrolled_at,
    reviewed_by,
    reviewed_at
  )
  VALUES (
    'ENR-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0'),
    p_student_uuid,
    v_semester,
    v_section,
    'enrolled',
    0,
    NOW(),
    p_faculty,
    CASE WHEN p_faculty IS NOT NULL THEN NOW() ELSE NULL END
  )
  RETURNING id INTO v_enrollment;

  FOR v_subject_code, v_schedule_id IN
    SELECT pref.key, pref.val
    FROM jsonb_each_text(v_schedules) pref(key, val)
  LOOP
    IF NULLIF(TRIM(v_schedule_id), '') IS NULL THEN
      CONTINUE;
    END IF;

    SELECT sub.id, sub.units
    INTO v_subject, v_units
    FROM subjects sub
    WHERE sub.code = v_subject_code
      AND sub.is_active = TRUE
    LIMIT 1;

    IF v_subject IS NULL THEN
      CONTINUE;
    END IF;

    SELECT cs.id, cs.schedule_label
    INTO v_schedule, v_schedule_label
    FROM class_schedules cs
    WHERE cs.id = v_schedule_id::uuid
      AND cs.subject_id = v_subject
    LIMIT 1;

    IF v_schedule IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO enrollment_subjects (
      enrollment_id,
      subject_id,
      class_schedule_id,
      units,
      schedule_label,
      status
    ) VALUES (
      v_enrollment,
      v_subject,
      v_schedule,
      COALESCE(v_units, 0),
      v_schedule_label,
      'enrolled'
    )
    ON CONFLICT (enrollment_id, subject_id) DO NOTHING;

    v_total_units := v_total_units + COALESCE(v_units, 0);
  END LOOP;

  UPDATE enrollments
  SET total_units = v_total_units,
      updated_at = NOW()
  WHERE id = v_enrollment;

  IF v_section IS NOT NULL THEN
    UPDATE students
    SET section_id = COALESCE(section_id, v_section),
        updated_at = NOW()
    WHERE id = p_student_uuid;
  END IF;

  RETURN v_enrollment;
END;
$$;

CREATE OR REPLACE FUNCTION sync_admission_enrollment_for_student(p_student_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_uuid UUID;
  v_application_id UUID;
  v_faculty UUID;
BEGIN
  SELECT s.id, a.id, a.reviewed_by
  INTO v_student_uuid, v_application_id, v_faculty
  FROM students s
  JOIN admission_applications a
    ON UPPER(TRIM(a.student_id_generated)) = UPPER(TRIM(s.student_id))
  WHERE s.student_id = UPPER(TRIM(p_student_id))
    AND a.status = 'approved'
  ORDER BY a.reviewed_at DESC NULLS LAST, a.updated_at DESC
  LIMIT 1;

  IF v_student_uuid IS NULL OR v_application_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN create_enrollment_from_admission(v_student_uuid, v_application_id, v_faculty);
END;
$$;

CREATE OR REPLACE FUNCTION review_admission_application(
  p_application_id TEXT,
  p_faculty_id TEXT,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faculty UUID;
  v_app RECORD;
  v_new_status TEXT;
  v_student_id TEXT;
  v_temp_password TEXT;
  v_student_uuid UUID;
  v_enrollment UUID;
BEGIN
  SELECT id INTO v_faculty
  FROM faculty
  WHERE faculty_id = UPPER(TRIM(p_faculty_id))
  LIMIT 1;

  SELECT *
  INTO v_app
  FROM admission_applications
  WHERE id::TEXT = p_application_id
     OR application_number = p_application_id
  LIMIT 1;

  IF v_app.id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status <> 'pending' THEN
    RAISE EXCEPTION 'Application already processed';
  END IF;

  v_new_status := CASE
    WHEN LOWER(p_action) = 'approve' THEN 'approved'
    WHEN LOWER(p_action) = 'reject' THEN 'rejected'
    ELSE NULL
  END;

  IF v_new_status IS NULL THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  IF v_new_status = 'approved' THEN
    v_student_id := generate_student_id();
    v_temp_password := 'Shs' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0');

    INSERT INTO students (
      student_id,
      last_name,
      first_name,
      middle_name,
      birthdate,
      password,
      gender,
      address,
      contact_number,
      admission_type,
      admission_status,
      grade_level,
      strand_id,
      scholastic_status,
      track,
      is_active
    )
    VALUES (
      v_student_id,
      v_app.last_name,
      v_app.first_name,
      v_app.middle_name,
      v_app.birthdate,
      v_temp_password,
      v_app.gender,
      v_app.address,
      v_app.contact_number,
      COALESCE(v_app.admission_type, 'new'),
      'approved',
      v_app.grade_level,
      v_app.strand_id,
      'Regular',
      'Academic',
      TRUE
    )
    RETURNING id INTO v_student_uuid;

    BEGIN
      INSERT INTO notifications (student_id, title, message, type)
      VALUES (
        v_student_uuid,
        'Welcome to Enrollment Management System',
        'Your admission has been approved. Use your Student ID to sign in to the enrollment portal.',
        'announcement'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    UPDATE admission_applications
    SET
      status = 'approved',
      student_id_generated = v_student_id,
      temp_password = v_temp_password,
      reviewed_by = v_faculty,
      reviewed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_app.id;

    v_enrollment := create_enrollment_from_admission(v_student_uuid, v_app.id, v_faculty);

    BEGIN
      PERFORM insert_student_notification(
        v_student_uuid,
        'Enrollment Complete',
        'Your 1st semester subjects and schedules from admission are now active. You do not need to enroll again for this term.',
        'enrollment'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    RETURN json_build_object(
      'success', TRUE,
      'status', 'approved',
      'studentId', v_student_id,
      'tempPassword', v_temp_password,
      'email', v_app.email,
      'firstName', v_app.first_name,
      'applicationNumber', v_app.application_number,
      'enrollmentId', v_enrollment,
      'enrollmentCreated', v_enrollment IS NOT NULL
    );
  END IF;

  UPDATE admission_applications
  SET
    status = 'rejected',
    rejection_reason = p_reason,
    reviewed_by = v_faculty,
    reviewed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_app.id;

  RETURN json_build_object(
    'success', TRUE,
    'status', 'rejected',
    'email', v_app.email,
    'firstName', v_app.first_name,
    'applicationNumber', v_app.application_number
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_student_enrollment(p_student_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  PERFORM sync_admission_enrollment_for_student(p_student_id);

  SELECT json_build_object(
    'status', e.status,
    'totalUnits', e.total_units,
    'enrolledAt', TO_CHAR(COALESCE(e.enrolled_at, e.created_at), 'Mon DD, YYYY HH12:MI AM'),
    'schoolYear', sy.label,
    'semester', sem.name,
    'subjects', (
      SELECT COALESCE(json_agg(json_build_object(
        'code', sub.code,
        'description', sub.name,
        'units', es.units,
        'schedule', es.schedule_label
      ) ORDER BY sub.code), '[]'::json)
      FROM enrollment_subjects es
      JOIN subjects sub ON sub.id = es.subject_id
      WHERE es.enrollment_id = e.id
    )
  )
  INTO result
  FROM enrollments e
  JOIN students s ON s.id = e.student_id
  JOIN semesters sem ON sem.id = e.semester_id
  JOIN school_years sy ON sy.id = sem.school_year_id
  WHERE s.student_id = UPPER(TRIM(p_student_id))
    AND sem.is_current = TRUE
  ORDER BY e.created_at DESC
  LIMIT 1;

  RETURN result;
END;
$$;

-- Backfill approved admissions that already have student accounts but no enrollment row
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      s.id AS student_uuid,
      a.id AS application_id,
      a.reviewed_by AS faculty_id
    FROM admission_applications a
    JOIN students s ON UPPER(TRIM(s.student_id)) = UPPER(TRIM(a.student_id_generated))
    WHERE a.status = 'approved'
      AND COALESCE(a.preferred_subject_schedules, '{}'::jsonb) <> '{}'::jsonb
  LOOP
    PERFORM create_enrollment_from_admission(r.student_uuid, r.application_id, r.faculty_id);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION create_enrollment_from_admission TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION sync_admission_enrollment_for_student TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION review_admission_application TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_student_enrollment TO anon, authenticated, service_role;
