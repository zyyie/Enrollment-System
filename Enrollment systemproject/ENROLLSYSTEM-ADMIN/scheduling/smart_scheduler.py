"""Free local smart scheduler — constraint-based scheduling, no API keys or tokens."""

from __future__ import annotations

import random

from .greedy_scheduler import GreedyScheduler
from .models import ScheduleAssignment, SchedulerInput


class SmartScheduler:
    """Tries multiple placement strategies until a conflict-free schedule is found."""

    def __init__(self):
        self._greedy = GreedyScheduler()

    def generate(
        self,
        scheduler_input: SchedulerInput,
        *,
        existing_assignments: list[ScheduleAssignment] | None = None,
        teachers: list[dict] | None = None,
    ) -> list[ScheduleAssignment]:
        strategies = [
            {},
            {"reverse_rooms": True},
            {"reverse_patterns": True},
            {"reverse_rooms": True, "reverse_patterns": True},
            {"shuffle_rooms": True},
            {"shuffle_patterns": True},
            {"shuffle_rooms": True, "shuffle_patterns": True},
            {"reverse_rooms": True, "shuffle_patterns": True},
        ]

        last_error: RuntimeError | None = None
        for strategy in strategies:
            try:
                return self._greedy.generate(
                    scheduler_input,
                    existing_assignments=existing_assignments,
                    teachers=teachers,
                    **strategy,
                )
            except RuntimeError as err:
                last_error = err

        random.seed()
        for attempt in range(24):
            try:
                return self._greedy.generate(
                    scheduler_input,
                    existing_assignments=existing_assignments,
                    teachers=teachers,
                    shuffle_rooms=True,
                    shuffle_patterns=True,
                )
            except RuntimeError as err:
                last_error = err
                random.seed(attempt + 1)

        raise RuntimeError(
            str(last_error) if last_error else "Could not build a conflict-free schedule"
        )
