#!/usr/bin/env python3
"""
Google Models on Replicate - Image Generation Agent
Models: google/nano-banana, google/nano-banana-pro, google/imagen-3, google/imagen-3-fast, google/veo-3.1, google/veo-3.1-fast
"""

import os
import replicate
from pathlib import Path

# Set your API token here or via environment variable
REPLICATE_API_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "YOUR_TOKEN_HERE")

# Model pricing (per image/video)
MODELS = {
    # Images
    "nano-banana": "google/nano-banana",           # $0.02/img - fast, good text
    "nano-banana-pro": "google/nano-banana-pro",   # $0.04/img - higher quality
    "imagen-3-fast": "google/imagen-3-fast",       # $0.03/img
    "imagen-3": "google/imagen-3",                 # $0.05/img - best quality
    
    # Videos
    "veo-3.1-fast": "google/veo-3.1-fast",         # $0.10-0.15/sec
    "veo-3.1": "google/veo-3.1",                   # $0.20-0.40/sec
}

async def generate_image(prompt: str, model_key: str = "nano-banana", **kwargs):
    """Generate image using specified model"""
    
    if model_key not in MODELS:
        raise ValueError(f"Unknown model: {model_key}. Available: {list(MODELS.keys())}")
    
    model = MODELS[model_key]
    
    # Default parameters
    input_params = {
        "prompt": prompt,
        **kwargs
    }
    
    print(f"🎨 Generating with {model}...")
    print(f"   Prompt: {prompt[:80]}...")
    
    try:
        output = replicate.run(
            model,
            input=input_params
        )
        
        # Output is typically a list of URLs
        if isinstance(output, list):
            urls = output
        else:
            urls = [output]
        
        print(f"✅ Generated {len(urls)} image(s):")
        for i, url in enumerate(urls):
            print(f"   {i+1}. {url}")
        
        return urls
        
    except Exception as e:
        print(f"❌ Error: {e}")
        raise

async def generate_video(prompt: str, model_key: str = "veo-3.1-fast", **kwargs):
    """Generate video using specified model"""
    
    if model_key not in MODELS:
        raise ValueError(f"Unknown model: {model_key}")
    
    model = MODELS[model_key]
    
    input_params = {
        "prompt": prompt,
        **kwargs
    }
    
    print(f"🎬 Generating video with {model}...")
    print(f"   Prompt: {prompt[:80]}...")
    
    try:
        output = replicate.run(
            model,
            input=input_params
        )
        
        if isinstance(output, list):
            urls = output
        else:
            urls = [output]
            
        print(f"✅ Generated video(s):")
        for i, url in enumerate(urls):
            print(f"   {i+1}. {url}")
            
        return urls
        
    except Exception as e:
        print(f"❌ Error: {e}")
        raise

# Synchronous wrappers
def generate_image_sync(prompt: str, model_key: str = "nano-banana", **kwargs):
    import asyncio
    return asyncio.run(generate_image(prompt, model_key, **kwargs))

def generate_video_sync(prompt: str, model_key: str = "veo-3.1-fast", **kwargs):
    import asyncio
    return asyncio.run(generate_video(prompt, model_key, **kwargs))


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python replicate_agent.py <prompt> [model]")
        print(f"Models: {list(MODELS.keys())}")
        sys.exit(1)
    
    prompt = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else "nano-banana"
    
    if "veo" in model:
        generate_video_sync(prompt, model)
    else:
        generate_image_sync(prompt, model)