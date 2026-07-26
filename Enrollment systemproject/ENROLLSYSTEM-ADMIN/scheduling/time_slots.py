"""Time grid: Mon–Fri 7:00 AM–5:00 PM, Sat 7:00 AM–12:00 PM (1-hour blocks)."""

from __future__ import annotations

from .models import TimeSlot
from .time_utils import DAY_CODES, format_clock

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

SCHOOL_OPEN = 8 * 60
SCHOOL_CLOSE_WEEKDAY = 17 * 60
SCHOOL_CLOSE_SATURDAY = 12 * 60
SLOT_MINUTES = 60


def weekday_slots(include_saturday: bool = False) -> list[TimeSlot]:
    slots: list[TimeSlot] = []
    for day in range(5 if not include_saturday else 6):
        close = SCHOOL_CLOSE_SATURDAY if day == 5 else SCHOOL_CLOSE_WEEKDAY
        start = SCHOOL_OPEN
        while start + SLOT_MINUTES <= close:
            slots.append(TimeSlot(day=day, start_minutes=start, end_minutes=start + SLOT_MINUTES))
            start += SLOT_MINUTES
    return slots


def _balanced_start_minutes() -> list[int]:
    """Prefer morning and late-morning slots first so Section B can use afternoon."""
    starts = list(range(SCHOOL_OPEN, SCHOOL_CLOSE_WEEKDAY, SLOT_MINUTES))
    early_morning = [value for value in starts if value < 10 * 60]
    late_morning = [value for value in starts if 10 * 60 <= value < 12 * 60]
    afternoon = [value for value in starts if value >= 12 * 60]
    ordered: list[int] = []
    for bucket in (early_morning, late_morning, afternoon):
        ordered.extend(bucket)
    return ordered


def build_meeting_patterns(max_hours: int = 2) -> list[list[TimeSlot]]:
    """Generate recurring meeting patterns (same clock time on 1–2 days per week)."""
    patterns: list[list[TimeSlot]] = []
    day_pairs = [
        [0, 2],      # MW
        [1, 3],      # TTh
        [0, 2, 4],   # MWF
        [4],         # F only
        [1],         # T only
        [0],         # M only
        [3],         # Th only
    ]

    for start in _balanced_start_minutes():
        for duration_hours in range(1, max_hours + 1):
            end = start + duration_hours * SLOT_MINUTES
            if end > SCHOOL_CLOSE_WEEKDAY:
                continue
            for days in day_pairs:
                pattern = [
                    TimeSlot(day=day, start_minutes=start, end_minutes=end)
                    for day in days
                ]
                patterns.append(pattern)

    seen: set[tuple] = set()
    unique: list[list[TimeSlot]] = []
    for pattern in patterns:
        key = tuple((slot.day, slot.start_minutes, slot.end_minutes) for slot in pattern)
        if key not in seen:
            seen.add(key)
            unique.append(pattern)
    return unique


def build_schedule_label(sessions: list[TimeSlot]) -> str:
    if not sessions:
        return "TBA"
    days = sorted({slot.day for slot in sessions})
    day_part = "".join(DAY_CODES[day] for day in days)
    start = min(slot.start_minutes for slot in sessions)
    end = max(slot.end_minutes for slot in sessions)
    return f"{day_part} {format_clock(start)}-{format_clock(end)}"


def default_time_slot_labels(include_saturday: bool = False) -> list[str]:
    labels: list[str] = []
    for slot in weekday_slots(include_saturday=include_saturday):
        labels.append(f"{format_clock(slot.start_minutes)}-{format_clock(slot.end_minutes)}")
    # dedupe while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for label in labels:
        if label not in seen:
            seen.add(label)
            unique.append(label)
    return unique
