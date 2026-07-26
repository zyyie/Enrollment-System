"""Prompt templates for cloud AI schedule generation."""



from __future__ import annotations



import json



SYSTEM_PROMPT = """You are a senior high school scheduling engine. Return ONLY valid JSON:

{"schedules":[{"strand":"STEM","section":"A","subject_code":"CODE","subject_name":"Name","faculty_id":null,"sessions":[{"day":"Monday","start":"8:00am","end":"9:00am","room":"NB101"}]}]}



Rules:

1. Schedule EVERY subject in the input exactly once for the target section.

2. No overlapping times for the same section, room, or faculty.

3. One room = one class at a time (avoid already_scheduled slots/rooms).

4. Use lab rooms (LAB1, LAB2, LAB3) for subjects with lab units; classrooms for lecture-only.

5. Respect teacher_availability and scheduling_context when provided. Set faculty_id from teacher_availability when possible.

6. Section A uses times BEFORE 12:00pm. Section B uses times AT OR AFTER 12:00pm. Never give Section A and Section B the same time slot — different room is NOT enough.

7. Different strands must not mirror the same subject at the same time.

8. Spread classes across the school day. Do NOT schedule every subject at 8:00am–10:00am.

9. Never double-book a room: if already_scheduled uses a room at a time, pick a different room or time.

10. Prefer MW or TTh patterns. Use only provided rooms/days/times.

11. If fix_conflicts is provided, regenerate avoiding those exact conflicts.



If impossible: {"schedules":[],"error":"reason"}"""





def build_user_prompt(

    payload: dict,

    *,

    target_section: str | None = None,

    target_sections: list[str] | None = None,

    already_scheduled: list[dict] | None = None,

    scheduling_context: dict | None = None,

    conflict_hints: list[str] | None = None,

) -> str:

    section = (target_section or "").upper()
    sections = [str(item).upper() for item in (target_sections or payload.get("target_sections") or []) if str(item).strip()]
    subject_count = len(payload.get("subjects") or [])

    compact = {

        "strand": (payload.get("strands") or [""])[0],

        "grade_level": payload.get("grade_level"),

        "semester_code": payload.get("semester_code"),

        "rooms": payload.get("rooms"),

        "days": payload.get("days"),

        "subjects": payload.get("subjects"),

    }

    if sections:
        compact["target_sections"] = sections
        compact["required_entries"] = subject_count * len(sections)
    else:
        compact["target_section"] = section
        compact["required_entries"] = subject_count

    ctx = scheduling_context or payload.get("scheduling_context")

    if ctx:

        compact["scheduling_context"] = {

            "teacher_availability": ctx.get("teacher_availability", [])[:12],

            "classroom_availability": ctx.get("classroom_availability", []),

            "laboratory_availability": ctx.get("laboratory_availability", []),

            "student_load": ctx.get("student_load", {}),

            "time_constraints": ctx.get("time_constraints", {}),

        }

    if already_scheduled:

        compact["already_scheduled"] = _compact_existing(already_scheduled)

    if conflict_hints:

        compact["fix_conflicts"] = conflict_hints[:15]



    intro = f"Build conflict-free schedule for strand {compact['strand']} section {section}."

    if sections:
        section_list = ", ".join(sections)
        intro = (
            f"Build conflict-free schedule for strand {compact['strand']} "
            f"sections {section_list}. Schedule every subject once per section. "
            f"Section A = morning only; Section B = afternoon only (different times, not just rooms)."
        )

    if conflict_hints:

        if sections:
            intro = (
                f"REGENERATE schedule fixing conflicts for {compact['strand']} "
                f"sections {', '.join(sections)}."
            )
        else:
            intro = f"REGENERATE schedule fixing conflicts for {compact['strand']} section {section}."



    return (

        f"{intro} You MUST return exactly {compact['required_entries']} schedule entries (one per subject).\n"

        f"INPUT:\n{json.dumps(compact, separators=(',', ':'))}"

    )





def _compact_existing(items: list[dict]) -> list[dict]:

    compact: list[dict] = []

    for item in items[-40:]:

        compact.append(

            {

                "strand": item.get("strand"),

                "section": item.get("section"),

                "subject_code": item.get("subject_code"),

                "sessions": item.get("sessions"),

            }

        )

    return compact

