"""Command line entry point: python -m scholarship_worker <command>."""

from __future__ import annotations

import argparse
import logging

from scholarship_worker.config import ConfigError, Settings
from scholarship_worker.logsafe import configure_logging

log = logging.getLogger("scholarship_worker")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="scholarship_worker")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check-config", help="validate settings without connecting")
    sub.add_parser("heartbeat", help="record a health check of the source registry")
    args = parser.parse_args(argv)

    configure_logging(logging.DEBUG if args.verbose else logging.INFO)

    try:
        settings = Settings.from_env()
    except ConfigError as exc:
        log.error("configuration error: %s", exc)
        return 2

    if args.command == "check-config":
        log.info("configuration ok (user agent: %s)", settings.user_agent)
        return 0

    from scholarship_worker.db import connect

    conn = connect(settings.database_url)
    try:
        if args.command == "heartbeat":
            from scholarship_worker.jobs import heartbeat

            heartbeat.run(conn)
    finally:
        conn.close()
    return 0
