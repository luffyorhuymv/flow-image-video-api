const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const USER_DATA_DIR = path.join(__dirname, 'flow-browser-profile');
const PROJECT_ID = 'fbeba5bb-94fc-4437-aab4-c3009a98047d';

async function ensureProfile() {
    if (!fs.existsSync(USER_DATA_DIR)) {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }
}

async function waitForGeneration(page, maxWaitMs = 180000) {
    const startTime = Date.now();
    let lastCount = 0;
    
    while (Date.now() - startTime < maxWaitMs) {
        // Check for generated images (look for flow-content.google URLs)
        const images = await page.locator('img[src*="flow-content.google"]').all();
        const count = images.length;
        
        if (count > lastCount) {
            console.log(`  📸 Found ${count} image(s)...`);
            lastCount = count;
        }
        
        if (count >= 2) {
            console.log(`  ✅ Got 2 images!`);
            break;
        }
        
        // Also check asb URLs (temporary)
        const asbImages = await page.locator('img[src*="asb/"]').all();
        if (asbImages.length >= 2 && count === 0) {
            console.log(`  ⏳ Got temporary asb images, waiting for permanent URLs...`);
        }
        
        await page.waitForTimeout(5000);
    }
    
    // Return all image URLs
    const allImages = await page.locator('img[src*="flow-content.google"], img[src*="asb/"]').all();
    const urls = [];
    for (const img of allImages) {
        const src = await img.getAttribute('src');
        if (src && !urls.includes(src)) urls.push(src);
    }
    return urls;
}

async function generateImage(page, prompt) {
    console.log(`\n🎨 Generating: "${prompt.slice(0, 60)}..."`);
    
    // Navigate to project
    const currentUrl = page.url();
    if (!currentUrl.includes('/project/')) {
        console.log('  📍 Navigating to project...');
        await page.goto(`https://flow.google.com/project/${PROJECT_ID}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
    }
    
    // Find prompt input - try multiple selectors
    const promptSelectors = [
        '[aria-label="Bạn muốn tạo những gì?"]',
        '[aria-label*="tạo"][contenteditable="true"]',
        '.ProseMirror[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
        '[contenteditable="true"]:not([aria-hidden="true"])'
    ];
    
    let promptInput = null;
    for (const selector of promptSelectors) {
        const el = page.locator(selector).first();
        try {
            await el.waitFor({ state: 'visible', timeout: 3000 });
            promptInput = el;
            console.log(`  ✓ Found prompt input: ${selector}`);
            break;
        } catch (e) {
            // try next
        }
    }
    
    if (!promptInput) {
        // Debug: list all contenteditable
        const editables = await page.locator('[contenteditable="true"]').all();
        console.log(`  Found ${editables.length} contenteditable elements`);
        for (let i = 0; i < editables.length; i++) {
            const aria = await editables[i].getAttribute('aria-label');
            const cls = await editables[i].getAttribute('class');
            console.log(`    [${i}] aria-label: ${aria}, class: ${cls}`);
        }
        
        // Debug: dump page content
        const content = await page.content();
        fs.writeFileSync(path.join(__dirname, 'debug_page.html'), content);
        console.log('  📄 Page content saved to debug_page.html');
        
        // Debug: screenshot
        await page.screenshot({ path: path.join(__dirname, 'debug_page.png'), fullPage: true });
        console.log('  📸 Page screenshot saved to debug_page.png');
        
        throw new Error('Could not find prompt input');
    }
    
    // Fill prompt
    await promptInput.click();
    await promptInput.fill('');
    await promptInput.type(prompt, { delay: 30 });
    await page.waitForTimeout(500);
    
    // Click generate button
    const generateSelectors = [
        '[aria-label="Bắt đầu tạo"]',
        '[aria-label*="tạo"]:not([aria-label*="Dự án"])',
        'button.generate-icon-button',
        'button:has-text("Tạo"):not(:has-text("Dự án"))'
    ];
    
    let generateBtn = null;
    for (const selector of generateSelectors) {
        const el = page.locator(selector).first();
        try {
            await el.waitFor({ state: 'visible', timeout: 3000 });
            generateBtn = el;
            console.log(`  ✓ Found generate button: ${selector}`);
            break;
        } catch (e) {}
    }
    
    if (!generateBtn) {
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
    
    await generateBtn.click();
    console.log('  🚀 Generation started...');
    
    // Wait for results
    return await waitForGeneration(page);
}

async function main() {
    const prompt = process.argv[2] || 'A futuristic cyberpunk city at sunset, neon lights, flying cars, highly detailed, cinematic lighting';
    
    console.log('🎨 Google Flow Playwright Agent (Persistent)');
    console.log('=============================================\n');
    
    await ensureProfile();
    
    // Launch persistent context - THIS IS KEY for session persistence
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,  // Set true for production
        viewport: { width: 1400, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        // Accept all cookies
        permissions: ['clipboard-read', 'clipboard-write'],
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh'
    });
    
    const page = context.pages()[0] || await context.newPage();
    
    // Block analytics to avoid console noise
    await page.route('**/google-analytics.com/**', route => route.abort());
    await page.route('**/googletagmanager.com/**', route => route.abort());
    await page.route('**/recaptcha/**', route => route.abort());
    
    try {
        const urls = await generateImage(page, prompt);
        
        console.log('\n🎉 Generation complete!');
        console.log(`Generated ${urls.length} image(s):`);
        urls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
        
        // Save results
        const result = {
            prompt,
            timestamp: new Date().toISOString(),
            imageUrls: urls,
            projectUrl: page.url()
        };
        fs.writeFileSync(
            path.join(__dirname, `result_${Date.now()}.json`),
            JSON.stringify(result, null, 2)
        );
        console.log('\n💾 Results saved');
        
        // Keep browser open for inspection
        console.log('\n⏸ Browser staying open. Press Ctrl+C to exit.');
        await new Promise(() => {}); // Wait forever
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        // Debug screenshot
        await page.screenshot({ 
            path: path.join(__dirname, `error_${Date.now()}.png`), 
            fullPage: true 
        });
        console.log('📸 Error screenshot saved');
        
        throw error;
    }
}

main().catch(console.error);