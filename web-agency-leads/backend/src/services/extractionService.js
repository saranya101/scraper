const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/g;

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function detectTech({ html = "", scripts = [], links = [] }) {
  const haystack = `${html} ${scripts.join(" ")} ${links.join(" ")}`.toLowerCase();
  const has = (pattern) => pattern.test(haystack);
  let cms = null;
  if (has(/wp-content|wp-includes|wordpress/)) cms = "wordpress";
  else if (has(/cdn\.shopify|myshopify|shopify/)) cms = "shopify";
  else if (has(/wixstatic|wix\.com|x-wix-/)) cms = "wix";
  else if (has(/webflow|assets\.website-files\.com/)) cms = "webflow";

  return {
    cms,
    analyticsGa4: has(/gtag\(|google-analytics\.com\/g\/collect|googletagmanager\.com\/gtag\/js|g-[a-z0-9]{6,}/i),
    analyticsGtm: has(/googletagmanager\.com\/gtm\.js|gtm-[a-z0-9]+/i),
    analyticsMetaPixel: has(/connect\.facebook\.net\/.*fbevents|fbq\(|meta pixel/i),
    bookingCalendly: has(/calendly\.com|assets\.calendly\.com/),
    bookingSimplyBook: has(/simplybook|simplybook\.me/),
    bookingAcuity: has(/acuityscheduling|squarespacescheduling|acuity/),
    marketingMailchimp: has(/mailchimp|list-manage\.com/),
    marketingHubspot: has(/hubspot|hs-scripts|hsforms|js\.hsforms\.net/),
    marketingKlaviyo: has(/klaviyo/),
    chatIntercom: has(/intercom|widget\.intercom\.io/),
    chatTawk: has(/tawk\.to|tawk_api/),
    chatZendesk: has(/zendesk|zopim|zdassets/)
  };
}

export function contactFromExtracted(data, source) {
  const socialLinks = data.socialLinks || [];
  const ownerEmail = (data.emails || []).find((email) => /owner|founder|director|ceo|principal/i.test(email)) || null;
  const generalEmail = (data.emails || []).find((email) => /info|hello|contact|admin|support|enquir|sales/i.test(email)) || data.emails?.[0] || null;
  const whatsapp = socialLinks.find((href) => /wa\.me|whatsapp/i.test(href)) || null;
  const linkedinCompany = socialLinks.find((href) => /linkedin\.com\/company/i.test(href)) || socialLinks.find((href) => /linkedin/i.test(href)) || null;
  const instagram = socialLinks.find((href) => /instagram/i.test(href)) || null;
  const facebook = socialLinks.find((href) => /facebook/i.test(href)) || null;
  const signalCount = [generalEmail, ownerEmail, whatsapp, linkedinCompany, instagram, facebook, ...(data.phones || [])].filter(Boolean).length;
  return {
    generalEmail,
    ownerEmail,
    linkedinCompany,
    instagram,
    facebook,
    whatsapp,
    contactConfidence: Math.min(100, Math.max(0, 25 + signalCount * 12)),
    contactSource: signalCount ? source : null
  };
}

export function mergeExtractedData(primary = {}, secondary = null) {
  if (!secondary) return primary;
  const merged = {
    ...primary,
    visibleText: unique([primary.visibleText, secondary.visibleText]).join("\n\n").slice(0, 9000),
    headings: unique([...(primary.headings || []), ...(secondary.headings || [])]).slice(0, 40),
    ctas: [...(primary.ctas || []), ...(secondary.ctas || [])].slice(0, 40),
    forms: [...(primary.forms || []), ...(secondary.forms || [])].slice(0, 12),
    socialLinks: unique([...(primary.socialLinks || []), ...(secondary.socialLinks || [])]).slice(0, 30),
    emails: unique([...(primary.emails || []), ...(secondary.emails || [])]).slice(0, 25),
    phones: unique([...(primary.phones || []), ...(secondary.phones || [])]).slice(0, 25),
    contactPageUrl: primary.contactPageUrl || secondary.contactPageUrl
  };
  return {
    ...merged,
    techStack: primary.techStack || secondary.techStack,
    contactInfo: {
      ...contactFromExtracted(merged, secondary.contactPageUrl || primary.contactPageUrl || "homepage/contact page"),
      ...(primary.contactInfo || {}),
      ...(secondary.contactInfo || {})
    }
  };
}

export async function extractPageData(page, baseUrl, scanDepth = "QUICK") {
  return page.evaluate(
    ({ baseUrl: pageBaseUrl, scanDepth: depth }) => {
      const text = document.body?.innerText || "";
      const title = document.title || "";
      const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, depth === "DEEP" ? 40 : 18);
      const ctas = Array.from(document.querySelectorAll("a,button,input[type='submit']"))
        .map((el) => ({
          text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim(),
          href: el.href || null
        }))
        .filter((item) => item.text)
        .filter((item) => /book|call|contact|get|quote|start|schedule|reserve|buy|shop|enquire|inquire|appointment/i.test(item.text))
        .slice(0, depth === "DEEP" ? 40 : 16);
      const forms = Array.from(document.querySelectorAll("form"))
        .map((form) => ({
          action: form.action || null,
          method: form.method || "get",
          fields: Array.from(form.querySelectorAll("input,textarea,select")).map((field) => field.name || field.type || field.placeholder).filter(Boolean)
        }))
        .slice(0, depth === "DEEP" ? 12 : 5);
      const socialLinks = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .filter((href) => /instagram|facebook|linkedin|tiktok|youtube|x\.com|twitter|wa\.me|whatsapp/i.test(href))
        .slice(0, 30);
      const contactPageUrl = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ href: a.href, text: a.textContent || "" }))
        .find((link) => /contact|enquiry|inquiry|appointment|booking/i.test(`${link.text} ${link.href}`))?.href || null;
      const canonical = document.querySelector("link[rel='canonical']")?.href || pageBaseUrl;
      const html = document.documentElement?.outerHTML || "";
      const scripts = Array.from(document.querySelectorAll("script[src]")).map((script) => script.src).slice(0, 80);
      const links = Array.from(document.querySelectorAll("link[href],a[href]")).map((link) => link.href).slice(0, 140);
      return {
        title,
        visibleText: text,
        headings,
        ctas,
        forms,
        socialLinks,
        contactPageUrl,
        canonical,
        metaDescription: document.querySelector("meta[name='description']")?.content || "",
        html,
        scripts,
        links
      };
    },
    { baseUrl, scanDepth }
  ).then((data) => {
    const emails = Array.from(new Set((data.visibleText.match(emailPattern) || []).slice(0, 20)));
    const phones = Array.from(new Set((data.visibleText.match(phonePattern) || []).map((phone) => phone.trim()).slice(0, 20)));
    const { html: _html, ...safeData } = data;
    const trimmed = {
      ...safeData,
      visibleText: data.visibleText.slice(0, scanDepth === "DEEP" ? 9000 : scanDepth === "FULL" ? 5500 : 3500),
      emails,
      phones
    };
    return {
      ...trimmed,
      techStack: detectTech(data),
      contactInfo: contactFromExtracted({ ...trimmed, emails, phones }, data.contactPageUrl ? "homepage/contact page" : "homepage")
    };
  });
}
