function normalize(value = "") {
  return String(value || "").trim().toLowerCase();
}

function includesAny(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

export function detectBounce({ fromEmail = "", subject = "", snippet = "" } = {}) {
  const from = normalize(fromEmail);
  const joined = `${subject}\n${snippet}`.toLowerCase();
  if (
    /mailer-daemon|mail delivery subsystem|postmaster/.test(from)
    || /delivery status notification|undelivered mail|delivery failed|mail delivery failed/i.test(joined)
    || /address not found|message not delivered|delivery has failed|recipient address rejected/i.test(joined)
  ) {
    return {
      bounced: true,
      reason: String(snippet || subject || "Delivery failed").trim().slice(0, 280)
    };
  }
  return { bounced: false, reason: "" };
}

export function classifyReply({ fromEmail = "", subject = "", snippet = "", isAutoReply = false } = {}) {
  const text = `${subject}\n${snippet}`.toLowerCase();
  if (isAutoReply) {
    return {
      classification: "AUTO_REPLY",
      confidence: 0.95,
      suggestedNextAction: "No manual action needed unless you want to retry after the recipient returns.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: false,
      needsAction: false,
      needsActionReason: null
    };
  }

  if (includesAny(text, [/remove me/, /unsubscribe/, /do not contact/, /don't contact/, /stop emailing/, /stop contacting/])) {
    return {
      classification: "NOT_INTERESTED",
      confidence: 0.98,
      suggestedNextAction: "Do not follow up again.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: true,
      needsAction: false,
      needsActionReason: null
    };
  }

  if (includesAny(text, [/wrong person/, /wrong contact/, /not the right person/, /i'm not the right person/, /no longer with/, /left the company/])) {
    return {
      classification: "WRONG_CONTACT",
      confidence: 0.92,
      suggestedNextAction: "Find the correct contact before sending anything else.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: false,
      needsAction: true,
      needsActionReason: "wrong_contact"
    };
  }

  if (includesAny(text, [/how much/, /price/, /pricing/, /cost/, /quote/, /rates?/])) {
    return {
      classification: "ASKED_FOR_PRICE",
      confidence: 0.92,
      suggestedNextAction: "Reply with context and offer a short call before quoting.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: false,
      needsAction: true,
      needsActionReason: "asked_for_price"
    };
  }

  if (includesAny(text, [/send more info/, /more information/, /tell me more/, /can you share/, /what do you mean/, /details\??/])) {
    return {
      classification: "ASKED_FOR_MORE_INFO",
      confidence: 0.88,
      suggestedNextAction: "Reply with a concise explanation and a few concrete next steps.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: false,
      needsAction: true,
      needsActionReason: "asked_for_more_info"
    };
  }

  if (includesAny(text, [/interested/, /sounds good/, /yes/, /sure/, /let'?s talk/, /happy to chat/, /open to/, /book a call/])) {
    return {
      classification: "INTERESTED",
      confidence: 0.9,
      suggestedNextAction: "Send a short reply and propose a call or next step.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: false,
      needsAction: true,
      needsActionReason: "interested_reply"
    };
  }

  if (includesAny(text, [/maybe later/, /not right now/, /circle back/, /follow up later/, /another time/, /next month/, /next quarter/])) {
    return {
      classification: "MAYBE_LATER",
      confidence: 0.85,
      suggestedNextAction: "Pause follow-up and set a reminder for later.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: false,
      needsAction: true,
      needsActionReason: "maybe_later"
    };
  }

  if (includesAny(text, [/not interested/, /no thanks/, /no thank you/, /we're fine/, /we are fine/, /don't need this/, /do not need this/])) {
    return {
      classification: "NOT_INTERESTED",
      confidence: 0.86,
      suggestedNextAction: "Do not continue the sequence.",
      shouldStopFollowUps: true,
      shouldMarkDoNotContact: false,
      needsAction: false,
      needsActionReason: null
    };
  }

  return {
    classification: "OTHER",
    confidence: 0.6,
    suggestedNextAction: "Review the reply manually and decide the next step.",
    shouldStopFollowUps: true,
    shouldMarkDoNotContact: false,
    needsAction: true,
    needsActionReason: "reply_received"
  };
}
