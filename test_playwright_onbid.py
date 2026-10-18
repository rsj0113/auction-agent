import asyncio
from playwright.async_api import async_playwright
import json

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        initial_post_data = None
        
        async def on_request(request):
            nonlocal initial_post_data
            if "srchCltrCdtn" in request.url and request.method == "POST":
                initial_post_data = request.post_data
                print(f"[INITIAL POST DATA] {initial_post_data}")

        async def on_response(response):
            if "srchCltrCdtn" in response.url:
                try:
                    data = await response.json()
                    print(f"Items received: {len(data.get('cltrInfVOList', []))}")
                    if data.get('cltrInfVOList'):
                        with open("onbid_sample_item.json", "w", encoding="utf-8") as f:
                            json.dump(data['cltrInfVOList'][0], f, ensure_ascii=False, indent=2)
                        print("Saved onbid_sample_item.json successfully!")
                except Exception as e:
                    print("Error parsing response json:", e)

        page.on("request", on_request)
        page.on("response", on_response)

        print("Navigating...")
        await page.goto("https://www.onbid.co.kr/op/cltrpbancinf/cltr/cltrcdtnsrch/CltrCdtnSrchController/mvmnCltrCdtnSrchClg.do")
        await page.wait_for_timeout(5000)
        
        if initial_post_data:
            with open("onbid_initial_payload.txt", "w", encoding="utf-8") as f:
                f.write(initial_post_data)
            print("Saved onbid_initial_payload.txt successfully!")
            
        await browser.close()

asyncio.run(run())
