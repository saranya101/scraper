const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/g;

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
        .filter((href) => /instagram|facebook|linkedin|tiktok|youtube|x\.com|twitter/i.test(href))
        .slice(0, 20);
      const contactPageUrl = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({ href: a.href, text: a.textContent || "" }))
        .find((link) => /contact|enquiry|inquiry|appointment|booking/i.test(`${link.text} ${link.href}`))?.href || null;
      const canonical = document.querySelector("link[rel='canonical']")?.href || pageBaseUrl;
      return {
        title,
        visibleText: text,
        headings,
        ctas,
        forms,
        socialLinks,
        contactPageUrl,
        canonical,
        metaDescription: document.querySelector("meta[name='description']")?.content || ""
      };
    },
    { baseUrl, scanDepth }
  ).then((data) => {
    const emails = Array.from(new Set((data.visibleText.match(emailPattern) || []).slice(0, 20)));
    const phones = Array.from(new Set((data.visibleText.match(phonePattern) || []).map((phone) => phone.trim()).slice(0, 20)));
    return {
      ...data,
      visibleText: data.visibleText.slice(0, scanDepth === "DEEP" ? 9000 : scanDepth === "FULL" ? 5500 : 3500),
      emails,
      phones
    };
  });
}
