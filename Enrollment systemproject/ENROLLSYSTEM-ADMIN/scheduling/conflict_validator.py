"""Strict conflict validation — guarantees zero room/time/faculty overlaps."""

from __future__ import annotations

from .models import ConflictError, ScheduleAssignment, ScheduleSession, ValidationResult
from .time_utils import DAY_NAME_TO_INDEX, parse_clock, sessions_overlap


def _section_key(strand: str, section: str) -> str:
    return f"{strand.upper()}|{section.upper()}"


def validate_schedule(
    assignments: list[ScheduleAssignment],
    *,
    strict_cross_strand_room: bool = True,
) -> ValidationResult:
    conflicts: list[ConflictError] = []

    room_bookings: list[tuple[str, str, int, int, str, str]] = []
    section_bookings: list[tuple[str, str, int, int, str, str, str]] = []
    faculty_bookings: list[tuple[str, str, int, int, str, str, str, str]] = []

    for assignment in assignments:
        strand = (assignment.strand or "").upper()
        section = (assignment.section or "").upper()
        subject = assignment.subject_code or assignment.subject_name or "UNKNOWN"

        if not assignment.sessions:
            conflicts.append(
                ConflictError(
                    "MISSING_SESSIONS",
                    f"{strand} {section} / {subject} has no sessions.",
                    {"strand": strand, "section": section, "subject_code": subject},
                )
            )
            continue

        for session in assignment.sessions:
            day_index = DAY_NAME_TO_INDEX.get(session.day.strip().lower())
            if day_index is None:
                conflicts.append(
                    ConflictError(
                        "INVALID_DAY",
                        f"Invalid day '{session.day}' for {subject}.",
                        {"subject_code": subject, "day": session.day},
                    )
                )
                continue

            try:
                start_minutes = parse_clock(session.start)
                end_minutes = parse_clock(session.end)
            except ValueError as err:
                conflicts.append(
                    ConflictError(
                        "INVALID_TIME",
                        f"Invalid time for {subject}: {err}",
                        {"subject_code": subject, "start": session.start, "end": session.end},
                    )
                )
                continue

            if end_minutes <= start_minutes:
                conflicts.append(
                    ConflictError(
                        "INVALID_RANGE",
                        f"End time must be after start time for {subject}.",
                        {"subject_code": subject, "start": session.start, "end": session.end},
                    )
                )
                continue

            room = (session.room or "").strip().upper()
            if not room:
                conflicts.append(
                    ConflictError(
                        "MISSING_ROOM",
                        f"Room is required for {subject}.",
                        {"subject_code": subject},
                    )
                )
                continue

            room_bookings.append((room, session.day, day_index, start_minutes, end_minutes, subject))
            section_bookings.append(
                (strand, section, session.day, day_index, start_minutes, end_minutes, subject)
            )
            if assignment.faculty_id:
                faculty_bookings.append(
                    (
                        assignment.faculty_id.strip().upper(),
                        strand,
                        section,
                        session.day,
                        day_index,
                        start_minutes,
                        end_minutes,
                        subject,
                    )
                )

    # Global room rule: one occupant per room/day/time (all strands)
    for i, booking_a in enumerate(room_bookings):
        room_a, day_a, day_idx_a, start_a, end_a, subject_a = booking_a
        for booking_b in room_bookings[i + 1 :]:
            room_b, day_b, day_idx_b, start_b, end_b, subject_b = booking_b
            if room_a != room_b or day_idx_a != day_idx_b:
                continue
            if not sessions_overlap(start_a, end_a, start_b, end_b):
                continue
            conflicts.append(
                ConflictError(
                    "ROOM_CONFLICT",
                    f"Room {room_a} double-booked on {day_a} "
                    f"({subject_a} overlaps {subject_b}).",
                    {
                        "room": room_a,
                        "day": day_a,
                        "subjects": [subject_a, subject_b],
                        "strict_cross_strand_room": strict_cross_strand_room,
                    },
                )
            )

    # Same section cannot have overlapping subjects
    for i, booking_a in enumerate(section_bookings):
        strand_a, section_a, day_a, day_idx_a, start_a, end_a, subject_a = booking_a
        for booking_b in section_bookings[i + 1 :]:
            strand_b, section_b, day_b, day_idx_b, start_b, end_b, subject_b = booking_b
            if _section_key(strand_a, section_a) != _section_key(strand_b, section_b):
                continue
            if day_idx_a != day_idx_b:
                continue
            if not sessions_overlap(start_a, end_a, start_b, end_b):
                continue
            conflicts.append(
                ConflictError(
                    "SECTION_CONFLICT",
                    f"{strand_a} Section {section_a} has overlapping classes on {day_a} "
                    f"({subject_a} vs {subject_b}).",
                    {
                        "strand": strand_a,
                        "section": section_a,
                        "day": day_a,
                        "subjects": [subject_a, subject_b],
                    },
                )
            )

    # Same strand, different sections must not share time slots
    for i, booking_a in enumerate(section_bookings):
        strand_a, section_a, day_a, day_idx_a, start_a, end_a, subject_a = booking_a
        for booking_b in section_bookings[i + 1 :]:
            strand_b, section_b, day_b, day_idx_b, start_b, end_b, subject_b = booking_b
            if strand_a != strand_b or section_a == section_b:
                continue
            if day_idx_a != day_idx_b:
                continue
            if not sessions_overlap(start_a, end_a, start_b, end_b):
                continue
            conflicts.append(
                ConflictError(
                    "MIRROR_SECTION_SCHEDULE",
                    f"{strand_a} Section {section_a} and Section {section_b} share the same time on {day_a}.",
                    {
                        "strand": strand_a,
                        "sections": [section_a, section_b],
                        "day": day_a,
                        "subjects": [subject_a, subject_b],
                    },
                )
            )

    # Different strands must not mirror the same subject at the same time
    for i, booking_a in enumerate(section_bookings):
        strand_a, section_a, day_a, day_idx_a, start_a, end_a, subject_a = booking_a
        for booking_b in section_bookings[i + 1 :]:
            strand_b, section_b, day_b, day_idx_b, start_b, end_b, subject_b = booking_b
            if strand_a == strand_b or subject_a != subject_b:
                continue
            if day_idx_a != day_idx_b:
                continue
            if not sessions_overlap(start_a, end_a, start_b, end_b):
                continue
            conflicts.append(
                ConflictError(
                    "MIRROR_STRAND_SCHEDULE",
                    f"Strands {strand_a} and {strand_b} share the same time for {subject_a} on {day_a}.",
                    {
                        "strands": [strand_a, strand_b],
                        "subject_code": subject_a,
                        "day": day_a,
                    },
                )
            )

    # Different sections (same or different strand): same room OR same teacher => no overlap
    section_meta = {
        _section_key(item.strand, item.section): (item.strand.upper(), item.section.upper())
        for item in assignments
    }
    for i, booking_a in enumerate(room_bookings):
        room_a, day_a, day_idx_a, start_a, end_a, subject_a = booking_a
        strand_a, section_a, _, _, _, _, _ = section_bookings[i]
        for j, booking_b in enumerate(room_bookings):
            if j <= i:
                continue
            room_b, day_b, day_idx_b, start_b, end_b, subject_b = booking_b
            strand_b, section_b, _, _, _, _, _ = section_bookings[j]
            if _section_key(strand_a, section_a) == _section_key(strand_b, section_b):
                continue
            if day_idx_a != day_idx_b or room_a != room_b:
                continue
            if not sessions_overlap(start_a, end_a, start_b, end_b):
                continue
            conflicts.append(
                ConflictError(
                    "CROSS_SECTION_ROOM_CONFLICT",
                    f"Sections {strand_a}-{section_a} and {strand_b}-{section_b} "
                    f"share room {room_a} on {day_a}.",
                    {
                        "room": room_a,
                        "day": day_a,
                        "sections": [
                            f"{strand_a}-{section_a}",
                            f"{strand_b}-{section_b}",
                        ],
                        "subjects": [subject_a, subject_b],
                    },
                )
            )

    for i, booking_a in enumerate(faculty_bookings):
        faculty_a, strand_a, section_a, day_a, day_idx_a, start_a, end_a, subject_a = booking_a
        for booking_b in faculty_bookings[i + 1 :]:
            faculty_b, strand_b, section_b, day_b, day_idx_b, start_b, end_b, subject_b = booking_b
            if faculty_a != faculty_b or day_idx_a != day_idx_b:
                continue
            if _section_key(strand_a, section_a) == _section_key(strand_b, section_b):
                continue
            if not sessions_overlap(start_a, end_a, start_b, end_b):
                continue
            conflicts.append(
                ConflictError(
                    "FACULTY_CONFLICT",
                    f"Faculty {faculty_a} assigned to overlapping sections on {day_a} "
                    f"({subject_a} vs {subject_b}).",
                    {
                        "faculty_id": faculty_a,
                        "day": day_a,
                        "sections": [
                            f"{strand_a}-{section_a}",
                            f"{strand_b}-{section_b}",
                        ],
                        "subjects": [subject_a, subject_b],
                    },
                )
            )

    # Uniform section sanity: each section should have same subject set (warning-level -> strict error optional)
    subjects_by_section: dict[str, set[str]] = {}
    for assignment in assignments:
        key = _section_key(assignment.strand, assignment.section)
        subjects_by_section.setdefault(key, set()).add(assignment.subject_code)

    by_strand: dict[str, dict[str, set[str]]] = {}
    for section_key, subject_codes in subjects_by_section.items():
        strand = section_key.split("|", 1)[0]
        by_strand.setdefault(strand, {})[section_key] = subject_codes

    for strand, sections in by_strand.items():
        if len(sections) < 2:
            continue
        reference = next(iter(sections.values()))
        for section_key, subject_codes in sections.items():
            if subject_codes != reference:
                conflicts.append(
                    ConflictError(
                        "UNIFORM_SECTION_MISMATCH",
                        f"Strand {strand}: section {section_key} subject list differs from sibling section.",
                        {
                            "strand": strand,
                            "section": section_key,
                            "subjects": sorted(subject_codes),
                            "expected_subjects": sorted(reference),
                        },
                    )
                )

    return ValidationResult(valid=not conflicts, conflicts=conflicts)


def assignments_from_payload(items: list[dict]) -> list[ScheduleAssignment]:
    assignments: list[ScheduleAssignment] = []
    for item in items or []:
        sessions = []
        for raw_session in item.get("sessions") or []:
            sessions.append(
                ScheduleSession(
                    day=raw_session.get("day") or raw_session.get("day_of_week") or "",
                    start=raw_session.get("start") or raw_session.get("start_time") or "",
                    end=raw_session.get("end") or raw_session.get("end_time") or "",
                    room=raw_session.get("room") or raw_session.get("room_name") or "",
                )
            )
        if not sessions and item.get("day") and item.get("time_slot"):
            start, end = _split_time_slot(item["time_slot"])
            sessions.append(
                ScheduleSession(
                    day=item["day"],
                    start=start,
                    end=end,
                    room=item.get("room") or item.get("room_name") or "",
                )
            )
        assignments.append(
            ScheduleAssignment(
                strand=item.get("strand") or "",
                section=item.get("section") or "",
                subject_code=item.get("subject_code") or item.get("subject") or "",
                subject_name=item.get("subject_name") or item.get("description") or "",
                sessions=sessions,
                faculty_id=item.get("faculty_id"),
                faculty_name=item.get("faculty_name") or "",
                schedule_label=item.get("schedule_label") or "",
            )
        )
    return assignments


def _split_time_slot(value: str) -> tuple[str, str]:
    text = (value or "").replace(" ", "")
    if "-" not in text:
        raise ValueError(f"Invalid time_slot: {value}")
    start, end = text.split("-", 1)
    return start, end
