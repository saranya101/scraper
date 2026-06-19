import os, json, base64, asyncio, pandas as pd
from dotenv import load_dotenv
from openai import OpenAI
from playwright.async_api import async_playwright

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

INPUT_FILE = "leads.csv"
OUTPUT_FILE = "audited_leads.xlsx"
SCREENSHOT_DIR = "screenshots"

os.makedirs(SCREENSHOT_DIR, exist_ok=True)


def safe_name(name):
    return "".join(c for c in name if c.isalnum() or c in (" ", "-", "_")).strip().replace(" ", "_")[:60]


def image_to_base64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


async def scan_site(company, website):
    if not website.startswith("http"):
        website = "https://" + website

    result = {
        "website_status": "Working",
        "status_code": "",
        "access_issue": "",
        "access_issue_reason": "",
        "desktop_screenshot": "",
        "mobile_screenshot": "",
        "text": ""
    }

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)

            page = await browser.new_page(
                viewport={"width": 1440, "height": 1000},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
            )

            try:
                response = await page.goto(website, timeout=20000, wait_until="domcontentloaded")
                if response:
                    result["status_code"] = response.status

                    if response.status == 403:
                        result["website_status"] = "Blocked"
                        result["access_issue"] = "403 Forbidden"
                    elif response.status == 404:
                        result["website_status"] = "Broken"
                        result["access_issue"] = "404 Not Found"
                    elif response.status >= 500:
                        result["website_status"] = "Server Error"
                        result["access_issue"] = f"{response.status} Server Error"

                await page.wait_for_timeout(3000)

                html_text = await page.locator("body").inner_text(timeout=5000)
                result["text"] = html_text[:5000]

                title = (await page.title()).lower()
                body = result["text"].lower()

                if "cloudflare" in body or "checking your browser" in body:
                    result["website_status"] = "Blocked"
                    result["access_issue"] = "Cloudflare detected"

                if "captcha" in body or "verify you are human" in body:
                    result["website_status"] = "Blocked"
                    result["access_issue"] = "CAPTCHA detected"

                if "domain for sale" in body or "buy this domain" in body:
                    result["website_status"] = "Parked"
                    result["access_issue"] = "Domain parked"

                base = safe_name(company or website)

                desktop_path = f"{SCREENSHOT_DIR}/{base}_desktop.png"
                await page.screenshot(path=desktop_path, full_page=True)
                result["desktop_screenshot"] = desktop_path

                mobile = await browser.new_page(
                    viewport={"width": 390, "height": 844},
                    is_mobile=True,
                    user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"
                )
                await mobile.goto(website, timeout=20000, wait_until="domcontentloaded")
                await mobile.wait_for_timeout(2000)

                mobile_path = f"{SCREENSHOT_DIR}/{base}_mobile.png"
                await mobile.screenshot(path=mobile_path, full_page=True)
                result["mobile_screenshot"] = mobile_path

            except Exception as e:
                result["website_status"] = "Error"
                result["access_issue"] = "Scan failed"
                result["access_issue_reason"] = str(e)

            await browser.close()

    except Exception as e:
        result["website_status"] = "Error"
        result["access_issue"] = "Browser failed"
        result["access_issue_reason"] = str(e)

    return result


def audit_with_ai(company, website, scan):
    desktop_b64 = ""
    if scan["desktop_screenshot"]:
        desktop_b64 = image_to_base64(scan["desktop_screenshot"])

    prompt = f"""
Audit this business website for a web design agency.

Company: {company}
Website: {website}
Website status: {scan["website_status"]}
Access issue: {scan["access_issue"]}
Visible text:
{scan["text"][:5000]}

Return ONLY valid JSON:
{{
  "overall_score": 5,
  "visual_design_score": 5,
  "mobile_score": 5,
  "trust_score": 5,
  "cta_score": 5,
  "seo_basic_score": 5,
  "opportunity_score": 5,
  "priority": "HOT/WARM/COLD",
  "estimated_project_value": "S$2k-S$5k",
  "issues": ["issue 1", "issue 2", "issue 3"],
  "recommended_fixes": ["fix 1", "fix 2", "fix 3"],
  "outreach_email": "short personalised email"
}}
"""

    content = [{"type": "input_text", "text": prompt}]

    if desktop_b64:
        content.append({
            "type": "input_image",
            "image_url": f"data:image/png;base64,{desktop_b64}"
        })

    response = client.responses.create(
        model="gpt-4.1-mini",
        input=[{"role": "user", "content": content}]
    )

    text = response.output_text.strip()

    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    return json.loads(text)


async def main():
    df = pd.read_csv(INPUT_FILE)
    results = []

    for _, row in df.iterrows():
        company = row.get("Company", "")
        website = row.get("Website", "")

        print(f"Scanning {company} - {website}")

        scan = await scan_site(company, website)

        try:
            audit = audit_with_ai(company, website, scan)
        except Exception as e:
            audit = {
                "overall_score": "",
                "visual_design_score": "",
                "mobile_score": "",
                "trust_score": "",
                "cta_score": "",
                "seo_basic_score": "",
                "opportunity_score": "",
                "priority": "",
                "estimated_project_value": "",
                "issues": [f"AI audit failed: {e}"],
                "recommended_fixes": [],
                "outreach_email": ""
            }

        results.append({
            "Company": company,
            "Website": website,
            "Phone": row.get("Phone", ""),
            "Address": row.get("Address", ""),
            "Industry": row.get("Industry Query", ""),
            "Website Status": scan["website_status"],
            "Status Code": scan["status_code"],
            "Access Issue": scan["access_issue"],
            "Access Issue Reason": scan["access_issue_reason"],
            "Desktop Screenshot": scan["desktop_screenshot"],
            "Mobile Screenshot": scan["mobile_screenshot"],
            "Overall Score": audit.get("overall_score", ""),
            "Visual Design Score": audit.get("visual_design_score", ""),
            "Mobile Score": audit.get("mobile_score", ""),
            "Trust Score": audit.get("trust_score", ""),
            "CTA Score": audit.get("cta_score", ""),
            "SEO Basic Score": audit.get("seo_basic_score", ""),
            "Opportunity Score": audit.get("opportunity_score", ""),
            "Priority": audit.get("priority", ""),
            "Project Value": audit.get("estimated_project_value", ""),
            "Issues": "; ".join(audit.get("issues", [])),
            "Recommended Fixes": "; ".join(audit.get("recommended_fixes", [])),
            "Outreach Email": audit.get("outreach_email", ""),
            "Status": "Not Contacted"
        })

    out = pd.DataFrame(results)
    out.to_excel(OUTPUT_FILE, index=False)
    print(f"Done. Saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    asyncio.run(main())