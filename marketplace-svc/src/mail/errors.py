"""Application errors for mail runtime config / admin outbox."""


class MailConfigError(Exception):
    """Invalid admin mail-config input."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class MailNotReady(Exception):
    """Provider/from/secrets are not sufficient to send."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class MailTestCooldown(Exception):
    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("mail test cooldown")
        self.retry_after_seconds = retry_after_seconds


class MailOutboxNotFound(Exception):
    pass


class MailOutboxConflict(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail
