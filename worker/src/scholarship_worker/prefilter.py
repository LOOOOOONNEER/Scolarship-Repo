"""Cheap keyword pre-filter, run before any AI call.

A page goes to extraction only if it mentions a scholarship-type program AND
something about applying. This keeps AI use well inside the free daily quota.
English and Filipino terms are both recognized.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

PROGRAM_TERMS = [
    r"scholarships?", r"scholars?", r"iskolar(?:ship|s)?", r"iskolar ng bayan", r"grant[- ]in[- ]aid",
    r"educational assistance", r"financial assistance", r"study grants?", r"tertiary education subsidy",
    r"tulong[- ]pang[- ]?edukasyon", r"tulong pinansyal", r"stipends?", r"tuition (?:fee )?(?:subsidy|assistance)",
    r"educational grants?", r"student assistance",
]
ACTION_TERMS = [
    r"apply", r"applicants?", r"applications?", r"deadline", r"requirements?", r"qualifications?",
    r"eligib(?:le|ility)", r"submit(?:ted|ssion)?", r"screening", r"examination", r"registration",
    r"mag-?apply", r"kwalipikasyon", r"kuwalipikasyon", r"pagsusumite", r"hanggang", r"kailangan",
    r"open(?:s|ing)? (?:on|for|until)", r"accepting", r"call for",
]

_PROGRAM = re.compile(r"\b(?:" + "|".join(PROGRAM_TERMS) + r")\b", re.I)
_ACTION = re.compile(r"\b(?:" + "|".join(ACTION_TERMS) + r")\b", re.I)


@dataclass
class PrefilterResult:
    passed: bool
    program_hits: list[str]
    action_hits: list[str]


def check(text: str) -> PrefilterResult:
    program = sorted({m.group(0).lower() for m in _PROGRAM.finditer(text)})
    action = sorted({m.group(0).lower() for m in _ACTION.finditer(text)})
    return PrefilterResult(passed=bool(program and action), program_hits=program, action_hits=action)
