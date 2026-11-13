/**
 * Google Flow Browser Automation Agent (Node.js/Playwright)
 * Uses exported session (cookies + localStorage) to generate images via Flow UI
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_FILE = path.join(__dirname, 'flow_session.json');

async function loadSession(context) {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    
    // Set cookies
    const cookies = session.cookies.split('; ').map(cookieStr => {
        const [name, ...valueParts] = cookieStr.split('=');
        return {
            name: name.trim(),
            value: valueParts.join('=').trim(),
            domain: '.google.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'Lax'
        };
    });
    await context.addCookies(cookies);
    
    // Set localStorage via init script
    let localStorageScript = '';
    for (const [key, value] of Object.entries(session.localStorage)) {
        localStorageScript += `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
    }
    await context.addInitScript(localStorageScript);
    
    return session.projectId;
}

async function generateImage(page, prompt, model = 'Nano Banana 2.1', outputCount = 2) {
    const projectId = await loadSession(page.context());
    console.log(`Navigating to project: ${projectId}`);
    await page.goto(`https://flow.google.com/project/${projectId}`);
    await page.waitForLoadState('networkidle');
    
    // Check if we're on the right page
    const url = page.url();
    console.log(`Current URL: ${url}`);
    
    if (!url.includes('/project/')) {
        console.log('Redirected away from project page, trying to navigate again...');
        await page.goto(`https://flow.google.com/project/${projectId}`);
        await page.waitForLoadState('networkidle');
    }
    
    // Debug: take screenshot
    await page.screenshot({ path: path.join(__dirname, 'debug_before.png'), fullPage: true });
    
    // Debug: dump page content
    const content = await page.content();
    fs.writeFileSync(path.join(__dirname, 'debug_page.html'), content);
    
    // Try multiple selectors for prompt input
    const promptSelectors = [
        '[aria-label="Bạn muốn tạo những gì?"]',
        '[aria-label*="tạo"]',
        '[contenteditable="true"][role="textbox"]',
        '.ProseMirror',
        'div[contenteditable="true"]',
        'input[type="text"]',
        'textarea'
    ];
    
    let promptInput = null;
    for (const selector of promptSelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            promptInput = el;
            console.log(`Found prompt input with selector: ${selector}`);
            break;
        }
    }
    
    if (!promptInput) {
        throw new Error('Could not find prompt input element');
    }
    
    // Clear and fill prompt
    await promptInput.click();
    await promptInput.fill('');
    await promptInput.type(prompt, { delay: 50 });
    
    // Select model if needed
    const modelButton = page.locator('[aria-label="Điều kiện kích hoạt cài đặt"]');
    if (await modelButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await modelButton.click();
        await page.waitForTimeout(500);
        const modelOption = page.locator(`text="${model}"`).first();
        if (await modelOption.isVisible({ timeout: 2000 }).catch(() => false)) {
            await modelOption.click();
        }
    }
    
    // Click generate button - try multiple selectors
    const generateSelectors = [
        '[aria-label="Bắt đầu tạo"]',
        '[aria-label*="tạo"]',
        'button:has-text("Tạo")',
        'button:has-text("Generate")',
        '.generate-icon-button'
    ];
    
    let generateBtn = null;
    for (const selector of generateSelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
            generateBtn = el;
            console.log(`Found generate button with selector: ${selector}`);
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
    ).catch(() => {}); // Ignore timeout, try anyway
    
    await generateBtn.click();
    
    // Wait for generation to complete
    await page.waitForTimeout(10000);
    
    // Poll for results
    const maxWait = 180000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
        const images = await page.locator('img[src^="blob:"], img[src^="data:"]').all();
        if (images.length >= outputCount) {
            break;
        }
        await page.waitForTimeout(5000);
    }
    
    // Debug: screenshot after generation
    await page.screenshot({ path: path.join(__dirname, 'debug_after.png'), fullPage: true });
    
    // Extract generated image URLs
    const imageElements = await page.locator('img[src^="blob:"], img[src^="data:"]').all();
    const imageUrls = [];
    for (const img of imageElements.slice(0, outputCount)) {
        const src = await img.getAttribute('src');
        if (src) imageUrls.push(src);
    }
    
    return imageUrls;
}

async function main() {
    const prompt = 'A futuristic cyberpunk city at sunset, neon lights, flying cars, highly detailed, cinematic lighting';
    
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();
    
    console.log(`Generating image: ${prompt}`);
    const imageUrls = await generateImage(page, prompt);
    
    console.log(`Generated ${imageUrls.length} images:`);
    for (let i = 0; i < imageUrls.length; i++) {
        console.log(`  ${i + 1}. ${imageUrls[i].slice(0, 80)}...`);
    }
    
    // Save images if they're data URLs
    for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        if (url.startsWith('data:')) {
            const [header, data] = url.split(',', 1);
            const ext = header.split(';')[0].split('/')[1];
            const buffer = Buffer.from(data, 'base64');
            fs.writeFileSync(path.join(__dirname, `generated_${i + 1}.${ext}`), buffer);
            console.log(`Saved generated_${i + 1}.${ext}`);
        }
    }
    
    await browser.close();
}

main().catch(console.error);