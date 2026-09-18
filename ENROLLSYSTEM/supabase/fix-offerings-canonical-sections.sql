-- Drop legacy section schedules from enrollment/admission dropdowns.
-- Keeps only the two named slots per strand (e.g. ICT 11-Wisdom, ICT 11-Compassion).
-- Run section-names.sql first if section_slot_name is missing.

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
          'slots', GREATEST(cs.max_slots - COALESCE(cs.enrolled_count, 0), 0),
          'section', sec.name,
          'dayTime', cs.schedule_label
        ) ORDER BY
          CASE WHEN v_section_id IS NOT NULL AND sec.id = v_section_id THEN 0 ELSE 1 END,
          sec.name
        ), '[]'::json)
        FROM class_schedules cs
        JOIN sections sec ON sec.id = cs.section_id
        JOIN strands st ON st.id = sec.strand_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
          AND (
            TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'A')
            OR TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'B')
          )
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
        JOIN strands st ON st.id = sec.strand_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
          AND (
            TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'A')
            OR TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'B')
          )
      )
  ) offerings;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

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
        JOIN strands st ON st.id = sec.strand_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
          AND (
            TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'A')
            OR TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'B')
          )
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
        JOIN strands st ON st.id = sec.strand_id
        JOIN semesters sem ON sem.id = cs.semester_id
        WHERE cs.subject_id = sub.id
          AND COALESCE(cs.is_active, TRUE) = TRUE
          AND sem.is_current = TRUE
          AND sec.strand_id = v_strand_id
          AND sec.grade_level = v_grade_level
          AND (
            TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'A')
            OR TRIM(SPLIT_PART(sec.name, '-', 2)) = section_slot_name(st.code, sec.grade_level, 'B')
          )
      )
  ) offerings;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Deactivate schedules tied to legacy Section A/B rows (e.g. ICT 11-A)
UPDATE class_schedules cs
SET is_active = FALSE
FROM sections sec
JOIN strands st ON st.id = sec.strand_id
WHERE cs.section_id = sec.id
  AND cs.is_active = TRUE
  AND TRIM(SPLIT_PART(sec.name, '-', 2)) NOT IN (
    section_slot_name(st.code, sec.grade_level, 'A'),
    section_slot_name(st.code, sec.grade_level, 'B')
  )
  AND TRIM(SPLIT_PART(sec.name, '-', 2)) ~ '^(A|B)$';

GRANT EXECUTE ON FUNCTION get_enrollment_offerings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_admission_offerings TO anon, authenticated;
