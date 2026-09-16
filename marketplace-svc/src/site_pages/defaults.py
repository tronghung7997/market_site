"""Seed copy for admin-editable footer pages.

These are the reset source for the built-in slugs. Content is markdown and is
rendered by the storefront with raw HTML disabled, so keep it plain markdown.
Admin edits live in ``site_pages``; nothing here is read on the request path
once the row exists.
"""
from __future__ import annotations

SYSTEM_SLUGS: tuple[str, ...] = ("terms", "warranty", "escrow", "privacy")

_TERMS_VI = """\
## 1. Chấp nhận điều khoản

Bằng việc tạo tài khoản hoặc sử dụng bất kỳ dịch vụ nào trên GMMO, bạn xác nhận đã đọc, hiểu và đồng ý với toàn bộ điều khoản dưới đây. Nếu bạn không đồng ý, hoặc bạn **dưới 18 tuổi**, vui lòng không đăng ký và không sử dụng website.

GMMO là sàn giao dịch trung gian: người bán đăng sản phẩm, người mua thanh toán vào **ví ký quỹ** của sàn, sàn giữ tiền cho đến khi giao dịch hoàn tất. Chúng tôi có thể cập nhật điều khoản này theo thời gian; phiên bản mới có hiệu lực ngay khi được đăng trên trang này.

## 2. Bản chất sản phẩm

- **Tài sản số**: toàn bộ tài khoản, proxy, dữ liệu số bán trên GMMO là tài sản ảo do người bán tạo hoặc sở hữu hợp pháp. Một số tài khoản có thể đã được nuôi lâu ngày, có bạn bè/tương tác sẵn để tăng độ ổn định, nhưng **không đại diện cho bất kỳ cá nhân hay tổ chức thật nào**.
- **Nói không với dữ liệu bất hợp pháp**: GMMO nghiêm cấm rao bán via, host, scan hay bất kỳ dữ liệu nào thu thập trái phép từ người dùng thật. Sản phẩm vi phạm sẽ bị gỡ, người bán bị khoá gian hàng và thu hồi số dư.
- **Trách nhiệm của người bán**: người bán chịu hoàn toàn trách nhiệm về nguồn gốc, mô tả và chất lượng sản phẩm mình đăng. Mô tả trên trang sản phẩm là căn cứ để bảo hành.
- Nếu bạn phát hiện sản phẩm không đúng cam kết, hãy **mở khiếu nại ngay trong đơn hàng** để sàn giữ tiền ký quỹ và xử lý.

## 3. Mục đích sử dụng

Bạn chỉ được dùng sản phẩm mua trên GMMO cho mục đích hợp pháp: marketing (nghiên cứu thị trường, chạy quảng cáo, seeding minh bạch), thương mại điện tử, kiểm thử phần mềm, kiểm thử bảo mật, học tập – nghiên cứu và các mục đích hợp pháp khác.

**Nghiêm cấm** sử dụng vào việc lừa đảo, đánh bạc trái phép, phát tán mã độc, spam, xâm nhập hệ thống, thu thập/phát tán dữ liệu cá nhân trái phép, giả mạo, xúc phạm tổ chức/cá nhân, vi phạm chính sách nền tảng thứ ba, hoặc bất kỳ hành vi nào vi phạm pháp luật Việt Nam và pháp luật nước sở tại.

Khi phát hiện vi phạm, GMMO có quyền **khoá tài khoản vĩnh viễn, thu hồi số dư còn lại và từ chối cung cấp dịch vụ** mà không cần báo trước. Bạn tự chịu trách nhiệm pháp lý đối với mọi hành vi sử dụng tài khoản và dịch vụ. GMMO có thể cung cấp thông tin liên quan (IP đăng nhập, lịch sử giao dịch, dữ liệu tài khoản) theo yêu cầu hợp lệ của cơ quan nhà nước có thẩm quyền.

## 4. Bảo mật sau khi nhận hàng

- GMMO và người bán **không đăng nhập** vào tài khoản đã bán cho bạn khi chưa được đồng ý.
- Ngay sau khi nhận hàng, hãy tự bảo mật: đổi mật khẩu, mật khẩu email liên kết, email khôi phục, bật 2FA của riêng bạn.
- Mật khẩu tài khoản GMMO phải khác với các website khác. Chúng tôi không chịu trách nhiệm với thiệt hại phát sinh do bạn không thực hiện các biện pháp bảo mật cần thiết.

## 5. Mua hàng và đơn hàng

- **Mua thử trước khi mua số lượng lớn**: với sản phẩm mới hoặc người bán mới, hãy mua 1 – 2 đơn để kiểm tra trước khi đặt số lượng lớn.
- Dữ liệu đã giao được lưu trong trang **Đơn hàng** của bạn. Hãy chủ động tải về và lưu lại; sàn có thể dọn dữ liệu đơn cũ theo chính sách lưu trữ.
- Mỗi sản phẩm có **thời hạn ký quỹ** riêng, hiển thị trên trang sản phẩm. Hết thời hạn mà không có khiếu nại, tiền được giải ngân cho người bán và không thể hoàn lại.

## 6. Ví, nạp và rút tiền

- Số dư ví được ghi nhận bằng VND. Các kênh nạp tiền và tỉ giá quy đổi tham khảo hiển thị tại trang **Ví**.
- Yêu cầu rút tiền được xử lý theo quy định hiển thị ở thời điểm tạo lệnh (hạn mức, phí nếu có). Nếu lỗi phát sinh từ phía GMMO, bạn được rút tiền không mất phí.
- Số dư có nguồn gốc gian lận, chargeback hoặc vi phạm điều khoản có thể bị tạm giữ để điều tra.

## 7. Khiếu nại và giải quyết tranh chấp

Người mua và người bán trao đổi trực tiếp trong khiếu nại của đơn hàng. Nếu hai bên không thống nhất, một trong hai có thể **chuyển lên GMMO** để đội ngũ sàn xem xét và ra quyết định cuối cùng (hoàn tiền một phần/toàn bộ, đổi hàng hoặc từ chối). Xem chi tiết tại trang **Chính sách bảo hành** và **Chính sách ký quỹ**.

## 8. Liên hệ

Mọi thắc mắc về điều khoản, vui lòng liên hệ qua **Chat hỗ trợ** ngay trên website sau khi đăng nhập.
"""

_TERMS_EN = """\
## 1. Acceptance

By creating an account or using any GMMO service you confirm that you have read, understood and agree to these terms. If you do not agree, or you are **under 18**, please do not register or use the site.

GMMO is a marketplace: sellers list products, buyers pay into the platform **escrow wallet**, and the platform holds the money until the transaction completes. We may update these terms; a new version takes effect as soon as it is published on this page.

## 2. Nature of the products

- **Digital assets**: every account, proxy or data set sold on GMMO is a virtual asset created or legally owned by the seller. Some accounts may have been aged or come with friends/engagement for stability, but **none represents a real person or organisation**.
- **No illegal data**: listing hijacked accounts ("via"), hosts, scans or any data collected from real users without consent is strictly forbidden. Such listings are removed, the seller's shop is closed and their balance withheld.
- **Seller responsibility**: sellers are fully responsible for the origin, description and quality of what they list. The product description is the basis for warranty.
- If a product does not match its listing, **open a dispute inside the order** so the platform can hold escrow and review it.

## 3. Permitted use

Products bought on GMMO may only be used for lawful purposes: marketing (market research, advertising, transparent seeding), e‑commerce, software and security testing, education and research, and other legal activities.

**Prohibited**: fraud, illegal gambling, malware distribution, spam, unauthorised system access, unlawful collection or spread of personal data, impersonation, harassment, violating third‑party platform policies, or anything that breaks Vietnamese law or the law of your jurisdiction.

On detecting a violation GMMO may **permanently lock the account, withhold the remaining balance and refuse service** without prior notice. You bear full legal responsibility for how you use accounts and services. GMMO may disclose related information (login IPs, transaction history, account data) upon a valid request from a competent authority.

## 4. Securing what you receive

- GMMO and sellers **never log in** to an account after it has been sold to you without your consent.
- Immediately after delivery, secure the item yourself: change the password, the linked email password, the recovery email, and enable your own 2FA.
- Your GMMO password must differ from other sites. We are not liable for losses caused by skipping these steps.

## 5. Orders

- **Test before buying in bulk**: for a new product or seller, buy one or two orders first.
- Delivered data is kept on your **Orders** page. Download and store it yourself; old order data may be pruned under the retention policy.
- Every product has its own **escrow window**, shown on the product page. Once it ends with no open dispute, funds are released to the seller and cannot be refunded.

## 6. Wallet, deposits and withdrawals

- Wallet balances are kept in VND. Deposit rails and the reference exchange rate are shown on the **Wallet** page.
- Withdrawal requests follow the rules shown when the request is created (limits, fees if any). If a problem is caused by GMMO, withdrawals are free of charge.
- Balances that stem from fraud, chargebacks or a terms violation may be frozen pending investigation.

## 7. Disputes

Buyer and seller talk directly inside the order's dispute. If they cannot agree, either side can **escalate to GMMO** for a final decision (partial/full refund, replacement, or rejection). See the **Warranty policy** and **Escrow policy** pages.

## 8. Contact

Questions about these terms: use **Support chat** on the site after signing in.
"""

_WARRANTY_VI = """\
## Quy định chung

- Sản phẩm được kiểm tra và bảo hành theo **tên và mô tả ghi trên từng trang sản phẩm**, kết hợp với quy định chung dưới đây. Nếu mô tả và quy định chung khác nhau, mô tả của người bán được ưu tiên.
- Bảo hành được thực hiện bằng cách **mở khiếu nại trong đơn hàng** (chọn các tài khoản bị lỗi, ghi lý do và đính kèm bằng chứng). Khiếu nại phải được mở **trước khi hết thời hạn ký quỹ** của sản phẩm — thời hạn này hiển thị ngay trên trang sản phẩm và trong đơn hàng.
- Hết thời hạn ký quỹ mà không có khiếu nại, tiền được giải ngân cho người bán và **không còn bảo hành**, kể cả khi bạn chưa sử dụng.
- Người bán có thể **đổi hàng** hoặc **hoàn tiền** cho từng tài khoản bị lỗi. Nếu hai bên không thống nhất, bạn hoặc người bán có thể chuyển khiếu nại lên GMMO để sàn quyết định.
- Sau khi nhận hàng hãy kiểm tra ngay. Mua ít dùng thử trước, dùng bao nhiêu mua bấy nhiêu; không bảo hành trường hợp mua rồi để lâu không kiểm tra dẫn đến tài khoản chết.

## A. Tài khoản Facebook

**Được bảo hành khi:**

- Sai thông tin đăng nhập (UID, mật khẩu, 2FA, email, mật khẩu email, email dự phòng) hoặc sai loại tài khoản so với mô tả.
- Tài khoản bị hạn chế quảng cáo hoặc bị khoá **trước thời điểm mua**.
- Không đổi được thông tin bảo mật dù mật khẩu email và email khôi phục đúng như mô tả.

**Từ chối bảo hành khi:**

- Tài khoản chết trong hoặc sau khi đăng nhập (do thiết bị, IP, cách đăng nhập của người mua).
- Người mua không tự bảo mật (đổi mật khẩu, mật khẩu email, email khôi phục) sau khi mua dẫn đến bị chiếm.
- Vi phạm chính sách của nền tảng.
- Tài khoản quảng cáo bị hạn chế hoặc tụt ngưỡng do thay đổi tiền tệ, múi giờ, quốc gia, gỡ admin cũ, thêm thẻ, tạo/thêm BM, chạy quảng cáo hoặc bất kỳ thao tác nào sau khi mua.
- Hình thức thanh toán trả trước/trả sau của tài khoản quảng cáo do Facebook tự quy định.

**Lưu ý:**

- Kiểm tra tài khoản (đăng nhập hoặc check live UID) **ngay khi còn trong thời hạn ký quỹ**.
- Không nên đổi thông tin tài khoản quá sớm; thời điểm an toàn là sau khi đăng nhập ít nhất 24 giờ. Kiểm tra đúng mô tả trước khi đổi; sau khi đổi thông tin sẽ không còn bảo hành.
- Tài khoản không có 2FA khi đăng nhập bằng UID | mật khẩu có thể báo sai mật khẩu — nên đăng nhập bằng cookie nếu người bán cung cấp.
- Do Facebook liên tục cập nhật, tài khoản có thể còn email/số điện thoại cũ hoặc mã xác nhận gửi về kênh cũ; các trường hợp này chỉ được bảo hành khi mô tả sản phẩm có cam kết rõ ràng (ví dụ "checkpoint mail", "hotmail trust").
- Một số tài khoản dùng email domain hoặc email tạm; email có thể chết hoặc không nhận được mã. Hãy đọc kỹ mô tả trước khi mua.

## B. Fanpage, Group

- Bảo hành khi **không đổi được tên** Fanpage/Group đúng như mô tả.
- Sau khi nhận quyền admin, hãy nhắn cho người bán trong khiếu nại/chat để họ rút admin cũ và BM cũ.

## C. BM (Business Manager) Facebook

**Được bảo hành khi:**

- Link mời nhận BM không vào được.
- BM hoặc tài khoản trong BM bị hạn chế quảng cáo **trước thời điểm mua**.

**Không bảo hành cho mọi thao tác và trạng thái BM sau khi mua**, ví dụ:

- Tự ý xoá quản trị viên khác khiến BM bị khoá bất thường.
- Set hoặc thoát quyền trong BM; BM đã tạo chiến dịch (kể cả bản nháp).
- BM đã thêm thông tin thanh toán, tạo/thêm tài khoản quảng cáo, Fanpage, Pixel; BM đã thêm vào tài khoản quảng cáo cá nhân.
- BM được xác thực bằng email tạm; ngưỡng hoặc limit BM bị giảm.
- Tài khoản cá nhân của người mua bị checkpoint khiến mất BM.

**Lưu ý:** không tự ý xoá admin cũ ngay khi nhận BM; hãy báo người bán tự thoát, hoặc sau 7 ngày hạ toàn bộ quản trị viên cũ xuống nhân viên. Khi cần chia sẻ BM sang tài khoản khác, cấp quyền nhân viên trước rồi mới nâng admin để hạn chế BM bị khoá.

## D. Các loại tài khoản khác

**Được bảo hành khi:**

- Sai mật khẩu, hoặc tài khoản bị khoá/chết **trước thời điểm mua**.
- Sai mô tả hoặc sai loại tài khoản.

**Từ chối bảo hành khi:**

- Đã đăng nhập thành công hoặc đã sử dụng.
- Vi phạm chính sách của nền tảng.
- Với sản phẩm Premium dùng chung: đổi email, số điện thoại, mật khẩu hoặc chia sẻ tài khoản cho người khác.
- Không tự bảo mật sau khi mua dẫn đến bị chiếm.

**Lưu ý:** email đi kèm (hotmail/outlook, email domain, email tạm) chỉ được bảo hành khi mô tả sản phẩm có cam kết rõ ràng.

## E. Proxy và dịch vụ theo thời hạn

- Bảo hành khi proxy không kết nối được, sai quốc gia/loại so với mô tả, hoặc dừng hoạt động trước khi hết thời hạn đã mua.
- Không bảo hành khi IP bị nền tảng thứ ba chặn do cách sử dụng của người mua, hoặc khi vi phạm chính sách sử dụng của nhà cung cấp.

## F. Liên hệ bảo hành

1. Mở đơn hàng → **Khiếu nại / bảo hành** → chọn tài khoản lỗi, mô tả và đính kèm bằng chứng.
2. Trao đổi với người bán ngay trong khiếu nại.
3. Nếu không thống nhất được, bấm **Chuyển lên GMMO** để sàn xem xét. Bạn cũng có thể liên hệ **Chat hỗ trợ** trên website.
"""

_WARRANTY_EN = """\
## General rules

- Products are checked and warranted according to the **name and description on each product page**, together with the rules below. Where they differ, the seller's description takes precedence.
- Warranty is claimed by **opening a dispute inside the order** (select the faulty items, give a reason and attach evidence). The dispute must be opened **before the product's escrow window ends** — the window is shown on the product page and in the order.
- Once the escrow window closes with no dispute, funds go to the seller and **warranty ends**, even if you have not used the items.
- The seller may **replace** or **refund** each faulty item. If the two sides cannot agree, either can escalate the dispute to GMMO for a decision.
- Check items right after delivery. Buy a small quantity first and buy only what you need; items left unchecked until they die are not covered.

## A. Facebook accounts

**Covered:**

- Wrong login details (UID, password, 2FA, email, email password, recovery email) or wrong account type versus the description.
- Ad restrictions or locks that existed **before purchase**.
- Security details cannot be changed even though the email password and recovery email match the description.

**Not covered:**

- The account dies during or after login (device, IP or login method of the buyer).
- The buyer did not secure the account (password, email password, recovery email) and it was taken over.
- Platform policy violations.
- Ad account restrictions or reduced limits after changing currency, time zone, country, removing old admins, adding cards, creating/adding BMs, running ads or any other post‑purchase action.
- Prepaid/postpaid billing method set by Facebook.

**Notes:**

- Verify the account (log in or check the UID is live) **while the escrow window is still open**.
- Do not change account details too early; wait at least 24 hours after first login. Confirm the description first — warranty ends once details are changed.
- Accounts without 2FA may report a wrong password when logging in with UID | password; use cookie login if the seller provides it.
- Because Facebook changes constantly, an account may retain an old email/phone or send codes to old channels; these cases are only covered when the description explicitly promises otherwise (e.g. "checkpoint mail", "trusted hotmail").
- Some accounts use domain or temporary emails that may stop working. Read the description carefully.

## B. Fanpages and groups

- Covered when the page/group **name cannot be changed** as described.
- After receiving admin rights, message the seller in the dispute/chat so they remove the old admin and BM.

## C. Facebook Business Managers

**Covered:**

- The BM invitation link does not work.
- The BM or ad accounts inside it were restricted **before purchase**.

**Not covered — any action or state after purchase**, for example:

- Removing other admins causing an unusual lock.
- Changing roles; BMs where a campaign (even a draft) was created.
- BMs with payment info added, ad accounts/pages/pixels created or added, or added to a personal ad account.
- BMs verified with a temporary email; reduced limits or thresholds.
- Losing the BM because the buyer's personal account got checkpointed.

**Notes:** do not remove old admins immediately; ask the seller to leave, or after 7 days demote them to employees. When sharing a BM to another account, grant employee access first and promote to admin later.

## D. Other account types

**Covered:**

- Wrong password, or the account was locked/dead **before purchase**.
- Wrong description or account type.

**Not covered:**

- Already logged in successfully or used.
- Platform policy violations.
- Shared premium products: changing email, phone, password or sharing with others.
- Account taken over because it was not secured after purchase.

**Notes:** bundled emails (hotmail/outlook, domain or temporary emails) are covered only when the description explicitly promises it.

## E. Proxies and time‑based services

- Covered when the proxy cannot connect, the country/type differs from the description, or it stops working before the purchased period ends.
- Not covered when a third‑party platform blocks the IP because of how it was used, or the provider's usage policy was violated.

## F. How to claim

1. Open the order → **Dispute / warranty** → select faulty items, describe the issue and attach evidence.
2. Talk to the seller inside the dispute.
3. If no agreement is reached, click **Escalate to GMMO**. You can also reach us via **Support chat** on the site.
"""

_ESCROW_VI = """\
## Ký quỹ hoạt động thế nào

1. **Thanh toán vào ký quỹ** — khi bạn đặt hàng, tiền được trừ từ ví và giữ trong ví ký quỹ của GMMO, không chuyển ngay cho người bán.
2. **Nhận hàng** — sản phẩm được giao ngay (kho có sẵn) hoặc theo thời gian xử lý ghi trên sản phẩm.
3. **Thời hạn ký quỹ** — mỗi sản phẩm có thời hạn ký quỹ riêng (hiển thị trên trang sản phẩm và trong đơn). Trong thời gian này bạn kiểm tra hàng và có thể mở khiếu nại.
4. **Giải ngân** — tiền được chuyển cho người bán khi bạn bấm xác nhận đã nhận hàng, hoặc khi hết thời hạn ký quỹ mà không có khiếu nại đang mở.

## Khi hàng không đúng mô tả

- Mở **khiếu nại** trong đơn hàng trước khi hết hạn ký quỹ, chọn đúng những tài khoản bị lỗi và đính kèm bằng chứng.
- Khiếu nại đang mở sẽ **giữ tiền ký quỹ** lại; tiền không được giải ngân cho người bán cho đến khi khiếu nại kết thúc.
- Người bán có thể đổi hàng hoặc hoàn tiền cho từng tài khoản. Tiền hoàn được trả về ví của bạn ngay khi được chấp nhận.
- Nếu hai bên không thống nhất, bạn hoặc người bán có thể **chuyển lên GMMO**. Sàn xem xét bằng chứng và ra quyết định cuối cùng: hoàn toàn bộ, hoàn một phần, đổi hàng, gia hạn bảo hành hoặc từ chối.

## Lưu ý

- Bấm "Đã nhận hàng" đồng nghĩa với việc bạn đồng ý giải ngân phần tiền còn lại cho người bán; hãy kiểm tra kỹ trước khi xác nhận.
- Khiếu nại mở nhưng không có phản hồi từ người mua trong thời gian dài sẽ được tự động đóng và tiền giải ngân cho người bán.
- Hàng giao ngay và dịch vụ qua nhà cung cấp (proxy, dịch vụ theo thời hạn) dùng cùng cơ chế giữ – rồi giải ngân này.
- Phí nền tảng được tính trên phần tiền người bán thực nhận, không tính vào số tiền hoàn cho người mua.
"""

_ESCROW_EN = """\
## How escrow works

1. **Pay into escrow** — when you order, the amount is deducted from your wallet and held by GMMO, not sent to the seller.
2. **Delivery** — items are delivered instantly (from stock) or within the processing time stated on the product.
3. **Escrow window** — every product has its own window (shown on the product page and in the order). During this time you check the items and can open a dispute.
4. **Release** — funds go to the seller when you confirm receipt, or when the window ends with no open dispute.

## If the items don't match the listing

- Open a **dispute** in the order before the window ends, select the faulty items and attach evidence.
- An open dispute **holds the escrow**; nothing is released to the seller until it is resolved.
- The seller can replace or refund each item. Refunds return to your wallet as soon as they are accepted.
- If you cannot agree, either side can **escalate to GMMO**. The platform reviews the evidence and makes the final call: full refund, partial refund, replacement, warranty extension or rejection.

## Notes

- Clicking "Received" releases the remaining escrow to the seller — check carefully first.
- A dispute left without buyer response for a long time is closed automatically and the escrow is released to the seller.
- Instant delivery and provider‑backed services (proxies, time‑based services) use the same hold‑then‑release mechanism.
- The platform fee is charged on what the seller actually receives, never on the amount refunded to the buyer.
"""

_PRIVACY_VI = """\
## Dữ liệu chúng tôi lưu

- Email và mật khẩu (đã băm) khi đăng ký; cookie phiên đăng nhập.
- Lịch sử đơn hàng, dữ liệu đã giao, khiếu nại và tin nhắn trao đổi trong đơn.
- Bút toán ví (nạp, rút, thanh toán, hoàn tiền) cần thiết để vận hành sàn.
- Địa chỉ IP và thông tin thiết bị của phiên đăng nhập, dùng để chống gian lận và bảo vệ tài khoản.

## Cách chúng tôi dùng dữ liệu

- Vận hành giao dịch, ký quỹ, bảo hành và hỗ trợ.
- Phát hiện gian lận, lạm dụng và bảo vệ người dùng khác.
- Gửi email giao dịch (xác nhận đơn, đặt lại mật khẩu, thông báo khiếu nại). Chúng tôi không gửi email quảng cáo nếu bạn không đăng ký.

## Bảo mật

- Cookie phiên là HttpOnly và không lưu vào localStorage.
- Dữ liệu nhạy cảm của người bán (khoá API, thông tin nhà cung cấp) được mã hoá khi lưu.
- Chúng tôi **không bán dữ liệu cá nhân**. Cổng thanh toán chỉ nhận thông tin cần thiết để nạp hoặc rút tiền.

## Chia sẻ với bên thứ ba

Chúng tôi chỉ chia sẻ dữ liệu với đối tác thanh toán, nhà cung cấp dịch vụ hạ tầng cần thiết để vận hành, và cơ quan nhà nước có thẩm quyền khi có yêu cầu hợp lệ theo pháp luật.

## Quyền của bạn

Để xem, sửa hoặc xoá dữ liệu tài khoản, hãy đăng nhập và liên hệ **Chat hỗ trợ** từ email đã đăng ký. Một số dữ liệu giao dịch có thể được giữ lại theo yêu cầu pháp lý và kế toán.
"""

_PRIVACY_EN = """\
## What we store

- Email and a hashed password at sign‑up; the session cookie.
- Order history, delivered data, disputes and messages exchanged in orders.
- Wallet entries (deposits, withdrawals, payments, refunds) needed to run the marketplace.
- Login IP addresses and device information, used for fraud prevention and account protection.

## How we use it

- To run transactions, escrow, warranty and support.
- To detect fraud and abuse and protect other users.
- To send transactional email (order confirmation, password reset, dispute updates). We do not send marketing email unless you opt in.

## Security

- Session cookies are HttpOnly and never written to localStorage.
- Sensitive seller data (API keys, provider credentials) is encrypted at rest.
- We **do not sell personal data**. Payment gateways only receive what is needed to deposit or withdraw.

## Sharing

We share data only with payment partners, infrastructure providers required to operate the service, and competent authorities upon a valid legal request.

## Your rights

To view, correct or delete your account data, sign in and contact **Support chat** from your registered email. Some transaction data may be retained for legal and accounting reasons.
"""

# slug -> row seed. sort_order is the footer order.
_RAW_PAGES: dict[str, dict] = {
    "terms": {
        "sort_order": 10,
        "title_vi": "Điều khoản sử dụng",
        "title_en": "Terms of service",
        "body_vi": _TERMS_VI,
        "body_en": _TERMS_EN,
    },
    "warranty": {
        "sort_order": 20,
        "title_vi": "Chính sách bảo hành",
        "title_en": "Warranty policy",
        "body_vi": _WARRANTY_VI,
        "body_en": _WARRANTY_EN,
    },
    "escrow": {
        "sort_order": 30,
        "title_vi": "Chính sách ký quỹ",
        "title_en": "Escrow policy",
        "body_vi": _ESCROW_VI,
        "body_en": _ESCROW_EN,
    },
    "privacy": {
        "sort_order": 40,
        "title_vi": "Quyền riêng tư",
        "title_en": "Privacy",
        "body_vi": _PRIVACY_VI,
        "body_en": _PRIVACY_EN,
    },
}

# Writers strip whitespace on save; strip the seed too so a freshly seeded row
# is not reported as "customized".
DEFAULT_PAGES: dict[str, dict] = {
    slug: {key: value.strip() if isinstance(value, str) else value for key, value in row.items()}
    for slug, row in _RAW_PAGES.items()
}
