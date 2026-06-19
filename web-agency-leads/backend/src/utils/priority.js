export function priorityFromScore(score) {
  const value = Number(score);
  if (value >= 1 && value <= 4) return "HOT";
  if (value >= 5 && value <= 6) return "WARM";
  return "COLD";
}

export function priorityFromAudit(score, opportunityScore) {
  const auditScore = Number(score || 7);
  const opportunity = Number(opportunityScore || 0);
  if ((auditScore >= 1 && auditScore <= 4) || opportunity >= 8) return "HOT";
  if (auditScore >= 5 && auditScore <= 6) return "WARM";
  return "COLD";
}

export function normalizeWebsite(website) {
  if (!website) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    const url = new URL(withProtocol.trim());
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return website.trim().replace(/\/$/, "").toLowerCase();
  }
}
