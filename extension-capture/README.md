# Flow Request Capture (Chrome extension)

Extension nhỏ ghi lại các request/response thật của Google Flow khi bạn bấm nút tạo ảnh —
dùng để lấy "chuẩn" endpoint + header + payload cho proxy.

## Cài đặt

1. Mở `chrome://extensions` trong Chrome
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) — góc trên bên phải
3. Bấm **Load unpacked** (Tải tiện ích chưa đóng gói) → chọn thư mục `extension-capture` này
4. Vào lại tab Flow ([flow.google.com](https://flow.google.com)) → **F5** để extension gắn vào trang

## Cách lấy dữ liệu

1. Trong project Flow, gõ prompt và bấm **tạo ảnh** như bình thường (1 lần là đủ)
2. Bấm icon extension trên thanh công cụ → popup hiện số request đã ghi (badge trên icon cũng đếm)
3. Bấm **⬇️ Tải capture-flow.json** → file lưu vào thư mục Downloads
4. Gửi file đó cho trợ lý để phân tích (chỉ cần phân tích local, không cần gửi lên đâu cả)

Chỉ ghi các request liên quan: `aisandbox-pa.googleapis.com`, `batchexecute`,
`accounts.google.com/o/oauth*`, và các URL chứa `token`. Body/response cắt ở 300KB mỗi cái
để file không phình to. Dữ liệu chỉ nằm trong trình duyệt của bạn cho đến khi bạn tải về.
