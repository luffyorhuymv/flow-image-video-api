/**
 * Flow Image Generation API using Browse Tool (real Chrome)
 * This uses the user's actual Chrome browser which is already authenticated
 */

import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const PROJECT_ID = 'fbeba5bc5-94fc-4437-aab4-c3009a98047d'; // Will be updated from actual project
let currentProjectId = null;
let browseSession = null;

// Browse tool functions (these will be called via the tools.browse.execute)
async function browseExecute(code, options = {}) {
    // This is a placeholder - in reality we'll call the MCP tool
    // For the server, we'll use a different approach
    throw new Error('browseExecute should be implemented via MCP');
}

// Instead, we'll use a different architecture:
// The server will expose endpoints, and we'll have a separate script
// that uses the browse tool to do the actual work.

// For now, let's create a simpler approach: the server just queues requests
// and a worker process (using browse tool) processes them.

// In-memory queue
const requestQueue = [];
const results = new Map();

// Add request to queue
function queueGenerateRequest(prompt, options = {}, requestId) {
    requestQueue.push({ prompt, options, requestId, timestamp: Date.now() });
}

// Get next request
function getNextRequest() {
    return requestQueue.shift();
}

// Store result
function storeResult(requestId, result) {
    results.set(requestId, { ...result, completedAt: Date.now() });
}

// Get result
function getResult(requestId) {
    return results.get(requestId);
}

// Clean old results
function cleanResults() {
    const now = Date.now();
    for (const [id, result] of results.entries()) {
        if (now - (result.completedAt || 0) > 3600000) { // 1 hour
            results.delete(id);
        }
    }
}

// API Routes
app.post('/generate', async (req, res) => {
    try {
        const { prompt, model, outputCount, waitForPermanent, maxWaitMs, type } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        queueGenerateRequest(prompt, {
            model,
            outputCount: outputCount || 2,
            waitForPermanent: waitForPermanent || false,
            maxWaitMs: maxWaitMs || (type === 'video' ? 300000 : 180000),
            type: type || 'image' // 'image' or 'video'
        }, requestId);
        
        // Return immediately with request ID
        res.json({
            success: true,
            requestId,
            status: 'queued',
            message: 'Request queued for processing. Poll /result/{requestId} for result.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message, success: false });
    }
});

app.get('/result/:requestId', (req, res) => {
    const result = getResult(req.params.requestId);
    if (!result) {
        return res.status(404).json({ error: 'Result not found or not ready' });
    }
    res.json(result);
});

app.post('/generate/sync', async (req, res) => {
    // Synchronous version - waits for result (with timeout)
    try {
        const { prompt, model, outputCount, waitForPermanent, maxWaitMs, type } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        queueGenerateRequest(prompt, {
            model,
            outputCount: outputCount || 2,
            waitForPermanent: waitForPermanent || false,
            maxWaitMs: maxWaitMs || (type === 'video' ? 300000 : 180000),
            type: type || 'image'
        }, requestId);
        
        // Poll for result
        const maxWait = maxWaitMs || (type === 'video' ? 300000 : 180000);
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait) {
            const result = getResult(requestId);
            if (result) {
                return res.json(result);
            }
            await new Promise(r => setTimeout(r, 2000));
        }
        
        res.status(408).json({ error: 'Timeout waiting for result', requestId });
    } catch (error) {
        res.status(500).json({ error: error.message, success: false });
    }
});

app.post('/generate/batch', async (req, res) => {
    try {
        const { prompts, model, outputCount, waitForPermanent, delayMs, type } = req.body;
        
        if (!prompts || !Array.isArray(prompts)) {
            return res.status(400).json({ error: 'prompts array is required' });
        }
        
        const requestIds = [];
        for (const prompt of prompts) {
            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            queueGenerateRequest(prompt, {
                model,
                outputCount: outputCount || 2,
                waitForPermanent: waitForPermanent || false,
                maxWaitMs: type === 'video' ? 300000 : 180000,
                type: type || 'image'
            }, requestId);
            requestIds.push(requestId);
        }
        
        res.json({
            success: true,
            requestIds,
            message: 'Batch queued. Poll /result/{requestId} for each result.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    cleanResults();
    res.json({ 
        status: 'ok', 
        service: 'Flow Image Generation API (Browse Tool)',
        queueLength: requestQueue.length,
        resultsStored: results.size
    });
});

app.get('/queue', (req, res) => {
    res.json({ queue: requestQueue, queueLength: requestQueue.length });
});

app.get('/stats', (req, res) => {
    cleanResults();
    res.json({ 
        queueLength: requestQueue.length,
        resultsStored: results.size,
        results: Array.from(results.entries()).slice(-10)
    });
});

// Submit result endpoint (for workers)
app.post('/result/submit', (req, res) => {
    const { requestId, result } = req.body;
    
    if (!requestId || !result) {
        return res.status(400).json({ error: 'requestId and result required' });
    }
    
    storeResult(requestId, result);
    res.json({ success: true, message: 'Result stored' });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Flow Image Generation API (Queue Mode) running on http://localhost:${PORT}`);
    console.log(`   POST /generate     - Queue single generation`);
    console.log(`   POST /generate/sync - Queue and wait for result`);
    console.log(`   POST /generate/batch - Queue batch`);
    console.log(`   GET  /result/:id   - Get result by request ID`);
    console.log(`   GET  /health       - Health check`);
    console.log(`   GET  /queue        - View queue`);
    console.log(`   GET  /stats        - View stats\n`);
    
    console.log('⚠️  This server only queues requests.');
    console.log('   You need to run the worker: node flow_browse_worker.js\n');
});

export { app, queueGenerateRequest, getResult, storeResult, getNextRequest };