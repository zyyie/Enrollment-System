"""Shared time/day helpers for scheduling."""

from __future__ import annotations

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
DAY_CODES = ["M", "T", "W", "Th", "F", "Sa"]

DAY_NAME_TO_INDEX = {
    "monday": 0,
    "mon": 0,
    "m": 0,
    "tuesday": 1,
    "tue": 1,
    "t": 1,
    "wednesday": 2,
    "wed": 2,
    "w": 2,
    "thursday": 3,
    "thu": 3,
    "th": 3,
    "friday": 4,
    "fri": 4,
    "f": 4,
    "saturday": 5,
    "sat": 5,
    "sa": 5,
}


def parse_clock(value: str) -> int:
    text = (value or "").strip().upper().replace(" ", "")
    if not text:
        raise ValueError("Empty time value")

    suffix = None
    if text.endswith("AM") or text.endswith("PM"):
        suffix = text[-2:]
        text = text[:-2]

    if ":" in text:
        hour_str, minute_str = text.split(":", 1)
        hour = int(hour_str)
        minute = int(minute_str)
    else:
        hour = int(text)
        minute = 0

    if suffix == "AM":
        if hour == 12:
            hour = 0
    elif suffix == "PM":
        if hour != 12:
            hour += 12

    if hour > 23 or minute > 59:
        raise ValueError(f"Invalid clock value: {value}")
    return hour * 60 + minute


def format_clock(minutes: int) -> str:
    hour = minutes // 60
    minute = minutes % 60
    suffix = "AM" if hour < 12 else "PM"
    display_hour = hour % 12 or 12
    if minute:
        return f"{display_hour}:{minute:02d}{suffix.lower()}"
    return f"{display_hour}:00{suffix.lower()}"


def sessions_overlap(start_a: int, end_a: int, start_b: int, end_b: int) -> bool:
    return start_a < end_b and start_b < end_a


def build_schedule_label(sessions: list[dict]) -> str:
    if not sessions:
        return "TBA"
    day_indexes = sorted(
        {
            DAY_NAME_TO_INDEX.get((session.get("day") or "").strip().lower(), 99)
            for session in sessions
        }
    )
    day_indexes = [index for index in day_indexes if index != 99]
    day_part = "".join(DAY_CODES[index] for index in day_indexes)
    starts = [parse_clock(session["start"]) for session in sessions]
    ends = [parse_clock(session["end"]) for session in sessions]
    return f"{day_part} {format_clock(min(starts))}-{format_clock(max(ends))}"
