# Flow Image Generation API

Local HTTP API wrapper for Google Flow image generation using your authenticated Chrome browser.

## 🚀 Quick Start

### 1. Start the API Server
```bash
cd K:\code\8.api\flow
node flow_api_server.js
```
Server runs on `http://localhost:3001`

### 2. Test with Client
```bash
# Health check
node flow_api_client.js health

# Single generation
node flow_api_client.js test

# Batch generation
node flow_api_client.js batch

# Project info
node flow_api_client.js project
```

## 📡 API Endpoints

### POST `/generate` - Single Image
```bash
curl -X POST http://localhost:3001/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cyberpunk city at sunset, neon lights, flying cars",
    "outputCount": 2,
    "waitForPermanent": false,
    "maxWaitMs": 180000
  }'
```

**Response:**
```json
{
  "success": true,
  "prompt": "A cyberpunk city at sunset...",
  "permanentUrls": ["https://flow-content.google/image/..."],
  "temporaryUrls": ["https://flow.google.com/asb/..."],
  "finalUrls": ["https://flow-content.google/image/..."],
  "timestamp": "2026-11-13T17:30:00.000Z"
}
```

### POST `/generate/batch` - Batch Images
```bash
curl -X POST http://localhost:3001/generate/batch \
  -H "Content-Type: application/json" \
  -d '{
    "prompts": [
      "A dragon flying over a castle",
      "A futuristic car in neon city",
      "An ancient library with glowing books"
    ],
    "outputCount": 2,
    "delayMs": 5000
  }'
```

### GET `/health` - Health Check
```bash
curl http://localhost:3001/health
```

### GET `/project` - Project Info
```bash
curl http://localhost:3001/project
```

## 🔧 Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `outputCount` | 2 | Number of images to generate |
| `waitForPermanent` | false | Wait for permanent CDN URLs (slower) |
| `maxWaitMs` | 180000 | Max wait time in ms (3 min) |
| `delayMs` | 5000 | Delay between batch generations |

## 📝 Notes

- **Requires**: Your Chrome browser with Flow already logged in
- **First run**: Opens Chrome window, navigates to Flow project
- **Subsequent runs**: Uses persistent browser profile (fast)
- **Free tier**: 50 credits/day + 100 initial credits
- **Image URLs**: 
  - Permanent: `flow-content.google` (CDN, expires ~1 hour)
  - Temporary: `flow.google.com/asb/` (immediate, may expire sooner)

## 🐍 Python Client Example

```python
import requests

API = "http://localhost:3001"

def generate(prompt, count=2):
    r = requests.post(f"{API}/generate", json={
        "prompt": prompt,
        "outputCount": count
    })
    return r.json()

# Usage
result = generate("A beautiful sunset over mountains, 8k")
print(result["finalUrls"])
```

## 🔄 Integration with Tools

```json
// MCP server config example
{
  "mcpServers": {
    "flow-image": {
      "command": "node",
      "args": ["K:/code/8.api/flow/flow_api_server.js"],
      "env": {}
    }
  }
}
```

## ⚠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| "Browser not ready" | Wait for Chrome to fully load on first run |
| "Prompt input not found" | Check if Flow UI changed selectors |
| "No images generated" | Check free credits, try `waitForPermanent: true` |
| Port 3001 in use | Change `PORT` in server or `PORT=3002 node flow_api_server.js` |

## 📁 Files

```
K:\code\8.api\flow\
├── flow_api_server.js    # Express API server
├── flow_api_client.js    # Test client
├── flow-browser-profile/ # Persistent Chrome profile (auto-created)
└── package.json
```