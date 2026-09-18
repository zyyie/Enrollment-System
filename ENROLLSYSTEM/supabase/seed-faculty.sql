-- Fix faculty table + seed default registrar account
-- Run this entire file in Supabase SQL Editor

ALTER TABLE faculty ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'Registrar';

INSERT INTO faculty (
  faculty_id,
  last_name,
  first_name,
  middle_name,
  role,
  department,
  password,
  is_active,
  last_login
)
VALUES (
  'FAC-2026-0001',
  'DELA CRUZ',
  'JUAN',
  'MARTINEZ',
  'Registrar',
  'Registrar Office',
  'faculty123',
  TRUE,
  NOW()
)
ON CONFLICT (faculty_id) DO UPDATE SET
  last_name = EXCLUDED.last_name,
  first_name = EXCLUDED.first_name,
  middle_name = EXCLUDED.middle_name,
  role = EXCLUDED.role,
  department = EXCLUDED.department,
  password = EXCLUDED.password,
  is_active = TRUE,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION authenticate_faculty(
  p_faculty_id TEXT,
  p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  UPDATE faculty
  SET last_login = NOW(), updated_at = NOW()
  WHERE faculty_id = UPPER(TRIM(p_faculty_id))
    AND password = p_password
    AND COALESCE(is_active, TRUE) = TRUE;

  SELECT json_build_object(
    'id', f.faculty_id,
    'supabaseId', f.id,
    'lastName', f.last_name,
    'firstName', f.first_name,
    'middleName', COALESCE(f.middle_name, ''),
    'role', f.role,
    'department', COALESCE(f.department, ''),
    'lastLogin', TO_CHAR(f.last_login, 'Mon DD, YYYY HH12:MI AM')
  )
  INTO result
  FROM faculty f
  WHERE f.faculty_id = UPPER(TRIM(p_faculty_id))
    AND f.password = p_password
    AND COALESCE(f.is_active, TRUE) = TRUE
  LIMIT 1;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION seed_default_faculty()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO faculty (
    faculty_id, last_name, first_name, middle_name, role, department, password, is_active, last_login
  )
  VALUES (
    'FAC-2026-0001', 'DELA CRUZ', 'JUAN', 'MARTINEZ', 'Registrar', 'Registrar Office', 'faculty123', TRUE, NOW()
  )
  ON CONFLICT (faculty_id) DO UPDATE SET
    last_name = EXCLUDED.last_name,
    first_name = EXCLUDED.first_name,
    middle_name = EXCLUDED.middle_name,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    password = EXCLUDED.password,
    is_active = TRUE,
    updated_at = NOW();

  RETURN json_build_object('success', TRUE, 'facultyId', 'FAC-2026-0001');
END;
$$;

GRANT EXECUTE ON FUNCTION authenticate_faculty TO anon, authenticated;
GRANT EXECUTE ON FUNCTION seed_default_faculty TO anon, authenticated;
