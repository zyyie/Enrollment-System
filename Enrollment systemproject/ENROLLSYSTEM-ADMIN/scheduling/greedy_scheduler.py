"""Deterministic conflict-free fallback scheduler (no AI)."""

from __future__ import annotations

from .models import ScheduleAssignment, ScheduleSession, SchedulerInput
from .time_slots import DAY_NAMES, build_meeting_patterns, build_schedule_label
from .time_utils import DAY_NAME_TO_INDEX, parse_clock, sessions_overlap


class GreedyScheduler:
    def generate(
        self,
        scheduler_input: SchedulerInput,
        *,
        existing_assignments: list[ScheduleAssignment] | None = None,
        teachers: list[dict] | None = None,
        reverse_rooms: bool = False,
        reverse_patterns: bool = False,
        shuffle_rooms: bool = False,
        shuffle_patterns: bool = False,
    ) -> list[ScheduleAssignment]:
        rooms = [room.strip().upper() for room in scheduler_input.rooms if room.strip()]
        if not rooms:
            rooms = ["NB101"]
        if reverse_rooms:
            rooms = list(reversed(rooms))
        if shuffle_rooms:
            import random

            rooms = list(rooms)
            random.shuffle(rooms)

        patterns = build_meeting_patterns(max_hours=2)
        if reverse_patterns:
            patterns = list(reversed(patterns))
        if shuffle_patterns:
            import random

            patterns = list(patterns)
            random.shuffle(patterns)
        section_labels = ["A", "B"][: scheduler_input.sections_per_strand]
        teacher_pool = list(teachers or [])

        # (day, start, end, room, strand, section, subject_code)
        room_usage: list[tuple[int, int, int, str, str, str, str]] = []
        section_usage: list[tuple[str, int, int, int, str]] = []
        faculty_usage: list[tuple[str, str, str, int, int, int, str]] = []

        _seed_usage_from_assignments(existing_assignments or [], room_usage, section_usage, faculty_usage)

        assignments: list[ScheduleAssignment] = []

        for strand in scheduler_input.strands:
            strand_code = strand.upper()
            filtered = []
            for subject in scheduler_input.subjects:
                sub_strand = subject.get("strand")
                if sub_strand is None or str(sub_strand).upper() == strand_code:
                    filtered.append(subject)
            strand_subjects = filtered

            for section_idx, section in enumerate(section_labels):
                if section_idx == 0:
                    section_patterns = [
                        pattern for pattern in patterns if pattern[0].start_minutes < 12 * 60
                    ]
                    if not section_patterns:
                        section_patterns = [
                            pattern for pattern in patterns if pattern[0].start_minutes < 13 * 60
                        ]
                else:
                    section_patterns = [
                        pattern for pattern in patterns if pattern[0].start_minutes >= 12 * 60
                    ]
                if not section_patterns:
                    section_patterns = (
                        sorted(patterns, key=lambda pattern: pattern[0].start_minutes)
                        if section_idx == 0
                        else sorted(
                            patterns,
                            key=lambda pattern: pattern[0].start_minutes,
                            reverse=True,
                        )
                    )
                section_offset = section_idx * max(len(section_patterns), 1) * max(len(rooms), 1)
                for subject_index, subject in enumerate(strand_subjects):
                    subject_code = subject.get("code") or subject.get("subject_code") or ""
                    required_hours = max(1, int(subject.get("units") or 1))
                    if required_hours > 2:
                        required_hours = 2
                    duration_minutes = required_hours * 60
                    placed = False

                    placement_index = section_offset + subject_index * 2
                    rotated_patterns = (
                        section_patterns[placement_index % len(section_patterns) :]
                        + section_patterns[: placement_index % len(section_patterns)]
                    )
                    rotated_rooms = (
                        rooms[(placement_index + section_idx * 3) % len(rooms) :]
                        + rooms[: (placement_index + section_idx * 3) % len(rooms)]
                    )

                    for pattern in rotated_patterns:
                        pattern_duration = pattern[0].end_minutes - pattern[0].start_minutes
                        if pattern_duration < duration_minutes:
                            continue
                        for room in rotated_rooms:
                            if _pattern_conflicts(
                                pattern,
                                room,
                                strand_code,
                                section,
                                subject_code,
                                duration_minutes,
                                room_usage,
                                section_usage,
                                faculty_usage,
                                subject.get("faculty_id"),
                            ):
                                continue

                            faculty_id, faculty_name = _pick_faculty(
                                teacher_pool,
                                strand_code,
                                pattern,
                                duration_minutes,
                                faculty_usage,
                                preferred_id=subject.get("faculty_id"),
                            )

                            sessions = [
                                ScheduleSession(
                                    day=DAY_NAMES[slot.day],
                                    start=_format_minutes(slot.start_minutes),
                                    end=_format_minutes(slot.start_minutes + duration_minutes),
                                    room=room,
                                )
                                for slot in pattern
                            ]
                            assignment = ScheduleAssignment(
                                strand=strand_code,
                                section=section,
                                subject_code=subject_code,
                                subject_name=subject.get("description")
                                or subject.get("name")
                                or subject.get("subject_name")
                                or "",
                                sessions=sessions,
                                faculty_id=faculty_id,
                                faculty_name=faculty_name or "",
                            )
                            assignment.schedule_label = build_schedule_label(pattern)
                            assignments.append(assignment)
                            _mark_usage(
                                pattern,
                                room,
                                strand_code,
                                section,
                                subject_code,
                                duration_minutes,
                                room_usage,
                                section_usage,
                                faculty_usage,
                                faculty_id,
                            )
                            placed = True
                            break
                        if placed:
                            break
                    if not placed:
                        raise RuntimeError(
                            f"Could not place {subject.get('code')} for {strand_code} Section {section}"
                        )

        return assignments


def _pick_faculty(
    teachers: list[dict],
    strand: str,
    pattern,
    duration_minutes: int,
    faculty_usage: list,
    *,
    preferred_id: str | None = None,
) -> tuple[str | None, str | None]:
    if not teachers:
        return preferred_id, None

    strand = strand.upper()
    candidates: list[tuple[int, dict]] = []
    for teacher in teachers:
        teacher_strands = [item.upper() for item in (teacher.get("strands") or [])]
        if teacher_strands and strand not in teacher_strands:
            continue
        faculty_id = teacher.get("faculty_id")
        if not faculty_id:
            continue
        load = sum(1 for used in faculty_usage if used[0] == str(faculty_id).upper())
        if preferred_id and str(faculty_id).upper() == str(preferred_id).upper():
            load -= 100
        candidates.append((load, teacher))

    if not candidates:
        return preferred_id, None

    candidates.sort(key=lambda item: item[0])
    for _, teacher in candidates:
        faculty_id = teacher.get("faculty_id")
        faculty_name = teacher.get("name") or ""
        if _faculty_available(faculty_id, pattern, duration_minutes, faculty_usage):
            return faculty_id, faculty_name

    fallback = candidates[0][1]
    return fallback.get("faculty_id"), fallback.get("name")


def _faculty_available(
    faculty_id: str | None,
    pattern,
    duration_minutes: int,
    faculty_usage: list,
) -> bool:
    if not faculty_id:
        return True
    faculty_key = str(faculty_id).upper()
    for slot in pattern:
        start = slot.start_minutes
        end = start + duration_minutes
        for (
            used_faculty,
            _used_strand,
            _used_section,
            used_day,
            used_start,
            used_end,
            _subject,
        ) in faculty_usage:
            if used_faculty != faculty_key or used_day != slot.day:
                continue
            if sessions_overlap(start, end, used_start, used_end):
                return False
    return True


def _seed_usage_from_assignments(
    assignments: list[ScheduleAssignment],
    room_usage: list,
    section_usage: list,
    faculty_usage: list,
) -> None:
    """Reserve rooms/times already taken by previously generated strands."""
    for assignment in assignments:
        strand = (assignment.strand or "").upper()
        section = (assignment.section or "").upper()
        if not strand or not section:
            continue
        section_key = f"{strand}|{section}"
        subject_code = assignment.subject_code or assignment.subject_name or "UNKNOWN"
        for session in assignment.sessions or []:
            day_index = DAY_NAME_TO_INDEX.get((session.day or "").strip().lower())
            if day_index is None:
                continue
            try:
                start_minutes = parse_clock(session.start)
                end_minutes = parse_clock(session.end)
            except ValueError:
                continue
            room = (session.room or "").strip().upper()
            if not room:
                continue
            room_usage.append(
                (day_index, start_minutes, end_minutes, room, strand, section, subject_code.upper())
            )
            section_usage.append((section_key, day_index, start_minutes, end_minutes, subject_code))
            if assignment.faculty_id:
                faculty_usage.append(
                    (
                        str(assignment.faculty_id).upper(),
                        strand,
                        section,
                        day_index,
                        start_minutes,
                        end_minutes,
                        subject_code,
                    )
                )


def _format_minutes(minutes: int) -> str:
    hour = minutes // 60
    minute = minutes % 60
    suffix = "am" if hour < 12 else "pm"
    display = hour % 12 or 12
    if minute:
        return f"{display}:{minute:02d}{suffix}"
    return f"{display}:00{suffix}"


def _pattern_conflicts(
    pattern,
    room: str,
    strand: str,
    section: str,
    subject_code: str,
    duration_minutes: int,
    room_usage,
    section_usage,
    faculty_usage,
    faculty_id,
) -> bool:
    subject_code = (subject_code or "").upper()
    for slot in pattern:
        start = slot.start_minutes
        end = start + duration_minutes
        day = slot.day

        for (
            used_day,
            used_start,
            used_end,
            used_room,
            used_strand,
            used_section,
            used_subject,
        ) in room_usage:
            if used_day != day or used_room != room:
                continue
            if sessions_overlap(start, end, used_start, used_end):
                return True

        section_key = f"{strand}|{section}"
        for used_key, used_day, used_start, used_end, _subject in section_usage:
            if used_key != section_key or used_day != day:
                continue
            if sessions_overlap(start, end, used_start, used_end):
                return True

        # Same strand, different section — must not share time slots
        for (
            used_day,
            used_start,
            used_end,
            _used_room,
            used_strand,
            used_section,
            _used_subject,
        ) in room_usage:
            if used_strand != strand or used_section == section:
                continue
            if used_day != day:
                continue
            if sessions_overlap(start, end, used_start, used_end):
                return True

        # Different strands — same subject must not share time slots
        if subject_code:
            for (
                used_day,
                used_start,
                used_end,
                _used_room,
                used_strand,
                _used_section,
                used_subject,
            ) in room_usage:
                if used_strand == strand or used_subject != subject_code:
                    continue
                if used_day != day:
                    continue
                if sessions_overlap(start, end, used_start, used_end):
                    return True

        if faculty_id:
            faculty_key = str(faculty_id).upper()
            for (
                used_faculty,
                used_strand,
                used_section,
                used_day,
                used_start,
                used_end,
                _subject,
            ) in faculty_usage:
                if used_faculty != faculty_key or used_day != day:
                    continue
                if used_strand == strand and used_section == section:
                    continue
                if sessions_overlap(start, end, used_start, used_end):
                    return True

        # Cross-section same strand room overlap check
        for (
            used_day,
            used_start,
            used_end,
            used_room,
            used_strand,
            used_section,
            _used_subject,
        ) in room_usage:
            if used_day != day or used_room != room or used_strand != strand:
                continue
            if used_section == section:
                continue
            if sessions_overlap(start, end, used_start, used_end):
                return True

    return False


def _mark_usage(
    pattern,
    room: str,
    strand: str,
    section: str,
    subject_code: str,
    duration_minutes: int,
    room_usage,
    section_usage,
    faculty_usage,
    faculty_id,
):
    section_key = f"{strand}|{section}"
    subject_code = (subject_code or "").upper()
    for slot in pattern:
        start = slot.start_minutes
        end = start + duration_minutes
        room_usage.append((slot.day, start, end, room, strand, section, subject_code))
        section_usage.append((section_key, slot.day, start, end, subject_code))
        if faculty_id:
            faculty_usage.append(
                (
                    str(faculty_id).upper(),
                    strand,
                    section,
                    slot.day,
                    start,
                    end,
                    subject_code,
                )
            )
