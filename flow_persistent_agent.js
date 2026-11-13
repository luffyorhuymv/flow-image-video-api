/**
 * Google Flow Browser Automation with Persistent Context
 * Uses Playwright's persistent context to maintain login session across runs
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Persistent browser profile directory
const USER_DATA_DIR = path.join(__dirname, 'flow-browser-profile');
const SESSION_FILE = path.join(__dirname, 'flow_session.json');

async function ensureProfileExists() {
    if (!fs.existsSync(USER_DATA_DIR)) {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
        console.log('Created new browser profile directory');
    }
}

async function generateImage(page, prompt, options = {}) {
    const {
        model = 'Nano Banana 2.1',
        outputCount = 2,
        aspectRatio = '16:9',
        waitForImages = true
    } = options;

    console.log(`📝 Generating: "${prompt.slice(0, 60)}..."`);
    
    // Navigate to project (use a stable project or create new)
    // First check if we're on a project page
    let currentUrl = page.url();
    
    if (!currentUrl.includes('/project/')) {
        console.log('Not on project page, navigating to create new project...');
        await page.goto('https://flow.google.com/');
        await page.waitForLoadState('networkidle');
        
        // Click "Dự án mới" (New project) button
        const newProjectBtn = page.locator('button:has-text("Dự án mới"), button:has-text("New project")').first();
        if (await newProjectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await newProjectBtn.click();
            await page.waitForLoadState('networkidle');
            await page.waitForURL('**/project/**', { timeout: 30000 });
        }
    }

    // Wait for prompt input
    const promptSelectors = [
        '[aria-label="Bạn muốn tạo những gì?"]',
        '[aria-label*="tạo"][contenteditable="true"]',
        '.ProseMirror[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]'
    ];

    let promptInput = null;
    for (const selector of promptSelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
            promptInput = el;
            console.log(`  ✓ Found prompt input: ${selector}`);
            break;
        }
    }

    if (!promptInput) {
        // Debug: dump all contenteditable elements
        const editables = await page.locator('[contenteditable="true"]').all();
        console.log(`  Found ${editables.length} contenteditable elements`);
        for (const el of editables) {
            const aria = await el.getAttribute('aria-label');
            const cls = await el.getAttribute('class');
            console.log(`    - aria-label: ${aria}, class: ${cls}`);
        }
        throw new Error('Could not find prompt input element');
    }

    // Fill prompt
    await promptInput.click();
    await promptInput.fill('');
    await promptInput.type(prompt, { delay: 30 });
    await page.waitForTimeout(500);

    // Select model if specified
    if (model) {
        const modelButton = page.locator('[aria-label*="cài đặt"], [aria-label*="settings"], button:has-text("Nano Banana")').first();
        if (await modelButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await modelButton.click();
            await page.waitForTimeout(500);
            
            const modelOption = page.locator(`text="${model}"`).first();
            if (await modelOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                await modelOption.click();
                console.log(`  ✓ Selected model: ${model}`);
            }
        }
    }

    // Click generate button
    const generateSelectors = [
        '[aria-label="Bắt đầu tạo"]',
        '[aria-label*="tạo"][type="submit"]',
        'button:has-text("Tạo"):not(:has-text("Dự án"))',
        '.generate-icon-button',
        'button[aria-label*="generate" i]'
    ];

    let generateBtn = null;
    for (const selector of generateSelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            generateBtn = el;
            console.log(`  ✓ Found generate button: ${selector}`);
            break;
        }
    }

    if (!generateBtn) {
        throw new Error('Could not find generate button');
    }

    // Wait for button to be enabled
    await page.waitForFunction(
        (sel) => !document.querySelector(sel)?.disabled,
        generateSelectors[0],
        { timeout: 30000 }
    ).catch(() => console.log('  ⚠ Button enable check timeout, trying anyway'));

    await generateBtn.click();
    console.log('  🚀 Generation started...');

    // Wait for results
    if (waitForImages) {
        const maxWait = 180000; // 3 minutes
        const startTime = Date.now();
        let lastCount = 0;

        while (Date.now() - startTime < maxWait) {
            // Look for generated images (class="image" or similar)
            const images = await page.locator('img.image, img[src*="flow-content.google"]').all();
            const count = images.length;
            
            if (count > lastCount) {
                console.log(`  📸 Found ${count} image(s)...`);
                lastCount = count;
            }

            if (count >= outputCount) {
                console.log(`  ✅ Got ${outputCount} images!`);
                break;
            }

            await page.waitForTimeout(5000);
        }

        // Extract image URLs
        const imageElements = await page.locator('img.image, img[src*="flow-content.google"]').all();
        const imageUrls = [];
        
        for (const img of imageElements.slice(0, outputCount)) {
            const src = await img.getAttribute('src');
            if (src) imageUrls.push(src);
        }

        return imageUrls;
    }

    return [];
}

async function main() {
    const prompt = process.argv[2] || 'A futuristic cyberpunk city at sunset, neon lights, flying cars, highly detailed, cinematic lighting';
    const outputCount = parseInt(process.argv[3]) || 2;

    console.log('🎨 Google Flow Persistent Browser Agent');
    console.log('=====================================\n');

    await ensureProfileExists();

    // Launch persistent context - this preserves cookies/localStorage!
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false, // Set true for production
        viewport: { width: 1400, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = context.pages()[0] || await context.newPage();

    try {
        const imageUrls = await generateImage(page, prompt, { outputCount });

        console.log('\n🎉 Generation complete!');
        console.log(`Generated ${imageUrls.length} image(s):`);
        
        for (let i = 0; i < imageUrls.length; i++) {
            console.log(`  ${i + 1}. ${imageUrls[i]}`);
        }

        // Save URLs to file
        const result = {
            prompt,
            timestamp: new Date().toISOString(),
            imageUrls,
            projectUrl: page.url()
        };
        
        fs.writeFileSync(
            path.join(__dirname, `result_${Date.now()}.json`),
            JSON.stringify(result, null, 2)
        );
        console.log('\n💾 Results saved to result_<timestamp>.json');

        // Keep browser open for inspection (remove in production)
        console.log('\n⏸ Browser staying open for inspection. Press Ctrl+C to exit.');
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
    } finally {
        // Don't close in persistent mode - keeps session alive!
        // await context.close();
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { generateImage };