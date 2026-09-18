-- Same as fix-admission-submit.sql — run in Supabase SQL Editor if submit fails.
-- Fixes: profile photos, subject schedules, bank payment, submit_admission_application RPC.

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
