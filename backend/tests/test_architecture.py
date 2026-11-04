"""Keep the layer boundaries that make this backend maintainable."""

import ast
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def imported_modules(path):
    modules = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.append(node.module)
    return modules


class ArchitectureTests(unittest.TestCase):
    def test_routes_do_not_access_database_or_provider_directly(self):
        for path in (APP / "api" / "routes").glob("*.py"):
            with self.subTest(module=path.name):
                self.assertFalse(
                    any(
                        module.startswith(
                            ("sqlalchemy", "openai", "redis", "app.db", "app.ai", "app.tasks")
                        )
                        for module in imported_modules(path)
                    )
                )

    def test_business_services_do_not_import_the_web_framework(self):
        for path in (APP / "services").glob("*.py"):
            with self.subTest(module=path.name):
                self.assertFalse(
                    any(
                        module.startswith(("fastapi", "starlette", "app.api"))
                        for module in imported_modules(path)
                    )
                )

    def test_database_and_processing_helpers_do_not_depend_on_routes_or_services(self):
        for directory in ("db", "processing"):
            for path in (APP / directory).glob("*.py"):
                with self.subTest(module=path.name):
                    self.assertFalse(
                        any(
                            module.startswith(("app.api", "app.services", "fastapi"))
                            for module in imported_modules(path)
                        )
                    )
