-- DELETE ALL STUDENTS + admission/enrollment data
-- Supabase → SQL Editor → Run this whole script
-- WARNING: Permanent. Faculty, subjects, schedules, and rooms are kept.

-- STEP 1: Preview (how many rows will be removed)
SELECT 'admission_applications' AS table_name, COUNT(*) AS rows FROM admission_applications
UNION ALL SELECT 'students', COUNT(*) FROM students
UNION ALL SELECT 'enrollments', COUNT(*) FROM enrollments
UNION ALL SELECT 'enrollment_subjects', COUNT(*) FROM enrollment_subjects
UNION ALL SELECT 'enrollment_payments', COUNT(*) FROM enrollment_payments
UNION ALL SELECT 'student_grades', COUNT(*) FROM student_grades
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;

-- STEP 2: Delete everything (run after you check STEP 1)
BEGIN;

DELETE FROM student_grades;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'grading_sheet_scores'
  ) THEN
    DELETE FROM grading_sheet_scores;
  END IF;
END $$;
DELETE FROM enrollment_payments;
DELETE FROM enrollment_subjects;
DELETE FROM enrollments;
DELETE FROM notifications;
DELETE FROM students;
DELETE FROM admission_applications;

-- Reset slot counts on published schedules
UPDATE class_schedules SET enrolled_count = 0;

COMMIT;

-- STEP 3: Verify (all should be 0)
SELECT 'admission_applications' AS table_name, COUNT(*) AS rows FROM admission_applications
UNION ALL SELECT 'students', COUNT(*) FROM students
UNION ALL SELECT 'enrollments', COUNT(*) FROM enrollments
UNION ALL SELECT 'enrollment_subjects', COUNT(*) FROM enrollment_subjects
UNION ALL SELECT 'enrollment_payments', COUNT(*) FROM enrollment_payments
UNION ALL SELECT 'student_grades', COUNT(*) FROM student_grades
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;
