-- Fix admission submit errors (profile photos + schedules + bank payment)
-- Run this ONCE in Supabase SQL Editor if submit shows:
--   "We could not save your application right now..."
--
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).

ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS doc_high_school_diploma_path TEXT,
  ADD COLUMN IF NOT EXISTS bank_code TEXT,
  ADD COLUMN IF NOT EXISTS bank_reference TEXT,
  ADD COLUMN IF NOT EXISTS bank_sender_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_proof_path TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_upload_path TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_camera_path TEXT,
  ADD COLUMN IF NOT EXISTS preferred_subject_schedules JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE admission_applications
  DROP CONSTRAINT IF EXISTS admission_applications_payment_mode_check;

ALTER TABLE admission_applications
  ADD CONSTRAINT admission_applications_payment_mode_check
  CHECK (payment_mode IN ('gcash', 'cashier', 'bank'));

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

GRANT EXECUTE ON FUNCTION submit_admission_application TO anon, authenticated;

-- Return profile photo paths in admin review detail
CREATE OR REPLACE FUNCTION get_admission_detail(p_application_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT row_to_json(t) INTO v_result
  FROM (
    SELECT
      a.id,
      a.application_number AS "applicationNumber",
      a.last_name AS "lastName",
      a.first_name AS "firstName",
      a.middle_name AS "middleName",
      CONCAT(a.last_name, ', ', a.first_name, ' ', COALESCE(a.middle_name, '')) AS student,
      TO_CHAR(a.birthdate, 'YYYY-MM-DD') AS birthdate,
      a.gender,
      COALESCE(
        NULLIF(TRIM(a.address), ''),
        NULLIF(TRIM(CONCAT_WS(', ',
          NULLIF(a.addr_house_number, ''),
          NULLIF(a.addr_street, ''),
          NULLIF(a.addr_barangay, ''),
          NULLIF(a.addr_city, ''),
          NULLIF(a.addr_province, '')
        )), '')
      ) AS address,
      a.addr_house_number AS "houseNumber",
      a.addr_street AS "street",
      a.addr_barangay AS "barangay",
      a.addr_city AS "city",
      a.addr_province AS "province",
      a.email,
      a.contact_number AS "contactNumber",
      str.code AS "strandCode",
      a.grade_level AS "gradeLevel",
      a.admission_type AS "admissionType",
      a.previous_school AS "previousSchool",
      a.payment_mode AS "paymentMode",
      a.gcash_reference AS "gcashReference",
      a.gcash_sender_name AS "gcashSenderName",
      a.gcash_proof_path AS "gcashProofPath",
      a.bank_code AS "bankCode",
      a.bank_reference AS "bankReference",
      a.bank_sender_name AS "bankSenderName",
      a.bank_proof_path AS "bankProofPath",
      a.payment_amount AS "paymentAmount",
      a.payment_status AS "paymentStatus",
      a.status,
      TO_CHAR(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "submittedAt",
      TO_CHAR(a.created_at, 'YYYY-MM-DD') AS date,
      a.student_id_generated AS "studentId",
      a.rejection_reason AS "rejectionReason",
      TO_CHAR(a.reviewed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "reviewedAt",
      a.doc_form_138_path AS "docForm138Path",
      a.doc_form_137_path AS "docForm137Path",
      a.doc_good_moral_path AS "docGoodMoralPath",
      a.doc_birth_certificate_path AS "docBirthCertificatePath",
      a.doc_high_school_diploma_path AS "docHighSchoolDiplomaPath",
      COALESCE(NULLIF(a.profile_photo_upload_path, ''), a.documents->>'profile_upload') AS "profilePhotoUploadPath",
      COALESCE(
        NULLIF(a.profile_photo_camera_path, ''),
        a.documents->>'profile_camera',
        a.documents->>'profile_upload'
      ) AS "profilePhotoCameraPath",
      a.preferred_subject_schedules AS "preferredSubjectSchedules",
      CASE
        WHEN jsonb_typeof(a.documents->'subject_schedule_details') = 'array'
          THEN a.documents->'subject_schedule_details'
        ELSE '[]'::jsonb
      END AS "subjectScheduleDetails",
      COALESCE(
        NULLIF(a.documents, '{}'::jsonb),
        jsonb_strip_nulls(jsonb_build_object(
          'form_138', a.doc_form_138_path,
          'form_137', a.doc_form_137_path,
          'good_moral', a.doc_good_moral_path,
          'birth_certificate', a.doc_birth_certificate_path,
          'high_school_diploma', a.doc_high_school_diploma_path,
          'profile_upload', a.profile_photo_upload_path,
          'profile_camera', a.profile_photo_camera_path
        ))
      ) AS documents
    FROM admission_applications a
    LEFT JOIN strands str ON str.id = a.strand_id
    WHERE a.id::TEXT = p_application_id
       OR a.application_number = p_application_id
    LIMIT 1
  ) t;

  RETURN COALESCE(v_result, '{}'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION get_admission_detail TO anon, authenticated;

-- Admission wizard: load real class_schedules (AI-published) by strand + grade
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
          'slots', GREATEST(cs.max_slots - COALESCE(cs.enrolled_count, 0), 0),
          'section', sec.name,
          'dayTime', cs.schedule_label
        ) ORDER BY sec.name, cs.schedule_label), '[]'::json)
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN semesters sem ON sem.id = cs.semester_id
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

GRANT EXECUTE ON FUNCTION get_admission_offerings TO anon, authenticated;

-- Backfill profile photo columns from documents JSON for existing applications
UPDATE admission_applications
SET
  profile_photo_upload_path = COALESCE(
    NULLIF(profile_photo_upload_path, ''),
    NULLIF(documents->>'profile_upload', '')
  ),
  profile_photo_camera_path = COALESCE(
    NULLIF(profile_photo_camera_path, ''),
    NULLIF(documents->>'profile_camera', ''),
    NULLIF(documents->>'profile_upload', '')
  )
WHERE documents ? 'profile_upload'
   OR documents ? 'profile_camera';

-- Include schedule fields in pending admissions list (admin review fallback)
CREATE OR REPLACE FUNCTION get_pending_admissions()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        a.id,
        a.application_number AS "applicationNumber",
        a.last_name AS "lastName",
        a.first_name AS "firstName",
        a.middle_name AS "middleName",
        CONCAT(a.last_name, ', ', a.first_name, ' ', COALESCE(a.middle_name, '')) AS student,
        TO_CHAR(a.birthdate, 'YYYY-MM-DD') AS birthdate,
        a.gender,
        COALESCE(
          NULLIF(TRIM(a.address), ''),
          NULLIF(TRIM(CONCAT_WS(', ',
            NULLIF(a.addr_house_number, ''),
            NULLIF(a.addr_street, ''),
            NULLIF(a.addr_barangay, ''),
            NULLIF(a.addr_city, ''),
            NULLIF(a.addr_province, '')
          )), '')
        ) AS address,
        a.addr_house_number AS "houseNumber",
        a.addr_street AS "street",
        a.addr_barangay AS "barangay",
        a.addr_city AS "city",
        a.addr_province AS "province",
        a.email,
        a.contact_number AS "contactNumber",
        str.code AS "strandCode",
        a.grade_level AS "gradeLevel",
        a.admission_type AS "admissionType",
        a.previous_school AS "previousSchool",
        a.payment_mode AS "paymentMode",
        a.gcash_reference AS "gcashReference",
        a.gcash_sender_name AS "gcashSenderName",
        a.gcash_proof_path AS "gcashProofPath",
        a.bank_code AS "bankCode",
        a.bank_reference AS "bankReference",
        a.bank_sender_name AS "bankSenderName",
        a.bank_proof_path AS "bankProofPath",
        a.payment_amount AS "paymentAmount",
        a.payment_status AS "paymentStatus",
        a.status,
        TO_CHAR(a.created_at, 'YYYY-MM-DD') AS date,
        TO_CHAR(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "submittedAt",
        a.doc_form_138_path AS "docForm138Path",
        a.doc_form_137_path AS "docForm137Path",
        a.doc_good_moral_path AS "docGoodMoralPath",
        a.doc_birth_certificate_path AS "docBirthCertificatePath",
        a.doc_high_school_diploma_path AS "docHighSchoolDiplomaPath",
        COALESCE(NULLIF(a.profile_photo_upload_path, ''), a.documents->>'profile_upload') AS "profilePhotoUploadPath",
        COALESCE(
          NULLIF(a.profile_photo_camera_path, ''),
          a.documents->>'profile_camera',
          a.documents->>'profile_upload'
        ) AS "profilePhotoCameraPath",
        a.preferred_subject_schedules AS "preferredSubjectSchedules",
        CASE
          WHEN jsonb_typeof(a.documents->'subject_schedule_details') = 'array'
            THEN a.documents->'subject_schedule_details'
          ELSE '[]'::jsonb
        END AS "subjectScheduleDetails",
        COALESCE(
          NULLIF(a.documents, '{}'::jsonb),
          jsonb_strip_nulls(jsonb_build_object(
            'form_138', a.doc_form_138_path,
            'form_137', a.doc_form_137_path,
            'good_moral', a.doc_good_moral_path,
            'birth_certificate', a.doc_birth_certificate_path,
            'high_school_diploma', a.doc_high_school_diploma_path,
            'profile_upload', a.profile_photo_upload_path,
            'profile_camera', a.profile_photo_camera_path,
            'subject_schedule_details', a.documents->'subject_schedule_details'
          ))
        ) AS documents
      FROM admission_applications a
      LEFT JOIN strands str ON str.id = a.strand_id
      WHERE a.status = 'pending'
      ORDER BY a.created_at DESC
    ) t
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_pending_admissions TO anon, authenticated;
