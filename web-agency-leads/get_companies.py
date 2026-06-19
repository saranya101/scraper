import os
import requests
import pandas as pd
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("GOOGLE_API_KEY")

SEARCHES = [
    {"industry": "aesthetic clinic", "location": "Singapore"},
    {"industry": "med spa", "location": "Los Angeles"},
    {"industry": "beauty salon", "location": "Dallas Texas"},
    {"industry": "hair salon", "location": "Austin Texas"},
    {"industry": "nail salon", "location": "New York"},
    {"industry": "dental clinic", "location": "Singapore"},
    {"industry": "pilates studio", "location": "Miami"},
    {"industry": "interior designer", "location": "Singapore"},
]

MAX_RESULTS_PER_SEARCH = 20


def search_places(industry, location):
    query = f"{industry} in {location}"

    url = "https://places.googleapis.com/v1/places:searchText"

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": (
            "places.displayName,"
            "places.websiteUri,"
            "places.nationalPhoneNumber,"
            "places.formattedAddress,"
            "places.rating,"
            "places.userRatingCount"
        ),
    }

    body = {
        "textQuery": query,
        "maxResultCount": MAX_RESULTS_PER_SEARCH,
    }

    response = requests.post(url, headers=headers, json=body)
    data = response.json()

    if "error" in data:
        print(f"Error for {query}: {data['error'].get('message')}")
        return []

    return data.get("places", [])


def main():
    leads = []

    for item in SEARCHES:
        industry = item["industry"]
        location = item["location"]

        print(f"Searching: {industry} in {location}")

        places = search_places(industry, location)

        for place in places:
            website = place.get("websiteUri")

            if not website:
                continue

            leads.append({
                "Company": place.get("displayName", {}).get("text", ""),
                "Website": website,
                "Phone": place.get("nationalPhoneNumber", ""),
                "Address": place.get("formattedAddress", ""),
                "Industry": industry,
                "Location": location,
                "Google Rating": place.get("rating", ""),
                "Review Count": place.get("userRatingCount", ""),
            })

    df = pd.DataFrame(leads)

    if df.empty:
        print("Saved 0 leads. No websites found.")
        return

    df = df.drop_duplicates(subset=["Website"])
    df.to_csv("leads.csv", index=False)

    print(f"Saved {len(df)} leads to leads.csv")


if __name__ == "__main__":
    main()