"""Scholarship Finder discovery worker.

Privacy boundary: this package connects as the `discovery_worker` Postgres role,
which has no grant on any student table. It must never query profiles, answers,
consents, matches, notifications or submissions (it reads submitted links only
through `submissions_for_worker`, which carries no student id).
CI enforces this with scripts/check_privacy_boundaries.py.
"""

__version__ = "0.1.0"
