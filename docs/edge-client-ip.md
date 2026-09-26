# Edge: chuyển IP thật của người dùng tới BFF và backend

> **Trạng thái:** chưa áp dụng trên production. Cấu hình edge không nằm trong repo; tài liệu này là
> việc ops cần làm trên server deploy và Cloudflare.

## Hiện trạng production (kiểm tra từ bên ngoài, 2026-09-26)

- `gmmo.info` và `api.gmmo.info` phân giải về IP anycast của Cloudflare (`104.21.61.87`,
  `172.67.207.249`, `2606:4700:…`); response có `Server: cloudflare`, `CF-RAY`, nên mọi request đi
  qua proxy Cloudflare. `https://api.gmmo.info/health` → `{"status":"ok","service":"marketplace-svc"}`
  kèm `x-request-id` của FastAPI; trang `gmmo.info` là Next.js (`vary: rsc, …`).
- Server deploy là `172.16.89.2` (IP nội bộ, `Jenkinsfile`), `/srv/market_site` với
  `docker-compose.yml` quản lý trên server (bản trong repo đã cũ: còn `API_URL` domain cũ
  `api-market.taskforces.info`, domain này không còn DNS). Cloudflare không tới thẳng được IP nội
  bộ và repo từng có service `cloudflared tunnel run`, nên nhiều khả năng origin được nối bằng
  **Cloudflare Tunnel** (cách B). Chưa xác nhận được từ bên ngoài; trên server kiểm tra bằng
  `docker ps | grep cloudflared` (hoặc `systemctl status cloudflared`) và Cloudflare Zero Trust →
  Networks → Tunnels.

## Vì sao cần

- BFF đọc IP người dùng từ header do edge đặt (`ADMIN_CLIENT_IP_HEADER`, mặc định `x-real-ip`,
  `frontend/lib/admin-access.ts`) rồi chuyển sang FastAPI qua `X-Client-IP` trên request đã ký
  (`marketplace-svc/src/security/client_ip.py::request_client_ip`). IP này dùng cho rate-limit
  login/register/refresh/forgot/reset/search, login history, audit và cổng `ADMIN_ALLOWED_IPS`.
- Khi edge chưa đặt header, mọi request có chung IP của BFF, nên cả sàn dùng chung một bucket.
  Vì vậy các limit theo IP trong `marketplace-svc/src/config.py` đang được nâng tạm ~10 lần
  (commit `1e28306`, comment `TEMPORARY`).
- **Edge phải GHI ĐÈ header, không nối thêm và không chuyển tiếp giá trị client gửi lên.** Nếu
  header của client lọt qua, bất kỳ ai cũng tự chọn được bucket rate-limit và vượt qua
  `ADMIN_ALLOWED_IPS` bằng cách gửi `X-Real-IP: <IP được phép>`.

## Cách A: Cloudflare → nginx → container (khuyến nghị nếu đang có nginx)

1. Sinh danh sách dải IP của Cloudflare (chạy lại định kỳ vì Cloudflare có thể đổi):

   ```bash
   { curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6; } \
     | sed '/^$/d; s/.*/set_real_ip_from &;/' > /etc/nginx/conf.d/cloudflare-real-ip.conf
   echo 'real_ip_header CF-Connecting-IP;' >> /etc/nginx/conf.d/cloudflare-real-ip.conf
   ```

   Sau bước này `$remote_addr` là IP người dùng, và chỉ được tin khi request thực sự đến từ
   Cloudflare.

2. Trong `location` proxy tới frontend (Next.js) **và** tới API (`api-market…`), ghi đè cả hai header:

   ```nginx
   proxy_set_header X-Real-IP       $remote_addr;
   proxy_set_header X-Forwarded-For $remote_addr;
   ```

   `proxy_set_header` thay thế giá trị client gửi lên. Không dùng
   `$proxy_add_x_forwarded_for` (nó nối thêm vào chuỗi do client gửi).

3. Backend nhận API trực tiếp (gateway `/gw/…`, webhook) và chỉ tin `X-Forwarded-For` khi TCP
   peer nằm trong `TRUSTED_PROXY_CIDRS`. Đặt biến này bằng IP/CIDR của nginx khi nhìn từ container
   backend (ví dụ subnet của Docker network), không đặt dải rộng hơn.

4. Chặn truy cập thẳng vào port container từ ngoài (`3001`, `8001` đang publish ra host): chỉ nginx
   được gọi tới. Nếu không, người gọi thẳng có thể tự đặt header.

## Cách B: Cloudflare Tunnel (cloudflared) trỏ thẳng vào container Next

Cloudflare luôn ghi đè `CF-Connecting-IP`, nên có thể để BFF đọc thẳng header đó:

```bash
# env của container frontend
ADMIN_CLIENT_IP_HEADER=cf-connecting-ip
```

Điều kiện: container Next chỉ nhận traffic qua tunnel. `docker-compose.yml` đang publish `3001` và
`8001` ra host; bất kỳ ai trong mạng nội bộ `172.16.x` gọi thẳng vào đó đều tự đặt được header.
Bỏ `ports:` (cloudflared gọi container qua Docker network) hoặc chặn bằng firewall; nếu không làm
được, dùng cách A.

API gọi thẳng `api.gmmo.info` (gateway `/gw/…`, webhook) không qua BFF: backend đọc
`X-Forwarded-For` (Cloudflare thêm IP client vào cuối chuỗi) nhưng chỉ khi TCP peer nằm trong
`TRUSTED_PROXY_CIDRS`. Đặt biến này bằng subnet Docker network giữa cloudflared và backend
(`docker network inspect <network> --format '{{(index .IPAM.Config 0).Subnet}}'`).

## Kiểm chứng sau khi áp dụng

1. Đăng nhập từ hai mạng khác nhau (ví dụ wifi và 4G); trang Tài khoản → Lịch sử đăng nhập phải
   hiện hai IP thật khác nhau, không phải IP nội bộ của BFF/Docker.
2. Thử giả mạo: gửi request đăng nhập kèm `X-Real-IP: 1.2.3.4` (và `CF-Connecting-IP: 1.2.3.4`
   với cách A). Lịch sử đăng nhập vẫn phải ghi IP thật, không ghi `1.2.3.4`.
3. Nếu dùng `ADMIN_ALLOWED_IPS`: request tới `/admin` từ IP không nằm trong danh sách, kèm
   `X-Real-IP` là IP được phép, vẫn phải bị chặn.

## Sau khi kiểm chứng xong

Trả các limit trong `marketplace-svc/src/config.py` về giá trị gốc (commit `1e28306`) và xoá comment
`TEMPORARY`:

| Setting | Tạm thời | Gốc |
|---|---|---|
| `auth_login_ip_limit` | 300 | 20 |
| `auth_register_ip_limit` | 100 | 10 |
| `auth_refresh_account_limit` (thực chất theo IP) | 2000 | 30 |
| `auth_forgot_ip_limit` | 100 | 10 |
| `auth_reset_ip_limit` | 200 | 20 |
| `gateway_ip_rate_limit` | 1200 | 120 |
| `affiliate_click_ip_limit` | 300 | 30 |
| `search_ip_rate_limit` | 1200 | 120 |
| `provider_webhook_ip_limit` | 600 | 120 |

Với `auth_refresh_account_limit`: BFF đã gom refresh song song (`frontend/lib/bff-refresh-coalescer.ts`),
nhưng một trang có nhiều tab vẫn refresh riêng; cân nhắc giữ giá trị lớn hơn 30 cho bucket này.
