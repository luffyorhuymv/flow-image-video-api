#!/usr/bin/env python3
"""
Google Flow Browser Automation Agent
Uses exported session (cookies + localStorage) to generate images via Flow UI
"""

import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

SESSION_FILE = Path(__file__).parent / "flow_session.json"

async def load_session(context):
    """Load cookies and localStorage from session file"""
    with open(SESSION_FILE) as f:
        session = json.load(f)
    
    # Set cookies
    cookies = []
    for cookie_str in session["cookies"].split("; "):
        if "=" in cookie_str:
            name, value = cookie_str.split("=", 1)
            cookies.append({
                "name": name.strip(),
                "value": value.strip(),
                "domain": ".google.com",
                "path": "/",
                "secure": True,
                "httpOnly": False,
                "sameSite": "Lax"
            })
    await context.add_cookies(cookies)
    
    # Set localStorage via init script
    local_storage_script = ""
    for key, value in session["localStorage"].items():
        local_storage_script += f"localStorage.setItem({json.dumps(key)}, {json.dumps(value)});"
    
    await context.add_init_script(local_storage_script)
    return session.get("projectId")

async def generate_image(page, prompt: str, model: str = "Nano Banana 2.1", output_count: int = 2):
    """Generate image using Flow UI"""
    
    # Navigate to project
    project_id = await load_session(page.context)
    await page.goto(f"https://flow.google.com/project/{project_id}")
    await page.wait_for_load_state("networkidle")
    
    # Wait for prompt input
    prompt_input = page.locator('[aria-label="Bạn muốn tạo những gì?"]')
    await prompt_input.wait_for(state="visible", timeout=10000)
    
    # Clear and fill prompt
    await prompt_input.click()
    await prompt_input.fill("")
    await prompt_input.type(prompt, delay=50)
    
    # Select model if needed (click model button to open menu, then select)
    model_button = page.locator('[aria-label="Điều kiện kích hoạt cài đặt"]')
    if await model_button.is_visible():
        await model_button.click()
        await page.wait_for_timeout(500)
        # Try to find and click the desired model
        model_option = page.locator(f'text="{model}"').first
        if await model_option.is_visible():
            await model_option.click()
    
    # Set output count (if different from default)
    if output_count != 2:
        # This would require interacting with settings - skip for now
        pass
    
    # Click generate button
    generate_btn = page.locator('[aria-label="Bắt đầu tạo"]')
    await generate_btn.wait_for(state="visible", timeout=5000)
    
    # Wait for button to be enabled
    await page.wait_for_function(
        '() => !document.querySelector(\'[aria-label="Bắt đầu tạo"]\').disabled',
        timeout=30000
    )
    
    await generate_btn.click()
    
    # Wait for generation to complete
    # Look for generated images in the grid
    await page.wait_for_timeout(5000)  # Initial wait
    
    # Poll for results
    max_wait = 120000  # 2 minutes max
    start_time = asyncio.get_event_loop().time()
    
    while (asyncio.get_event_loop().time() - start_time) * 1000 < max_wait:
        # Check for generated images (they appear as img elements with blob: or data: URLs)
        images = await page.locator('img[src^="blob:"], img[src^="data:"]').all()
        if len(images) >= output_count:
            break
        await page.wait_for_timeout(3000)
    
    # Extract generated image URLs
    image_elements = await page.locator('img[src^="blob:"], img[src^="data:"]').all()
    image_urls = []
    for img in image_elements[:output_count]:
        src = await img.get_attribute("src")
        if src:
            image_urls.append(src)
    
    return image_urls

async def main():
    prompt = "A futuristic cyberpunk city at sunset, neon lights, flying cars, highly detailed, cinematic lighting"
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # Set True for production
        context = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        page = await context.new_page()
        
        print(f"Generating image: {prompt}")
        image_urls = await generate_image(page, prompt)
        
        print(f"Generated {len(image_urls)} images:")
        for i, url in enumerate(image_urls):
            print(f"  {i+1}. {url[:80]}...")
        
        # Save images if they're data URLs
        for i, url in enumerate(image_urls):
            if url.startswith("data:"):
                import base64
                header, data = url.split(",", 1)
                ext = header.split(";")[0].split("/")[1]
                with open(f"generated_{i+1}.{ext}", "wb") as f:
                    f.write(base64.b64decode(data))
                print(f"Saved generated_{i+1}.{ext}")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())