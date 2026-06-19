import axios from "axios";
import { HttpError } from "../utils/httpError.js";
import { normalizeWebsiteRoot, websiteDomainKey } from "../utils/priority.js";

function compactLocation({ country, state, city, location }) {
  return [city, state, country].filter(Boolean).join(", ") || location;
}

function placeToBusiness(place, input) {
  const location = compactLocation(input);
  return {
    company: place.displayName?.text || place.name || "Unnamed business",
    website: normalizeWebsiteRoot(place.websiteUri) || null,
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    address: place.formattedAddress || null,
    industry: input.keyword,
    location,
    googleRating: place.rating || null,
    googleReviewCount: place.userRatingCount || 0
  };
}

function buildQueries(input) {
  const location = compactLocation(input);
  const services = String(input.services || "")
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);
  const baseKeywords = [input.keyword, ...services].filter(Boolean);
  const include = String(input.filters?.includeKeywords || "")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const terms = [...new Set([...baseKeywords, ...include])];
  const variants = [];

  for (const term of terms) {
    variants.push(`${term} in ${location}`);
    variants.push(`best ${term} in ${location}`);
    variants.push(`top rated ${term} in ${location}`);
    variants.push(`${term} near ${location}`);
    variants.push(`popular ${term} in ${location}`);
  }

  return variants;
}

export async function searchGooglePlaces(input) {
  if (!process.env.GOOGLE_API_KEY) {
    throw new HttpError(400, "GOOGLE_API_KEY is required to run scanner searches");
  }

  const target = Math.min(Number(input.maxResults || 10), 100);
  const minReviews = Number(input.minReviews || 0);
  const hasWebsiteOnly = Boolean(input.hasWebsiteOnly);
  const seen = new Set();
  const businesses = [];

  for (const textQuery of buildQueries(input)) {
    if (businesses.length >= target) break;

    const { data } = await axios.post(
      "https://places.googleapis.com/v1/places:searchText",
      {
        textQuery,
        maxResultCount: Math.min(target - businesses.length, 20)
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_API_KEY,
          "X-Goog-FieldMask":
            "places.displayName,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.formattedAddress,places.rating,places.userRatingCount"
        },
        timeout: 20000
      }
    );

    for (const place of data.places || []) {
      const business = placeToBusiness(place, input);
      if (hasWebsiteOnly && !business.website) continue;
      if (business.googleReviewCount < minReviews) continue;

      const key = websiteDomainKey(business.website) || `${business.company}-${business.address}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      businesses.push(business);
      if (businesses.length >= target) break;
    }
  }

  return businesses;
}
