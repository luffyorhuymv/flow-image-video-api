# Flow Image Proxy

Proxy API cục bộ để **tạo ảnh từ Google Flow** (project
`https://flow.google.com/project/87c609bb-6931-4a76-8d8b-99a28f854873`) qua giao diện
kiểu OpenAI (`/v1/images/generations`). Không cần cài thư viện nào — chỉ cần **Node.js ≥ 18**.

> ⚠️ Đây là API không chính thức (reverse-engineer từ web app, tham khảo cách làm của
> [flow2api](https://github.com/TheSmallHanCat/flow2api) và
> [comfyui-labs-google](https://github.com/ainewsto/comfyui-labs-google)). Google có thể thay
> đổi bất cứ lúc nào. Chỉ dùng với tài khoản Flow của chính bạn — có thể vi phạm ToS của Google.

## Cơ chế hoạt động

1. Đổi cookie `__Secure-next-auth.session-token` (lấy từ trình duyệt đã đăng nhập Flow) thành
   `access_token` qua `GET https://labs.google/fx/api/auth/session` (tự động refresh, cache ở `.token-cache.json`).
2. Gọi `POST https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages`
   — đây chính là endpoint web app Flow dùng khi bấm nút tạo ảnh (tool `PINHOLE`).
3. Nhận URL ký tên / base64 → tải về, lưu vào `output/`, trả JSON chuẩn OpenAI.

## Cài đặt

```bash
# 1. Lấy cookies
#    - Mở https://flow.google.com (đã đăng nhập) -> F12 -> tab Network
#    - Refresh trang, click vào request đầu tiên tới flow.google.com
#    - Request Headers -> copy TOÀN BỘ giá trị của header "cookie: ..."
#    - Dán vào file cookies.txt (xem cookies.example.txt)
copy cookies.example.txt cookies.txt   # rồi mở ra dán cookie thật vào

# 2. (tuỳ chọn) chỉnh cấu hình
copy config.example.json config.json

# 3. Chạy
node server.js
```

Cấu hình cũng có thể đặt bằng biến môi trường: `PORT`, `FLOW_API_KEY`, `FLOW_PROJECT_ID`,
`FLOW_BACKEND`, `FLOW_MODEL`, `FLOW_ASPECT`, `FLOW_COOKIES`, `FLOW_RECAPTCHA_TOKEN`,
`FLOW_TIMEOUT_MS`.

## Endpoints

| Method | Path                      | Mô tả |
|--------|---------------------------|-------|
| GET    | `/`                       | Trang web mini để test tạo ảnh bằng tay |
| GET    | `/health`                 | Trạng thái: có cookies, token, hết hạn lúc nào |
| GET    | `/v1/models`              | Danh sách model |
| POST   | `/v1/images/generations`  | Tạo ảnh (thân chính) |
| POST   | `/v1/images/upscale`      | Upscale ảnh đã tạo lên 2K/4K |
| GET    | `/files/<tên-file>`       | Xem ảnh đã lưu trong `output/` |

### POST /v1/images/generations

```jsonc
{
  "prompt": "a cinematic photo of a cat astronaut, neon lights",
  "model": "nano-banana",        // nano-banana | nano-banana-pro | imagen-4 (+ bí danh gemini-3.x-*)
  "aspect_ratio": "16:9",        // 16:9 | 9:16 | 1:1 | 4:3 | 3:4 (imagen-4 chỉ hỗ trợ 16:9, 9:16)
  "n": 1,                        // 1..4
  "seed": 12345,                 // tuỳ chọn
  "quality": "2k",               // tuỳ chọn: "2k" | "4k" -> tự upscale ảnh đầu tiên
  "response_format": "b64_json"  // "b64_json" (mặc định) hoặc "url" (link /files/ cục bộ)
}
```

Ví dụ:

```bash
curl -s http://127.0.0.1:8811/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cozy ramen shop at night, studio ghibli style","n":2,"aspect_ratio":"1:1"}' \
  | jq '.data[].saved_path'
```

Dùng với SDK OpenAI (base URL trỏ về proxy):

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:8811/v1", api_key="anything")
img = client.images.generate(model="nano-banana", prompt="a dragon made of glass", n=1)
print(img.data[0].b64_json[:64], "...")
```

### POST /v1/images/upscale

```jsonc
{ "media_id": "<batch_id trả về từ /v1/images/generations>", "size": "4k" }
```

## Model

| Tên model        | Model nội bộ của Flow | Ghi chú |
|------------------|-----------------------|---------|
| `nano-banana`    | `NARWHAL`             | Gemini Flash image — mặc định của Flow hiện tại |
| `nano-banana-pro`| `GEM_PIX_2`           | Gemini Pro image (Nano Banana Pro) |
| `imagen-4`       | `IMAGEN_3_5`          | Chỉ hỗ trợ 16:9 / 9:16 |

Backend dự phòng `imagefx` (config `"backend": "imagefx"`): gọi `POST /v1:runImageFx`
(IMAGEN_3_1 qua labs.google) — không sinh ảnh vào project Flow nhưng thường vượt qua được khi
endpoint project bị chặn; chỉ hỗ trợ 16:9 / 9:16 / 1:1.

## Xử lý sự cố

- **401 / không lấy được access_token** → cookie hết hạn. Đăng nhập lại flow.google.com, copy lại `cookies.txt`.
- **Google trả lỗi reCAPTCHA** → Flow có thể yêu cầu token reCAPTCHA. Lấy giá trị
  `recaptchaContext.token` từ một request `batchGenerateImages` thật trong tab Network (F12) rồi
  đặt vào `FLOW_RECAPTCHA_TOKEN` / `recaptchaToken` trong config (token ngắn hạn, cần lấy mới cho
  mỗi phiên), hoặc chuyển sang backend `imagefx`.
- **Model/aspect không hỗ trợ** → chạy `GET /v1/models` để xem danh sách và tỷ lệ được phép.
- **Ảnh không lưu** → kiểm tra quyền ghi thư mục `output/` (đổi `outputDir` trong config nếu cần).

Bảo mật: proxy chỉ gọi các host Google trong allowlist và từ chối localhost/IP riêng khi tải ảnh
(chống SSRF). Nếu đặt `apiKey` trong config, mọi request phải kèm `Authorization: Bearer <key>`.
