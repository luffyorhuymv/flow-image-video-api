# Flow Image/Video Generation API - Tailscale Multi-Machine Access Guide

## Overview

Cách cấu hình để gọi API `http://localhost:3001` từ các máy khác trong mạng Tailscale.

---

## 1. Tìm Tailscale IP của máy chủ API

### Trên máy chủ (Windows):
```powershell
# Cách 1: Tailscale CLI
tailscale ip -4

# Cách 2: PowerShell
(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "*Tailscale*").IPAddress

# Cách 3: Tailscale web UI
# Mở https://login.tailscale.com/admin/machines
# Tìm machine name của máy này -> copy IP (100.x.x.x)
```

**Ví dụ output:** `100.64.1.23`

---

## 2. Cấu hình Firewall (Windows)

### Cho phép inbound trên port 3001:
```powershell
# PowerShell as Administrator
New-NetFirewallRule -DisplayName "Flow API Tailscale" `
    -Direction Inbound -Protocol TCP -LocalPort 3001 `
    -Action Allow -Profile Any `
    -RemoteAddress 100.64.0.0/10  # Chỉ cho phép Tailscale subnet
```

### Hoặc qua Windows Defender Firewall UI:
1. Windows Security > Firewall > Advanced Settings
2. Inbound Rules > New Rule > Port > TCP > 3001
3. Scope > Remote IP > Add `100.64.0.0/10` (Tailscale CGNAT range)

---

## 3. Bind API Server tới Tailscale Interface

### Sửa `flow_browse_api_server.js`:
```javascript
// Thay đổi dòng listen:
const TAILSCALE_IP = process.env.TAILSCALE_IP || '0.0.0.0'; // Hoặc IP cụ thể
const PORT = process.env.PORT || 3001;

app.listen(PORT, TAILSCALE_IP, () => {
    console.log(`API running on ${TAILSCALE_IP}:${PORT}`);
});
```

### Chạy với Tailscale IP:
```bash
# Windows PowerShell
$env:TAILSCALE_IP = "100.64.1.23"  # Thay bằng IP thực
$env:PORT = "3001"
node flow_browse_api_server.js

# Hoặc Command Prompt
set TAILSCALE_IP=100.64.1.23 && set PORT=3001 && node flow_browse_api_server.js
```

---

## 4. Gọi API từ máy Client (trong Tailscale)

### Test kết nối:
```bash
# Health check
curl http://100.64.1.23:3001/health

# Queue generation
curl -X POST http://100.64.1.23:3001/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A beautiful sunset", "outputCount": 2}'

# Get result
curl http://100.64.1.23:3001/result/req_xxxxx
```

### Python Client Example:
```python
import requests
import time

TAILSCALE_API = "http://100.64.1.23:3001"  # Thay bằng IP thật

def generate_image(prompt, output_count=2, wait_for_result=True):
    # Queue request
    resp = requests.post(f"{TAILSCALE_API}/generate", json={
        "prompt": prompt,
        "outputCount": output_count
    })
    data = resp.json()
    request_id = data["requestId"]
    print(f"Queued: {request_id}")
    
    if not wait_for_result:
        return {"requestId": request_id, "status": "queued"}
    
    # Poll for result
    while True:
        time.sleep(5)
        result = requests.get(f"{TAILSCALE_API}/result/{request_id}").json()
        if result.get("success") is not None:
            return result
        print(f"  Waiting... ({result.get('status', 'processing')})")

# Usage
result = generate_image("A cyberpunk city at sunset", output_count=2)
print(f"Images: {result['finalUrls']}")
```

### Node.js Client:
```javascript
const TAILSCALE_API = 'http://100.64.1.23:3001';

async function generateImage(prompt, options = {}) {
    const res = await fetch(`${TAILSCALE_API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...options })
    });
    const { requestId } = await res.json();
    console.log(`Queued: ${requestId}`);
    
    // Poll
    while (true) {
        await new Promise(r => setTimeout(r, 5000));
        const result = await fetch(`${TAILSCALE_API}/result/${requestId}`).then(r => r.json());
        if (result.success !== undefined) return result;
        console.log('Waiting...');
    }
}

// Usage
const result = await generateImage('A dragon flying over castle', { outputCount: 2 });
console.log('Images:', result.finalUrls);
```

---

## 5. Systemd Service (Linux) / NSSM (Windows) - Auto Start

### Windows - NSSM (Non-Sucking Service Manager):
```powershell
# Install NSSM
choco install nssm

# Create service
nssm install FlowAPI
# Path: node.exe
# Arguments: K:\code\8.api\flow\flow_browse_api_server.js
# Startup directory: K:\code\8.api\flow
# Environment: TAILSCALE_IP=100.64.1.23;PORT=3001

# Start service
nssm start FlowAPI
```

### Linux systemd:
```ini
# /etc/systemd/system/flow-api.service
[Unit]
Description=Flow Image Generation API
After=network.target tailscaled.service

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/flow
Environment=TAILSCALE_IP=100.64.1.23
Environment=PORT=3001
ExecStart=/usr/bin/node flow_browse_api_server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable flow-api
sudo systemctl start flow-api
```

---

## 6. Docker Deployment (Optional)

### Dockerfile:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV TAILSCALE_IP=0.0.0.0
ENV PORT=3001
EXPOSE 3001
CMD ["node", "flow_browse_api_server.js"]
```

### docker-compose.yml:
```yaml
version: '3.8'
services:
  flow-api:
    build: .
    ports:
      - "3001:3001"
    environment:
      - TAILSCALE_IP=0.0.0.0
      - PORT=3001
    volumes:
      - ./flow-browser-profile:/app/flow-browser-profile
    restart: unless-stopped
```

---

## 7. Troubleshooting

| Issue | Solution |
|-------|----------|
| `curl: (7) Failed to connect` | Check firewall, Tailscale IP correct, server running |
| `ERR_CONNECTION_REFUSED` | API bind to 0.0.0.0 or correct Tailscale IP |
| `Timeout` | Increase `maxWaitMs` in request options |
| `Queue empty but no results` | Check OpenCode processor running (`await processLoop()`) |
| Tailscale IP thay đổi | Tailscale IP thường static, nhưng có thể đổi khi reinstall. Check `tailscale ip -4` |

---

## 8. Security Best Practices

1. **Chỉ cho phép Tailscale subnet:**
   ```powershell
   # Firewall rule chỉ cho 100.64.0.0/10
   ```

2. **API Key (tùy chọn):**
   ```javascript
   // Thêm middleware auth
   app.use((req, res, next) => {
       const key = req.headers['x-api-key'];
       if (key !== process.env.API_KEY) return res.status(401).json({error: 'Invalid key'});
       next();
   });
   ```

3. **Rate limiting:**
   ```javascript
   const rateLimit = require('express-rate-limit');
   app.use(rateLimit({ windowMs: 60000, max: 30 }));
   ```

---

## 9. Quick Reference Card

```bash
# === MACHINE CHỦ (SERVER) ===
# 1. Get Tailscale IP
tailscale ip -4
# → 100.64.1.23

# 2. Allow firewall
New-NetFirewallRule -Name "FlowAPI" -Direction Inbound -Protocol TCP -LocalPort 3001 -RemoteAddress 100.64.0.0/10 -Action Allow

# 3. Run server
$env:TAILSCALE_IP="100.64.1.23"; node flow_browse_api_server.js

# === MACHINE CLIENT ===
# Test
curl http://100.64.1.23:3001/health

# Generate
curl -X POST http://100.64.1.23:3001/generate -H "Content-Type: application/json" -d '{"prompt":"sunset","outputCount":2}'

# Get result
curl http://100.64.1.23:3001/result/req_xxx
```

---

## 10. Files Structure on Server

```
K:\code\8.api\flow\
├── flow_browse_api_server.js   # Main API server
├── process_queue.js            # Processor (run in OpenCode)
├── flow_session.json           # Chrome session data
├── package.json
├── README_API.md
├── TAILSCALE_API_GUIDE.md      # This file
└── flow-browser-profile/       # Chrome persistent profile
```

---

**Lưu ý:** Mặc định API bind `0.0.0.0` (tất cả interfaces). Chỉ cần firewall rule cho Tailscale IP là đủ bảo mật. Nếu muốn bind chặt chặt, set `TAILSCALE_IP=100.64.1.23` khi chạy.