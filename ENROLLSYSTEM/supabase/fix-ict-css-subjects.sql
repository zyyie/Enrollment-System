-- Restore ICT strand subjects to official CSS NC II curriculum (ICT = CSS)
-- Run ONCE in Supabase SQL Editor.
--
-- Problem: seed-professors-subjects.sql overwrote G11-ICT-01/02 with
-- "Computer Programming 1" instead of the CSS NC II titles from your curriculum.

-- Deactivate legacy wrong ICT subject codes
UPDATE subjects
SET is_active = FALSE, updated_at = NOW()
WHERE code IN ('ICT-G12', 'ICT-02', 'ICT-03', 'ICT-01')
   OR (code LIKE 'ICT-%' AND code !~ '^G1[12]-ICT-');

-- Grade 11 — 1st Sem (CSS specialized)
UPDATE subjects SET
  name = 'CSS NC II – Install and Configure Computer Systems',
  description = 'CSS NC II – Install and Configure Computer Systems',
  grade_level = 'Grade 11',
  lec_hours = 3, lab_hours = 1, units = 4,
  semester_code = '1st',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G11-ICT-01';

UPDATE subjects SET
  name = 'CSS NC II – Set Up Computer Networks',
  description = 'CSS NC II – Set Up Computer Networks',
  grade_level = 'Grade 11',
  lec_hours = 3, lab_hours = 1, units = 4,
  semester_code = '1st',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G11-ICT-02';

-- Grade 11 — 2nd Sem
UPDATE subjects SET
  name = 'CSS NC II – Install Computer Systems and Networks',
  description = 'CSS NC II – Install Computer Systems and Networks',
  grade_level = 'Grade 11',
  lec_hours = 3, lab_hours = 1, units = 4,
  semester_code = '2nd',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G11-ICT-03';

UPDATE subjects SET
  name = 'CSS NC II – Maintain and Repair Computer Systems and Networks',
  description = 'CSS NC II – Maintain and Repair Computer Systems and Networks',
  grade_level = 'Grade 11',
  lec_hours = 3, lab_hours = 1, units = 4,
  semester_code = '2nd',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G11-ICT-04';

-- Grade 12 — 1st Sem
UPDATE subjects SET
  name = 'CSS NC II – Diagnose and Troubleshoot Computer Systems',
  description = 'CSS NC II – Diagnose and Troubleshoot Computer Systems',
  grade_level = 'Grade 12',
  lec_hours = 3, lab_hours = 1, units = 4,
  semester_code = '1st',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G12-ICT-01';

UPDATE subjects SET
  name = 'CSS NC II – Configure Network Services',
  description = 'CSS NC II – Configure Network Services',
  grade_level = 'Grade 12',
  lec_hours = 3, lab_hours = 1, units = 4,
  semester_code = '1st',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G12-ICT-02';

-- Grade 12 — 2nd Sem
UPDATE subjects SET
  name = 'Work Immersion',
  description = 'Work Immersion',
  grade_level = 'Grade 12',
  lec_hours = 3, lab_hours = 0, units = 3,
  semester_code = '2nd',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G12-ICT-03';

UPDATE subjects SET
  name = 'Specialization Enhancement / Entrepreneurship Integration',
  description = 'Specialization Enhancement / Entrepreneurship Integration',
  grade_level = 'Grade 12',
  lec_hours = 3, lab_hours = 0, units = 3,
  semester_code = '2nd',
  is_active = TRUE,
  updated_at = NOW()
WHERE code = 'G12-ICT-04';

-- Ensure ICT strand_id is set on all G11/G12-ICT subjects
UPDATE subjects sub
SET strand_id = s.id, updated_at = NOW()
FROM strands s
WHERE s.code = 'ICT'
  AND sub.code ~ '^G1[12]-ICT-'
  AND sub.strand_id IS DISTINCT FROM s.id;

-- Hide schedules tied to deactivated legacy ICT subjects
UPDATE class_schedules cs
SET is_active = FALSE, updated_at = NOW()
FROM subjects sub
WHERE cs.subject_id = sub.id
  AND sub.is_active = FALSE;

-- Insert missing CSS subjects if seed-shs-curriculum was never run
INSERT INTO subjects (code, name, description, strand_id, grade_level, lec_hours, lab_hours, units, semester_code, is_active)
SELECT v.code, v.name, v.description, s.id, v.grade_level, v.lec, v.lab, v.units, v.semester_code, TRUE
FROM strands s,
(VALUES
  ('G11-ICT-01', 'CSS NC II – Install and Configure Computer Systems', 'CSS NC II – Install and Configure Computer Systems', 'Grade 11', 3, 1, 4, '1st'),
  ('G11-ICT-02', 'CSS NC II – Set Up Computer Networks', 'CSS NC II – Set Up Computer Networks', 'Grade 11', 3, 1, 4, '1st'),
  ('G11-ICT-03', 'CSS NC II – Install Computer Systems and Networks', 'CSS NC II – Install Computer Systems and Networks', 'Grade 11', 3, 1, 4, '2nd'),
  ('G11-ICT-04', 'CSS NC II – Maintain and Repair Computer Systems and Networks', 'CSS NC II – Maintain and Repair Computer Systems and Networks', 'Grade 11', 3, 1, 4, '2nd'),
  ('G12-ICT-01', 'CSS NC II – Diagnose and Troubleshoot Computer Systems', 'CSS NC II – Diagnose and Troubleshoot Computer Systems', 'Grade 12', 3, 1, 4, '1st'),
  ('G12-ICT-02', 'CSS NC II – Configure Network Services', 'CSS NC II – Configure Network Services', 'Grade 12', 3, 1, 4, '1st'),
  ('G12-ICT-03', 'Work Immersion', 'Work Immersion', 'Grade 12', 3, 0, 3, '2nd'),
  ('G12-ICT-04', 'Specialization Enhancement / Entrepreneurship Integration', 'Specialization Enhancement / Entrepreneurship Integration', 'Grade 12', 3, 0, 3, '2nd')
) AS v(code, name, description, grade_level, lec, lab, units, semester_code)
WHERE s.code = 'ICT'
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  strand_id = EXCLUDED.strand_id,
  grade_level = EXCLUDED.grade_level,
  lec_hours = EXCLUDED.lec_hours,
  lab_hours = EXCLUDED.lab_hours,
  units = EXCLUDED.units,
  semester_code = EXCLUDED.semester_code,
  is_active = TRUE;
