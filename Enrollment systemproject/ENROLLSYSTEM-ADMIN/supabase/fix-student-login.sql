-- Fix student login after admission approval
-- Run in Supabase SQL Editor
-- Fixes: Invalid Student ID / birthdate / password after Gmail approval email

-- Ensure students table has login columns
ALTER TABLE students ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS birthdate DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS grade_level TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS strand_id UUID;
ALTER TABLE students ADD COLUMN IF NOT EXISTS track TEXT DEFAULT 'Academic';
ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_status TEXT DEFAULT 'enrolled';
ALTER TABLE students ADD COLUMN IF NOT EXISTS scholastic_status TEXT DEFAULT 'Regular';

UPDATE students SET is_active = TRUE WHERE is_active IS NULL;

-- Sync password from approved admissions if student row is missing password
UPDATE students s
SET password = a.temp_password
FROM admission_applications a
WHERE a.status = 'approved'
  AND UPPER(a.student_id_generated) = UPPER(s.student_id)
  AND a.temp_password IS NOT NULL
  AND (s.password IS NULL OR TRIM(s.password) = '');

CREATE OR REPLACE FUNCTION authenticate_student(
  p_student_id TEXT,
  p_birth_month INT,
  p_birth_day INT,
  p_birth_year INT,
  p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
  v_password TEXT := TRIM(p_password);
  v_student_id TEXT := UPPER(TRIM(p_student_id));
BEGIN
  IF v_student_id = '' OR v_password = '' THEN
    RETURN NULL;
  END IF;

  -- 1) Primary: students table (created on approve)
  SELECT json_build_object(
    'id', s.student_id,
    'supabaseId', s.id,
    'lastName', s.last_name,
    'firstName', s.first_name,
    'middleName', COALESCE(s.middle_name, ''),
    'birthMonth', EXTRACT(MONTH FROM s.birthdate)::TEXT,
    'birthDay', EXTRACT(DAY FROM s.birthdate)::TEXT,
    'birthYear', EXTRACT(YEAR FROM s.birthdate)::TEXT,
    'gradeLevel', s.grade_level,
    'strand', COALESCE(st.code, 'GAS'),
    'strandFull', COALESCE(st.name, st.code, 'GAS'),
    'section', COALESCE(sec.name, ''),
    'track', COALESCE(s.track, 'Academic'),
    'admissionStatus', COALESCE(s.admission_status, 'approved'),
    'scholasticStatus', COALESCE(s.scholastic_status, 'Regular'),
    'schoolYear', COALESCE(sy.label, '2026-2027'),
    'semester', COALESCE(sem.name, 'First Semester'),
    'voucherQualified', COALESCE(s.voucher_qualified, FALSE)
  )
  INTO result
  FROM students s
  LEFT JOIN strands st ON st.id = s.strand_id
  LEFT JOIN sections sec ON sec.id = s.section_id
  LEFT JOIN semesters sem ON sem.is_current = TRUE
  LEFT JOIN school_years sy ON sy.id = sem.school_year_id
  WHERE UPPER(s.student_id) = v_student_id
    AND TRIM(s.password) = v_password
    AND EXTRACT(MONTH FROM s.birthdate) = p_birth_month
    AND EXTRACT(DAY FROM s.birthdate) = p_birth_day
    AND EXTRACT(YEAR FROM s.birthdate) = p_birth_year
    AND COALESCE(s.is_active, TRUE) = TRUE
  LIMIT 1;

  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  -- 2) Fallback: approved admission (Gmail credentials stored here on approve)
  SELECT json_build_object(
    'id', a.student_id_generated,
    'supabaseId', NULL,
    'lastName', a.last_name,
    'firstName', a.first_name,
    'middleName', COALESCE(a.middle_name, ''),
    'birthMonth', EXTRACT(MONTH FROM a.birthdate)::TEXT,
    'birthDay', EXTRACT(DAY FROM a.birthdate)::TEXT,
    'birthYear', EXTRACT(YEAR FROM a.birthdate)::TEXT,
    'gradeLevel', a.grade_level,
    'strand', COALESCE(st.code, 'GAS'),
    'strandFull', COALESCE(st.name, st.code, 'GAS'),
    'section', '',
    'track', 'Academic',
    'admissionStatus', 'approved',
    'scholasticStatus', 'Regular',
    'schoolYear', '2026-2027',
    'semester', 'First Semester',
    'voucherQualified', FALSE
  )
  INTO result
  FROM admission_applications a
  LEFT JOIN strands st ON st.id = a.strand_id
  WHERE a.status = 'approved'
    AND UPPER(a.student_id_generated) = v_student_id
    AND TRIM(a.temp_password) = v_password
    AND EXTRACT(MONTH FROM a.birthdate) = p_birth_month
    AND EXTRACT(DAY FROM a.birthdate) = p_birth_day
    AND EXTRACT(YEAR FROM a.birthdate) = p_birth_year
  LIMIT 1;

  IF result IS NOT NULL THEN
    -- Sync student row so future logins use students table
    INSERT INTO students (
      student_id, last_name, first_name, middle_name, birthdate, password,
      gender, address, contact_number, admission_type, admission_status,
      grade_level, strand_id, scholastic_status, track, is_active
    )
    SELECT
      a.student_id_generated, a.last_name, a.first_name, a.middle_name,
      a.birthdate, a.temp_password, a.gender, a.address, a.contact_number,
      COALESCE(a.admission_type, 'new'), 'approved', a.grade_level, a.strand_id,
      'Regular', 'Academic', TRUE
    FROM admission_applications a
    WHERE a.status = 'approved'
      AND UPPER(a.student_id_generated) = v_student_id
    ON CONFLICT (student_id) DO UPDATE SET
      password = EXCLUDED.password,
      birthdate = EXCLUDED.birthdate,
      is_active = TRUE,
      updated_at = NOW();
  END IF;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION authenticate_student TO anon, authenticated;
