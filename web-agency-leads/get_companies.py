import os, requests, pandas as pd
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("GOOGLE_API_KEY")

QUERIES = [
    "aesthetic clinic in Singapore",
    "med spa in Los Angeles",
    "beauty salon in Dallas Texas",
    "hair salon in Austin Texas",
    "nail salon in New York",
    "dental clinic in Singapore",
    "pilates studio in Miami",
    "interior designer in Singapore",
]

def search_places(query):
    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.nationalPhoneNumber,places.formattedAddress"
    }
    body = {"textQuery": query, "maxResultCount": 20}

    r = requests.post(url, headers=headers, json=body)
    data = r.json()
    print(query, data.get("error", data.get("places", [])[:1]))
    return data.get("places", [])

def main():
    leads = []

    for query in QUERIES:
        for p in search_places(query):
            website = p.get("websiteUri", "")
            if not website:
                continue

            leads.append({
                "Company": p.get("displayName", {}).get("text", ""),
                "Website": website,
                "Phone": p.get("nationalPhoneNumber", ""),
                "Address": p.get("formattedAddress", ""),
                "Industry Query": query
            })

    df = pd.DataFrame(leads).drop_duplicates(subset=["Website"])
    df.to_csv("leads.csv", index=False)
    print(f"Saved {len(df)} leads to leads.csv")

if __name__ == "__main__":
    main()