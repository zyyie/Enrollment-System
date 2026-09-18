-- Faculty grades: student list by grade level (Grade 11 / Grade 12)
-- Run once in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION get_students_for_grading(
  p_grade_level TEXT DEFAULT NULL,
  p_strand_code TEXT DEFAULT NULL
)
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
        st.student_id AS "studentId",
        CONCAT(st.last_name, ', ', st.first_name) AS student,
        st.grade_level AS "gradeLevel",
        str.code AS strand,
        e.id AS "enrollmentId",
        sem.name AS semester
      FROM enrollments e
      JOIN students st ON st.id = e.student_id
      LEFT JOIN strands str ON str.id = st.strand_id
      JOIN semesters sem ON sem.id = e.semester_id
      WHERE e.status IN ('enrolled', 'approved', 'pending')
        AND sem.is_current = TRUE
        AND COALESCE(st.is_active, TRUE) = TRUE
        AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
        AND (p_grade_level IS NULL OR st.grade_level = p_grade_level)
        AND (p_strand_code IS NULL OR str.code = UPPER(TRIM(p_strand_code)))
      ORDER BY st.last_name, st.first_name
    ) t
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_teacher_students_for_grading(
  p_faculty_id TEXT,
  p_grade_level TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_faculty UUID;
BEGIN
  SELECT id INTO v_faculty
  FROM faculty
  WHERE faculty_id = UPPER(TRIM(COALESCE(p_faculty_id, '')))
  LIMIT 1;

  IF v_faculty IS NULL THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        st.student_id AS "studentId",
        CONCAT(st.last_name, ', ', st.first_name) AS student,
        st.grade_level AS "gradeLevel",
        str.code AS strand,
        e.id AS "enrollmentId",
        sem.name AS semester
      FROM enrollments e
      JOIN students st ON st.id = e.student_id
      LEFT JOIN strands str ON str.id = st.strand_id
      JOIN semesters sem ON sem.id = e.semester_id
      WHERE sem.is_current = TRUE
        AND e.status IN ('enrolled', 'approved', 'pending')
        AND COALESCE(st.is_active, TRUE) = TRUE
        AND COALESCE(st.account_status, 'active') NOT IN ('inactive', 'frozen', 'deleted')
        AND (p_grade_level IS NULL OR st.grade_level = p_grade_level)
        AND (
          EXISTS (
            SELECT 1
            FROM enrollment_subjects es
            JOIN class_schedules cs ON cs.id = es.class_schedule_id
            WHERE es.enrollment_id = e.id
              AND cs.faculty_id = v_faculty
              AND cs.is_active = TRUE
              AND COALESCE(es.status, 'enrolled') = 'enrolled'
          )
          OR (
            st.strand_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM faculty_strands fs
              WHERE fs.faculty_id = v_faculty
                AND fs.strand_id = st.strand_id
            )
          )
        )
      ORDER BY st.last_name, st.first_name
    ) t
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_students_for_grading TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_teacher_students_for_grading TO anon, authenticated, service_role;
