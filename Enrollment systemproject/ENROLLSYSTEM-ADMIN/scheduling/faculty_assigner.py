"""Assign professors to schedule entries from the faculty pool."""

from __future__ import annotations

from .models import ScheduleAssignment
from .time_utils import DAY_NAME_TO_INDEX, parse_clock, sessions_overlap


def assign_faculty_to_assignments(
    assignments: list[ScheduleAssignment],
    teachers: list[dict] | None,
) -> None:
    if not teachers:
        return

    faculty_usage: list[tuple[str, int, int, int]] = []
    for assignment in assignments:
        if not assignment.faculty_id:
            continue
        faculty_key = str(assignment.faculty_id).upper()
        for session in assignment.sessions or []:
            day_index = DAY_NAME_TO_INDEX.get((session.day or "").strip().lower())
            if day_index is None:
                continue
            try:
                start_minutes = parse_clock(session.start)
                end_minutes = parse_clock(session.end)
            except ValueError:
                continue
            faculty_usage.append((faculty_key, day_index, start_minutes, end_minutes))

    names_by_id = {
        str(teacher.get("faculty_id", "")).upper(): (teacher.get("name") or "").strip()
        for teacher in teachers
        if teacher.get("faculty_id")
    }

    for assignment in assignments:
        if assignment.faculty_id:
            if not assignment.faculty_name:
                assignment.faculty_name = names_by_id.get(str(assignment.faculty_id).upper(), "")
            continue

        strand = (assignment.strand or "").upper()
        picked_id, picked_name = _pick_teacher(
            teachers,
            strand,
            assignment.sessions or [],
            faculty_usage,
        )
        if picked_id:
            assignment.faculty_id = picked_id
            assignment.faculty_name = picked_name or names_by_id.get(str(picked_id).upper(), "")
            for session in assignment.sessions or []:
                day_index = DAY_NAME_TO_INDEX.get((session.day or "").strip().lower())
                if day_index is None:
                    continue
                try:
                    start_minutes = parse_clock(session.start)
                    end_minutes = parse_clock(session.end)
                except ValueError:
                    continue
                faculty_usage.append((str(picked_id).upper(), day_index, start_minutes, end_minutes))


def _pick_teacher(
    teachers: list[dict],
    strand: str,
    sessions: list,
    faculty_usage: list[tuple[str, int, int, int]],
) -> tuple[str | None, str | None]:
    candidates: list[tuple[int, dict]] = []
    for teacher in teachers:
        faculty_id = teacher.get("faculty_id")
        if not faculty_id:
            continue
        teacher_strands = [item.upper() for item in (teacher.get("strands") or [])]
        if teacher_strands and strand not in teacher_strands:
            continue
        load = sum(1 for used in faculty_usage if used[0] == str(faculty_id).upper())
        candidates.append((load, teacher))

    if not candidates:
        for teacher in teachers:
            if teacher.get("faculty_id"):
                candidates.append((0, teacher))
        if not candidates:
            return None, None

    candidates.sort(key=lambda item: item[0])
    for _, teacher in candidates:
        faculty_id = teacher.get("faculty_id")
        if _teacher_available(faculty_id, sessions, faculty_usage):
            return faculty_id, teacher.get("name") or ""

    fallback = candidates[0][1]
    return fallback.get("faculty_id"), fallback.get("name") or ""


def _teacher_available(
    faculty_id: str | None,
    sessions: list,
    faculty_usage: list[tuple[str, int, int, int]],
) -> bool:
    if not faculty_id:
        return False
    faculty_key = str(faculty_id).upper()
    for session in sessions:
        day_index = DAY_NAME_TO_INDEX.get((session.day or "").strip().lower())
        if day_index is None:
            continue
        try:
            start_minutes = parse_clock(session.start)
            end_minutes = parse_clock(session.end)
        except ValueError:
            continue
        for used_faculty, used_day, used_start, used_end in faculty_usage:
            if used_faculty != faculty_key or used_day != day_index:
                continue
            if sessions_overlap(start_minutes, end_minutes, used_start, used_end):
                return False
    return True
