# Flow Image & Video Generation API (Browse Tool Version)

Uses your **real Chrome browser** (already logged into Flow) via the Browse tool.

## 🚀 Quick Start

### 1. Start the API Server
```bash
cd K:\code\8.api\flow
node flow_browse_api_server.js
```
Server runs on `http://localhost:3001`

### 2. Queue Generation Requests
```bash
# Single IMAGE generation
curl -X POST http://localhost:3001/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A cyberpunk city at sunset", "outputCount": 2, "type": "image"}'

# Single VIDEO generation
curl -X POST http://localhost:3001/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A dragon flying over a castle at sunset", "outputCount": 1, "type": "video"}'

# Batch generation
curl -X POST http://localhost:3001/generate/batch \
  -H "Content-Type: application/json" \
  -d '{"prompts": ["dragon", "castle", "forest"], "outputCount": 1, "type": "image"}'
```

### 3. Process Queue (Run in OpenCode)
```javascript
// In OpenCode terminal:
await processNext()  // Process one request

// Or continuous processing:
await processLoop(10000)  // Process every 10 seconds
```

### 4. Get Results
```bash
# Check specific result
curl http://localhost:3001/result/req_123456789_abc123

# View queue
curl http://localhost:3001/queue

# View stats
curl http://localhost:3001/stats
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/generate` | Queue single generation (image or video) |
| POST | `/generate/sync` | Queue and wait for result (with timeout) |
| POST | `/generate/batch` | Queue multiple generations |
| GET | `/result/:requestId` | Get result by ID |
| GET | `/queue` | View pending queue |
| GET | `/stats` | View queue stats |
| GET | `/health` | Health check |

## 🔧 Request Parameters

```json
{
  "prompt": "A beautiful sunset over mountains",  // Required
  "type": "image",                                 // Optional: "image" or "video" (default: "image")
  "model": "Nano Banana 2.1",                     // Optional (auto-selected)
  "outputCount": 2,                                // Optional (default: 2 for image, 1 for video)
  "waitForPermanent": false,                       // Optional (default: false)
  "maxWaitMs": 180000                              // Optional: 180000 (image), 300000 (video)
}
```

### Type-specific defaults:
| Parameter | Image | Video |
|-----------|-------|-------|
| `outputCount` | 2 | 1 |
| `maxWaitMs` | 180000 (3 min) | 300000 (5 min) |

## 📋 Response Format

### Image Response:
```json
{
  "success": true,
  "prompt": "A beautiful sunset...",
  "type": "image",
  "permanentUrls": ["https://flow-content.google/image/..."],
  "temporaryUrls": ["https://flow.google.com/asb/..."],
  "finalUrls": ["https://flow-content.google/image/..."],
  "timestamp": "2026-11-13T17:30:00.000Z"
}
```

### Video Response:
```json
{
  "success": true,
  "prompt": "A dragon flying...",
  "type": "video",
  "permanentUrls": ["https://flow-content.google/video/..."],
  "temporaryUrls": ["https://flow.google.com/asb/..."],
  "finalUrls": ["https://flow-content.google/video/..."],
  "timestamp": "2026-11-13T17:30:00.000Z"
}
```

## 🎯 Usage Workflow

### Terminal 1 - API Server
```bash
cd K:\code\8.api\flow
node flow_browse_api_server.js
```

### Terminal 2 - Queue Requests
```bash
# Image
curl -X POST http://localhost:3001/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A majestic dragon", "outputCount": 2, "type": "image"}'

# Video
curl -X POST http://localhost:3001/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A dragon flying over a castle at sunset", "outputCount": 1, "type": "video"}'

# Batch
curl -X POST http://localhost:3001/generate/batch \
  -H "Content-Type: application/json" \
  -d '{"prompts": ["dragon", "castle", "forest"], "outputCount": 1, "type": "image"}'
```

### OpenCode Terminal - Process Queue
```javascript
// Load the processor
const { processNext, processLoop } = await import('./process_queue.js');

// Process one
await processNext();

// Or continuous
await processLoop(10000);
```

### Terminal 3 - Check Results
```bash
# Get result
curl http://localhost:3001/result/req_123456789_abc123

# View all pending
curl http://localhost:3001/queue

# View stats
curl http://localhost:3001/stats
```

## 🎬 Video Generation (Free Tier)

| Model | Credits/clip | Clips/day | Resolution | Duration |
|-------|--------------|-----------|------------|----------|
| **Veo 3.1 Lite** | 10 | **5** | 720p | 4-8s |
| **Veo 3.1 Fast** | 20 | **2** | 720p | 4-8s |
| **Gemini Omni Flash 360p** | 4 | **12** | 360p | 4s |
| **Gemini Omni Flash 720p** | 12 | **4** | 720p | 8s |

**Video workflow:**
1. API auto-switches to "Cảnh" (Scenes) tab
2. Uses same prompt input
3. Generates video clips (takes longer than images)
4. Returns video URLs

## 🔑 Key Points

- **Uses your real Chrome** (via Browse tool) - already authenticated
- **Queue-based** - non-blocking API, process at your own pace
- **Persistent session** - Chrome stays logged in
- **Free tier limits** - 50 credits/day + 100 initial
- **Image**: ~0 credits (Nano Banana free)
- **Video**: 4-20 credits/clip (Veo 3.1 Lite/Fast)

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Queue is empty" | No pending requests, submit new ones |
| "Result not found" | Request still processing or ID wrong |
| Generation fails | Check credits, try `waitForPermanent: true` |
| Port 3001 in use | Change PORT: `PORT=3002 node flow_browse_api_server.js` |
| Video tab not found | Flow UI may have changed, check selectors in `process_queue.js` |

## 📁 Files

```
K:\code\8.api\flow\
├── flow_browse_api_server.js   # Express API server (queue only)
├── process_queue.js            # Processor (run in OpenCode) - supports image & video
├── test_queue_request.cjs      # Test client
├── TAILSCALE_API_GUIDE.md      # Multi-machine access guide
├── API_README.md               # This file
└── flow-browser-profile/       # Chrome profile (auto-created)
```

## 🔗 Tailscale Multi-Machine Access

Xem file `TAILSCALE_API_GUIDE.md` để cấu hình gọi API từ các máy khác trong mạng Tailscale.