import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { understandLeadBusiness } from "./businessUnderstandingService.js";
import { filterConversationQuality } from "./conversationQualityService.js";
import { writeEmail } from "./emailWriterService.js";
import { evaluateEmailQuality } from "./emailQualityGateService.js";
import { buildGapAnalysis } from "./gapAnalysisService.js";
import { scoreObservations } from "./observationScoringService.js";
import { filterOwnerInterest } from "./ownerInterestService.js";
import { buildStructuredEvidenceForLead } from "./structuredEvidenceService.js";
import { buildWebsiteBlueprint } from "./websiteBlueprintService.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function pickObservations(input = {}) {
  return array(input.observations || input.gapAnalysis || input.phase4Observations);
}

function senderFromUser(user) {
  if (!user) return {};
  return {
    name: user.senderName || user.name || "",
    title: user.senderTitle || "",
    company: user.companyName || ""
  };
}

async function getLead(leadId) {
  if (!leadId) return null;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { industryRef: true }
  });
  if (!lead) throw notFound("Lead not found");
  return lead;
}

async function defaultSender(input, userId) {
  if (input.sender && typeof input.sender === "object") return input.sender;
  if (!userId) return {};
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, senderName: true, senderTitle: true, companyName: true }
  });
  return senderFromUser(user);
}

function contextFrom(input, lead, phase1) {
  const identity = phase1?.businessIdentity || {};
  return {
    company: {
      name: input.company?.name || lead?.company || identity.businessName || "",
      website: input.company?.website || lead?.website || input.website || ""
    },
    industry: input.industry || identity.industry || lead?.industryRef?.name || lead?.industry || "",
    businessType: input.businessType || identity.businessType || ""
  };
}

async function phase1For(input, lead) {
  if (input.businessUnderstanding || input.phase1) return input.businessUnderstanding || input.phase1;
  if (lead?.scanEvidence?.businessUnderstanding) return lead.scanEvidence.businessUnderstanding;
  if (lead) return understandLeadBusiness(lead.id, { persist: true });
  throw new HttpError(422, "Phase 1 business understanding or leadId is required");
}

async function phase4For(input, lead, phase1) {
  const supplied = pickObservations(input);
  if (supplied.length) return supplied;
  if (!lead) throw new HttpError(422, "Phase 4 observations are required when leadId is not provided");

  const blueprint = input.websiteBlueprint || input.blueprint || await buildWebsiteBlueprint({ businessUnderstanding: phase1 });
  const structuredEvidence = input.structuredEvidence || input.evidence || await buildStructuredEvidenceForLead(lead.id);
  return buildGapAnalysis({ websiteBlueprint: blueprint.websiteBlueprint || blueprint, structuredEvidence });
}

function survivingObservationIds(conversationQuality, ownerInterest) {
  const phase6 = new Set(array(conversationQuality.conversationQuality).filter((item) => item.keep).map((item) => item.id));
  const phase7 = new Set(array(ownerInterest.ownerInterest).filter((item) => item.wouldReply).map((item) => item.id));
  return new Set([...phase6].filter((id) => phase7.has(id)));
}

function observationConfidence(observation) {
  const confidence = Number(observation.confidence ?? observation.scores?.evidenceConfidence ?? 0);
  return Number.isFinite(confidence) ? confidence : 0;
}

function confidenceBand(confidence) {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

function candidateList(scoredObservations, conversationQuality, ownerInterest) {
  const survivingIds = survivingObservationIds(conversationQuality, ownerInterest);
  const qualityById = new Map(array(conversationQuality.conversationQuality).map((item) => [item.id, item]));
  const interestById = new Map(array(ownerInterest.ownerInterest).map((item) => [item.id, item]));
  return scoredObservations
    .filter((observation) => survivingIds.has(observation.id))
    .map((observation) => {
      const quality = qualityById.get(observation.id) || {};
      const interest = interestById.get(observation.id) || {};
      const confidence = observationConfidence(observation);
      return {
        observation,
        quality,
        interest,
        confidence,
        confidenceBand: confidenceBand(confidence)
      };
    })
    .sort((a, b) =>
      Number(b.observation.scores?.overallScore || 0) - Number(a.observation.scores?.overallScore || 0) ||
      Number(b.quality.conversationValue || 0) - Number(a.quality.conversationValue || 0) ||
      Number(b.interest.interestLevel || 0) - Number(a.interest.interestLevel || 0) ||
      b.confidence - a.confidence
    );
}

function selectionReason(selected, scoring, conversationQuality, ownerInterest) {
  if (!selected) return "";
  const quality = array(conversationQuality.conversationQuality).find((item) => item.id === selected.id);
  const interest = array(ownerInterest.ownerInterest).find((item) => item.id === selected.id);
  return [
    `Highest scoring surviving observation (${Number(selected.scores?.overallScore || 0).toFixed(1)}/10).`,
    quality?.reason,
    interest?.reason,
    scoring.rankingSummary?.highestScoringObservationIds?.includes(selected.id) ? "Included in Phase 5 top-ranked observations." : ""
  ].map(clean).filter(Boolean).join(" ");
}

function noSuitableAngle(reason, details = {}) {
  return {
    status: "no_suitable_angle",
    selectedObservationId: null,
    selectedObservation: null,
    selectionReason: reason,
    email: null,
    qualityGate: null,
    debug: details
  };
}

function pipelineLabel(status) {
  return {
    approved: "Approved",
    rejected: "Rejected",
    no_suitable_angle: "No Suitable Angle"
  }[status] || "Needs Review";
}

function pipelineStatus(result) {
  if (!result) return "NOT_ANALYSED";
  if (result.status === "approved") return "APPROVED";
  if (result.status === "rejected") return "REJECTED";
  if (result.status === "no_suitable_angle") return "NO_SUITABLE_ANGLE";
  return "NEEDS_REVIEW";
}

function leadScanEvidence(lead) {
  return lead?.scanEvidence && typeof lead.scanEvidence === "object" && !Array.isArray(lead.scanEvidence)
    ? lead.scanEvidence
    : {};
}

function pipelineStateFromResult(result, userId) {
  return {
    status: pipelineStatus(result),
    label: pipelineLabel(result?.status),
    result,
    selectedObservationId: result?.selectedObservationId || null,
    selectedObservation: result?.selectedObservation || null,
    email: result?.email || null,
    qualityGate: result?.qualityGate || null,
    confidence: result?.debug?.evaluatedCandidates?.find((item) => item.observationId === result?.selectedObservationId)?.confidence || null,
    qualityScore: result?.qualityGate?.qualityScore || null,
    observationCategory: result?.selectedObservation?.category || null,
    lastRunAt: new Date().toISOString(),
    updatedBy: userId || null
  };
}

async function persistPipelineResult(leadId, result, userId) {
  if (!leadId) return result;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, scanEvidence: true } });
  if (!lead) return result;
  const state = pipelineStateFromResult(result, userId);
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      scanEvidence: { ...leadScanEvidence(lead), outreachPipeline: state },
      outreachEmail: result.email?.body || undefined,
      emailStatus: result.status === "approved" ? "READY_TO_SEND" : undefined,
      pipelineStage: result.status === "approved" ? "DRAFTED" : undefined
    }
  });
  return { ...result, pipelineState: state };
}

function countFailureReasons(evaluatedCandidates = []) {
  const counts = evaluatedCandidates.reduce((acc, candidate) => {
    const checks = candidate.secondPhase9Result?.failedChecks ||
      candidate.qualityGate?.failedChecks ||
      candidate.firstPhase9Result?.failedChecks ||
      candidate.firstQualityGate?.failedChecks ||
      [];
    for (const check of checks) {
      acc[check] = (acc[check] || 0) + 1;
    }
    return acc;
  }, {});
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function improvedFailedChecks(firstResult, secondResult) {
  const first = new Set(array(firstResult?.failedChecks));
  const second = new Set(array(secondResult?.failedChecks));
  return [...first].filter((check) => !second.has(check));
}

function worsenedFailedChecks(firstResult, secondResult) {
  const first = new Set(array(firstResult?.failedChecks));
  const second = new Set(array(secondResult?.failedChecks));
  return [...second].filter((check) => !first.has(check));
}

function diagnosticSummary(evaluatedCandidates = [], candidateCount = evaluatedCandidates.length) {
  return {
    candidateCount,
    approved: evaluatedCandidates.filter((item) => item.status === "approved").length,
    rejected: evaluatedCandidates.filter((item) => item.status === "rejected").length,
    skippedLowConfidence: evaluatedCandidates.filter((item) => item.status === "skipped_low_confidence").length,
    topFailureReasons: countFailureReasons(evaluatedCandidates)
  };
}

function candidateDiagnostics(result) {
  return {
    observationId: result.selectedObservationId,
    confidence: result.confidence,
    confidenceBand: result.confidenceBand,
    status: result.status,
    phase8Email: result.firstEmail || null,
    firstPhase9Result: result.firstQualityGate || null,
    rewritePhase8Email: result.rewriteEmail || null,
    secondPhase9Result: result.secondQualityGate || null,
    rewriteImprovedFailedChecks: improvedFailedChecks(result.firstQualityGate, result.secondQualityGate),
    rewriteWorsenedFailedChecks: worsenedFailedChecks(result.firstQualityGate, result.secondQualityGate),
    rewriteImproved: improvedFailedChecks(result.firstQualityGate, result.secondQualityGate).length > 0,
    qualityGate: result.qualityGate || null,
    firstQualityGate: result.firstQualityGate || null,
    reason: result.reason || result.qualityGate?.reason || result.secondQualityGate?.reason || ""
  };
}

async function writeAndGate({ selectedObservation, context, sender, contact, retry = null, caution = null }) {
  const email = await writeEmail({
    selectedObservation,
    company: context.company,
    industry: context.industry,
    businessType: context.businessType,
    sender,
    contact,
    ...(caution ? { confidenceMode: caution } : {}),
    ...(retry ? { failedChecks: retry.failedChecks, qualityFeedback: retry.feedback } : {})
  });
  const qualityGate = evaluateEmailQuality({
    email,
    selectedObservation,
    company: context.company,
    industry: context.industry,
    businessType: context.businessType
  });
  return { email, qualityGate };
}

async function evaluateCandidate({ candidate, context, sender, contact }) {
  const selectedObservation = candidate.observation;
  if (candidate.confidenceBand === "low") {
    return {
      status: "skipped_low_confidence",
      selectedObservationId: selectedObservation.id,
      selectedObservation,
      confidence: candidate.confidence,
      confidenceBand: candidate.confidenceBand,
      reason: "Skipped because observation confidence is below 0.60."
    };
  }

  const caution = candidate.confidenceBand === "medium" ? "medium_confidence" : null;
  const firstAttempt = await writeAndGate({ selectedObservation, context, sender, contact, caution });
  if (firstAttempt.qualityGate.approved) {
    return {
      status: "approved",
      selectedObservationId: selectedObservation.id,
      selectedObservation,
      confidence: candidate.confidence,
      confidenceBand: candidate.confidenceBand,
      firstEmail: firstAttempt.email,
      firstQualityGate: firstAttempt.qualityGate,
      email: firstAttempt.email,
      qualityGate: firstAttempt.qualityGate
    };
  }

  const secondAttempt = await writeAndGate({
    selectedObservation,
    context,
    sender,
    contact,
    caution,
    retry: firstAttempt.qualityGate
  });

  if (secondAttempt.qualityGate.approved) {
    return {
      status: "approved",
      selectedObservationId: selectedObservation.id,
      selectedObservation,
      confidence: candidate.confidence,
      confidenceBand: candidate.confidenceBand,
      firstEmail: firstAttempt.email,
      rewriteEmail: secondAttempt.email,
      secondQualityGate: secondAttempt.qualityGate,
      email: secondAttempt.email,
      qualityGate: secondAttempt.qualityGate,
      firstQualityGate: firstAttempt.qualityGate
    };
  }

  return {
    status: "rejected",
    selectedObservationId: selectedObservation.id,
    selectedObservation,
    confidence: candidate.confidence,
    confidenceBand: candidate.confidenceBand,
    firstEmail: firstAttempt.email,
    rewriteEmail: secondAttempt.email,
    secondQualityGate: secondAttempt.qualityGate,
    email: secondAttempt.email,
    qualityGate: secondAttempt.qualityGate,
    firstQualityGate: firstAttempt.qualityGate
  };
}

export async function runOutreachPipeline(input = {}, { userId } = {}) {
  const lead = await getLead(input.leadId);
  const sender = await defaultSender(input, userId);
  const contact = input.contact || {};
  const phase1 = await phase1For(input, lead);
  if (!phase1) return persistPipelineResult(input.leadId, noSuitableAngle("Phase 1 could not identify the business confidently enough for outreach."), userId);

  const phase4Observations = await phase4For(input, lead, phase1);
  if (!phase4Observations.length) return persistPipelineResult(input.leadId, noSuitableAngle("No Phase 4 observations were available for this lead."), userId);

  const scoring = scoreObservations({ businessUnderstanding: phase1, observations: phase4Observations });
  const conversationQuality = filterConversationQuality({ scoredObservations: scoring.scoredObservations });
  const ownerInterest = filterOwnerInterest({
    conversationQuality,
    scoredObservations: scoring.scoredObservations
  });
  const candidates = candidateList(scoring.scoredObservations, conversationQuality, ownerInterest);
  if (!candidates.length) {
    return persistPipelineResult(input.leadId, noSuitableAngle("No suitable outreach angle found after Phase 6 and Phase 7 filtering.", {
      summary: diagnosticSummary([], 0),
      phase6Kept: array(conversationQuality.conversationQuality).filter((item) => item.keep).length,
      phase7WouldReply: array(ownerInterest.ownerInterest).filter((item) => item.wouldReply).length,
      totalScored: scoring.scoredObservations.length
    }), userId);
  }

  const context = contextFrom(input, lead, phase1);
  const evaluatedCandidates = [];

  for (const candidate of candidates) {
    const result = await evaluateCandidate({ candidate, context, sender, contact });
    evaluatedCandidates.push(candidateDiagnostics(result));
    if (result.status === "approved") {
      return persistPipelineResult(input.leadId, {
        status: "approved",
        selectedObservationId: result.selectedObservationId,
        selectedObservation: result.selectedObservation,
        selectionReason: selectionReason(result.selectedObservation, scoring, conversationQuality, ownerInterest),
        email: result.email,
        qualityGate: result.qualityGate,
        firstQualityGate: result.firstQualityGate,
        debug: {
          evaluatedCandidates,
          summary: diagnosticSummary(evaluatedCandidates, candidates.length)
        }
      }, userId);
    }
  }

  return persistPipelineResult(input.leadId, noSuitableAngle("No suitable outreach angle found after every surviving observation was evaluated.", {
    evaluatedCandidates,
    summary: diagnosticSummary(evaluatedCandidates, candidates.length),
    candidateCount: candidates.length,
    skippedLowConfidence: evaluatedCandidates.filter((item) => item.status === "skipped_low_confidence").length,
    rejectedByQualityGate: evaluatedCandidates.filter((item) => item.status === "rejected").length
  }), userId);
}

export async function resetPipeline(leadIds = [], { all = false } = {}) {
  const where = all ? {} : { id: { in: leadIds.filter(Boolean) } };
  if (!all && !where.id.in.length) throw new HttpError(422, "Select at least one lead to reset");
  const leads = await prisma.lead.findMany({ where, select: { id: true, scanEvidence: true } });
  for (const lead of leads) {
    const scanEvidence = { ...leadScanEvidence(lead) };
    delete scanEvidence.outreachPipeline;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        scanEvidence,
        outreachEmail: null,
        emailStatus: null,
        pipelineStage: "NOT_CONTACTED"
      }
    });
  }
  return { reset: leads.length };
}

export async function decidePipeline(leadId, decision) {
  if (!leadId) throw new HttpError(422, "Lead is required");
  if (!["APPROVED", "REJECTED"].includes(decision)) throw new HttpError(422, "Decision must be APPROVED or REJECTED");
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, scanEvidence: true } });
  if (!lead) throw notFound("Lead not found");
  const scanEvidence = leadScanEvidence(lead);
  const current = scanEvidence.outreachPipeline || {};
  const next = {
    ...current,
    status: decision,
    label: decision === "APPROVED" ? "Approved" : "Rejected",
    manuallyReviewedAt: new Date().toISOString()
  };
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      scanEvidence: { ...scanEvidence, outreachPipeline: next },
      emailStatus: decision === "APPROVED" ? "READY_TO_SEND" : "REJECTED",
      pipelineStage: decision === "APPROVED" ? "DRAFTED" : undefined
    }
  });
  return updated.scanEvidence.outreachPipeline;
}

export async function savePipelineDraft(leadId, draft = {}) {
  if (!leadId) throw new HttpError(422, "Lead is required");
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, scanEvidence: true } });
  if (!lead) throw notFound("Lead not found");
  const scanEvidence = leadScanEvidence(lead);
  const current = scanEvidence.outreachPipeline || { status: "NEEDS_REVIEW", label: "Needs Review" };
  const cleanDraft = {
    fromName: clean(draft.fromName),
    fromEmail: clean(draft.fromEmail),
    toEmail: clean(draft.toEmail),
    subject: clean(draft.subject),
    body: String(draft.body || "").trim(),
    fullEmail: String(draft.fullEmail || "").trim(),
    updatedAt: new Date().toISOString()
  };
  const next = {
    ...current,
    status: current.status || "NEEDS_REVIEW",
    label: current.label || "Needs Review",
    editedDraft: cleanDraft,
    email: {
      ...(current.email || {}),
      subject: cleanDraft.subject,
      body: cleanDraft.fullEmail || cleanDraft.body,
      wordCount: cleanDraft.fullEmail ? cleanDraft.fullEmail.split(/\s+/).filter(Boolean).length : cleanDraft.body.split(/\s+/).filter(Boolean).length
    }
  };
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      scanEvidence: { ...scanEvidence, outreachPipeline: next },
      outreachEmail: cleanDraft.fullEmail || cleanDraft.body || null
    }
  });
  return updated.scanEvidence.outreachPipeline;
}
