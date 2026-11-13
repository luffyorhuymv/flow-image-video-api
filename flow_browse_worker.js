/**
 * Flow Browse Worker - Processes generation queue using browse tool
 * Run this in OpenCode terminal: node flow_browse_worker.js
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3001';

// Browse tool execution - this runs in OpenCode context
// We'll use the same pattern as tools.browse.execute

async function processGeneration(prompt, options = {}) {
    const {
        outputCount = 2,
        waitForPermanent = false,
        maxWaitMs = 180000
    } = options;
    
    console.log(`\n🎨 Processing: "${prompt.slice(0, 60)}..."`);
    
    try {
        // This code will be executed via tools.browse.execute
        // We need to return the JavaScript code as a string
        const browseCode = `
            // Navigate to project page
            const projectId = '${getCurrentProjectId()}';
            await page.goto(\`https://flow.google.com/project/\${projectId}\`);
            await page.waitForLoadState('networkidle');
            
            // Fill prompt
            const input = page.locator('[aria-label="Bạn muốn tạo gì?"]');
            await input.waitFor({ state: 'visible', timeout: 10000 });
            await input.click();
            await input.fill('');
            await input.type('${escapePrompt(prompt)}', { delay: 30 });
            await page.waitForTimeout(500);
            
            // Click generate
            const btn = page.locator('[aria-label="Bắt đầu tạo"]');
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            await btn.click();
            
            return 'started';
        `;
        
        // Actually, we can't call tools.browse.execute from Node.js
        // We need a different approach
        
        return { success: false, error: 'Worker must run in OpenCode context' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function escapePrompt(prompt) {
    return prompt.replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function getCurrentProjectId() {
    // This would need to be dynamic
    return 'fbeba5bb-94fc-4437-aab4-c3009a98047d';
}

// Main worker loop
async function runWorker() {
    console.log('🤖 Flow Browse Worker started');
    console.log('===============================\n');
    console.log('This worker needs to run in OpenCode context to use browse tool.');
    console.log('Press Ctrl+C to stop.\n');
    
    while (true) {
        try {
            // Check queue
            const response = await fetch(`${API_BASE}/queue`);
            const { queue } = await response.json();
            
            if (queue.length > 0) {
                console.log(`\n📦 Queue has ${queue.length} items`);
                
                // Process first item
                const item = queue[0];
                console.log(`Processing: ${item.prompt.slice(0, 60)}...`);
                
                // Here we would call tools.browse.execute
                // But since we can't from Node.js, we'll just log
                console.log('⚠️  Need to run browse tool manually in OpenCode');
                console.log('Run this in OpenCode:');
                console.log(`
const result = await tools.browse.execute({
  code: \`...browse code here...\`
});
                `);
                
                // For now, just wait and check again
                await new Promise(r => setTimeout(r, 10000));
            } else {
                // No items, wait
                await new Promise(r => setTimeout(r, 5000));
            }
        } catch (error) {
            console.error('Worker error:', error.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// If running directly
if (require.main === module) {
    runWorker().catch(console.error);
}

export { processGeneration, runWorker };