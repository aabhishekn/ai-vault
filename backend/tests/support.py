"""Shared test configuration and process-level database cleanup."""

import atexit
import os
import unittest

from app.db.database import engine

# unittest does not own the application lifespan; release its shared pool at exit.
atexit.register(engine.dispose)
requires_database = unittest.skipUnless(
    os.getenv("RUN_INTEGRATION_TESTS") == "1", "Requires migrated local PostgreSQL"
)
