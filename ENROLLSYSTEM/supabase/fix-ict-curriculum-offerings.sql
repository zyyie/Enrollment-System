-- Fix wrong / duplicate subjects in admission & enrollment offerings (e.g. ICT G11 1st Sem)
-- Run ONCE in Supabase SQL Editor.
-- Requires: section-quota.sql (for section_scheduled_count) — skip if already run.
--
-- Cause: old seed data (CORE-01, CORE-02, GAS-01, etc.) is still active and
-- ensure_enrollment_schedules attached them to ICT sections alongside the real
-- G11-* curriculum codes.

-- 1) Deactivate legacy non-curriculum subject codes
UPDATE subjects
SET is_active = FALSE,
    updated_at = NOW()
WHERE code !~ '^(G11|G12)-'
   OR code IN (
     'CORE-01', 'CORE-02', 'CORE-03', 'CORE-04',
     'GAS-01', 'APPL-02', 'PE-04', 'WORK-01'
   );

-- 2) Ensure official semester assignment (from SHS curriculum)
UPDATE subjects SET semester_code = '1st' WHERE code IN (
  'G11-A01', 'G11-ABM-01', 'G11-ABM-02', 'G11-C01', 'G11-C02', 'G11-C03', 'G11-C04', 'G11-C05',
  'G11-CK-01', 'G11-CK-02', 'G11-CK-03', 'G11-CK-04',
  'G11-EIM-01', 'G11-EIM-02', 'G11-EIM-03', 'G11-EIM-04',
  'G11-HUM-01', 'G11-HUM-02', 'G11-HUM-03',
  'G11-ICT-01', 'G11-ICT-02', 'G11-PE1',
  'G11-STEM-01', 'G11-STEM-02', 'G11-STEM-03'
);
UPDATE subjects SET semester_code = '2nd' WHERE code IN (
  'G11-A02', 'G11-ABM-03', 'G11-ABM-04', 'G11-C06', 'G11-C07', 'G11-C08', 'G11-C09', 'G11-C10',
  'G11-CK-05', 'G11-CK-06', 'G11-CK-07', 'G11-CK-08', 'G11-CK-09', 'G11-CK-10', 'G11-CK-11',
  'G11-EIM-05', 'G11-EIM-06', 'G11-EIM-07',
  'G11-HUM-04', 'G11-HUM-05', 'G11-HUM-06',
  'G11-ICT-03', 'G11-ICT-04', 'G11-PE2',
  'G11-STEM-04', 'G11-STEM-05', 'G11-STEM-06'
);
UPDATE subjects SET semester_code = '1st' WHERE code IN (
  'G12-A01', 'G12-A02', 'G12-A03', 'G12-ABM-01', 'G12-ABM-02', 'G12-C01', 'G12-C02',
  'G12-CK-01', 'G12-CK-02', 'G12-CK-03', 'G12-CK-04',
  'G12-EIM-01', 'G12-EIM-02', 'G12-EIM-03', 'G12-HUM-01',
  'G12-ICT-01', 'G12-ICT-02', 'G12-PE3', 'G12-STEM-01', 'G12-STEM-02'
);
UPDATE subjects SET semester_code = '2nd' WHERE code IN (
  'G12-A04', 'G12-A05', 'G12-A06', 'G12-ABM-03', 'G12-ABM-04', 'G12-C03',
  'G12-CK-05', 'G12-CK-06', 'G12-CK-07', 'G12-CK-08',
  'G12-EIM-04', 'G12-EIM-05', 'G12-HUM-02',
  'G12-ICT-03', 'G12-ICT-04', 'G12-PE4', 'G12-STEM-03', 'G12-STEM-04'
);

-- 3) Hide schedules for deactivated / wrong-semester subjects
UPDATE class_schedules cs
SET is_active = FALSE, updated_at = NOW()
FROM subjects sub, semesters sem
WHERE cs.subject_id = sub.id
  AND cs.semester_id = sem.id
  AND sem.is_current = TRUE
  AND (
    sub.is_active = FALSE
    OR sub.code !~ '^(G11|G12)-'
    OR sub.semester_code IS DISTINCT FROM sem.code
  );

-- 4) Only seed placeholder schedules for official curriculum codes
CREATE OR REPLACE FUNCTION ensure_enrollment_schedules(
  p_strand_id UUID,
  p_grade_level TEXT,
  p_semester_code TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_semester UUID;
  v_semester_code TEXT;
  v_section UUID;
  v_section_name TEXT;
  v_grade_num TEXT;
  v_inserted INT := 0;
BEGIN
  IF p_strand_id IS NULL OR p_grade_level IS NULL THEN
    RETURN 0;
  END IF;

  SELECT id, code INTO v_semester, v_semester_code
  FROM semesters
  WHERE is_current = TRUE
  LIMIT 1;

  IF v_semester IS NULL THEN
    RETURN 0;
  END IF;

  v_semester_code := COALESCE(NULLIF(TRIM(p_semester_code), ''), v_semester_code, '1st');
  v_grade_num := CASE WHEN p_grade_level LIKE '%11%' THEN '11' ELSE '12' END;

  SELECT build_section_name(code, p_grade_level, 'A')
  INTO v_section_name
  FROM strands
  WHERE id = p_strand_id;

  INSERT INTO sections (name, strand_id, grade_level)
  VALUES (v_section_name, p_strand_id, p_grade_level)
  ON CONFLICT (name, strand_id, grade_level) DO NOTHING;

  SELECT id INTO v_section
  FROM sections
  WHERE name = v_section_name
    AND strand_id = p_strand_id
    AND grade_level = p_grade_level
  LIMIT 1;

  IF v_section IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO class_schedules (
    subject_id, section_id, semester_id, schedule_label, day_of_week,
    start_time, end_time, max_slots, is_active, is_published
  )
  SELECT sub.id, v_section, v_semester, 'MW 9:00AM-10:30AM', 'MW',
    TIME '09:00:00', TIME '10:30:00', 40, TRUE, TRUE
  FROM subjects sub
  WHERE sub.is_active = TRUE
    AND sub.code ~ '^(G11|G12)-'
    AND sub.grade_level = p_grade_level
    AND sub.semester_code = v_semester_code
    AND (sub.strand_id IS NULL OR sub.strand_id = p_strand_id)
    AND NOT EXISTS (
      SELECT 1
      FROM class_schedules cs
      WHERE cs.subject_id = sub.id
        AND cs.section_id = v_section
        AND cs.semester_id = v_semester
        AND COALESCE(cs.is_active, TRUE) = TRUE
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

-- 5) Admission offerings: official curriculum only, exact semester match
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
          AND sem.code = v_semester_code
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
    ) AS subject_row
    FROM subjects sub
    LEFT JOIN strands str_sub ON str_sub.id = sub.strand_id
    WHERE sub.is_active = TRUE
      AND sub.code ~ '^(G11|G12)-'
      AND sub.grade_level = v_grade_level
      AND sub.semester_code = v_semester_code
      AND (sub.strand_id IS NULL OR sub.strand_id = v_strand_id)
      AND EXISTS (
        SELECT 1
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sem.code = v_semester_code
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
  ) offerings;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 6) Enrollment offerings: same curriculum filter
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
          AND sem.code = v_semester_code
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
    ) AS subject_row
    FROM subjects sub
    LEFT JOIN strands str_sub ON str_sub.id = sub.strand_id
    WHERE sub.is_active = TRUE
      AND sub.code ~ '^(G11|G12)-'
      AND v_strand_id IS NOT NULL
      AND sub.grade_level = v_grade_level
      AND sub.semester_code = v_semester_code
      AND (sub.strand_id IS NULL OR sub.strand_id = v_strand_id)
      AND EXISTS (
        SELECT 1
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sem.code = v_semester_code
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
      )
  ) offerings;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_enrollment_schedules TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_admission_offerings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_enrollment_offerings TO anon, authenticated;
