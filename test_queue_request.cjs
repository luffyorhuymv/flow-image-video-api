const API_BASE = 'http://localhost:3001';

async function queueRequest(type = 'image') {
    console.log(`📤 Queuing ${type} generation request...`);
    
    const prompts = {
        image: 'A majestic phoenix rising from flames, vibrant orange and red feathers, fantasy art, cinematic lighting, 8k',
        video: 'A dragon flying over a medieval castle at sunset, cinematic camera movement, 8 seconds'
    };
    
    try {
        const response = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompts[type],
                outputCount: 2,
                type: type
            })
        });
        
        const result = await response.json();
        console.log('✅ Queued:', JSON.stringify(result, null, 2));
        return result;
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function queueBatch() {
    console.log('📤 Queuing batch request...');
    
    try {
        const response = await fetch(`${API_BASE}/generate/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompts: [
                    'A cyberpunk city at night, neon lights',
                    'A peaceful forest with sunlight rays',
                    'An astronaut on Mars, Earth visible'
                ],
                outputCount: 1,
                type: 'image'
            })
        });
        
        const result = await response.json();
        console.log('✅ Batch queued:', JSON.stringify(result, null, 2));
        return result;
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'image';
    
    console.log('🔗 Flow API Client');
    console.log('==================\n');
    
    try {
        switch (command) {
            case 'image':
                await queueRequest('image');
                break;
            case 'video':
                await queueRequest('video');
                break;
            case 'batch':
                await queueBatch();
                break;
            case 'health': {
                const health = await fetch(`${API_BASE}/health`).then(r => r.json());
                console.log('Health:', JSON.stringify(health, null, 2));
                break;
            }
            default:
                console.log('Usage: node test_queue_request.cjs [image|video|batch|health]');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();