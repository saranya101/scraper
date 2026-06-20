import axios from "axios";
import { exclusionKeywords, getIndustryProfile, getIndustryProfileConfig } from "./industryProfileService.js";
import { HttpError } from "../utils/httpError.js";
import { normalizeWebsiteRoot, websiteDomainKey } from "../utils/priority.js";

function compactLocation({ country, state, city, location }) {
  return [city, state, country].filter(Boolean).join(", ") || location;
}

function placeToBusiness(place, input) {
  const location = compactLocation(input);
  const profile = input.industryProfile || getIndustryProfile(input.industrySlug);
  return {
    company: place.displayName?.text || place.name || "Unnamed business",
    website: normalizeWebsiteRoot(place.websiteUri) || null,
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    address: place.formattedAddress || null,
    industry: input.industryName || profile.name || input.keyword,
    industrySlug: input.industrySlug,
    location,
    googleRating: place.rating || null,
    googleReviewCount: place.userRatingCount || 0
  };
}

function buildQueries(input) {
  const location = compactLocation(input);
  const profile = input.industryProfile || getIndustryProfile(input.industrySlug);
  const services = String(input.services || "")
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);
  const profileTerms = input.keywordsEdited === false || !input.keyword
    ? profile.keywords
    : String(input.keyword).split(",").map((keyword) => keyword.trim()).filter(Boolean);
  const baseKeywords = [...profileTerms, ...services].filter(Boolean);
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

function isExcludedBusiness(business, input) {
  const manual = String(input.filters?.excludeKeywords || "")
    .split(",")
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);
  const preset = exclusionKeywords(input.exclusions || []).map((keyword) => keyword.toLowerCase());
  const blocked = [...new Set([...manual, ...preset])];
  if (!blocked.length) return false;
  const haystack = `${business.company} ${business.website || ""} ${business.address || ""}`.toLowerCase();
  return blocked.some((keyword) => haystack.includes(keyword));
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
  const enrichedInput = { ...input, industryProfile: await getIndustryProfileConfig(input.industrySlug) };

  for (const textQuery of buildQueries(enrichedInput)) {
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
      const business = placeToBusiness(place, enrichedInput);
      if (hasWebsiteOnly && !business.website) continue;
      if (business.googleReviewCount < minReviews) continue;
      if (isExcludedBusiness(business, enrichedInput)) continue;

      const key = websiteDomainKey(business.website) || `${business.company}-${business.address}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      businesses.push(business);
      if (businesses.length >= target) break;
    }
  }

  return businesses;
}
