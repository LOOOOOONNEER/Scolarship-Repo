#!/usr/bin/env python3
"""Fails CI when code crosses the privacy boundaries in the technical plan.

1. The discovery worker must never query student tables.
2. No logging statement anywhere may reference a questionnaire field.

The database already enforces (1) with grants; this catches mistakes earlier and
keeps the intent visible in review.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

STUDENT_TABLES = (
    "profiles", "profile_sensitive", "consents", "matches", "notifications",
    "push_subscriptions", "submissions", "error_reports",
)
SQL_TABLE_REF = re.compile(
    r"(?i)\b(?:from|join|into|update|table)\s+(?:public\.)?(" + "|".join(STUDENT_TABLES) + r")\b(?!_for_worker)"
)

PROFILE_FIELDS = (
    "birth_date", "grade_value", "grade_scale", "grade_source", "residence_province_id",
    "residence_locality_id", "residency_years", "parent_registered_voter", "income_bracket", "is_4ps",
    "citizenship", "holds_other_scholarship", "is_pwd", "is_indigenous", "is_solo_parent_child",
    "is_ofw_dependent", "is_athlete", "is_first_gen", "guardian_name", "guardian_contact",
    "export_my_data",
)
LOG_CALL = re.compile(r"\b(console\.(log|info|warn|error|debug)|log(ger)?\.(debug|info|warning|error|exception|critical)|logging\.\w+|print)\s*\(")
FIELD_REF = re.compile(r"\b(" + "|".join(PROFILE_FIELDS) + r")\b")

LOG_SCAN_DIRS = ("web/src", "worker/src", "supabase/functions")
SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx"}


def files_under(rel: str):
    base = ROOT / rel
    if not base.exists():
        return
    for path in sorted(base.rglob("*")):
        if path.suffix in SOURCE_SUFFIXES and "node_modules" not in path.parts:
            yield path


def main() -> int:
    problems: list[str] = []

    for path in files_under("worker/src"):
        for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            m = SQL_TABLE_REF.search(line)
            if m:
                problems.append(f"{path.relative_to(ROOT)}:{no}: worker references student table '{m.group(1)}'")

    for rel in LOG_SCAN_DIRS:
        for path in files_under(rel):
            for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if LOG_CALL.search(line):
                    m = FIELD_REF.search(line)
                    if m:
                        problems.append(
                            f"{path.relative_to(ROOT)}:{no}: logging statement mentions student field '{m.group(1)}'"
                        )

    if problems:
        print("Privacy boundary check failed:")
        for p in problems:
            print("  " + p)
        return 1
    print("Privacy boundary check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
