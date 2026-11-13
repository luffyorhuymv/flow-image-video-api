/**
 * Queue Processor - Run this in OpenCode to process queued generations
 * Supports both IMAGE and VIDEO generation
 * Usage: await processNext() or await processLoop(10000)
 */

const API_BASE = 'http://localhost:3001';

async function getNextRequest() {
    const response = await fetch(`${API_BASE}/queue`);
    const { queue } = await response.json();
    return queue[0] || null;
}

async function processNext() {
    const request = await getNextRequest();
    
    if (!request) {
        console.log('📭 Queue is empty');
        return null;
    }
    
    const { prompt, options, requestId } = request;
    const type = options?.type || 'image'; // 'image' or 'video'
    console.log(`\n🎨 Processing ${type.toUpperCase()}: "${prompt.slice(0, 60)}..."`);
    console.log(`   Request ID: ${requestId}`);
    
    try {
        const projectId = 'fbeba5bb-94fc-4437-aab4-c3009a98047d';
        await page.goto(`https://flow.google.com/project/${projectId}`);
        await page.waitForLoadState('networkidle');
        
        if (type === 'video') {
            return await processVideo(requestId, prompt, options);
        } else {
            return await processImage(requestId, prompt, options);
        }
        
    } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        return { requestId, result: { success: false, error: error.message, prompt } };
    }
}

async function processImage(requestId, prompt, options = {}) {
    console.log('  🖼️  Image mode');
    
    // Fill prompt
    const input = page.locator('[aria-label="Bạn muốn tạo gì?"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.click();
    await input.fill('');
    await input.type(prompt, { delay: 30 });
    await page.waitForTimeout(500);
    
    // Click generate
    const btn = page.locator('[aria-label="Bắt đầu tạo"]');
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    console.log('  🚀 Generation started...');
    
    return await waitForResults(requestId, prompt, options, 'image');
}

async function processVideo(requestId, prompt, options = {}) {
    console.log('  🎬 Video mode');
    
    // Switch to video tab (Cảnh)
    console.log('  📹 Switching to video mode...');
    const videoTab = page.locator('button:has-text("Cảnh"), [role="tab"]:has-text("movie")').first();
    if (await videoTab.isVisible({ timeout: 3000 })) {
        await videoTab.click();
        await page.waitForTimeout(1000);
    }
    
    // Fill prompt
    const input = page.locator('[aria-label="Bạn muốn tạo gì?"]');
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.click();
    await input.fill('');
    await input.type(prompt, { delay: 30 });
    await page.waitForTimeout(500);
    
    // Click generate
    const btn = page.locator('[aria-label="Bắt đầu tạo"]');
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    console.log('  🚀 Video generation started...');
    
    return await waitForResults(requestId, prompt, options, 'video');
}

async function waitForResults(requestId, prompt, options, type) {
    const { 
        outputCount = 2, 
        waitForPermanent = false, 
        maxWaitMs = type === 'video' ? 300000 : 180000 // Video takes longer
    } = options || {};
    
    const startTime = Date.now();
    let permanentUrls = [];
    let tempUrls = [];
    
    console.log(`  ⏳ Waiting for ${type} generation (max ${maxWaitMs/1000}s)...`);
    
    while (Date.now() - startTime < maxWaitMs) {
        // Check for permanent URLs (images: flow-content.google, videos: check for video elements)
        if (type === 'image') {
            const permanent = await page.locator('img[src*="flow-content.google"]').all();
            permanentUrls = [];
            for (const img of permanent) {
                const src = await img.getAttribute('src');
                if (src && !permanentUrls.includes(src)) permanentUrls.push(src);
            }
        } else {
            // For video, look for video elements or completed generations
            const videos = await page.locator('video[src*="flow-content.google"], video[src*="asb/"]').all();
            for (const vid of videos) {
                const src = await vid.getAttribute('src');
                if (src && !permanentUrls.includes(src)) permanentUrls.push(src);
            }
        }
        
        // Check temp URLs
        if (type === 'image') {
            const temp = await page.locator('img[src*="asb/"]').all();
            tempUrls = [];
            for (const img of temp) {
                const src = await img.getAttribute('src');
                if (src && !tempUrls.includes(src)) tempUrls.push(src);
            }
        } else {
            const tempVids = await page.locator('video[src*="asb/"]').all();
            for (const vid of tempVids) {
                const src = await vid.getAttribute('src');
                if (src && !tempUrls.includes(src)) tempUrls.push(src);
            }
        }
        
        // Progress log
        if (permanentUrls.length > 0 || tempUrls.length > 0) {
            console.log(`  📊 Progress - Permanent: ${permanentUrls.length}, Temp: ${tempUrls.length}`);
        }
        
        // Check completion
        const currentCount = type === 'image' ? 
            (waitForPermanent ? permanentUrls.length : (permanentUrls.length > 0 ? permanentUrls.length : tempUrls.length)) :
            (waitForPermanent ? permanentUrls.length : (permanentUrls.length > 0 ? permanentUrls.length : tempUrls.length));
            
        if (currentCount >= outputCount) {
            console.log(`  ✅ Got ${currentCount} ${type}(s)!`);
            break;
        }
        
        await page.waitForTimeout(type === 'video' ? 10000 : 5000);
    }
    
    const finalUrls = waitForPermanent ? permanentUrls : 
        (permanentUrls.length > 0 ? permanentUrls : tempUrls);
    
    const result = {
        success: finalUrls.length > 0,
        prompt,
        type,
        permanentUrls: permanentUrls.slice(0, outputCount),
        temporaryUrls: tempUrls.slice(0, outputCount),
        finalUrls: finalUrls.slice(0, outputCount),
        timestamp: new Date().toISOString()
    };
    
    console.log(`  ✅ Completed! Got ${finalUrls.length} ${type}(s)`);
    return { requestId, result };
}

// Auto-process loop
async function processLoop(intervalMs = 10000) {
    console.log('🤖 Starting queue processor loop...');
    console.log('Press Ctrl+C to stop\n');
    
    while (true) {
        try {
            await processNext();
        } catch (error) {
            console.error('Processor error:', error.message);
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
}

// Export for use in OpenCode
export { processNext, processLoop };

// Usage:
// await processNext()           // Process one request
// await processLoop(10000)      // Continuous processing every 10s