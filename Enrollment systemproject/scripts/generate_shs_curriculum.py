"""Generate enrollment_curriculum.py, enrollment-curriculum.js, and SQL seed from SHS doc."""
import json
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ENROLLMENT_TRACKS = {
    "Academic": {"label": "Academic Track", "strands": ["STEM", "ABM", "HUMSS", "GAS"]},
    "TechPro": {"label": "Technical-Professional (TechPro)", "strands": ["ICT", "COOKERY", "EIM"]},
}

# (code_suffix, description, lec, lab) — units = lec + lab for TVL lab subjects else lec
def subj(code, desc, lec=3, lab=0):
    return {"code": code, "description": desc, "lec": lec, "lab": lab, "units": lec + (lab if lab else 0)}

CURRICULUM = {
    "Grade 11": {
        "1st": {
            "core": [
                subj("G11-C01", "Oral Communication in Context"),
                subj("G11-C02", "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino"),
                subj("G11-C03", "General Mathematics"),
                subj("G11-C04", "Earth and Life Science"),
                subj("G11-C05", "Personal Development"),
                subj("G11-PE1", "Physical Education and Health 1", 2, 0),
            ],
            "applied": [
                subj("G11-A01", "Empowerment Technologies"),
            ],
            "specialized": {
                "STEM": [
                    subj("G11-STEM-01", "Pre-Calculus", 4, 0),
                    subj("G11-STEM-02", "General Biology 1", 3, 1),
                    subj("G11-STEM-03", "Earth Science"),
                ],
                "ABM": [
                    subj("G11-ABM-01", "Organization and Management"),
                    subj("G11-ABM-02", "Applied Economics"),
                ],
                "HUMSS": [
                    subj("G11-HUM-01", "Disciplines and Ideas in the Social Sciences"),
                    subj("G11-HUM-02", "Creative Writing"),
                    subj("G11-HUM-03", "Philippine Politics and Governance"),
                ],
                "GAS": [],
                "ICT": [
                    subj("G11-ICT-01", "CSS NC II – Install and Configure Computer Systems", 3, 1),
                    subj("G11-ICT-02", "CSS NC II – Set Up Computer Networks", 3, 1),
                ],
                "COOKERY": [
                    subj("G11-CK-01", "Use Kitchen Tools, Equipment, and Paraphernalia", 3, 1),
                    subj("G11-CK-02", "Perform Mensuration and Calculation", 3, 1),
                    subj("G11-CK-03", "Interpret Kitchen Layout", 3, 1),
                    subj("G11-CK-04", "Practice Occupational Health and Safety Procedures", 3, 1),
                ],
                "EIM": [
                    subj("G11-EIM-01", "Prepare Electrical Materials and Tools", 3, 1),
                    subj("G11-EIM-02", "Interpret Technical Drawings and Plans", 3, 1),
                    subj("G11-EIM-03", "Perform Mensuration and Calculation", 3, 1),
                    subj("G11-EIM-04", "Practice Occupational Safety and Health Procedures", 3, 1),
                ],
            },
        },
        "2nd": {
            "core": [
                subj("G11-C06", "Reading and Writing Skills"),
                subj("G11-C07", "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik"),
                subj("G11-C08", "Statistics and Probability"),
                subj("G11-C09", "Physical Science"),
                subj("G11-C10", "Understanding Culture, Society and Politics"),
                subj("G11-PE2", "Physical Education and Health 2", 2, 0),
            ],
            "applied": [
                subj("G11-A02", "Practical Research 1"),
            ],
            "specialized": {
                "STEM": [
                    subj("G11-STEM-04", "Basic Calculus", 4, 0),
                    subj("G11-STEM-05", "General Biology 2", 3, 1),
                    subj("G11-STEM-06", "General Physics 1", 3, 1),
                ],
                "ABM": [
                    subj("G11-ABM-03", "Business Finance"),
                    subj("G11-ABM-04", "Fundamentals of Accountancy, Business and Management 1"),
                ],
                "HUMSS": [
                    subj("G11-HUM-04", "Disciplines and Ideas in the Applied Social Sciences"),
                    subj("G11-HUM-05", "Creative Nonfiction"),
                    subj("G11-HUM-06", "Community Engagement, Solidarity and Citizenship"),
                ],
                "GAS": [],
                "ICT": [
                    subj("G11-ICT-03", "CSS NC II – Install Computer Systems and Networks", 3, 1),
                    subj("G11-ICT-04", "CSS NC II – Maintain and Repair Computer Systems and Networks", 3, 1),
                ],
                "COOKERY": [
                    subj("G11-CK-05", "Clean and Maintain Kitchen Tools, Equipment, and Premises", 3, 1),
                    subj("G11-CK-06", "Prepare Appetizers", 3, 1),
                    subj("G11-CK-07", "Prepare Salads and Dressings", 3, 1),
                    subj("G11-CK-08", "Prepare Sandwiches", 3, 1),
                    subj("G11-CK-09", "Prepare Egg Dishes", 3, 1),
                    subj("G11-CK-10", "Prepare Vegetables", 3, 1),
                    subj("G11-CK-11", "Prepare Seafood Dishes", 3, 1),
                ],
                "EIM": [
                    subj("G11-EIM-05", "Install Electrical Lighting System", 3, 1),
                    subj("G11-EIM-06", "Install Wiring Devices", 3, 1),
                    subj("G11-EIM-07", "Install Conduit, Tubing and Fittings", 3, 1),
                ],
            },
        },
    },
    "Grade 12": {
        "1st": {
            "core": [
                subj("G12-C01", "Introduction to the Philosophy of the Human Person"),
                subj("G12-C02", "Disaster Readiness and Risk Reduction"),
                subj("G12-PE3", "Physical Education and Health 3", 2, 0),
            ],
            "applied": [
                subj("G12-A01", "English for Academic and Professional Purposes"),
                subj("G12-A02", "Entrepreneurship"),
                subj("G12-A03", "Filipino sa Piling Larang"),
            ],
            "specialized": {
                "STEM": [
                    subj("G12-STEM-01", "General Chemistry 1", 3, 1),
                    subj("G12-STEM-02", "General Physics 2", 3, 1),
                ],
                "ABM": [
                    subj("G12-ABM-01", "Fundamentals of Accountancy, Business and Management 2"),
                    subj("G12-ABM-02", "Business Ethics and Social Responsibility"),
                ],
                "HUMSS": [
                    subj("G12-HUM-01", "Trends, Networks and Critical Thinking in the 21st Century"),
                ],
                "GAS": [],
                "ICT": [
                    subj("G12-ICT-01", "CSS NC II – Diagnose and Troubleshoot Computer Systems", 3, 1),
                    subj("G12-ICT-02", "CSS NC II – Configure Network Services", 3, 1),
                ],
                "COOKERY": [
                    subj("G12-CK-01", "Prepare Stocks, Sauces and Soups", 3, 1),
                    subj("G12-CK-02", "Prepare Poultry and Game Dishes", 3, 1),
                    subj("G12-CK-03", "Prepare Meat Dishes", 3, 1),
                    subj("G12-CK-04", "Prepare Desserts", 3, 1),
                ],
                "EIM": [
                    subj("G12-EIM-01", "Install Electrical Protection System", 3, 1),
                    subj("G12-EIM-02", "Install Electrical Control System", 3, 1),
                    subj("G12-EIM-03", "Maintain and Repair Electrical Systems", 3, 1),
                ],
            },
        },
        "2nd": {
            "core": [
                subj("G12-C03", "Contemporary Philippine Arts from the Regions"),
                subj("G12-PE4", "Physical Education and Health 4", 2, 0),
            ],
            "applied": [
                subj("G12-A04", "Inquiries, Investigations, and Immersion"),
                subj("G12-A05", "Practical Research 2"),
                subj("G12-A06", "Work Immersion"),
            ],
            "specialized": {
                "STEM": [
                    subj("G12-STEM-03", "General Chemistry 2", 3, 1),
                    subj("G12-STEM-04", "Research/Capstone"),
                ],
                "ABM": [
                    subj("G12-ABM-03", "Principles of Marketing"),
                    subj("G12-ABM-04", "Business Enterprise Simulation"),
                ],
                "HUMSS": [
                    subj("G12-HUM-02", "Introduction to World Religions and Belief Systems"),
                ],
                "GAS": [],
                "ICT": [
                    subj("G12-ICT-03", "Work Immersion"),
                    subj("G12-ICT-04", "Specialization Enhancement / Entrepreneurship Integration"),
                ],
                "COOKERY": [
                    subj("G12-CK-05", "Prepare Cakes", 3, 1),
                    subj("G12-CK-06", "Prepare Pastries", 3, 1),
                    subj("G12-CK-07", "Package Prepared Food", 3, 1),
                    subj("G12-CK-08", "Work Immersion"),
                ],
                "EIM": [
                    subj("G12-EIM-04", "Test and Commission Electrical Installation", 3, 1),
                    subj("G12-EIM-05", "Work Immersion"),
                ],
            },
        },
    },
}


def py_literal(obj, indent=0):
    sp = " " * indent
    if isinstance(obj, dict):
        lines = ["{"]
        for k, v in obj.items():
            key = repr(k)
            lines.append(f"{sp}    {key}: {py_literal(v, indent + 4)},")
        lines.append(f"{sp}}}")
        return "\n".join(lines)
    if isinstance(obj, list):
        if not obj:
            return "[]"
        lines = ["["]
        for item in obj:
            lines.append(f"{sp}    {py_literal(item, indent + 4)},")
        lines.append(f"{sp}]")
        return "\n".join(lines)
    return repr(obj)


def generate_python():
    strands = []
    for info in ENROLLMENT_TRACKS.values():
        strands.extend(info["strands"])

    body = f'''"""Enrollment curriculum catalog — keep in sync with js/enrollment-curriculum.js
Source: SHS-Subjects.docx (DepEd SHS curriculum)
"""

ENROLLMENT_TRACKS = {py_literal(ENROLLMENT_TRACKS, 0)}

ENROLLMENT_STRANDS = {strands!r}

STRAND_TRACK = {{}}
for _track, _info in ENROLLMENT_TRACKS.items():
    for _code in _info["strands"]:
        STRAND_TRACK[_code] = _track

ENROLLMENT_CURRICULUM = {py_literal(CURRICULUM, 0)}


def _grade_num(grade_level):
    return "11" if "11" in (grade_level or "") else "12"


def _build_strand_schedules(grade_level, semester, subject_code, day_time, slots=28):
    grade_num = _grade_num(grade_level)
    schedules = []
    for index, strand in enumerate(ENROLLMENT_STRANDS):
        schedules.append({{
            "id": f"{{subject_code}}-{{strand}}-{{grade_num}}-{{semester}}-{{index + 1}}",
            "slots": slots - index * 2,
            "section": f"{{strand}} {{grade_num}}-A",
            "dayTime": day_time or "MW 9:00AM-10:30AM",
        }})
    return schedules


def build_enrollment_subjects_catalog():
    catalog = []
    for grade_level, semesters in ENROLLMENT_CURRICULUM.items():
        for semester, config in semesters.items():
            for category, subject_type in (
                ("core", "core"),
                ("applied", "applied"),
            ):
                for item in config.get(category, []):
                    catalog.append({{
                        **item,
                        "gradeLevel": grade_level,
                        "semester": semester,
                        "strand": None,
                        "type": subject_type,
                        "schedules": _build_strand_schedules(
                            grade_level, semester, item["code"], item.get("dayTime"), 28
                        ),
                    }})
            for strand, specs in config.get("specialized", {{}}).items():
                grade_num = _grade_num(grade_level)
                for spec in specs:
                    catalog.append({{
                        **spec,
                        "gradeLevel": grade_level,
                        "semester": semester,
                        "strand": strand,
                        "type": "specialized",
                        "schedules": [{{
                            "id": f"{{spec['code']}}-{{strand}}-{{grade_num}}-{{semester}}",
                            "slots": 25,
                            "section": f"{{strand}} {{grade_num}}-A",
                            "dayTime": spec.get("dayTime") or "TTh 1:00PM-2:30PM",
                        }}],
                    }})
    return catalog


ENROLLMENT_SUBJECTS_DEMO = build_enrollment_subjects_catalog()


def subjects_for_term(strand_code, grade_level, semester_code):
    """All subjects a student must take for grade/semester/strand."""
    code = (strand_code or "GAS").upper()
    result = []
    config = ENROLLMENT_CURRICULUM.get(grade_level, {{}}).get(semester_code, {{}})
    for item in config.get("core", []) + config.get("applied", []):
        result.append({{**item, "strand": None, "type": "core"}})
    for item in config.get("specialized", {{}}).get(code, []):
        result.append({{**item, "strand": code, "type": "specialized"}})
    return result


def required_subjects_count(strand_code, grade_level, semester_code):
    return len(subjects_for_term(strand_code, grade_level, semester_code))


def section_matches_student(section_name, strand_code, grade_level):
    section = (section_name or "").upper()
    code = (strand_code or "GAS").upper()
    if not section.startswith(code):
        return False
    if grade_level:
        grade_num = _grade_num(grade_level)
        if grade_num not in section:
            return False
    return True


def filter_demo_subjects_by_strand(strand_code, grade_level="Grade 12", semester_code="1st"):
    code = (strand_code or "GAS").upper()
    subjects = []
    for subj in ENROLLMENT_SUBJECTS_DEMO:
        if grade_level and subj.get("gradeLevel") and subj["gradeLevel"] != grade_level:
            continue
        if semester_code and subj.get("semester") and subj["semester"] != semester_code:
            continue
        sub_strand = subj.get("strand")
        if sub_strand is not None and str(sub_strand).upper() != code:
            continue
        schedules = [
            schedule for schedule in subj.get("schedules", [])
            if section_matches_student(schedule.get("section"), code, grade_level)
        ]
        if not schedules:
            continue
        subjects.append({{**subj, "schedules": schedules}})
    return subjects
'''
    for app in ("ENROLLSYSTEM", "ENROLLSYSTEM-ADMIN"):
        path = ROOT / app / "enrollment_curriculum.py"
        path.write_text(body, encoding="utf-8")
        print(f"Wrote {path}")


def js_str(s):
    return json.dumps(s)


def generate_js():
    strands = []
    for info in ENROLLMENT_TRACKS.values():
        strands.extend(info["strands"])

    def fmt_subjects(items):
        parts = []
        for item in items:
            parts.append(
                f"{{ code: {js_str(item['code'])}, description: {js_str(item['description'])}, "
                f"lec: {item['lec']}, lab: {item['lab']}, units: {item['units']} }}"
            )
        return "[\n          " + ",\n          ".join(parts) + "\n        ]"

    lines = [
        "// SHS curriculum from SHS-Subjects.docx — keep in sync with enrollment_curriculum.py",
        "",
        f"const ENROLLMENT_TRACKS = {json.dumps(ENROLLMENT_TRACKS, indent=2)};",
        "",
        f"const ENROLLMENT_STRANDS = {json.dumps(strands)};",
        "",
        "const ENROLLMENT_CURRICULUM = {",
    ]
    for gi, (grade, semesters) in enumerate(CURRICULUM.items()):
        lines.append(f"  {js_str(grade)}: {{")
        for si, (sem, config) in enumerate(semesters.items()):
            lines.append(f"    {js_str(sem)}: {{")
            lines.append(f"      core: {fmt_subjects(config['core'])},")
            lines.append(f"      applied: {fmt_subjects(config.get('applied', []))},")
            lines.append("      specialized: {")
            for strand, specs in config["specialized"].items():
                lines.append(f"        {strand}: {fmt_subjects(specs)},")
            lines.append("      }")
            lines.append("    }" + ("," if si < len(semesters) - 1 else ""))
        lines.append("  }" + ("," if gi < len(CURRICULUM) - 1 else ""))
    lines.append("};")
    lines.append("")
    lines.append(textwrap.dedent("""
        function _gradeNum(gradeLevel) {
          return String(gradeLevel || '').includes('11') ? '11' : '12';
        }

        function buildStrandSchedules(gradeLevel, semester, subjectCode, dayTime, slots) {
          const gradeNum = _gradeNum(gradeLevel);
          return ENROLLMENT_STRANDS.map((strand, index) => ({
            id: `${subjectCode}-${strand}-${gradeNum}-${semester}-${index + 1}`,
            slots: (slots || 28) - index * 2,
            section: `${strand} ${gradeNum}-A`,
            dayTime: dayTime || 'MW 9:00AM-10:30AM'
          }));
        }

        function buildEnrollmentSubjectsCatalog() {
          const catalog = [];
          Object.entries(ENROLLMENT_CURRICULUM).forEach(([gradeLevel, semesters]) => {
            Object.entries(semesters).forEach(([semester, config]) => {
              ['core', 'applied'].forEach((category) => {
                (config[category] || []).forEach((item) => {
                  catalog.push({
                    ...item,
                    gradeLevel,
                    semester,
                    strand: null,
                    type: category === 'applied' ? 'applied' : 'core',
                    schedules: buildStrandSchedules(gradeLevel, semester, item.code, item.dayTime, 28)
                  });
                });
              });
              Object.entries(config.specialized || {}).forEach(([strand, specs]) => {
                const gradeNum = _gradeNum(gradeLevel);
                specs.forEach((spec) => {
                  catalog.push({
                    ...spec,
                    gradeLevel,
                    semester,
                    strand,
                    type: 'specialized',
                    schedules: [{
                      id: `${spec.code}-${strand}-${gradeNum}-${semester}`,
                      slots: 25,
                      section: `${strand} ${gradeNum}-A`,
                      dayTime: spec.dayTime || 'TTh 1:00PM-2:30PM'
                    }]
                  });
                });
              });
            });
          });
          return catalog;
        }

        const ENROLLMENT_SUBJECTS_DEMO = buildEnrollmentSubjectsCatalog();

        function subjectsForTerm(strandCode, gradeLevel, semesterCode) {
          const code = String(strandCode || 'GAS').toUpperCase();
          const config = (ENROLLMENT_CURRICULUM[gradeLevel] || {})[semesterCode] || {};
          const shared = [...(config.core || []), ...(config.applied || [])].map((item) => ({
            ...item,
            strand: null,
            type: 'core'
          }));
          const specialized = (config.specialized || {})[code] || [];
          return shared.concat(specialized.map((item) => ({ ...item, strand: code, type: 'specialized' })));
        }

        function requiredSubjectsCount(strandCode, gradeLevel, semesterCode) {
          return subjectsForTerm(strandCode, gradeLevel, semesterCode).length;
        }
    """).strip())

    path = ROOT / "ENROLLSYSTEM" / "js" / "enrollment-curriculum.js"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {path}")


def generate_sql():
    all_codes = []
    core_rows = []
    strand_rows = []

    for grade, semesters in CURRICULUM.items():
        for sem, config in semesters.items():
            for item in config.get("core", []) + config.get("applied", []):
                all_codes.append(item["code"])
                short = item["description"][:80]
                core_rows.append(
                    (item["code"], short, item["description"], grade, item["lec"], item["lab"], item["units"])
                )
            for strand, specs in config.get("specialized", {}).items():
                for item in specs:
                    all_codes.append(item["code"])
                    short = item["description"][:80]
                    strand_rows.append(
                        (strand, item["code"], short, item["description"], grade, item["lec"], item["lab"], item["units"])
                    )

    lines = [
        "-- SHS Curriculum seed — run in Supabase SQL Editor",
        "-- Replaces old subjects with official SHS-Subjects.docx curriculum",
        "-- Run AFTER schema.sql and faculty-strands-rooms.sql",
        "",
        "-- Deactivate retired TechPro strands",
        "UPDATE strands SET is_active = FALSE WHERE code IN ('CSS', 'HE', 'INDARTS', 'OTHER');",
        "",
        "-- Upsert current strands",
        "INSERT INTO strands (code, name, track) VALUES",
        "  ('STEM',    'STEM - Science, Technology, Engineering, and Mathematics', 'Academic'),",
        "  ('ABM',     'Accountancy, Business & Management', 'Academic'),",
        "  ('HUMSS',   'Humanities & Social Sciences', 'Academic'),",
        "  ('GAS',     'General Academic Strand', 'Academic'),",
        "  ('ICT',     'Information and Communications Technology', 'TechPro'),",
        "  ('COOKERY', 'Cookery', 'TechPro'),",
        "  ('EIM',     'Electrical Installation and Maintenance', 'TechPro')",
        "ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, track = EXCLUDED.track, is_active = TRUE;",
        "",
        "-- Deactivate all existing subjects (preserves FK history)",
        "UPDATE subjects SET is_active = FALSE;",
        "",
        "-- Core + Applied (all strands)",
        "INSERT INTO subjects (code, name, description, strand_id, grade_level, lec_hours, lab_hours, units) VALUES",
    ]
    core_vals = []
    for row in core_rows:
        code, name, desc, grade, lec, lab, units = row
        name_esc = name.replace("'", "''")
        desc_esc = desc.replace("'", "''")
        core_vals.append(
            f"  ('{code}', '{name_esc}', '{desc_esc}', NULL, '{grade}', {lec}, {lab}, {units})"
        )
    lines.append(",\n".join(core_vals))
    lines.append("ON CONFLICT (code) DO UPDATE SET")
    lines.append("  name = EXCLUDED.name, description = EXCLUDED.description,")
    lines.append("  strand_id = NULL, grade_level = EXCLUDED.grade_level,")
    lines.append("  lec_hours = EXCLUDED.lec_hours, lab_hours = EXCLUDED.lab_hours,")
    lines.append("  units = EXCLUDED.units, is_active = TRUE;")
    lines.append("")

    by_strand = {}
    for row in strand_rows:
        by_strand.setdefault(row[0], []).append(row[1:])

    for strand, rows in by_strand.items():
        lines.append(f"-- {strand} specialized subjects")
        lines.append(
            "INSERT INTO subjects (code, name, description, strand_id, grade_level, lec_hours, lab_hours, units)"
        )
        lines.append(f"SELECT v.code, v.name, v.description, s.id, v.grade_level, v.lec, v.lab, v.units")
        lines.append("FROM strands s,")
        lines.append("(VALUES")
        val_lines = []
        for code, name, desc, grade, lec, lab, units in rows:
            name_esc = name.replace("'", "''")
            desc_esc = desc.replace("'", "''")
            val_lines.append(
                f"  ('{code}', '{name_esc}', '{desc_esc}', '{grade}', {lec}, {lab}, {units})"
            )
        lines.append(",\n".join(val_lines))
        lines.append(") AS v(code, name, description, grade_level, lec, lab, units)")
        lines.append(f"WHERE s.code = '{strand}'")
        lines.append("ON CONFLICT (code) DO UPDATE SET")
        lines.append("  name = EXCLUDED.name, description = EXCLUDED.description,")
        lines.append("  strand_id = EXCLUDED.strand_id, grade_level = EXCLUDED.grade_level,")
        lines.append("  lec_hours = EXCLUDED.lec_hours, lab_hours = EXCLUDED.lab_hours,")
        lines.append("  units = EXCLUDED.units, is_active = TRUE;")
        lines.append("")

    lines.append(f"-- Active subject count: {len(all_codes)}")
    path = ROOT / "ENROLLSYSTEM-ADMIN" / "supabase" / "seed-shs-curriculum.sql"
    path.write_text("\n".join(lines), encoding="utf-8")
    # copy to student app
    copy = ROOT / "ENROLLSYSTEM" / "supabase" / "seed-shs-curriculum.sql"
    copy.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"Wrote {path} ({len(all_codes)} subjects)")


if __name__ == "__main__":
    generate_python()
    generate_js()
    generate_sql()
