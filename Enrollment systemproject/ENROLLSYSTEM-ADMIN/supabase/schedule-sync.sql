-- Schedule sync: save + publish schedules for admin auto-schedule and student portal
-- Run in Supabase SQL Editor (also run seed-enrollment-schedules.sql if enrollment subjects are empty)

ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS sessions_json JSONB;
ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE;

CREATE OR REPLACE FUNCTION parse_schedule_time(p_raw TEXT, p_default TIME DEFAULT TIME '09:00:00')
RETURNS TIME
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_clean TEXT;
  v_match TEXT[];
  v_hour INT;
  v_min INT;
  v_ampm TEXT;
BEGIN
  IF p_raw IS NULL OR TRIM(p_raw) = '' THEN
    RETURN p_default;
  END IF;

  v_clean := LOWER(TRIM(p_raw));

  BEGIN
    RETURN v_clean::TIME;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  v_match := regexp_match(v_clean, '^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$');
  IF v_match IS NOT NULL THEN
    v_hour := v_match[1]::INT;
    v_min := v_match[2]::INT;
    v_ampm := COALESCE(v_match[4], '');
    IF v_ampm = 'pm' AND v_hour < 12 THEN
      v_hour := v_hour + 12;
    ELSIF v_ampm = 'am' AND v_hour = 12 THEN
      v_hour := 0;
    END IF;
    RETURN make_time(v_hour, v_min, 0);
  END IF;

  RETURN p_default;
END;
$$;

CREATE OR REPLACE FUNCTION apply_generated_schedules(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grade_level TEXT;
  v_semester_code TEXT;
  v_semester UUID;
  v_item JSON;
  v_session JSON;
  v_strand UUID;
  v_subject UUID;
  v_section UUID;
  v_room UUID;
  v_schedule UUID;
  v_section_name TEXT;
  v_grade_num TEXT;
  v_day TEXT;
  v_label TEXT;
  v_count INT := 0;
  v_start_time TIME;
  v_end_time TIME;
  v_sessions JSON;
  v_faculty UUID;
BEGIN
  v_grade_level := COALESCE(p_payload->>'gradeLevel', 'Grade 12');
  v_semester_code := COALESCE(p_payload->>'semesterCode', '1st');
  v_grade_num := CASE WHEN v_grade_level LIKE '%11%' THEN '11' ELSE '12' END;

  SELECT id INTO v_semester
  FROM semesters
  WHERE is_current = TRUE
  LIMIT 1;

  IF v_semester IS NULL THEN
    RAISE EXCEPTION 'No active semester configured';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(COALESCE(p_payload->'schedules', '[]'::json))
  LOOP
    SELECT id INTO v_strand FROM strands WHERE code = UPPER(v_item->>'strand') LIMIT 1;
    IF v_strand IS NULL THEN
      RAISE EXCEPTION 'Unknown strand: %', v_item->>'strand';
    END IF;

    v_section_name := UPPER(v_item->>'strand') || ' ' || v_grade_num || '-' || UPPER(v_item->>'section');

    INSERT INTO sections (name, strand_id, grade_level)
    VALUES (v_section_name, v_strand, v_grade_level)
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_section FROM sections WHERE name = v_section_name LIMIT 1;

    SELECT id INTO v_subject FROM subjects WHERE code = v_item->>'subject_code' LIMIT 1;
    IF v_subject IS NULL THEN
      INSERT INTO subjects (code, name, strand_id, grade_level, semester_code, lec_hours, lab_hours, units)
      VALUES (
        v_item->>'subject_code',
        COALESCE(v_item->>'subject_name', v_item->>'subject_code'),
        CASE WHEN v_item->>'strand' IS NULL THEN NULL ELSE v_strand END,
        v_grade_level,
        v_semester_code,
        3, 0, 3
      )
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id INTO v_subject;
    END IF;

    v_label := COALESCE(v_item->>'schedule_label', 'TBA');
    v_sessions := COALESCE(v_item->'sessions', '[]'::json);
    v_day := 'MW';
    v_start_time := TIME '09:00:00';
    v_end_time := TIME '10:30:00';

    IF json_array_length(v_sessions) > 0 THEN
      SELECT string_agg(DISTINCT s->>'day', ', ' ORDER BY s->>'day')
      INTO v_day
      FROM json_array_elements(v_sessions) s;

      v_session := v_sessions->0;
      v_start_time := parse_schedule_time(v_session->>'start', TIME '09:00:00');
      v_end_time := parse_schedule_time(v_session->>'end', v_start_time + INTERVAL '90 minutes');
    END IF;

    IF v_end_time IS NULL OR v_end_time <= v_start_time THEN
      v_end_time := v_start_time + INTERVAL '90 minutes';
    END IF;

    SELECT id INTO v_room
    FROM rooms
    WHERE UPPER(name) = UPPER(COALESCE(v_item->'sessions'->0->>'room', ''))
    LIMIT 1;

    IF v_room IS NULL AND json_array_length(COALESCE(v_sessions, '[]'::json)) > 0 THEN
      INSERT INTO rooms (name, capacity, room_type)
      VALUES (UPPER(v_item->'sessions'->0->>'room'), 40, 'classroom')
      ON CONFLICT (name) DO NOTHING
      RETURNING id INTO v_room;
      IF v_room IS NULL THEN
        SELECT id INTO v_room FROM rooms WHERE UPPER(name) = UPPER(v_item->'sessions'->0->>'room') LIMIT 1;
      END IF;
    END IF;

    v_faculty := NULL;
    IF COALESCE(v_item->>'faculty_id', '') <> '' THEN
      SELECT id INTO v_faculty
      FROM faculty
      WHERE faculty_id = UPPER(TRIM(v_item->>'faculty_id'))
      LIMIT 1;
    END IF;

    DELETE FROM class_schedules
    WHERE subject_id = v_subject
      AND section_id = v_section
      AND semester_id = v_semester;

    INSERT INTO class_schedules (
      subject_id,
      section_id,
      semester_id,
      faculty_id,
      room_id,
      day_of_week,
      start_time,
      end_time,
      schedule_label,
      sessions_json,
      max_slots,
      is_published
    )
    VALUES (
      v_subject,
      v_section,
      v_semester,
      v_faculty,
      v_room,
      COALESCE(v_day, 'MW'),
      v_start_time,
      v_end_time,
      v_label,
      v_sessions,
      40,
      TRUE
    )
    RETURNING id INTO v_schedule;

    v_count := v_count + 1;
  END LOOP;

  RETURN json_build_object(
    'success', TRUE,
    'applied', v_count,
    'semesterId', v_semester,
    'gradeLevel', v_grade_level,
    'semesterCode', v_semester_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_scheduler_existing_schedules(
  p_grade_level TEXT DEFAULT 'Grade 12',
  p_semester_code TEXT DEFAULT '1st',
  p_exclude_strand TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT COALESCE(json_agg(row_data ORDER BY row_data->>'strand', row_data->>'section', row_data->>'subject_code'), '[]'::json)
  INTO result
  FROM (
    SELECT json_build_object(
      'strand', st.code,
      'section', UPPER(SPLIT_PART(SPLIT_PART(sec.name, '-', 2), ' ', 1)),
      'subject_code', sub.code,
      'subject_name', sub.name,
      'faculty_id', f.faculty_id,
      'faculty_name', TRIM(COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, '')),
      'schedule_label', cs.schedule_label,
      'sessions', COALESCE(
        cs.sessions_json,
        CASE
          WHEN cs.room_id IS NOT NULL THEN
            json_build_array(json_build_object(
              'day', SPLIT_PART(cs.day_of_week, ',', 1),
              'start', COALESCE(TO_CHAR(cs.start_time, 'HH12:MIam'), '8:00am'),
              'end', COALESCE(TO_CHAR(cs.end_time, 'HH12:MIam'), '9:00am'),
              'room', r.name
            ))
          ELSE '[]'::json
        END
      )
    ) AS row_data
    FROM class_schedules cs
    JOIN sections sec ON sec.id = cs.section_id
    JOIN strands st ON st.id = sec.strand_id
    JOIN subjects sub ON sub.id = cs.subject_id
    JOIN semesters sem ON sem.id = cs.semester_id
    LEFT JOIN rooms r ON r.id = cs.room_id
    LEFT JOIN faculty f ON f.id = cs.faculty_id
    WHERE cs.is_active = TRUE
      AND sec.grade_level = p_grade_level
      AND sem.is_current = TRUE
      AND (p_exclude_strand IS NULL OR st.code <> UPPER(TRIM(p_exclude_strand)))
  ) rows;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION get_student_strand_schedule(p_student_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_strand_id UUID;
  v_grade_level TEXT;
  v_section_id UUID;
  v_section_name TEXT;
  result JSON;
BEGIN
  SELECT s.strand_id, s.grade_level, s.section_id, sec.name
  INTO v_strand_id, v_grade_level, v_section_id, v_section_name
  FROM students s
  LEFT JOIN sections sec ON sec.id = s.section_id
  WHERE s.student_id = UPPER(TRIM(p_student_id))
  LIMIT 1;

  IF v_strand_id IS NULL OR v_grade_level IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT COALESCE(json_agg(row_data ORDER BY row_data->>'code'), '[]'::json)
  INTO result
  FROM (
    SELECT json_build_object(
      'code', sub.code,
      'description', sub.name,
      'lec', sub.lec_hours,
      'lab', sub.lab_hours,
      'unit', sub.units,
      'section', sec.name,
      'schedule', CASE
        WHEN cs.sessions_json IS NOT NULL AND json_array_length(cs.sessions_json) > 0 THEN
          (
            SELECT string_agg(
              (s->>'day') || ' ' || (s->>'start') || '-' || (s->>'end') || ' @ ' || (s->>'room'),
              ' · '
            )
            FROM json_array_elements(cs.sessions_json) s
          )
        ELSE
          COALESCE(cs.schedule_label, 'TBA') ||
          CASE WHEN r.name IS NOT NULL THEN ' @ ' || r.name ELSE '' END
      END
    ) AS row_data
    FROM class_schedules cs
    JOIN sections sec ON sec.id = cs.section_id
    JOIN subjects sub ON sub.id = cs.subject_id
    JOIN semesters sem ON sem.id = cs.semester_id
    LEFT JOIN rooms r ON r.id = cs.room_id
    WHERE cs.is_active = TRUE
      AND sem.is_current = TRUE
      AND sec.strand_id = v_strand_id
      AND sec.grade_level = v_grade_level
      AND (v_section_id IS NULL OR sec.id = v_section_id)
  ) rows;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION publish_schedules(p_payload JSON)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grade_level TEXT;
  v_semester UUID;
  v_count INT := 0;
BEGIN
  v_grade_level := COALESCE(p_payload->>'gradeLevel', 'Grade 12');

  SELECT id INTO v_semester
  FROM semesters
  WHERE is_current = TRUE
  LIMIT 1;

  IF v_semester IS NULL THEN
    RAISE EXCEPTION 'No active semester configured';
  END IF;

  UPDATE class_schedules cs
  SET is_published = TRUE
  FROM sections sec
  WHERE cs.section_id = sec.id
    AND cs.semester_id = v_semester
    AND sec.grade_level = v_grade_level
    AND cs.is_active = TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN json_build_object(
    'success', TRUE,
    'published', v_count,
    'gradeLevel', v_grade_level,
    'semesterId', v_semester,
    'message', 'Schedule published to students, teachers, and registrar.'
  );
END;
$$;

-- Repair rows missing times (from older failed saves)
UPDATE class_schedules
SET
  start_time = COALESCE(start_time, TIME '09:00:00'),
  end_time = COALESCE(end_time, TIME '10:30:00'),
  is_published = COALESCE(is_published, TRUE)
WHERE start_time IS NULL OR end_time IS NULL;

GRANT EXECUTE ON FUNCTION parse_schedule_time TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION apply_generated_schedules TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION publish_schedules TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_scheduler_existing_schedules TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_student_strand_schedule TO anon, authenticated, service_role;
