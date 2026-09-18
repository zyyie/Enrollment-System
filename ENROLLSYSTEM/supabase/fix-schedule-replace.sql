-- Fix: Save & Publish new schedules when students already enrolled
-- Run ONCE in Supabase SQL Editor.
--
-- Error fixed:
--   update or delete on table "class_schedules" violates foreign key constraint
--   "enrollment_subjects_class_schedule_id_fkey"
--
-- Cause: apply_generated_schedules deleted old rows before insert. Enrolled students
-- still reference those schedule IDs in enrollment_subjects.
--
-- Fix: update existing class_schedules in place (same UUID) instead of delete+insert.

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

    v_section_name := build_section_name(v_item->>'strand', v_grade_level, v_item->>'section');

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

    SELECT cs.id INTO v_schedule
    FROM class_schedules cs
    WHERE cs.subject_id = v_subject
      AND cs.section_id = v_section
      AND cs.semester_id = v_semester
    ORDER BY
      EXISTS (
        SELECT 1 FROM enrollment_subjects es
        WHERE es.class_schedule_id = cs.id
      ) DESC,
      COALESCE(cs.is_active, TRUE) DESC,
      cs.created_at DESC NULLS LAST
    LIMIT 1;

    IF v_schedule IS NOT NULL THEN
      UPDATE class_schedules
      SET
        faculty_id = v_faculty,
        room_id = v_room,
        day_of_week = COALESCE(v_day, 'MW'),
        start_time = v_start_time,
        end_time = v_end_time,
        schedule_label = v_label,
        sessions_json = v_sessions,
        max_slots = COALESCE(max_slots, 40),
        is_published = TRUE,
        is_active = TRUE,
        updated_at = NOW()
      WHERE id = v_schedule;

      UPDATE enrollment_subjects
      SET schedule_label = v_label
      WHERE class_schedule_id = v_schedule;

      UPDATE class_schedules
      SET is_active = FALSE, updated_at = NOW()
      WHERE subject_id = v_subject
        AND section_id = v_section
        AND semester_id = v_semester
        AND id <> v_schedule
        AND NOT EXISTS (
          SELECT 1 FROM enrollment_subjects es
          WHERE es.class_schedule_id = class_schedules.id
        );
    ELSE
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
    END IF;

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

GRANT EXECUTE ON FUNCTION apply_generated_schedules TO anon, authenticated, service_role;
