-- Section quota per strand/section (default 40 students)
-- Run ONCE in Supabase SQL Editor.
-- Blocks admission/enrollment when a section is full and exposes quota data to admin + student UI.

UPDATE sections
SET max_students = 40
WHERE max_students IS NULL OR max_students < 1;

CREATE OR REPLACE FUNCTION section_scheduled_count(p_section_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
  v_semester UUID;
BEGIN
  IF p_section_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT id INTO v_semester FROM semesters WHERE is_current = TRUE LIMIT 1;

  SELECT COUNT(*)::INT INTO v_count
  FROM students s
  WHERE s.section_id = p_section_id
    AND COALESCE(s.is_active, TRUE) = TRUE;

  SELECT v_count + COUNT(DISTINCT a.id)::INT INTO v_count
  FROM admission_applications a
  WHERE a.status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM jsonb_each_text(COALESCE(a.preferred_subject_schedules, '{}'::jsonb)) pref(key, val)
      JOIN class_schedules cs ON cs.id = NULLIF(TRIM(pref.val), '')::uuid
      WHERE cs.section_id = p_section_id
    );

  IF v_semester IS NOT NULL THEN
    SELECT v_count + COUNT(DISTINCT e.student_id)::INT INTO v_count
    FROM enrollments e
    WHERE e.status = 'pending'
      AND e.semester_id = v_semester
      AND EXISTS (
        SELECT 1
        FROM enrollment_subjects es
        JOIN class_schedules cs ON cs.id = es.class_schedule_id
        WHERE es.enrollment_id = e.id
          AND cs.section_id = p_section_id
      );
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION assert_section_has_quota(p_section_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quota INT;
  v_scheduled INT;
  v_section_name TEXT;
BEGIN
  IF p_section_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(sec.max_students, 40), section_scheduled_count(sec.id), sec.name
  INTO v_quota, v_scheduled, v_section_name
  FROM sections sec
  WHERE sec.id = p_section_id;

  IF v_quota IS NULL THEN
    RETURN;
  END IF;

  IF v_scheduled >= v_quota THEN
    RAISE EXCEPTION 'Section % is full (%/% students). Please choose another section or contact the registrar.',
      COALESCE(v_section_name, 'selected'), v_scheduled, v_quota;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION validate_subject_schedule_quotas(p_schedules JSONB)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_val TEXT;
  v_section_id UUID;
  v_seen UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_schedules IS NULL OR jsonb_typeof(p_schedules) IS DISTINCT FROM 'object' THEN
    RETURN;
  END IF;

  FOR v_key, v_val IN SELECT * FROM jsonb_each_text(p_schedules)
  LOOP
    IF NULLIF(TRIM(v_val), '') IS NULL THEN
      CONTINUE;
    END IF;

    SELECT cs.section_id INTO v_section_id
    FROM class_schedules cs
    WHERE cs.id = v_val::uuid;

    IF v_section_id IS NOT NULL AND NOT (v_section_id = ANY(v_seen)) THEN
      PERFORM assert_section_has_quota(v_section_id);
      v_seen := array_append(v_seen, v_section_id);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION get_section_quota_overview()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.strand, t."gradeLevel", t.section), '[]'::json)
  INTO result
  FROM (
    SELECT
      sec.id,
      sec.name AS section,
      str.code AS strand,
      sec.grade_level AS "gradeLevel",
      COALESCE(sec.max_students, 40) AS quota,
      section_scheduled_count(sec.id) AS "scheduledStudents",
      GREATEST(COALESCE(sec.max_students, 40) - section_scheduled_count(sec.id), 0) AS remaining,
      CASE
        WHEN section_scheduled_count(sec.id) >= COALESCE(sec.max_students, 40) THEN 'Full'
        ELSE 'Open'
      END AS status
    FROM sections sec
    JOIN strands str ON str.id = sec.strand_id
    WHERE COALESCE(sec.is_active, TRUE) = TRUE
      AND COALESCE(str.is_active, TRUE) = TRUE
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Patch admission submit: reject when chosen section(s) are full
CREATE OR REPLACE FUNCTION submit_admission_application(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_app_number TEXT;
  v_count INT;
  v_docs JSONB;
  v_full_address TEXT;
  v_schedules JSONB;
  v_year_prefix TEXT := 'APP-' || TO_CHAR(NOW(), 'YYYY') || '-';
BEGIN
  SELECT COALESCE(MAX(
    CAST(NULLIF(REGEXP_REPLACE(application_number, '^.*-', ''), '') AS INT)
  ), 0) + 1
  INTO v_count
  FROM admission_applications
  WHERE application_number LIKE v_year_prefix || '%';

  v_app_number := v_year_prefix || LPAD(v_count::TEXT, 5, '0');

  v_docs := COALESCE(p_payload->'documents', '{}'::json);
  v_schedules := COALESCE((p_payload->'subjectSchedules')::jsonb, '{}'::jsonb);
  IF jsonb_typeof(v_schedules) IS DISTINCT FROM 'object' THEN
    v_schedules := '{}'::jsonb;
  END IF;

  PERFORM validate_subject_schedule_quotas(v_schedules);

  v_full_address := NULLIF(CONCAT_WS(', ',
    NULLIF(TRIM(p_payload->>'houseNumber'), ''),
    NULLIF(TRIM(p_payload->>'street'), ''),
    NULLIF(TRIM(p_payload->>'barangay'), ''),
    NULLIF(TRIM(p_payload->>'city'), ''),
    NULLIF(TRIM(p_payload->>'province'), '')
  ), '');

  IF v_full_address IS NULL THEN
    v_full_address := NULLIF(TRIM(p_payload->>'address'), '');
  END IF;

  INSERT INTO admission_applications (
    application_number, last_name, first_name, middle_name, birthdate, gender,
    address, addr_house_number, addr_street, addr_barangay, addr_city, addr_province,
    contact_number, email, grade_level, strand_id, admission_type, previous_school,
    payment_mode,
    gcash_reference, gcash_sender_name, gcash_proof_path,
    bank_code, bank_reference, bank_sender_name, bank_proof_path,
    payment_status, payment_amount,
    doc_form_138_path, doc_form_137_path, doc_good_moral_path,
    doc_birth_certificate_path, doc_high_school_diploma_path,
    profile_photo_upload_path, profile_photo_camera_path,
    preferred_subject_schedules,
    documents, status
  )
  VALUES (
    v_app_number,
    UPPER(TRIM(p_payload->>'lastName')),
    UPPER(TRIM(p_payload->>'firstName')),
    NULLIF(UPPER(TRIM(p_payload->>'middleName')), ''),
    (p_payload->>'birthdate')::DATE,
    NULLIF(p_payload->>'gender', ''),
    v_full_address,
    NULLIF(TRIM(p_payload->>'houseNumber'), ''),
    NULLIF(TRIM(p_payload->>'street'), ''),
    NULLIF(TRIM(p_payload->>'barangay'), ''),
    NULLIF(TRIM(p_payload->>'city'), ''),
    NULLIF(TRIM(p_payload->>'province'), ''),
    p_payload->>'contactNumber',
    LOWER(TRIM(p_payload->>'email')),
    p_payload->>'gradeLevel',
    COALESCE(
      NULLIF(p_payload->>'strandId', '')::UUID,
      (SELECT id FROM strands WHERE code = UPPER(TRIM(p_payload->>'strandCode')) LIMIT 1)
    ),
    COALESCE(p_payload->>'admissionType', 'new'),
    NULLIF(TRIM(p_payload->>'previousSchool'), ''),
    p_payload->>'paymentMode',
    NULLIF(p_payload->>'gcashReference', ''),
    NULLIF(p_payload->>'gcashSenderName', ''),
    NULLIF(p_payload->>'gcashProofPath', ''),
    NULLIF(p_payload->>'bankCode', ''),
    NULLIF(p_payload->>'bankReference', ''),
    NULLIF(p_payload->>'bankSenderName', ''),
    NULLIF(p_payload->>'bankProofPath', ''),
    COALESCE(p_payload->>'paymentStatus', 'submitted'),
    NULLIF(p_payload->>'paymentAmount', '')::NUMERIC,
    NULLIF(COALESCE(p_payload->>'docForm138Path', v_docs->>'form_138'), ''),
    NULLIF(COALESCE(p_payload->>'docForm137Path', v_docs->>'form_137'), ''),
    NULLIF(COALESCE(p_payload->>'docGoodMoralPath', v_docs->>'good_moral'), ''),
    NULLIF(COALESCE(p_payload->>'docBirthCertificatePath', v_docs->>'birth_certificate'), ''),
    NULLIF(COALESCE(p_payload->>'docHighSchoolDiplomaPath', v_docs->>'high_school_diploma'), ''),
    NULLIF(COALESCE(p_payload->>'profilePhotoUploadPath', v_docs->>'profile_upload'), ''),
    NULLIF(COALESCE(p_payload->>'profilePhotoCameraPath', v_docs->>'profile_camera'), ''),
    v_schedules,
    jsonb_strip_nulls(jsonb_build_object(
      'form_138', NULLIF(COALESCE(p_payload->>'docForm138Path', v_docs->>'form_138'), ''),
      'form_137', NULLIF(COALESCE(p_payload->>'docForm137Path', v_docs->>'form_137'), ''),
      'good_moral', NULLIF(COALESCE(p_payload->>'docGoodMoralPath', v_docs->>'good_moral'), ''),
      'birth_certificate', NULLIF(COALESCE(p_payload->>'docBirthCertificatePath', v_docs->>'birth_certificate'), ''),
      'high_school_diploma', NULLIF(COALESCE(p_payload->>'docHighSchoolDiplomaPath', v_docs->>'high_school_diploma'), ''),
      'profile_upload', NULLIF(COALESCE(p_payload->>'profilePhotoUploadPath', v_docs->>'profile_upload'), ''),
      'profile_camera', NULLIF(COALESCE(p_payload->>'profilePhotoCameraPath', v_docs->>'profile_camera'), ''),
      'subject_schedule_details', p_payload->'subjectScheduleDetails'
    )),
    'pending'
  )
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'success', TRUE,
    'applicationId', v_id,
    'applicationNumber', v_app_number
  );
END;
$$;

-- Offerings: include section quota + remaining slots for student dropdowns
CREATE OR REPLACE FUNCTION get_admission_offerings(
  p_strand_code TEXT,
  p_grade_level TEXT,
  p_semester_code TEXT DEFAULT '1st'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_strand_id UUID;
  v_grade_level TEXT;
  v_semester_code TEXT;
  result JSON;
BEGIN
  v_grade_level := NULLIF(TRIM(p_grade_level), '');
  v_semester_code := COALESCE(NULLIF(TRIM(p_semester_code), ''), '1st');

  IF v_grade_level IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT id INTO v_strand_id
  FROM strands
  WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_strand_code))
  LIMIT 1;

  IF v_strand_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  PERFORM ensure_enrollment_schedules(v_strand_id, v_grade_level, v_semester_code);

  SELECT COALESCE(json_agg(subject_row ORDER BY subject_row->>'code'), '[]'::json)
  INTO result
  FROM (
    SELECT json_build_object(
      'code', sub.code,
      'description', sub.name,
      'lec', sub.lec_hours,
      'lab', sub.lab_hours,
      'units', sub.units,
      'gradeLevel', sub.grade_level,
      'semester', sub.semester_code,
      'type', CASE
        WHEN sub.strand_id IS NULL AND sub.code LIKE 'G%-A%' THEN 'applied'
        WHEN sub.strand_id IS NULL THEN 'core'
        ELSE 'specialized'
      END,
      'strandCode', str_sub.code,
      'schedules', (
        SELECT COALESCE(json_agg(json_build_object(
          'id', cs.id,
          'section', sec.name,
          'dayTime', cs.schedule_label,
          'sectionQuota', sq.quota,
          'sectionScheduled', sq.scheduled,
          'sectionRemaining', GREATEST(sq.quota - sq.scheduled, 0),
          'sectionFull', sq.scheduled >= sq.quota,
          'slots', LEAST(
            GREATEST(cs.max_slots - COALESCE(cs.enrolled_count, 0), 0),
            GREATEST(sq.quota - sq.scheduled, 0)
          )
        ) ORDER BY sec.name, cs.schedule_label), '[]'::json)
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN semesters sem ON sem.id = cs.semester_id
        CROSS JOIN LATERAL (
          SELECT
            COALESCE(sec.max_students, 40) AS quota,
            section_scheduled_count(sec.id) AS scheduled
        ) sq
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
    ) AS subject_row
    FROM subjects sub
    LEFT JOIN strands str_sub ON str_sub.id = sub.strand_id
    WHERE sub.is_active = TRUE
      AND sub.grade_level = v_grade_level
      AND (sub.semester_code IS NULL OR sub.semester_code = v_semester_code)
      AND (sub.strand_id IS NULL OR sub.strand_id = v_strand_id)
      AND EXISTS (
        SELECT 1
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
  ) offerings;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION get_enrollment_offerings(p_student_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_strand_id UUID;
  v_grade_level TEXT;
  v_semester_code TEXT;
  v_section_id UUID;
  result JSON;
BEGIN
  SELECT s.strand_id, s.grade_level, sem.code, s.section_id
  INTO v_strand_id, v_grade_level, v_semester_code, v_section_id
  FROM students s
  CROSS JOIN semesters sem
  WHERE s.student_id = UPPER(TRIM(p_student_id))
    AND sem.is_current = TRUE
  LIMIT 1;

  IF v_grade_level IS NULL THEN
    RETURN '[]'::json;
  END IF;

  IF v_strand_id IS NOT NULL THEN
    PERFORM ensure_enrollment_schedules(v_strand_id, v_grade_level, v_semester_code);
  END IF;

  SELECT COALESCE(json_agg(subject_row ORDER BY subject_row->>'code'), '[]'::json)
  INTO result
  FROM (
    SELECT json_build_object(
      'code', sub.code,
      'description', sub.name,
      'lec', sub.lec_hours,
      'lab', sub.lab_hours,
      'units', sub.units,
      'gradeLevel', sub.grade_level,
      'semester', sub.semester_code,
      'type', CASE
        WHEN sub.strand_id IS NULL AND sub.code LIKE 'G%-A%' THEN 'applied'
        WHEN sub.strand_id IS NULL THEN 'core'
        ELSE 'specialized'
      END,
      'strandCode', str_sub.code,
      'schedules', (
        SELECT COALESCE(json_agg(json_build_object(
          'id', cs.id,
          'section', sec.name,
          'dayTime', cs.schedule_label,
          'sectionQuota', sq.quota,
          'sectionScheduled', sq.scheduled,
          'sectionRemaining', GREATEST(sq.quota - sq.scheduled, 0),
          'sectionFull', sq.scheduled >= sq.quota,
          'slots', LEAST(
            GREATEST(cs.max_slots - COALESCE(cs.enrolled_count, 0), 0),
            GREATEST(sq.quota - sq.scheduled, 0)
          )
        ) ORDER BY
          CASE WHEN v_section_id IS NOT NULL AND sec.id = v_section_id THEN 0 ELSE 1 END,
          sec.name,
          cs.schedule_label
        ), '[]'::json)
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN semesters sem ON sem.id = cs.semester_id
        CROSS JOIN LATERAL (
          SELECT
            COALESCE(sec.max_students, 40) AS quota,
            section_scheduled_count(sec.id) AS scheduled
        ) sq
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
    ) AS subject_row
    FROM subjects sub
    LEFT JOIN strands str_sub ON str_sub.id = sub.strand_id
    WHERE sub.is_active = TRUE
      AND v_strand_id IS NOT NULL
      AND sub.grade_level = v_grade_level
      AND (sub.semester_code IS NULL OR sub.semester_code = v_semester_code)
      AND (sub.strand_id IS NULL OR sub.strand_id = v_strand_id)
      AND EXISTS (
        SELECT 1
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
  ) offerings;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Patch enrollment submit: reject when chosen section(s) are full
CREATE OR REPLACE FUNCTION submit_student_enrollment(
  p_student_id TEXT,
  p_subjects JSON
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student UUID;
  v_strand_id UUID;
  v_grade_level TEXT;
  v_semester UUID;
  v_section UUID;
  v_enrollment UUID;
  v_total_units INT := 0;
  v_item JSON;
  v_subject UUID;
  v_sub_strand UUID;
  v_sub_grade TEXT;
  v_sub_code TEXT;
  v_schedule UUID;
  v_units INT;
  v_schedule_label TEXT;
  v_sched_strand UUID;
  v_sched_grade TEXT;
  v_sched_section UUID;
  v_count INT;
  v_max_subjects INT := 20;
  v_access JSON;
  v_enrollment_open BOOLEAN;
  v_account_status TEXT;
  v_upload_path TEXT;
  v_camera_path TEXT;
  v_photos_semester UUID;
  v_seen_sections UUID[] := ARRAY[]::UUID[];
BEGIN
  SELECT s.id, s.strand_id, s.grade_level, s.section_id, s.account_status,
         s.enrollment_photo_upload_path, s.enrollment_photo_camera_path, s.enrollment_photos_semester_id
  INTO v_student, v_strand_id, v_grade_level, v_section, v_account_status,
       v_upload_path, v_camera_path, v_photos_semester
  FROM students s
  WHERE s.student_id = UPPER(TRIM(p_student_id))
  LIMIT 1;

  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  IF v_account_status IN ('frozen', 'inactive') THEN
    RAISE EXCEPTION 'Your account cannot enroll. Contact the registrar.';
  END IF;

  IF v_strand_id IS NULL THEN
    RAISE EXCEPTION 'Student has no assigned strand. Contact the registrar.';
  END IF;

  SELECT id INTO v_semester FROM semesters WHERE is_current = TRUE LIMIT 1;
  IF v_semester IS NULL THEN
    RAISE EXCEPTION 'No active semester configured';
  END IF;

  IF v_photos_semester IS DISTINCT FROM v_semester
     OR v_upload_path IS NULL OR TRIM(v_upload_path) = ''
     OR v_camera_path IS NULL OR TRIM(v_camera_path) = '' THEN
    RAISE EXCEPTION 'Please complete Step 1 (Upload Photo) and Step 2 (Take Photo) before submitting enrollment.';
  END IF;

  v_access := get_student_enrollment_access(p_student_id);
  IF NOT COALESCE((v_access->>'canEnroll')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION '%', COALESCE(v_access->>'reason', 'Enrollment is not available.');
  END IF;

  SELECT enrollment_open INTO v_enrollment_open FROM semesters WHERE is_current = TRUE LIMIT 1;
  IF NOT COALESCE(v_enrollment_open, FALSE) THEN
    RAISE EXCEPTION 'Enrollment is closed for the current term.';
  END IF;

  v_count := json_array_length(p_subjects);
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'Select at least one subject';
  END IF;

  IF v_count > v_max_subjects THEN
    RAISE EXCEPTION 'Maximum % subjects allowed', v_max_subjects;
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(p_subjects)
  LOOP
    SELECT sub.id, sub.units, sub.strand_id, sub.grade_level, sub.code
    INTO v_subject, v_units, v_sub_strand, v_sub_grade, v_sub_code
    FROM subjects sub
    WHERE sub.code = v_item->>'code' AND sub.is_active = TRUE
    LIMIT 1;

    IF v_subject IS NULL THEN
      RAISE EXCEPTION 'Subject not found: %', v_item->>'code';
    END IF;

    IF v_sub_grade <> v_grade_level THEN
      RAISE EXCEPTION 'Subject % is not offered for %', v_sub_code, v_grade_level;
    END IF;

    IF v_sub_strand IS NOT NULL AND v_sub_strand <> v_strand_id THEN
      RAISE EXCEPTION 'Subject % is not available for your strand', v_sub_code;
    END IF;

    SELECT cs.id, cs.schedule_label, sec.strand_id, sec.grade_level, sec.id
    INTO v_schedule, v_schedule_label, v_sched_strand, v_sched_grade, v_sched_section
    FROM class_schedules cs
    JOIN sections sec ON sec.id = cs.section_id
    JOIN semesters sem ON sem.id = cs.semester_id
    WHERE cs.id = resolve_class_schedule_id(v_item->>'scheduleId', v_subject, v_strand_id, v_grade_level)
      AND cs.subject_id = v_subject
      AND cs.is_active = TRUE
      AND sem.is_current = TRUE
    LIMIT 1;

    IF v_schedule IS NULL THEN
      RAISE EXCEPTION 'Invalid schedule for subject %', v_sub_code;
    END IF;

    IF v_sched_strand <> v_strand_id THEN
      RAISE EXCEPTION 'Schedule for % does not match your strand', v_sub_code;
    END IF;

    IF v_sched_grade <> v_grade_level THEN
      RAISE EXCEPTION 'Schedule for % does not match your grade level', v_sub_code;
    END IF;

    IF v_sched_section IS NOT NULL AND NOT (v_sched_section = ANY(v_seen_sections)) THEN
      PERFORM assert_section_has_quota(v_sched_section);
      v_seen_sections := array_append(v_seen_sections, v_sched_section);
    END IF;

    v_total_units := v_total_units + COALESCE(v_units, 0);
  END LOOP;

  INSERT INTO enrollments (
    enrollment_number, student_id, semester_id, section_id,
    status, total_units, enrolled_at
  )
  VALUES (
    'ENR-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(FLOOR(random() * 10000)::TEXT, 4, '0'),
    v_student, v_semester, v_section,
    'pending', v_total_units, NOW()
  )
  ON CONFLICT (student_id, semester_id)
  DO UPDATE SET
    status = 'pending',
    total_units = EXCLUDED.total_units,
    enrolled_at = NOW(),
    updated_at = NOW(),
    rejection_reason = NULL,
    reviewed_by = NULL,
    reviewed_at = NULL
  RETURNING id INTO v_enrollment;

  DELETE FROM enrollment_subjects WHERE enrollment_id = v_enrollment;

  FOR v_item IN SELECT * FROM json_array_elements(p_subjects)
  LOOP
    SELECT sub.id, sub.units INTO v_subject, v_units
    FROM subjects sub WHERE sub.code = v_item->>'code' LIMIT 1;

    SELECT cs.id, cs.schedule_label INTO v_schedule, v_schedule_label
    FROM class_schedules cs
    WHERE cs.id = resolve_class_schedule_id(v_item->>'scheduleId', v_subject, v_strand_id, v_grade_level)
      AND cs.subject_id = v_subject
    LIMIT 1;

    INSERT INTO enrollment_subjects (
      enrollment_id, subject_id, class_schedule_id, units, schedule_label, status
    ) VALUES (
      v_enrollment, v_subject, v_schedule, v_units,
      COALESCE(v_schedule_label, v_item->>'scheduleLabel'), 'enrolled'
    );
  END LOOP;

  PERFORM insert_student_notification(
    v_student,
    'Enrollment Submitted',
    'Your enrollment submission is pending review and approval by the Administrator.',
    'enrollment'
  );

  RETURN json_build_object(
    'success', TRUE,
    'enrollmentId', v_enrollment,
    'status', 'pending',
    'totalUnits', v_total_units
  );
END;
$$;

GRANT EXECUTE ON FUNCTION section_scheduled_count TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION assert_section_has_quota TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION validate_subject_schedule_quotas TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_section_quota_overview TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION submit_admission_application TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_admission_offerings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_enrollment_offerings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_student_enrollment TO anon, authenticated;
