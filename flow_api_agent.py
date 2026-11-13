#!/usr/bin/env python3
"""
Google Flow API-style Agent (using session cookies)
Attempts to call Flow's internal generation API directly
"""

import json
import requests
from pathlib import Path

SESSION_FILE = Path(__file__).parent / "flow_session.json"

def load_session():
    with open(SESSION_FILE) as f:
        return json.load(f)

def get_headers(session):
    """Build headers with cookies"""
    return {
        "Cookie": session["cookies"],
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Origin": "https://flow.google.com",
        "Referer": "https://flow.google.com/",
        "X-Requested-With": "XMLHttpRequest",
    }

def generate_image_api(prompt: str, project_id: str = None):
    """Try to call Flow's internal generation endpoint"""
    session = load_session()
    project_id = project_id or session.get("projectId")
    
    if not project_id:
        print("No project ID in session")
        return None
    
    headers = get_headers(session)
    
    # Flow's internal API endpoints (may need adjustment based on actual network traffic)
    # These are guessed based on typical Firebase/Google internal APIs
    endpoints_to_try = [
        f"https://flow.google.com/api/projects/{project_id}/generate",
        f"https://flow.google.com/api/generate",
        f"https://us-central1-flow-prod.cloudfunctions.net/generateImage",
        f"https://flow.googleapis.com/v1/projects/{project_id}:generate",
    ]
    
    payload = {
        "prompt": prompt,
        "model": "nano-banana-2.1",
        "outputCount": 2,
        "aspectRatio": "16:9",
    }
    
    for endpoint in endpoints_to_try:
        try:
            print(f"Trying {endpoint}...")
            resp = requests.post(endpoint, headers=headers, json=payload, timeout=30)
            print(f"  Status: {resp.status_code}")
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 401:
                print("  Session expired")
            elif resp.status_code == 404:
                print("  Endpoint not found")
        except Exception as e:
            print(f"  Error: {e}")
    
    return None

def main():
    prompt = "A futuristic cyberpunk city at sunset, neon lights, flying cars, highly detailed, cinematic lighting"
    print(f"Attempting API generation: {prompt}")
    result = generate_image_api(prompt)
    if result:
        print("Success!")
        print(json.dumps(result, indent=2))
    else:
        print("API approach failed - use browser automation (flow_agent.py) instead")

if __name__ == "__main__":
    main()