#!/usr/bin/env node
/**
 * Flow API Client - Test and usage examples
 */

const API_BASE = 'http://localhost:3001';

async function generateImage(prompt, options = {}) {
    const response = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...options })
    });
    return response.json();
}

async function batchGenerate(prompts, options = {}) {
    const response = await fetch(`${API_BASE}/generate/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts, ...options })
    });
    return response.json();
}

async function healthCheck() {
    const response = await fetch(`${API_BASE}/health`);
    return response.json();
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'test';
    
    console.log('🔗 Flow API Client');
    console.log('==================\n');
    
    try {
        switch (command) {
            case 'health': {
                const health = await healthCheck();
                console.log('Health:', JSON.stringify(health, null, 2));
                break;
            }
            
            case 'test': {
                console.log('Testing single generation...\n');
                const result = await generateImage(
                    'A majestic phoenix rising from flames, vibrant colors, fantasy art, highly detailed, 8k',
                    { outputCount: 2 }
                );
                console.log('Result:', JSON.stringify(result, null, 2));
                break;
            }
            
            case 'batch': {
                const prompts = [
                    'A cyberpunk samurai in neon Tokyo, rain, cinematic lighting',
                    'An underwater city with bioluminescent buildings, mermaids swimming',
                    'A steampunk airship floating above Victorian London, sunset'
                ];
                console.log('Testing batch generation...\n');
                const result = await batchGenerate(prompts, { outputCount: 1, delayMs: 3000 });
                console.log('Results:', JSON.stringify(result, null, 2));
                break;
            }
            
            case 'project': {
                const response = await fetch(`${API_BASE}/project`);
                const data = await response.json();
                console.log('Project:', JSON.stringify(data, null, 2));
                break;
            }
            
            default:
                console.log('Usage: node flow_api_client.js [health|test|batch|project]');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();