import unittest

from scholarship_worker.config import ConfigError, Settings

GOOD_URL = "postgresql://discovery_worker.projectref:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"


class SettingsTests(unittest.TestCase):
    def test_requires_database_url(self):
        with self.assertRaises(ConfigError):
            Settings.from_env({})

    def test_rejects_non_postgres_url(self):
        with self.assertRaises(ConfigError):
            Settings.from_env({"WORKER_DATABASE_URL": "https://example.com"})

    def test_rejects_other_roles(self):
        with self.assertRaises(ConfigError):
            Settings.from_env({"WORKER_DATABASE_URL": "postgresql://postgres:pw@db.example.com/postgres"})

    def test_rejects_too_short_delay(self):
        with self.assertRaises(ConfigError):
            Settings.from_env({"WORKER_DATABASE_URL": GOOD_URL, "WORKER_PER_HOST_DELAY_S": "0.2"})

    def test_good_settings(self):
        s = Settings.from_env({"WORKER_DATABASE_URL": GOOD_URL, "WORKER_CONTACT": "admin@example.org"})
        self.assertEqual(s.per_host_delay_s, 5.0)
        self.assertIn("admin@example.org", s.user_agent)


if __name__ == "__main__":
    unittest.main()
