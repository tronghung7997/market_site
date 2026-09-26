# Lưu trữ ảnh (media): Postgres → Cloudflare R2 / S3

> Dành cho dev và devops. Mã nguồn: `marketplace-svc/src/media/`, frontend `frontend/lib/media.ts`, `frontend/app/media/[...key]/route.ts`.

## 1. Tóm tắt

- Mọi ảnh upload đi qua một module duy nhất. Các mục đích upload (`purpose`): ảnh sản phẩm, ảnh category, logo và banner shop, avatar, ảnh đính kèm chat, bằng chứng khiếu nại, biên lai rút tiền.
- **Hiện tại** ảnh nằm trong Postgres (`MEDIA_STORAGE=db`), không cần hạ tầng mới.
- **Khi devops sẵn sàng** chuyển sang R2 hoặc S3: đổi env, chạy một script, **không sửa code và không downtime**.
- Key ảnh không phụ thuộc nhà cung cấp, nên muốn đổi R2 → dịch vụ S3 khác (B2, SeaweedFS…) chỉ cần copy nguyên bucket.

## 2. Cách hoạt động

```text
Trình duyệt ──(ảnh đã thu nhỏ ≤2560px)──► BFF /api/media/uploads ──► FastAPI POST /media/uploads
                                                                        │ giải mã, xoay EXIF, cắt, thu nhỏ
                                                                        │ re-encode WebP (xoá EXIF/GPS)
                                                                        ▼
                                             media_objects (metadata)  +  bytes: media_blobs (db) | bucket (s3)
```

- **Upload** gửi bytes thô (không multipart), tối đa `MEDIA_MAX_UPLOAD_BYTES`, giới hạn `MEDIA_UPLOAD_RATE_LIMIT_PER_HOUR` lượt mỗi tài khoản và tối đa 50 ảnh chưa lưu (pending).
  - Không nhận SVG.
  - Không lưu bản gốc, chỉ lưu 2 cỡ WebP: `full` và `thumb`. Cỡ theo mục đích nằm ở `src/media/processing.py::PRESETS`.
- **Key** (bất biến, dùng chung cho mọi nơi lưu): `pub|prv/<purpose>/<yyyy>/<mm>/<id>_<full|thumb>.webp`.
  - `pub/` là ảnh công khai (sản phẩm, category, logo, banner, avatar).
  - `prv/` là ảnh riêng tư (chat, khiếu nại, biên lai).
  - Sửa ảnh là tạo ảnh mới, nên ảnh công khai được cache `public, max-age=31536000, immutable`.
- **Vòng đời:**

  | Trạng thái | Nghĩa | Bị xoá khi |
  |---|---|---|
  | `pending` | vừa upload, chưa gắn vào đâu | sau 24 giờ |
  | `attached` | đã gắn vào sản phẩm / tin nhắn / khiếu nại… | — |
  | `detached` | bị bỏ ra | sau 7 ngày |
  | `removed` | admin gỡ | — |

  Việc xoá do job `media_gc` (chạy 30 phút một lần).
- **Mỗi row ghi nơi lưu của chính nó** (`media_objects.storage`). Đọc ảnh theo row chứ không theo env, nên trong lúc chuyển dữ liệu hệ thống vẫn chạy bình thường.
- **Phục vụ ảnh:**

  | Loại | `MEDIA_PUBLIC_BASE_URL` trống | `MEDIA_PUBLIC_BASE_URL` đã đặt |
  |---|---|---|
  | Công khai | `/media/<key>`: Next.js → FastAPI `GET /public/media/<key>` đọc từ db hoặc bucket | `https://<cdn>/<key>`: trình duyệt tải thẳng từ bucket public qua CDN |
  | Riêng tư | Endpoint của feature sở hữu (kiểm quyền mỗi lần). Chế độ db: trả bytes kèm `private, max-age=3600` | Như bên trái. Chế độ s3: 302 sang URL ký sẵn, sống `MEDIA_SIGNED_URL_TTL_SECONDS` |

## 3. Biến môi trường (backend)

| Biến | Ý nghĩa |
|---|---|
| `MEDIA_STORAGE` | `db` (mặc định) hoặc `s3`: nơi ghi **upload mới** |
| `MEDIA_S3_ENDPOINT` | Endpoint S3. R2: `https://<account_id>.r2.cloudflarestorage.com` (path-style) |
| `MEDIA_S3_REGION` | R2: `auto` |
| `MEDIA_S3_PUBLIC_BUCKET` / `MEDIA_S3_PRIVATE_BUCKET` | **Hai bucket khác nhau.** Chỉ bucket public được gắn domain công khai |
| `MEDIA_S3_ACCESS_KEY_ID` / `MEDIA_S3_SECRET_ACCESS_KEY` | Secret, chỉ để trong env |
| `MEDIA_PUBLIC_BASE_URL` | Domain CDN của bucket public (bắt buộc https ở production). **Chỉ đặt sau khi đã chuyển hết ảnh** |
| `MEDIA_SIGNED_URL_TTL_SECONDS` | Tuổi URL ký sẵn cho ảnh riêng tư (mặc định 600) |
| `MEDIA_MAX_UPLOAD_BYTES` | Trần body upload (mặc định 10 MB) |
| `MEDIA_UPLOAD_RATE_LIMIT_PER_HOUR` | Số upload mỗi tài khoản mỗi giờ (mặc định 120) |

Backend không khởi động nếu `MEDIA_STORAGE=s3` mà thiếu biến S3, hoặc hai bucket trùng tên.

## 4. Việc của devops trước khi chuyển

1. **Reverse proxy:** cho phép body tới khoảng 12 MB trên `/api/media/uploads` (nginx: `client_max_body_size 12m;`). BFF từ chối mọi body trên 25 MB, FastAPI áp trần `MEDIA_MAX_UPLOAD_BYTES`.
2. **Cloudflare trước website (áp dụng ngay cả khi còn ở chế độ db):** để CDN cache `/media/*`. Đuôi `.webp` nằm trong danh sách Cloudflare cache mặc định và response mang `Cache-Control: public, max-age=31536000, immutable`, nên thường không cần rule riêng; nếu có rule "bypass cache" cho cả site thì loại trừ `/media/*`.
3. **R2:**
   - Tạo 2 bucket, ví dụ `gmmo-media-public` và `gmmo-media-private`.
   - Chỉ bucket **public** được gắn custom domain, ví dụ `media.<domain>`. Bucket private không bật truy cập công khai.
   - Tạo API token R2 quyền Object Read & Write, **chỉ cho 2 bucket này**. Lấy Access Key ID / Secret Access Key và Account ID cho endpoint.
   - Không cần CORS: trình duyệt không upload thẳng lên R2, và `<img>` không cần CORS.
4. Chạy thử `scripts/media_verify.py` (mục 5, bước 3) trên staging trước production.

## 5. Chuyển Postgres → R2 (không downtime)

```bash
# 1) Đặt env MEDIA_STORAGE=s3 + MEDIA_S3_* (để trống MEDIA_PUBLIC_BASE_URL), deploy lại backend.
#    Upload mới vào R2; ảnh cũ vẫn đọc từ Postgres.

# 2) Chuyển ảnh cũ. Mặc định dry-run chỉ đếm; --limit để chạy thử vài ảnh.
docker compose exec marketplace-svc python scripts/media_migrate.py --to s3
docker compose exec marketplace-svc python scripts/media_migrate.py --to s3 --apply --limit 20
docker compose exec marketplace-svc python scripts/media_migrate.py --to s3 --apply

# 3) Kiểm tra: mọi ảnh phải có trong bucket (--hash tải về và so sha256).
docker compose exec marketplace-svc python scripts/media_verify.py --hash

# 4) Đặt MEDIA_PUBLIC_BASE_URL=https://media.<domain>, deploy lại. URL ảnh công khai trỏ thẳng CDN.
```

- Script chuyển **từng ảnh trong một transaction ngắn**:
  1. đọc bytes và so với sha256 lúc upload;
  2. ghi vào bucket;
  3. đổi `storage` của row và xoá blob trong Postgres, cùng một transaction.
- Dừng giữa chừng rồi chạy lại vẫn an toàn: ảnh đã chuyển được bỏ qua.
- Ảnh lỗi được liệt kê, script thoát mã 1.
- Không cần `VACUUM FULL` ngay. Postgres tự dùng lại chỗ trống; chỉ chạy `VACUUM FULL media_blobs` vào giờ thấp điểm nếu muốn trả dung lượng đĩa.

**Rollback:** xoá `MEDIA_PUBLIC_BASE_URL`, đặt lại `MEDIA_STORAGE=db` (vẫn giữ `MEDIA_S3_*` để đọc), deploy lại rồi chạy:

```bash
docker compose exec marketplace-svc python scripts/media_migrate.py --to db --apply
```

## 6. Backup

- **Chế độ db:** ảnh nằm trong `pg_dump` (bảng `media_blobs`). Dump phình theo dung lượng ảnh; nên chuyển sang R2 trước khi media vượt khoảng 5–10 GB. Theo dõi dung lượng:

  ```sql
  SELECT pg_size_pretty(pg_total_relation_size('media_blobs'));
  ```

- **Chế độ s3:** `pg_dump` chỉ còn metadata. Sao lưu bucket bằng `rclone` hằng đêm sang nhà cung cấp thứ hai (B2, S3, SeaweedFS…). Key không đổi và không bị ghi đè, nên `rclone copy` chỉ chép ảnh mới:

  ```bash
  rclone copy r2:gmmo-media-public  backup:gmmo-media-public  --fast-list
  rclone copy r2:gmmo-media-private backup:gmmo-media-private --fast-list
  ```

  Dùng `copy`, không dùng `sync`, để ảnh đã gỡ vẫn còn trong bản sao lưu.

## 7. Đổi nhà cung cấp (R2 → dịch vụ S3 khác)

1. `rclone sync` cả 2 bucket sang nhà cung cấp mới (giữ nguyên key).
2. Đổi `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, key và tên bucket; đổi `MEDIA_PUBLIC_BASE_URL` sang domain mới; deploy lại.
3. `python scripts/media_verify.py --hash`.

Row trong DB vẫn là `storage=s3`, key không đổi, nên không cần migrate dữ liệu.

> **MinIO:** từ cuối 2025 MinIO không còn phát hành Docker image bản community (`docker pull minio/minio` bị từ chối). Nếu cần tự host, [SeaweedFS](https://github.com/seaweedfs/seaweedfs) đã được thử với client này (mục 9); Garage cũng là lựa chọn S3-compatible.

## 8. Chi phí R2 tham khảo

Bảng giá R2 Standard (đã kiểm tháng 9/2026):

| Hạng mục | Đơn giá | Miễn phí mỗi tháng |
|---|---|---|
| Lưu trữ | $0.015 / GB-tháng | 10 GB |
| Ghi (Class A) | $4.50 / triệu lượt | 1 triệu lượt |
| Đọc (Class B) | $0.36 / triệu lượt | 10 triệu lượt |
| Egress | miễn phí | — |

Ví dụ 10.000 sản phẩm × 5 ảnh cộng 100.000 ảnh chat/khiếu nại ≈ 36 GB, tức khoảng $0.4 mỗi tháng tiền lưu trữ. Mỗi upload tốn 2 lượt ghi (full + thumb). Ảnh công khai phần lớn do CDN trả nên ít khi chạm R2.

## 9. Thử S3 ở máy dev (SeaweedFS)

1. Tạo `s3.json` ở máy dev với 2 identity, dùng key/secret giả:
   - identity cho app: quyền `Read`, `Write`, `List`, `Admin`;
   - identity `anonymous`: chỉ `Read:gmmo-media-public`.
2. Chạy server và tạo bucket:

   ```bash
   docker run -d --name gmmo-seaweed -p 8333:8333 -v "$PWD/s3.json:/etc/seaweedfs/s3.json:ro" \
     chrislusf/seaweedfs server -s3 -s3.config=/etc/seaweedfs/s3.json
   docker exec gmmo-seaweed sh -c 'echo "s3.bucket.create -name gmmo-media-public" | weed shell'
   docker exec gmmo-seaweed sh -c 'echo "s3.bucket.create -name gmmo-media-private" | weed shell'
   ```

3. Chạy backend với `MEDIA_STORAGE=s3`, `MEDIA_S3_ENDPOINT=http://127.0.0.1:8333`, `MEDIA_S3_REGION=us-east-1`, cùng tên bucket và key ở trên.
4. Chạy `media_migrate` / `media_verify` như mục 5.

`MEDIA_PUBLIC_BASE_URL=http://…` chỉ dùng thử được bằng script, vì CSP của web chỉ tải ảnh ngoài qua https.

## 10. Vận hành

- **Trang admin `/admin/media`:** số ảnh và dung lượng theo mục đích và nơi lưu (dùng để ước lượng R2), danh sách ảnh mới nhất lọc theo mục đích / trạng thái / email, xem ảnh (kể cả ảnh riêng tư) và **gỡ ảnh vi phạm**.
  - Gỡ ảnh: bytes bị xoá ngay, mọi URL của ảnh trả 404, giao diện hiện ô trống; lý do ghi vào nhật ký `media_removed`.
  - Ở chế độ CDN, bản đã cache có thể còn tới khi purge. Cần gỡ gấp thì purge URL đó trong Cloudflare.
- **Giới hạn dung lượng mỗi ảnh:** admin đổi ở Cài đặt › Hệ thống (có nhật ký), không vượt được `MEDIA_MAX_UPLOAD_BYTES`.
- **Log cần theo dõi:**
  - `media_upload_store_failed`, `media_read_failed`: bucket lỗi hoặc sai key.
  - `media_orphan_objects`: object thừa trong bucket, chỉ tốn chỗ.
  - `media_transfer_source_left`: bản cũ chưa xoá sau khi chuyển.
