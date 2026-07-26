"""Orchestrates cloud AI generation, validation, and local fallback."""

from __future__ import annotations

import re
from typing import Any

from enrollment_curriculum import ENROLLMENT_CURRICULUM, ENROLLMENT_STRANDS, ENROLLMENT_TRACKS, STRAND_TRACK

from .cloud_ai_client import CloudAIClient
from .schedule_coverage import (
    count_by_strand,
    is_complete,
    missing_keys,
    strands_with_gaps,
)
from .conflict_validator import assignments_from_payload, validate_schedule
from .faculty_assigner import assign_faculty_to_assignments
from .models import ScheduleAssignment, SchedulerInput
from .scheduling_context import build_scheduling_context
from .smart_scheduler import SmartScheduler
from .time_slots import DAY_NAMES, default_time_slot_labels
from .time_utils import build_schedule_label


DEFAULT_ROOMS = [
    "NB101", "NB102", "NB103", "NB104", "NB105", "NB106", "NB107", "NB108",
    "NB201", "NB202", "NB203", "NB204",
    "LAB1", "LAB2", "LAB3",
]


def compute_ai_cooldown_sec(progress_log: list[dict[str, str]], source: str) -> int:
    """Suggest wait time before the next cloud AI strand call."""
    if source == "smart_ai_fallback":
        return 0

    had_rate_limit = False
    max_pause = 0
    for entry in progress_log or []:
        message = entry.get("message") or ""
        lower = message.lower()
        if "429" in message or "rate limit" in lower:
            had_rate_limit = True
        match = re.search(r"pausing\s+(\d+)s", lower)
        if match:
            max_pause = max(max_pause, int(match.group(1)))

    if had_rate_limit:
        return max(30, max_pause + 15)
    if any((entry.get("message") or "").lower().find("cloud ai") >= 0 for entry in progress_log or []):
        return 10
    return 0


def _strand_success_payload(
    *,
    strand_code: str,
    source: str,
    assignments: list[ScheduleAssignment],
    existing_assignments: list[ScheduleAssignment],
    progress_log: list[dict[str, str]],
    teachers: list[dict] | None = None,
    ai_error: str | None = None,
) -> dict[str, Any]:
    assign_faculty_to_assignments(assignments, teachers or [])
    combined = list(existing_assignments)
    combined.extend(assignments)
    validation = validate_schedule(combined)
    cooldown_sec = compute_ai_cooldown_sec(progress_log, source)
    return {
        "success": validation.valid,
        "strand": strand_code,
        "source": source,
        "ai_error": ai_error,
        "progress": progress_log,
        "validation": validation.to_dict(),
        "count": len(assignments),
        "strand_count": len(assignments),
        "schedules": [item.to_dict() for item in assignments],
        "combined_valid": validation.valid,
        "cooldown_sec": cooldown_sec,
        "error": None if validation.valid else (
            f"Schedule has {len(validation.conflicts)} conflict(s). "
            "Section A/B must use different times."
        ),
    }


class SchedulerService:
    def __init__(
        self,
        *,
        groq_api_key: str = "",
        groq_model: str = "llama-3.1-8b-instant",
        openrouter_api_key: str = "",
        openrouter_model: str = "meta-llama/llama-3.3-70b-instruct:free",
        gemini_api_key: str = "",
        gemini_model: str = "gemini-2.0-flash",
        rest_get=None,
    ):
        self._rest_get = rest_get
        self.cloud_ai = CloudAIClient(
            groq_api_key=groq_api_key,
            groq_model=groq_model,
            openrouter_api_key=openrouter_api_key,
            openrouter_model=openrouter_model,
            gemini_api_key=gemini_api_key,
            gemini_model=gemini_model,
        )
        self.smart = SmartScheduler()

    def get_default_config(self) -> dict[str, Any]:
        primary = self.cloud_ai.primary_provider
        providers = self.cloud_ai.list_providers()
        return {
            "strands": ENROLLMENT_STRANDS,
            "tracks": ENROLLMENT_TRACKS,
            "strand_tracks": STRAND_TRACK,
            "sections_per_strand": 2,
            "rooms": DEFAULT_ROOMS,
            "days": DAY_NAMES[:5],
            "time_slots": default_time_slot_labels(include_saturday=False),
            "grade_levels": ["Grade 11", "Grade 12"],
            "semester_codes": ["1st", "2nd"],
            "scheduler_mode": "cloud_ai" if self.cloud_ai.configured else "needs_api_key",
            "requires_api_key": not self.cloud_ai.configured,
            "ai_model_ready": self.cloud_ai.configured,
            "ai_provider": primary.name if primary else None,
            "ai_provider_label": primary.label if primary else None,
            "ai_model": primary.model if primary else None,
            "ai_providers": [
                {"name": item.name, "label": item.label, "model": item.model}
                for item in providers
            ],
            "setup_hint": (
                None
                if self.cloud_ai.configured
                else "Add OPENROUTER_API_KEY to .env — get a key at https://openrouter.ai/keys"
            ),
            "rate_limit": {
                "section_delay_sec": 1.5,
                "strand_delay_sec": 1,
                "subject_chunk_size": 20,
                "max_retries": 4,
                "backoff_base_sec": 6,
            },
            "fallback_providers": [
                item.name for item in providers if item.name != (primary.name if primary else "")
            ],
            # Backward compatibility
            "cloud_ai_available": self.cloud_ai.configured,
            "cloud_ai_model": primary.model if primary else None,
            "smart_ai_ready": True,
        }

    def build_input(
        self,
        *,
        grade_level: str = "Grade 12",
        semester_code: str = "1st",
        strands: list[str] | None = None,
        sections_per_strand: int = 2,
        rooms: list[str] | None = None,
    ) -> SchedulerInput:
        selected_strands = [strand.upper() for strand in (strands or ENROLLMENT_STRANDS)]
        subjects = self._subjects_for_term(grade_level, semester_code)

        return SchedulerInput(
            grade_level=grade_level,
            semester_code=semester_code,
            strands=selected_strands,
            sections_per_strand=max(1, min(sections_per_strand, 2)),
            rooms=rooms or DEFAULT_ROOMS,
            days=DAY_NAMES[:5],
            time_slots=default_time_slot_labels(include_saturday=False),
            subjects=subjects,
        )

    def get_scheduling_context(
        self,
        *,
        grade_level: str = "Grade 12",
        semester_code: str = "1st",
        strands: list[str] | None = None,
        rooms: list[str] | None = None,
    ) -> dict[str, Any]:
        return build_scheduling_context(
            grade_level=grade_level,
            semester_code=semester_code,
            strands=strands,
            rooms=rooms,
            rest_get=self._rest_get,
        )

    def generate(
        self,
        *,
        grade_level: str = "Grade 12",
        semester_code: str = "1st",
        strands: list[str] | None = None,
        sections_per_strand: int = 2,
        rooms: list[str] | None = None,
        use_ai: bool = True,
        use_cloud_ai: bool = True,
        allow_local_fallback: bool = True,
    ) -> dict[str, Any]:
        scheduler_input = self.build_input(
            grade_level=grade_level,
            semester_code=semester_code,
            strands=strands,
            sections_per_strand=sections_per_strand,
            rooms=rooms,
        )
        payload = scheduler_input.to_dict()
        ai_error = None

        if not use_ai:
            return {
                "success": False,
                "error": "AI scheduling is disabled. Enable AI auto-schedule to generate.",
                "source": "failed",
                "input": payload,
            }

        assignments: list[ScheduleAssignment] = []
        if use_cloud_ai:
            if not self.cloud_ai.configured:
                if not allow_local_fallback:
                    return {
                        "success": False,
                        "error": "Cloud AI is not configured.",
                        "source": "failed",
                        "setup_hint": "Add GROQ_API_KEY to .env (free at https://console.groq.com/keys)",
                        "input": payload,
                    }
                ai_error = "Cloud AI not configured — using local fallback."
            else:
                report = self.cloud_ai.generate_with_report(payload, timeout=120)
                ai_payload = {"schedules": report.schedules} if report.schedules else None
                ai_error = " | ".join(report.errors) if report.errors else None
                provider = report.provider

                if ai_payload and isinstance(ai_payload.get("schedules"), list):
                    assignments = assignments_from_payload(ai_payload["schedules"])
                    self._attach_schedule_labels(assignments)
                    gap_strands: list[str] = []

                    if not is_complete(scheduler_input, assignments):
                        gap_strands = strands_with_gaps(scheduler_input, assignments)
                        assignments = self._fill_gaps(scheduler_input, assignments, gap_strands)
                        self._attach_schedule_labels(assignments)
                        if gap_strands:
                            ai_error = (
                                (ai_error + " | ") if ai_error else ""
                            ) + f"Filled missing strands with local scheduler: {', '.join(gap_strands)}"

                    validation = validate_schedule(assignments)
                    if validation.valid and is_complete(scheduler_input, assignments):
                        return self._success_response(
                            assignments,
                            source=f"{provider}_ai" if provider else "groq_ai",
                            validation=validation,
                            input_payload=payload,
                            ai_error=ai_error if gap_strands else None,
                            strand_counts=count_by_strand(assignments),
                        )
                    ai_error = (
                        ai_error
                        or f"Schedule had {len(validation.conflicts)} conflict(s) or missing subjects."
                    )
                if not allow_local_fallback:
                    return {
                        "success": False,
                        "error": ai_error or "Cloud AI could not produce a valid schedule.",
                        "source": "failed",
                        "input": payload,
                    }
                ai_error = (ai_error or "Cloud AI failed") + " Using local fallback."

        try:
            assignments = self._generate_local(scheduler_input)
            self._attach_schedule_labels(assignments)
        except RuntimeError as err:
            return {
                "success": False,
                "error": str(err),
                "source": "failed",
                "ai_error": ai_error,
                "input": payload,
            }

        validation = validate_schedule(assignments)
        if not validation.valid:
            return {
                "success": False,
                "error": "Local fallback scheduler produced conflicts.",
                "source": "failed",
                "validation": validation.to_dict(),
                "ai_error": ai_error,
                "input": payload,
            }

        return self._success_response(
            assignments,
            source="smart_ai_fallback",
            validation=validation,
            input_payload=payload,
            ai_error=ai_error,
            strand_counts=count_by_strand(assignments),
        )

    def generate_strand(
        self,
        *,
        strand: str,
        grade_level: str = "Grade 12",
        semester_code: str = "1st",
        sections_per_strand: int = 2,
        rooms: list[str] | None = None,
        existing_schedules: list[dict] | None = None,
        use_ai: bool = True,
        use_cloud_ai: bool = True,
        allow_local_fallback: bool = True,
    ) -> dict[str, Any]:
        strand_code = (strand or "").upper()
        if not strand_code:
            return {"success": False, "error": "Strand is required.", "source": "failed"}

        scheduler_input = self.build_input(
            grade_level=grade_level,
            semester_code=semester_code,
            strands=[strand_code],
            sections_per_strand=sections_per_strand,
            rooms=rooms,
        )
        payload = scheduler_input.to_dict()
        ai_error: str | None = None
        source = "smart_ai_fallback"
        assignments: list[ScheduleAssignment] = []

        if not use_ai:
            return {"success": False, "error": "AI scheduling is disabled.", "source": "failed", "strand": strand_code}

        existing_payload = existing_schedules or []
        existing_assignments = assignments_from_payload(existing_payload)
        self._attach_schedule_labels(existing_assignments)

        progress_log: list[dict[str, str]] = []

        def on_progress(level: str, message: str) -> None:
            progress_log.append({"level": level, "message": message})

        scheduling_ctx = self.get_scheduling_context(
            grade_level=grade_level,
            semester_code=semester_code,
            strands=[strand_code],
            rooms=rooms,
        )
        teachers = scheduling_ctx.get("teacher_availability") or []
        payload["scheduling_context"] = scheduling_ctx
        on_progress("info", "AI collected scheduling data (teachers, rooms, labs, student load).")

        if allow_local_fallback:
            try:
                local_assignments = self._generate_local(
                    scheduler_input,
                    existing_payload,
                    teachers=teachers,
                )
                self._attach_schedule_labels(local_assignments)
                local_complete = is_complete(scheduler_input, local_assignments)
                combined_preview = existing_assignments + local_assignments
                preview_validation = validate_schedule(combined_preview)
                local_valid = local_complete and preview_validation.valid
                if local_valid:
                    on_progress(
                        "success",
                        f"{strand_code} scheduled instantly via rule-based scheduler.",
                    )
                    return _strand_success_payload(
                        strand_code=strand_code,
                        source="smart_ai_fallback",
                        assignments=local_assignments,
                        existing_assignments=existing_assignments,
                        progress_log=progress_log,
                        teachers=teachers,
                    )
                if local_complete:
                    on_progress(
                        "info",
                        "Rule-based schedule had conflicts — trying cloud AI once.",
                    )
                else:
                    on_progress("info", "Rule-based schedule incomplete — trying cloud AI once.")
            except RuntimeError as err:
                on_progress("info", f"Rule-based scheduler unavailable ({err}) — trying cloud AI once.")

        if use_cloud_ai and self.cloud_ai.configured:
            report = self.cloud_ai.generate_one_strand(
                payload,
                strand_code,
                already_scheduled=existing_payload,
                timeout=90,
                on_progress=on_progress,
                scheduling_context=scheduling_ctx,
            )
            ai_error = " | ".join(report.errors) if report.errors else None

            if report.schedules:
                ai_assignments = assignments_from_payload(report.schedules)
                self._attach_schedule_labels(ai_assignments)
                combined_preview = existing_assignments + ai_assignments
                preview_validation = validate_schedule(combined_preview)
                ai_complete = is_complete(scheduler_input, ai_assignments)
                ai_valid = ai_complete and preview_validation.valid

                if ai_valid:
                    source = f"{report.provider}_ai" if report.provider else "groq_ai"
                    on_progress("success", f"{strand_code} scheduled successfully via cloud AI.")
                    return _strand_success_payload(
                        strand_code=strand_code,
                        source=source,
                        assignments=ai_assignments,
                        existing_assignments=existing_assignments,
                        progress_log=progress_log,
                        teachers=teachers,
                        ai_error=ai_error,
                    )

                issue_bits = []
                if not ai_complete:
                    issue_bits.append("incomplete subjects")
                if not preview_validation.valid:
                    issue_bits.append(f"{len(preview_validation.conflicts)} conflict(s)")
                issue_text = " and ".join(issue_bits) or "validation failed"
                on_progress(
                    "warn",
                    f"Cloud AI result had {issue_text} — switching to rule-based scheduler.",
                )
                ai_error = ((ai_error + " | ") if ai_error else "") + f"Cloud AI {issue_text}."
            elif ai_error:
                on_progress("warn", f"Cloud AI failed ({ai_error}) — switching to rule-based scheduler.")

            try:
                assignments = self._generate_local(
                    scheduler_input,
                    existing_payload,
                    teachers=teachers,
                )
                self._attach_schedule_labels(assignments)
                combined_preview = existing_assignments + assignments
                local_validation = validate_schedule(combined_preview)
                local_complete = is_complete(scheduler_input, assignments)
                if local_complete and local_validation.valid:
                    repair_note = f"{strand_code}: cloud AI failed — used rule-based scheduler."
                    ai_error = ((ai_error + " | ") if ai_error else "") + repair_note
                    on_progress("success", f"{strand_code} scheduled via rule-based scheduler.")
                    return _strand_success_payload(
                        strand_code=strand_code,
                        source="smart_ai_fallback",
                        assignments=assignments,
                        existing_assignments=existing_assignments,
                        progress_log=progress_log,
                        teachers=teachers,
                        ai_error=ai_error,
                    )
                if local_complete:
                    on_progress("warn", "Rule-based schedule still has conflicts after cloud AI.")
            except RuntimeError as err:
                ai_error = ((ai_error + " | ") if ai_error else "") + str(err)

            return {
                "success": False,
                "error": ai_error or f"Could not build a valid schedule for {strand_code}.",
                "source": "failed",
                "strand": strand_code,
                "ai_error": ai_error,
                "progress": progress_log,
            }

        if allow_local_fallback:
            try:
                assignments = self._generate_local(
                    scheduler_input,
                    existing_payload,
                    teachers=teachers,
                )
                self._attach_schedule_labels(assignments)
            except RuntimeError as err:
                return {
                    "success": False,
                    "error": str(err),
                    "source": "failed",
                    "strand": strand_code,
                    "progress": progress_log,
                }
            if not self.cloud_ai.configured:
                ai_error = "Cloud AI not configured — local scheduler used."
        else:
            return {
                "success": False,
                "error": "Cloud AI is not configured.",
                "source": "failed",
                "strand": strand_code,
                "progress": progress_log,
            }

        combined = list(existing_assignments)
        combined.extend(assignments)
        validation = validate_schedule(combined)

        if not is_complete(scheduler_input, assignments):
            return {
                "success": False,
                "error": f"Could not complete all subjects for {strand_code}.",
                "source": "failed",
                "strand": strand_code,
                "ai_error": ai_error,
                "schedules": [item.to_dict() for item in assignments],
                "count": len(assignments),
                "validation": validation.to_dict(),
                "progress": progress_log,
            }

        if not validation.valid:
            return {
                "success": False,
                "error": (
                    f"Schedule has {len(validation.conflicts)} conflict(s) after adding {strand_code}. "
                    "Try again or reduce sections per strand."
                ),
                "source": "failed",
                "strand": strand_code,
                "ai_error": ai_error,
                "schedules": [item.to_dict() for item in combined],
                "count": len(combined),
                "validation": validation.to_dict(),
                "progress": progress_log,
            }

        return _strand_success_payload(
            strand_code=strand_code,
            source=source,
            assignments=assignments,
            existing_assignments=existing_assignments,
            progress_log=progress_log,
            teachers=teachers,
            ai_error=ai_error,
        )

    def _generate_local(
        self,
        scheduler_input: SchedulerInput,
        existing_schedules: list[dict] | None = None,
        teachers: list[dict] | None = None,
    ) -> list[ScheduleAssignment]:
        if teachers is None:
            ctx = self.get_scheduling_context(
                grade_level=scheduler_input.grade_level,
                semester_code=scheduler_input.semester_code,
                strands=scheduler_input.strands,
                rooms=scheduler_input.rooms,
            )
            teachers = ctx.get("teacher_availability") or []
        existing = assignments_from_payload(existing_schedules or [])
        self._attach_schedule_labels(existing)
        return self.smart.generate(
            scheduler_input,
            existing_assignments=existing,
            teachers=teachers,
        )

    def _fill_gaps(
        self,
        scheduler_input: SchedulerInput,
        assignments: list[ScheduleAssignment],
        gap_strands: list[str],
    ) -> list[ScheduleAssignment]:
        if not gap_strands:
            return assignments

        gap_set = {strand.upper() for strand in gap_strands}
        merged = [item for item in assignments if (item.strand or "").upper() not in gap_set]

        for strand in gap_strands:
            strand_input = SchedulerInput(
                grade_level=scheduler_input.grade_level,
                semester_code=scheduler_input.semester_code,
                strands=[strand.upper()],
                sections_per_strand=scheduler_input.sections_per_strand,
                rooms=scheduler_input.rooms,
                days=scheduler_input.days,
                time_slots=scheduler_input.time_slots,
                subjects=scheduler_input.subjects,
            )
            merged.extend(
                self.smart.generate(
                    strand_input,
                    existing_assignments=list(merged),
                    teachers=self.get_scheduling_context(
                        grade_level=scheduler_input.grade_level,
                        semester_code=scheduler_input.semester_code,
                        strands=[strand.upper()],
                        rooms=scheduler_input.rooms,
                    ).get("teacher_availability")
                    or [],
                )
            )
        return merged

    def validate_payload(self, schedules: list[dict]) -> dict[str, Any]:
        assignments = assignments_from_payload(schedules)
        self._attach_schedule_labels(assignments)
        validation = validate_schedule(assignments)
        return {
            "success": validation.valid,
            "validation": validation.to_dict(),
            "schedules": [item.to_dict() for item in assignments],
            "count": len(assignments),
        }

    def _subjects_for_term(self, grade_level: str, semester_code: str) -> list[dict[str, Any]]:
        term = ENROLLMENT_CURRICULUM.get(grade_level, {}).get(semester_code)
        if not term:
            return []

        subjects: list[dict[str, Any]] = []
        for core in term.get("core", []):
            subjects.append(
                {
                    "code": core["code"],
                    "description": core["description"],
                    "units": core.get("units", 3),
                    "strand": None,
                    "type": "core",
                }
            )
        for applied in term.get("applied", []):
            subjects.append(
                {
                    "code": applied["code"],
                    "description": applied["description"],
                    "units": applied.get("units", 3),
                    "strand": None,
                    "type": "applied",
                }
            )
        for strand, specs in term.get("specialized", {}).items():
            for spec in specs:
                subjects.append(
                    {
                        "code": spec["code"],
                        "description": spec["description"],
                        "units": spec.get("units", 3),
                        "strand": strand,
                        "type": "specialized",
                    }
                )
        return subjects

    @staticmethod
    def _attach_schedule_labels(assignments: list[ScheduleAssignment]) -> None:
        for assignment in assignments:
            if assignment.schedule_label:
                continue
            assignment.schedule_label = build_schedule_label(
                [session.to_dict() for session in assignment.sessions]
            )

    @staticmethod
    def _success_response(
        assignments: list[ScheduleAssignment],
        *,
        source: str,
        validation,
        input_payload: dict,
        ai_error: str | None,
        strand_counts: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        return {
            "success": True,
            "source": source,
            "ai_error": ai_error,
            "validation": validation.to_dict(),
            "input": input_payload,
            "count": len(assignments),
            "strand_counts": strand_counts or count_by_strand(assignments),
            "schedules": [assignment.to_dict() for assignment in assignments],
        }
