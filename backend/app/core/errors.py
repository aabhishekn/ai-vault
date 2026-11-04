"""Public service errors; the API layer renders these as JSON responses."""


class AppError(Exception):
    status_code = 500

    def __init__(self, detail: str | dict):
        self.detail = detail
        super().__init__(str(detail))


class InvalidInputError(AppError):
    status_code = 400


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class ContentTooLargeError(AppError):
    status_code = 413


class UnsupportedDocumentError(AppError):
    status_code = 415


class StorageError(AppError):
    status_code = 500


class InvalidAIResponseError(AppError, ValueError):
    status_code = 502


class DependencyUnavailableError(AppError):
    status_code = 503


class ConfigurationError(RuntimeError):
    """A required local setting is missing or invalid."""
