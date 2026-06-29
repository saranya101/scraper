import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";

const allowedStatuses = new Set(["present", "absent", "unclear"]);
const businessCategories = new Set([
  "business",
  "trust",
  "conversion",
  "services",
  "content",
  "navigation",
  "social_proof",
  "credentials",
  "contact",
  "local",
  "technical",
  "seo",
  "ux"
]);
const weakText = new Set([
  "discover",
  "learn more",
  "read more",
  "more",
  "view more",
  "click here",
  "submit",
  "next",
  "previous",
  "home",
  "menu",
  "search"
]);
const ctaWords = /\b(book|schedule|reserve|appointment|consultation|contact|call|enquire|inquire|get quote|request quote|free quote|whatsapp|buy|order|apply|start|get started|send message|talk to|speak to)\b/i;
const serviceWords = /\b(service|services|treatment|treatments|solution|solutions|product|products|fuel|fuels|design|clinic|legal|dentistry|orthodontic|restaurant|menu|catering|branding|seo|maintenance|repair|installation|consulting|automation|analytics|booking|ecommerce|portfolio|project|projects)\b/i;
const trustWords = /\b(accredited|certified|licensed|award|awards|winner|recognised|recognized|trusted|approved|registered|member|partner|partners|official|guarantee|warranty|insured|iso|certification|certifications)\b/i;
const testimonialWords = /\b(testimonial|testimonials|review|reviews|rated|rating|stars|clients say|customers say|patient reviews|google reviews)\b/i;
const caseStudyWords = /\b(case study|case studies|portfolio|project|projects|our work|gallery|before and after|before\/after|results)\b/i;
const faqSectionWords = /\b(faqs?|frequently asked questions)\b/i;
const pricingWords = /\b(price|pricing|packages|plans|fees|rates|cost|from \$|starting at|quote)\b/i;
const staffWords = /\b(team|staff|doctor|doctors|dentist|dentists|lawyer|lawyers|attorney|attorneys|founder|specialist|consultant|therapist|designer|profile|profiles)\b/i;
const locationWords = /\b(location|locations|service area|service areas|serving|near me|address|singapore|australia|malaysia|usa|uk|united states|united kingdom)\b/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampConfidence(value, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unique(values) {
  return [...new Set(array(values).map(clean).filter(Boolean))];
}

function normalizeStatus(value) {
  if (value === "present" || value === true) return "present";
  if (value === "absent" || value === false) return "absent";
  return "unclear";
}

function normalizeCategory(category) {
  const safe = clean(category);
  if (businessCategories.has(safe)) return safe;
  if (safe === "meta" || safe === "structured_data") return "seo";
  if (safe === "technology") return "technical";
  if (safe === "dom" || safe === "scan_evidence" || safe === "ocr") return "content";
  return "business";
}

function usefulText(value, { allowCta = false } = {}) {
  const text = clean(value);
  if (!text) return "";
  if (text.length < 3 || text.length > 180) return "";
  if (!allowCta && weakText.has(text.toLowerCase())) return "";
  if (/^[\W_]+$/.test(text)) return "";
  return text;
}

function compactIdPart(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function evidenceItem({
  id,
  signal,
  status,
  category,
  page = "homepage",
  url = "",
  confidence = 0.5,
  evidenceText = "",
  domSelector = "",
  ocrEvidence = "",
  screenshotReference = "",
  notes = [],
  fields = [],
  source = "dom"
}) {
  const safeStatus = allowedStatuses.has(status) ? status : "unclear";
  const safeEvidenceText = clean(evidenceText);
  const safeOcrEvidence = clean(ocrEvidence);
  const safeDomSelector = clean(domSelector);
  if (!safeEvidenceText && !safeOcrEvidence && !safeDomSelector) return null;
  return {
    id: clean(id),
    signal: clean(signal),
    status: safeStatus,
    category: normalizeCategory(category),
    page: clean(page || "homepage"),
    url: clean(url),
    confidence: Number(clampConfidence(confidence).toFixed(2)),
    source: clean(source || "dom"),
    evidenceText: safeEvidenceText,
    domSelector: safeDomSelector,
    ocrEvidence: safeOcrEvidence,
    screenshotReference: clean(screenshotReference),
    notes: array(notes).map(clean).filter(Boolean),
    ...(array(fields).length ? { fields: unique(fields) } : {})
  };
}

function normalizeInput(input = {}) {
  const raw = input.rawExtractedData || input.existingScanData?.rawExtractedData || {};
  return {
    pageUrl: clean(input.pageUrl || input.url || input.websiteUrl || input.website || raw.canonical),
    page: clean(input.page || "homepage"),
    visibleText: clean(input.visibleText || raw.visibleText),
    ocrText: clean(input.ocrText),
    metaTags: input.metaTags || {
      title: input.title || raw.title || "",
      description: input.metaDescription || raw.metaDescription || ""
    },
    structuredData: input.structuredData || raw.structuredData || [],
    headings: array(input.headings || raw.headings),
    ctas: array(input.ctas || raw.ctas),
    forms: array(input.forms || raw.forms),
    socialLinks: array(input.socialLinks || raw.socialLinks),
    links: array(input.links || raw.links || raw.anchors),
    emails: array(input.emails || raw.emails),
    phones: array(input.phones || raw.phones),
    techStack: input.techStack || raw.techStack || null,
    scanEvidence: input.scanEvidence || input.existingScanData?.scanEvidence || null,
    screenshotMetadata: input.screenshotMetadata || {},
    screenshotReference: clean(input.screenshotReference || input.screenshotPath || input.existingScanData?.screenshotPath || "")
  };
}

function categoryForSignal(key, signal = {}) {
  const normalized = clean(key).toLowerCase();
  const evidence = clean(signal.evidence || signal.textRead || "").toLowerCase();
  if (/social|instagram|facebook|linkedin|tiktok|youtube|twitter|x_twitter/.test(normalized)) {
    return socialCategoryForText(`${normalized} ${evidence}`);
  }
  const sourceCategory = clean(signal.category);
  if (businessCategories.has(sourceCategory)) return sourceCategory;
  if (/phone|email|whatsapp|contact/.test(normalized)) return "contact";
  if (/form|booking|cta|button|appointment|reservation|quote|enquiry|inquiry/.test(normalized)) return "conversion";
  if (/review|testimonial|rating|stars/.test(normalized)) return "social_proof";
  if (/award|badge|certification|accreditation|credential|license/.test(normalized)) return "credentials";
  if (/service|product|treatment|portfolio|case|project|faq|pricing|content/.test(normalized)) return "content";
  if (/seo|title|description|heading|schema|structured/.test(normalized)) return "seo";
  if (/speed|ssl|redirect|status|tech|analytics|pixel|cms/.test(normalized)) return "technical";
  return "business";
}

function itemFromSignal(key, signal, context) {
  if (!signal || !signal.evidence) return null;
  return evidenceItem({
    id: `scan-${key}`,
    signal: key,
    status: normalizeStatus(signal.value),
    category: categoryForSignal(key, signal),
    page: context.page,
    url: context.pageUrl,
    confidence: signal.confidence,
    evidenceText: signal.evidence,
    domSelector: signal.domSelector || (signal.source === "dom" ? "body" : ""),
    ocrEvidence: signal.source === "vision" || signal.source === "dom+vision" ? signal.textRead || signal.evidence : "",
    screenshotReference: context.screenshotReference,
    source: signal.source || "scan_evidence",
    notes: [signal.source, signal.detectorVersion].filter(Boolean)
  });
}

function itemsFromMeta(context) {
  const title = clean(context.metaTags?.title);
  const description = clean(context.metaTags?.description || context.metaTags?.metaDescription);
  return [
    title && evidenceItem({
      id: "meta-title",
      signal: "meta_title",
      status: "present",
      category: "seo",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.96,
      evidenceText: title,
      domSelector: "title",
      source: "dom"
    }),
    description && evidenceItem({
      id: "meta-description",
      signal: "meta_description",
      status: "present",
      category: "seo",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.94,
      evidenceText: description,
      domSelector: "meta[name='description']",
      source: "dom"
    })
  ].filter(Boolean);
}

function fieldName(field, index) {
  if (typeof field === "string") {
    const safe = usefulText(field);
    if (!safe || /^field[_-]?[a-z0-9]{4,}$/i.test(safe) || /[a-f0-9]{8,}/i.test(safe)) return "";
    return safe;
  }
  const source = object(field);
  const fromName = usefulText(source.name);
  const fromId = usefulText(source.id);
  const safeName = fromName && !/^field[_-]?[a-z0-9]{4,}$/i.test(fromName) && !/[a-f0-9]{8,}/i.test(fromName) ? fromName : "";
  const safeId = fromId && !/^field[_-]?[a-z0-9]{4,}$/i.test(fromId) && !/[a-f0-9]{8,}/i.test(fromId) ? fromId : "";
  const safeType = usefulText(source.type);
  return (
    usefulText(source.label) ||
    usefulText(source.placeholder) ||
    safeName ||
    safeId ||
    (safeType && !["hidden", "submit", "button"].includes(safeType.toLowerCase()) ? safeType : "") ||
    ""
  );
}

function linkParts(link) {
  if (typeof link === "string") return { href: clean(link), text: "" };
  const source = object(link);
  return {
    href: clean(source.href || source.url),
    text: clean(source.text || source.label || source.title || source.ariaLabel)
  };
}

function ctaParts(cta) {
  if (typeof cta === "string") return { text: clean(cta), href: "" };
  const source = object(cta);
  return {
    text: clean(source.text || source.label || source.value || source.ariaLabel),
    href: clean(source.href || source.url || source.action)
  };
}

function itemsFromHeadings(context) {
  const items = [];
  const questionHeadingCount = context.headings.filter((heading) => isQuestionText(heading)).length;
  context.headings.slice(0, 12).forEach((heading, index) => {
    const text = usefulText(heading);
    if (!text) return;
    let signal = "page_section";
    let category = "content";
    let confidence = 0.78;
    if (caseStudyWords.test(text)) {
      signal = "case_study_or_portfolio_section";
      category = "content";
      confidence = 0.88;
    } else if (serviceWords.test(text)) {
      signal = "product_or_service";
      category = "services";
      confidence = 0.88;
    } else if (trustWords.test(text)) {
      signal = "trust_or_credential_claim";
      category = "credentials";
      confidence = 0.86;
    } else if (testimonialWords.test(text)) {
      signal = "reviews_or_testimonials_section";
      category = "social_proof";
      confidence = 0.9;
    } else if (isFaqHeading(text, questionHeadingCount)) {
      signal = "faq_section";
      category = "content";
      confidence = 0.9;
    } else if (pricingWords.test(text)) {
      signal = "pricing_content";
      category = "content";
      confidence = 0.84;
    } else if (staffWords.test(text)) {
      signal = "staff_or_profile_section";
      category = "trust";
      confidence = 0.84;
    } else if (locationWords.test(text)) {
      signal = "location_or_service_area";
      category = "local";
      confidence = 0.82;
    }
    items.push(evidenceItem({
      id: `heading-${index + 1}`,
      signal,
      status: "present",
      category,
      page: context.page,
      url: context.pageUrl,
      confidence,
      evidenceText: text,
      domSelector: "h1,h2,h3",
      source: "dom"
    }));
  });
  return items.filter(Boolean);
}

function itemsFromCtas(context) {
  const items = [];
  context.ctas.slice(0, 12).forEach((cta, index) => {
    const { text, href } = ctaParts(cta);
    const safeText = usefulText(text, { allowCta: true });
    if (!safeText || !ctaWords.test(`${safeText} ${href}`)) return;
    items.push(evidenceItem({
      id: `cta-${index + 1}`,
      signal: /book|appointment|reserve|schedule/i.test(`${safeText} ${href}`)
        ? "booking_cta"
        : /quote|enquire|inquire|contact|call|whatsapp|message/i.test(`${safeText} ${href}`)
          ? "contact_cta"
          : "primary_cta",
      status: "present",
      category: "conversion",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.9,
      evidenceText: safeText,
      domSelector: "a,button,input[type='submit']",
      source: "dom",
      notes: [href].filter(Boolean)
    }));
  });
  return items.filter(Boolean);
}

function itemsFromForms(context) {
  const items = [];
  context.forms.slice(0, 8).forEach((form, index) => {
    const source = object(form);
    const fields = unique(array(source.fields || source.inputs).map(fieldName));
    const action = clean(source.action);
    const method = clean(source.method);
    const joined = `${fields.join(" ")} ${action}`.toLowerCase();
    const signal = /book|appointment|reservation|reserve|schedule/.test(joined) ? "booking_form" : "contact_form";
    items.push(evidenceItem({
      id: `form-${index + 1}`,
      signal,
      status: "present",
      category: "conversion",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.88,
      evidenceText: fields.length ? `${signal === "booking_form" ? "Booking" : "Contact"} form fields: ${fields.join(", ")}` : action || "Form element detected",
      domSelector: "form",
      source: "dom",
      notes: [action, method].filter(Boolean),
      fields
    }));
  });
  return items.filter(Boolean);
}

function socialPlatform(href) {
  if (/instagram\.com/i.test(href)) return "instagram";
  if (/facebook\.com|fb\.com/i.test(href)) return "facebook";
  if (/linkedin\.com/i.test(href)) return "linkedin";
  if (/tiktok\.com/i.test(href)) return "tiktok";
  if (/youtube\.com|youtu\.be/i.test(href)) return "youtube";
  if (/x\.com|twitter\.com/i.test(href)) return "x_twitter";
  return "social";
}

function socialCategoryForText(value) {
  const text = clean(value).toLowerCase();
  if (/whatsapp|wa\.me|mailto:|tel:/.test(text)) return "contact";
  if (/book|appointment|reserve|reservation|schedule|quote|enquiry|inquiry|contact/.test(text)) return "conversion";
  return "social_proof";
}

function itemsFromSocialAndContact(context) {
  const items = [];
  context.socialLinks.slice(0, 12).forEach((href, index) => {
    const platform = socialPlatform(href);
    items.push(evidenceItem({
      id: `social-link-${index + 1}`,
      signal: `${platform}_link`,
      status: "present",
      category: socialCategoryForText(href),
      page: context.page,
      url: context.pageUrl,
      confidence: 0.94,
      evidenceText: href,
      domSelector: "a[href]",
      source: "dom"
    }));
  });
  context.emails.slice(0, 8).forEach((email, index) => {
    items.push(evidenceItem({
      id: `email-${index + 1}`,
      signal: "email_address",
      status: "present",
      category: "contact",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.96,
      evidenceText: email,
      domSelector: "body",
      source: "dom"
    }));
  });
  context.phones.slice(0, 8).forEach((phone, index) => {
    items.push(evidenceItem({
      id: `phone-${index + 1}`,
      signal: "phone_number",
      status: "present",
      category: "contact",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.9,
      evidenceText: phone,
      domSelector: "body",
      source: "dom"
    }));
  });
  return items.filter(Boolean);
}

function itemsFromLinks(context) {
  const items = [];
  context.links.slice(0, 80).forEach((link, index) => {
    const { href, text } = linkParts(link);
    const combined = `${text} ${href}`;
    const safeText = usefulText(text, { allowCta: true });
    if (!href && !safeText) return;
    const add = (signal, category, evidenceText, confidence = 0.82) => {
      items.push(evidenceItem({
        id: `link-${signal}-${index + 1}`,
        signal,
        status: "present",
        category,
        page: context.page,
        url: context.pageUrl,
        confidence,
        evidenceText: evidenceText || safeText || href,
        domSelector: "a[href]",
        source: "dom",
        notes: [href].filter(Boolean)
      }));
    };
    if (/contact|enquiry|inquiry|get-in-touch|appointment|booking|reserve|reservation|quote|whatsapp/i.test(combined)) {
      add(/book|appointment|reserve|reservation/i.test(combined) ? "booking_or_reservation_path" : "contact_path", "conversion", safeText || href, 0.86);
    } else if (/service|treatment|product|solution|menu/i.test(combined)) {
      add("service_navigation", "services", safeText || href, 0.8);
    } else if (/case-stud|portfolio|projects|gallery|our-work|before-after/i.test(combined)) {
      add("case_study_or_portfolio_path", "content", safeText || href, 0.84);
    } else if (/review|testimonial/i.test(combined)) {
      add("reviews_or_testimonials_path", "social_proof", safeText || href, 0.84);
    } else if (/about|team|staff|doctor|lawyer|profile/i.test(combined)) {
      add("about_or_team_path", "trust", safeText || href, 0.8);
    } else if (isFaqLink(combined)) {
      add("faq_path", "content", safeText || href, 0.86);
    } else if (/pricing|price|package|plan|fees|rates/i.test(combined)) {
      add("pricing_path", "content", safeText || href, 0.82);
    } else if (/location|locations|areas|service-area/i.test(combined)) {
      add("location_or_service_area_path", "local", safeText || href, 0.82);
    }
  });
  return items.filter(Boolean);
}

function itemsFromStructuredData(context) {
  const items = [];
  array(context.structuredData).slice(0, 12).forEach((entry, index) => {
    const data = object(entry);
    const type = clean([data["@type"], data.type, ...array(data["@graph"]).map((item) => object(item)["@type"] || object(item).type)].filter(Boolean).join(", "));
    const name = clean(data.name || data.legalName);
    const address = typeof data.address === "string" ? data.address : clean([data.address?.streetAddress, data.address?.addressLocality, data.address?.addressRegion, data.address?.addressCountry].filter(Boolean).join(", "));
    const telephone = clean(data.telephone);
    const sameAs = array(data.sameAs);
    items.push(evidenceItem({
      id: `structured-data-${index + 1}`,
      signal: "structured_data",
      status: "present",
      category: "seo",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.92,
      evidenceText: JSON.stringify(entry).slice(0, 1000),
      domSelector: "script[type='application/ld+json']",
      source: "dom"
    }));
    if (type) {
      items.push(evidenceItem({
        id: isFaqSchemaType(type) ? `schema-faq-${index + 1}` : `schema-type-${index + 1}`,
        signal: isFaqSchemaType(type) ? "faq_schema" : "business_schema_type",
        status: "present",
        category: isFaqSchemaType(type) ? "content" : "business",
        page: context.page,
        url: context.pageUrl,
        confidence: 0.9,
        evidenceText: type,
        domSelector: "script[type='application/ld+json']",
        source: "dom"
      }));
    }
    if (name) {
      items.push(evidenceItem({
        id: `schema-name-${index + 1}`,
        signal: "business_name",
        status: "present",
        category: "business",
        page: context.page,
        url: context.pageUrl,
        confidence: 0.88,
        evidenceText: name,
        domSelector: "script[type='application/ld+json']",
        source: "dom"
      }));
    }
    if (address) {
      items.push(evidenceItem({
        id: `schema-address-${index + 1}`,
        signal: "business_location",
        status: "present",
        category: "local",
        page: context.page,
        url: context.pageUrl,
        confidence: 0.9,
        evidenceText: address,
        domSelector: "script[type='application/ld+json']",
        source: "dom"
      }));
    }
    if (telephone) {
      items.push(evidenceItem({
        id: `schema-phone-${index + 1}`,
        signal: "phone_number",
        status: "present",
        category: "contact",
        page: context.page,
        url: context.pageUrl,
        confidence: 0.92,
        evidenceText: telephone,
        domSelector: "script[type='application/ld+json']",
        source: "dom"
      }));
    }
    sameAs.slice(0, 6).forEach((href, sameAsIndex) => {
      items.push(evidenceItem({
        id: `schema-same-as-${index + 1}-${sameAsIndex + 1}`,
        signal: `${socialPlatform(href)}_link`,
        status: "present",
        category: socialCategoryForText(href),
        page: context.page,
        url: context.pageUrl,
        confidence: 0.9,
        evidenceText: href,
        domSelector: "script[type='application/ld+json']",
        source: "dom"
      }));
    });
  });
  return items.filter(Boolean);
}

function itemsFromOcr(context) {
  if (!context.ocrText) return [];
  return [evidenceItem({
      id: "ocr-visible-text",
      signal: "ocr_text",
      status: "present",
      category: "ux",
    page: context.page,
    url: context.pageUrl,
    confidence: 0.78,
    evidenceText: "",
    ocrEvidence: context.ocrText.slice(0, 1200),
    screenshotReference: context.screenshotReference || context.screenshotMetadata?.path || "",
    source: "ocr"
  })].filter(Boolean);
}

function itemsFromTechStack(context) {
  if (!context.techStack || typeof context.techStack !== "object") return [];
  return Object.entries(context.techStack)
    .filter(([, value]) => Boolean(value))
    .slice(0, 16)
    .map(([key, value]) => evidenceItem({
      id: `tech-${key}`,
      signal: `tech_${key}`,
      status: "present",
      category: "technical",
      page: context.page,
      url: context.pageUrl,
      confidence: 0.82,
      evidenceText: `${key}: ${value}`,
      domSelector: "script[src],link[href],html",
      source: "dom"
    }))
    .filter(Boolean);
}

function evidenceSnippets(text, regex, signal, category, confidence) {
  const source = clean(text);
  if (!source) return [];
  const sentences = source
    .split(/(?<=[.!?])\s+|\n+/)
    .map(usefulText)
    .filter(Boolean)
    .filter((sentence) => regex.test(sentence))
    .slice(0, 8);
  return sentences.map((sentence, index) =>
    evidenceItem({
      id: `${signal}-${index + 1}-${compactIdPart(sentence)}`,
      signal,
      status: "present",
      category,
      page: "homepage",
      url: "",
      confidence,
      evidenceText: sentence,
      domSelector: "body",
      source: "dom"
    })
  ).filter(Boolean);
}

function isQuestionText(value) {
  const text = clean(value);
  return /\?$/.test(text) || /^(what|why|how|when|where|who|which|can|do|does|is|are|will|should)\b/i.test(text);
}

function isFaqHeading(value, questionHeadingCount = 0) {
  const text = clean(value);
  if (!text || testimonialWords.test(text)) return false;
  if (faqSectionWords.test(text)) return true;
  return questionHeadingCount >= 2 && isQuestionText(text);
}

function isFaqLink(value) {
  const text = clean(value);
  if (!text || testimonialWords.test(text)) return false;
  return /\bfaqs?\b|frequently-asked|frequently asked/i.test(text);
}

function isFaqSchemaType(type) {
  return String(type || "")
    .split(",")
    .map((part) => clean(part).toLowerCase())
    .some((part) => part === "faqpage" || part === "faq");
}

function itemsFromFaqText(context) {
  const text = clean(context.visibleText);
  if (!text) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(usefulText)
    .filter(Boolean);
  const questionSentences = sentences.filter((sentence) => isQuestionText(sentence) && !testimonialWords.test(sentence));
  const hasFaqSection = faqSectionWords.test(text);
  if (!hasFaqSection && questionSentences.length < 2) return [];
  return questionSentences.slice(0, 6).map((sentence, index) =>
    evidenceItem({
      id: `faq-question-${index + 1}-${compactIdPart(sentence)}`,
      signal: "faq_question",
      status: "present",
      category: "content",
      page: context.page,
      url: context.pageUrl,
      confidence: hasFaqSection ? 0.84 : 0.76,
      evidenceText: sentence,
      domSelector: "body",
      source: "dom"
    })
  ).filter(Boolean);
}

function itemsFromVisibleText(context) {
  const text = context.visibleText;
  const items = [
    ...evidenceSnippets(text, trustWords, "trust_or_credential_claim", "credentials", 0.74),
    ...evidenceSnippets(text, testimonialWords, "reviews_or_testimonials_content", "social_proof", 0.78),
    ...evidenceSnippets(text, caseStudyWords, "case_study_or_portfolio_content", "content", 0.78),
    ...itemsFromFaqText(context),
    ...evidenceSnippets(text, pricingWords, "pricing_content", "content", 0.72),
    ...evidenceSnippets(text, staffWords, "staff_or_profile_content", "trust", 0.72),
    ...evidenceSnippets(text, locationWords, "location_or_service_area", "local", 0.7)
  ];

  const yearsMatches = [...clean(text).matchAll(/\b(?:since|established|founded)\s+(19\d{2}|20\d{2})\b/gi)]
    .slice(0, 4)
    .map((match, index) =>
      evidenceItem({
        id: `years-in-business-${index + 1}`,
        signal: "years_in_business_or_founded_date",
        status: "present",
        category: "trust",
        page: context.page,
        url: context.pageUrl,
        confidence: 0.82,
        evidenceText: match[0],
        domSelector: "body",
        source: "dom"
      })
    )
    .filter(Boolean);

  return [...items.map((item) => ({ ...item, page: context.page, url: context.pageUrl })), ...yearsMatches];
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.signal}:${item.status}:${item.evidenceText}:${item.ocrEvidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildEvidenceSummary(structuredEvidence) {
  const presentByCategory = (category) =>
    structuredEvidence.filter((item) => item.status === "present" && item.category === category).length;
  return {
    trustSignalsFound: structuredEvidence.filter((item) => item.status === "present" && ["trust", "credentials", "social_proof"].includes(item.category)).length,
    conversionSignalsFound: presentByCategory("conversion"),
    contentSignalsFound: structuredEvidence.filter((item) => item.status === "present" && ["content", "services", "navigation"].includes(item.category)).length,
    technicalSignalsFound: presentByCategory("technical"),
    businessSignalsFound: structuredEvidence.filter((item) => item.status === "present" && ["business", "local", "contact"].includes(item.category)).length,
    missingOrUnclearSignals: structuredEvidence
      .filter((item) => item.status === "absent" || item.status === "unclear")
      .map((item) => ({
        signal: item.signal,
        status: item.status,
        category: item.category,
        confidence: item.confidence,
        evidenceText: item.evidenceText || item.ocrEvidence
      }))
      .slice(0, 30)
  };
}

export function buildStructuredEvidence(input = {}) {
  const context = normalizeInput(input);
  const signalItems = Object.entries(context.scanEvidence?.signals || {})
    .map(([key, signal]) => itemFromSignal(key, signal, context))
    .filter(Boolean);
  const structuredEvidence = dedupe([
    ...signalItems,
    ...itemsFromMeta(context),
    ...itemsFromHeadings(context),
    ...itemsFromCtas(context),
    ...itemsFromForms(context),
    ...itemsFromSocialAndContact(context),
    ...itemsFromLinks(context),
    ...itemsFromStructuredData(context),
    ...itemsFromVisibleText(context),
    ...itemsFromOcr(context),
    ...itemsFromTechStack(context)
  ]);
  return { structuredEvidence, evidenceSummary: buildEvidenceSummary(structuredEvidence) };
}

function scanResultToInput(scanResult) {
  return {
    pageUrl: scanResult.website,
    page: "homepage",
    rawExtractedData: scanResult.rawExtractedData || {},
    headings: scanResult.extractedHeadings || [],
    ctas: scanResult.extractedCTAs || [],
    forms: scanResult.extractedForms || [],
    socialLinks: scanResult.extractedSocialLinks || [],
    emails: scanResult.extractedEmails || [],
    phones: scanResult.extractedPhones || [],
    scanEvidence: scanResult.scanEvidence,
    screenshotPath: scanResult.screenshotPath
  };
}

export async function buildStructuredEvidenceForScanResult(scanResultId) {
  const scanResult = await prisma.scanResult.findUnique({ where: { id: scanResultId } });
  if (!scanResult) throw notFound("Scan result not found");
  return buildStructuredEvidence(scanResultToInput(scanResult));
}

export async function buildStructuredEvidenceForLead(leadId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, website: true, scanEvidence: true, screenshotPath: true } });
  if (!lead) throw notFound("Lead not found");
  const scanResult = await prisma.scanResult.findFirst({ where: { website: lead.website }, orderBy: { createdAt: "desc" } });
  if (scanResult) return buildStructuredEvidence(scanResultToInput(scanResult));
  if (!lead.scanEvidence) throw new HttpError(404, "No scan evidence found for this lead");
  return buildStructuredEvidence({
    pageUrl: lead.website,
    page: "homepage",
    scanEvidence: lead.scanEvidence,
    screenshotPath: lead.screenshotPath
  });
}
