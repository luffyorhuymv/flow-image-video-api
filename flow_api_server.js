import express from 'express';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Config
const PORT = process.env.PORT || 3001;
const PROJECT_ID = 'fbeba5bb-94fc-4437-aab4-c3009a98047d';
const USER_DATA_DIR = path.join(__dirname, 'flow-browser-profile');

let browserContext = null;
let page = null;

// Initialize browser with persistent context
async function initBrowser() {
    if (browserContext) return;
    
    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false, // Set true for production
        viewport: { width: 1400, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh'
    });
    
    page = browserContext.pages()[0] || await browserContext.newPage();
    
    // Block analytics
    await page.route('**/google-analytics.com/**', route => route.abort());
    await page.route('**/googletagmanager.com/**', route => route.abort());
    await page.route('**/recaptcha/**', route => route.abort());
    
    // Navigate to project
    await page.goto(`https://flow.google.com/project/${PROJECT_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    console.log('✅ Browser initialized and logged into Flow');
}

// Generate image
async function generateImage(prompt, options = {}) {
    const {
        model = 'Nano Banana 2.1',
        outputCount = 2,
        waitForPermanent = false,
        maxWaitMs = 180000
    } = options;
    
    if (!page) await initBrowser();
    
    console.log(`🎨 Generating: "${prompt.slice(0, 60)}..."`);
    
    // Ensure we're on project page
    if (!page.url().includes('/project/')) {
        await page.goto(`https://flow.google.com/project/${PROJECT_ID}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
    }
    
    // Fill prompt - try multiple possible selectors
    const promptSelectors = [
        '[aria-label="Bạn muốn tạo gì?"]',
        '[aria-label="Bạn muốn tạo những gì?"]',
        '[aria-label*="tạo"][contenteditable="true"]',
        '.ProseMirror[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
        '[contenteditable="true"]:not([aria-hidden="true"])'
    ];
    
    let input = null;
    for (const selector of promptSelectors) {
        const el = page.locator(selector).first();
        try {
            // Use short timeout and don't throw on timeout
            await el.waitFor({ state: 'visible', timeout: 2000 });
            input = el;
            console.log(`  ✓ Found prompt input: ${selector}`);
            break;
        } catch (e) {
            // try next selector
        }
    }
    
    // Fallback: get all contenteditable elements
    if (!input) {
        const editables = await page.locator('[contenteditable="true"]').all();
        for (let i = 0; i < editables.length; i++) {
            const aria = await editables[i].getAttribute('aria-label');
            const cls = await editables[i].getAttribute('class');
            if (aria && aria.includes('tạo')) {
                input = editables[i];
                console.log(`  ✓ Found prompt input via fallback: [${i}] ${aria}`);
                break;
            }
        }
    }
    
    if (!input) {
        throw new Error('Could not find prompt input element');
    }
    
    await input.click();
    await input.fill('');
    await input.type(prompt, { delay: 30 });
    await page.waitForTimeout(500);
    
    // Click generate - try multiple selectors
    const generateSelectors = [
        '[aria-label="Bắt đầu tạo"]',
        '[aria-label*="tạo"]:not([aria-label*="Dự án"])',
        'button.generate-icon-button',
        'button:has-text("Tạo"):not(:has-text("Dự án"))'
    ];
    
    let btn = null;
    for (const selector of generateSelectors) {
        const el = page.locator(selector).first();
        try {
            await el.waitFor({ state: 'visible', timeout: 2000 });
            btn = el;
            console.log(`  ✓ Found generate button: ${selector}`);
            break;
        } catch (e) {
            // try next
        }
    }
    
    if (!btn) {
        throw new Error('Could not find generate button');
    }
    
    // Wait for enabled
    try {
        await page.waitForFunction(
            (sel) => !document.querySelector(sel)?.disabled,
            generateSelectors[0],
            { timeout: 30000 }
        );
    } catch (e) {
        console.log('  ⚠ Button enable check timeout, trying anyway');
    }
    
    await btn.click();
    console.log('  🚀 Generation started...');
    
    // Wait for results
    const startTime = Date.now();
    let permanentUrls = [];
    let tempUrls = [];
    
    while (Date.now() - startTime < maxWaitMs) {
        // Check for permanent URLs
        const permanent = await page.locator('img[src*="flow-content.google"]').all();
        permanentUrls = [];
        for (const img of permanent) {
            const src = await img.getAttribute('src');
            if (src && !permanentUrls.includes(src)) permanentUrls.push(src);
        }
        
        // Check for temporary URLs
        const temp = await page.locator('img[src*="asb/"]').all();
        tempUrls = [];
        for (const img of temp) {
            const src = await img.getAttribute('src');
            if (src && !tempUrls.includes(src)) tempUrls.push(src);
        }
        
        // If we have enough permanent URLs, return them
        if (permanentUrls.length >= outputCount) {
            console.log(`  ✅ Got ${permanentUrls.length} permanent URLs`);
            break;
        }
        
        // If not waiting for permanent and have temp URLs
        if (!waitForPermanent && tempUrls.length >= outputCount) {
            console.log(`  ✅ Got ${tempUrls.length} temporary URLs`);
            break;
        }
        
        // Log progress
        if (permanentUrls.length > 0 || tempUrls.length > 0) {
            console.log(`  ⏳ Permanent: ${permanentUrls.length}, Temp: ${tempUrls.length}`);
        }
        
        await page.waitForTimeout(5000);
    }
    
    const finalUrls = waitForPermanent ? permanentUrls : (permanentUrls.length > 0 ? permanentUrls : tempUrls);
    
    return {
        success: finalUrls.length > 0,
        prompt,
        permanentUrls: permanentUrls.slice(0, outputCount),
        temporaryUrls: tempUrls.slice(0, outputCount),
        finalUrls: finalUrls.slice(0, outputCount),
        timestamp: new Date().toISOString()
    };
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'Flow Image Generation API',
        browserReady: !!page,
        projectId: PROJECT_ID
    });
});

// Generate image endpoint
app.post('/generate', async (req, res) => {
    try {
        const { prompt, model, outputCount, waitForPermanent, maxWaitMs } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        
        const result = await generateImage(prompt, {
            model,
            outputCount: outputCount || 2,
            waitForPermanent: waitForPermanent || false,
            maxWaitMs: maxWaitMs || 180000
        });
        
        res.json(result);
    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ 
            error: error.message,
            success: false 
        });
    }
});

// Batch generate
app.post('/generate/batch', async (req, res) => {
    try {
        const { prompts, model, outputCount, waitForPermanent, delayMs } = req.body;
        
        if (!prompts || !Array.isArray(prompts)) {
            return res.status(400).json({ error: 'prompts array is required' });
        }
        
        const results = [];
        for (let i = 0; i < prompts.length; i++) {
            console.log(`\n📦 Batch ${i + 1}/${prompts.length}`);
            const result = await generateImage(prompts[i], {
                model,
                outputCount: outputCount || 2,
                waitForPermanent: waitForPermanent || false
            });
            results.push(result);
            
            // Delay between generations
            if (i < prompts.length - 1) {
                await new Promise(r => setTimeout(r, delayMs || 5000));
            }
        }
        
        res.json({ results, total: results.length });
    } catch (error) {
        console.error('Batch error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get project info
app.get('/project', async (req, res) => {
    if (!page) await initBrowser();
    res.json({
        projectId: PROJECT_ID,
        currentUrl: page?.url(),
        title: await page?.title()
    });
});

// Start server
async function start() {
    try {
        await initBrowser();
        
        app.listen(PORT, () => {
            console.log(`\n🚀 Flow Image Generation API running on http://localhost:${PORT}`);
            console.log(`   POST /generate     - Generate single image`);
            console.log(`   POST /generate/batch - Batch generate`);
            console.log(`   GET  /health       - Health check`);
            console.log(`   GET  /project      - Project info\n`);
        });
    } catch (error) {
        console.error('Failed to start:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (browserContext) await browserContext.close();
    process.exit(0);
});

start();

export { app, generateImage };