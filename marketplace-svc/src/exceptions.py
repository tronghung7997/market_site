from fastapi import HTTPException, status


class InsufficientCredit(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Số dư ví không đủ để thực hiện giao dịch này")


class ResourceUnavailable(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail="Sản phẩm này tạm hết hàng, vui lòng chọn gói khác hoặc quay lại sau")


class NotOwner(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail="Bạn không có quyền thao tác trên tài nguyên này")


class DuplicateEmail(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail="Email này đã được đăng ký")
