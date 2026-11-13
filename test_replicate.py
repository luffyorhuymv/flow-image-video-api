#!/usr/bin/env python3
"""
Quick test for Replicate API with Google models
"""

import replicate
import os

# SET YOUR TOKEN HERE
os.environ["REPLICATE_API_TOKEN"] = "r8_YOUR_TOKEN_HERE"

# Test prompts
TEST_PROMPTS = [
    "A futuristic cyberpunk city at sunset, neon lights, flying cars, highly detailed, cinematic lighting",
    "An ancient library with floating glowing books, magical particles, spiral staircase, bioluminescent plants, fantasy atmosphere, cinematic lighting, 8k",
    "A majestic dragon flying over a medieval castle at sunrise, epic fantasy art, highly detailed",
]

MODELS_TO_TEST = [
    ("nano-banana", "google/nano-banana"),      # $0.02 - Fast, good text
    ("nano-banana-pro", "google/nano-banana-pro"), # $0.04 - Higher quality
]

def test_model(model_name, model_id, prompt):
    print(f"\n{'='*60}")
    print(f"Testing: {model_name} ({model_id})")
    print(f"Prompt: {prompt[:60]}...")
    print(f"{'='*60}")
    
    try:
        output = replicate.run(
            model_id,
            input={"prompt": prompt}
        )
        
        urls = output if isinstance(output, list) else [output]
        print(f"✅ Success! {len(urls)} image(s):")
        for i, url in enumerate(urls):
            print(f"  {i+1}. {url}")
        return urls
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return []

def main():
    print("🧪 Replicate API Test - Google Models")
    print(f"Token: {os.environ.get('REPLICATE_API_TOKEN', 'NOT SET')[:20]}...")
    
    if "YOUR_TOKEN" in os.environ.get("REPLICATE_API_TOKEN", ""):
        print("\n⚠️  Please set your REPLICATE_API_TOKEN first!")
        print("   Get it from: https://replicate.com/account/api-tokens")
        return
    
    for model_name, model_id in MODELS_TO_TEST:
        for prompt in TEST_PROMPTS[:1]:  # Test first prompt only
            test_model(model_name, model_id, prompt)

if __name__ == "__main__":
    main()