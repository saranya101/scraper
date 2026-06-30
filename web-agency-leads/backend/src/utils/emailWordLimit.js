export const EMAIL_WORD_MIN = 100;
export const EMAIL_WORD_MAX = 150;

export function countEmailWords(body = "") {
  return String(body || "").trim().split(/\s+/).filter(Boolean).length;
}

export function emailWordLimitDiagnostics(body = "") {
  const wordCount = countEmailWords(body);
  return {
    wordCount,
    minimum: EMAIL_WORD_MIN,
    maximum: EMAIL_WORD_MAX,
    withinWordLimit: wordCount >= EMAIL_WORD_MIN && wordCount <= EMAIL_WORD_MAX
  };
}

export function logEmailWordLimitQa(source, body = "") {
  const diagnostics = emailWordLimitDiagnostics(body);
  console.info("[email-word-limit-qa]", JSON.stringify({
    source,
    calculatedWordCount: diagnostics.wordCount,
    minimum: diagnostics.minimum,
    maximum: diagnostics.maximum,
    withinWordLimit: diagnostics.withinWordLimit
  }));
  return diagnostics;
}
