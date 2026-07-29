from datetime import datetime

from pydantic import BaseModel, computed_field

from src.payments.qr import vietqr_svg_data_uri


class DepositCreateRequest(BaseModel):
    amount: int


class DepositResponse(BaseModel):
    id: int
    amount: int
    status: str
    checkout_url: str | None = None
    qr_code: str | None = None
    paid_amount: int | None = None
    created_at: datetime
    expires_at: datetime
    paid_at: datetime | None = None

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def qr_svg(self) -> str | None:
        """Ảnh QR dựng sẵn (data URI SVG) từ `qr_code` — frontend nhét thẳng
        vào <img> nên buyer quét được NGAY TRÊN TRANG VÍ, không phải mở trang
        thanh toán của nhà cung cấp (máy trong mạng nội bộ không ra được
        internet thì trang đó không mở nổi — sự cố test 29/07).

        Chỉ dựng cho lệnh còn chờ thanh toán: lệnh đã trả/huỷ/hết hạn thì QR
        vô nghĩa, và khỏi tốn công vẽ cho cả trang lịch sử."""
        if self.status != "pending":
            return None
        return vietqr_svg_data_uri(self.qr_code)


class AdminDepositResponse(DepositResponse):
    account_id: int
    account_email: str | None = None
    payment_link_id: str | None = None
    payos_reference: str | None = None
