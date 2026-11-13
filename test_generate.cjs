const API_BASE = 'http://localhost:3001';

async function testGenerate() {
    console.log('Testing generation...');
    
    try {
        const response = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                prompt: 'A beautiful sunset over mountains, cinematic lighting', 
                outputCount: 1 
            })
        });
        
        const result = await response.json();
        console.log('Result:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testGenerate();