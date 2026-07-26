"""Generate seed-enrollment-schedules.sql from curriculum."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ENROLLSYSTEM"))
import enrollment_curriculum as ec  # noqa: E402

lines = [
    "-- Default class schedules for enrollment",
    "-- Run after seed-shs-curriculum.sql and enrollment-workflow.sql",
    "",
    "ALTER TABLE subjects ADD COLUMN IF NOT EXISTS semester_code TEXT",
    "  CHECK (semester_code IS NULL OR semester_code IN ('1st', '2nd'));",
    "",
]

for grade in ["Grade 11", "Grade 12"]:
    for sem in ["1st", "2nd"]:
        codes = set()
        for strand in ec.ENROLLMENT_STRANDS:
            for subj in ec.subjects_for_term(strand, grade, sem):
                codes.add(subj["code"])
        quoted = ", ".join(f"'{c}'" for c in sorted(codes))
        lines.append(f"UPDATE subjects SET semester_code = '{sem}' WHERE code IN ({quoted});")

lines.extend(
    [
        "",
        "INSERT INTO sections (name, strand_id, grade_level)",
        "SELECT str.code || ' ' || CASE WHEN g.gl = 'Grade 11' THEN '11' ELSE '12' END || '-A', str.id, g.gl",
        "FROM strands str",
        "CROSS JOIN (VALUES ('Grade 11'), ('Grade 12')) AS g(gl)",
        "WHERE str.is_active = TRUE",
        "ON CONFLICT (name, strand_id, grade_level) DO NOTHING;",
        "",
        "INSERT INTO class_schedules (",
        "  subject_id, section_id, semester_id, schedule_label, day_of_week,",
        "  start_time, end_time, max_slots, is_active, is_published",
        ")",
        "SELECT sub.id, sec.id, sem.id, 'MW 9:00AM-10:30AM', 'MW',",
        "  TIME '09:00:00', TIME '10:30:00', 40, TRUE, TRUE",
        "FROM subjects sub",
        "JOIN sections sec ON sec.grade_level = sub.grade_level",
        "  AND (sub.strand_id IS NULL OR sub.strand_id = sec.strand_id)",
        "JOIN strands str ON str.id = sec.strand_id AND str.is_active = TRUE",
        "JOIN semesters sem ON sem.is_current = TRUE",
        "WHERE sub.is_active = TRUE",
        "  AND (sub.semester_code IS NULL OR sub.semester_code = sem.code)",
        "  AND NOT EXISTS (",
        "    SELECT 1 FROM class_schedules cs",
        "    WHERE cs.subject_id = sub.id AND cs.section_id = sec.id AND cs.semester_id = sem.id",
        "  );",
        "",
    ]
)

out = ROOT / "ENROLLSYSTEM" / "supabase" / "seed-enrollment-schedules.sql"
out.write_text("\n".join(lines), encoding="utf-8")
admin_out = ROOT / "ENROLLSYSTEM-ADMIN" / "supabase" / "seed-enrollment-schedules.sql"
admin_out.write_text("\n".join(lines), encoding="utf-8")
print(f"Wrote {out}")
