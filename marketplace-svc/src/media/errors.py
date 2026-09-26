from src.errors.codes import ErrorCode


class MediaError(Exception):
    """Application error of the media module; ``errors.handlers`` maps it to a
    coded HTTP response, so feature services can call ``media.service`` without
    translating it themselves."""

    def __init__(self, code: ErrorCode, status_code: int, **params) -> None:
        super().__init__(code.value)
        self.code = code
        self.status_code = status_code
        self.params = params
