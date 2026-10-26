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
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    batch_size: int = 40
    llm_daily_limit: int = 1000

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

        try:
            batch = int(env.get("WORKER_BATCH_SIZE", "40"))
            llm_limit = int(env.get("WORKER_LLM_DAILY_LIMIT", "1000"))
        except ValueError as exc:
            raise ConfigError("WORKER_BATCH_SIZE and WORKER_LLM_DAILY_LIMIT must be whole numbers") from exc
        if not (1 <= batch <= 500):
            raise ConfigError("WORKER_BATCH_SIZE must be between 1 and 500")

        return cls(
            database_url=url,
            user_agent=agent,
            per_host_delay_s=delay,
            gemini_api_key=env.get("GEMINI_API_KEY", "").strip(),
            gemini_model=env.get("WORKER_GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash",
            batch_size=batch,
            llm_daily_limit=max(0, llm_limit),
        )
