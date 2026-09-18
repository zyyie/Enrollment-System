  -- Deploy get_admission_offerings for the admission wizard (Step 5 schedules)
  -- Run ONCE in Supabase SQL Editor if applicants see "No published schedules found"
  -- even after Admin → Auto Schedule → Save & Publish.
  --
  -- Full fix bundle (submit + admin detail + offerings): fix-admission-submit.sql

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
