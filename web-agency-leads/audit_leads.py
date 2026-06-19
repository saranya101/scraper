import os, json, requests, pandas as pd
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

INPUT_FILE = "leads.csv"
OUTPUT_FILE = "audited_leads.xlsx"

def get_site_text(url):
    try:
        if not url.startswith("http"):
            url = "https://" + url

        r = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0"
        })
        soup = BeautifulSoup(r.text, "html.parser")

        for tag in soup(["script", "style"]):
            tag.decompose()

        text = soup.get_text(" ", strip=True)
        return text[:4000]
    except Exception as e:
        return f"Could not access site: {e}"

def audit_website(company, website, site_text):
    prompt = f"""
Return ONLY raw JSON. No markdown. No explanation.

Company: {company}
Website: {website}
Website text:
{site_text[:4000]}

JSON format:
{{
  "score": 5,
  "issues": ["issue 1", "issue 2", "issue 3"],
  "project_value_sgd": "S$2k-S$5k",
  "outreach_email": "Hi..."
}}
"""

    response = client.responses.create(
        model="gpt-4.1-mini",
        input=prompt
    )

    text = response.output_text.strip()

    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    print("AI RESPONSE:", text)

    return json.loads(text)

def main():
    df = pd.read_csv(INPUT_FILE)
    results = []

    for _, row in df.iterrows():
        company = row.get("Company", "")
        website = row.get("Website", "")

        print(f"Auditing {company} - {website}")

        site_text = get_site_text(website)

        try:
            audit = audit_website(company, website, site_text)
        except Exception as e:
            audit = {
                "score": "",
                "issues": [f"AI audit failed: {e}"],
                "project_value_sgd": "",
                "outreach_email": ""
            }

        results.append({
            "Company": company,
            "Website": website,
            "Score": audit.get("score", ""),
            "Issues": "; ".join(audit.get("issues", [])),
            "Project Value": audit.get("project_value_sgd", ""),
            "Outreach Email": audit.get("outreach_email", ""),
            "Status": "Not Contacted"
        })

    out = pd.DataFrame(results)
    out.to_excel(OUTPUT_FILE, index=False)
    print(f"Done. Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()