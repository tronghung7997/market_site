"""Vẽ mã QR VietQR thành SVG ngay tại server.

Vì sao ở đây mà không phải trình duyệt: chuỗi VietQR (`DepositIntent.qr_code`,
PayOS trả về lúc tạo link) vốn đã nằm server-side, và render nó là một hàm
thuần. Đưa ảnh QR về cùng response nghĩa là trang nạp tiền KHÔNG cần trình
duyệt buyer gọi ra bất kỳ domain nào khác — trước đây buyer bị đẩy sang trang
thanh toán của nhà cung cấp, máy nào không ra được internet là tắc luôn ở đó
dù lệnh nạp đã tạo thành công (sự cố khi test trong mạng nội bộ 29/07).

Trả về data URI để nhét thẳng vào `<img src>`: `<img>` không gửi được header
Authorization nên một endpoint ảnh riêng sẽ phải tự chế cơ chế xác thực khác,
trong khi QR chỉ có nghĩa với đúng người vừa tạo lệnh nạp.
"""
import base64
import io

import segno

# Mức sửa lỗi M — cân bằng chuẩn cho QR thanh toán: chịu được vết xước/loá khi
# quét từ màn hình mà không phình kích thước như mức Q/H.
_ERROR_LEVEL = "m"


def vietqr_svg_data_uri(qr_payload: str | None) -> str | None:
    """Chuỗi VietQR → data URI của ảnh SVG. None nếu không có payload.

    SVG (không phải PNG) vì nó nét ở mọi kích thước — buyer hay phóng to
    màn hình để điện thoại bắt được mã.
    """
    if not qr_payload:
        return None
    buf = io.BytesIO()
    segno.make(qr_payload, error=_ERROR_LEVEL).save(
        buf,
        kind="svg",
        scale=1,          # kích thước thật do CSS quyết định
        border=2,         # vùng trắng tối thiểu để máy quét bắt được viền
        dark="#000000",
        light="#ffffff",  # nền trắng tường minh: QR trên nền tối là không quét được
        xmldecl=False,
        svgns=True,
    )
    encoded = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/svg+xml;base64,{encoded}"
