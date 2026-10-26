"""Settings, read from environment variables (GitHub Actions secrets in production)."""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    database_url: str
    # Identifies the bot to the sites it reads, with a way to reach a human.
    user_agent: str
    # Minimum seconds between two requests to the same host.
    per_host_delay_s: float

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = dict(os.environ if env is None else env)
        url = env.get("WORKER_DATABASE_URL", "").strip()
        if not url:
            raise ConfigError("WORKER_DATABASE_URL is not set")
        if not url.startswith(("postgresql://", "postgres://")):
            raise ConfigError("WORKER_DATABASE_URL must be a postgresql:// connection string")
        if "discovery_worker" not in url:
            # The worker must use its own restricted role, never the postgres
            # superuser or a service-role connection.
            raise ConfigError("WORKER_DATABASE_URL must connect as the discovery_worker role")

        contact = env.get("WORKER_CONTACT", "").strip()
        agent = "ScholarshipFinderBot/0.1"
        if contact:
            agent += f" (+{contact})"

        delay = float(env.get("WORKER_PER_HOST_DELAY_S", "5"))
        if delay < 1:
            raise ConfigError("WORKER_PER_HOST_DELAY_S must be at least 1 second")

        return cls(database_url=url, user_agent=agent, per_host_delay_s=delay)
