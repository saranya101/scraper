import { prisma } from "../repositories/prisma.js";
import { HttpError, notFound } from "../utils/httpError.js";
import { DEFAULT_REPORT_SERVICE_IDS, REPORT_SERVICE_MAP } from "../constants/reportServiceOptions.js";
import { understandLeadBusiness } from "./businessUnderstandingService.js";
import { filterConversationQuality } from "./conversationQualityService.js";
import { writeEmail } from "./emailWriterService.js";
import { evaluateEmailQuality } from "./emailQualityGateService.js";
import { buildGapAnalysis } from "./gapAnalysisService.js";
import { scoreObservations } from "./observationScoringService.js";
import { filterOwnerInterest } from "./ownerInterestService.js";
import { buildStructuredEvidenceForLead } from "./structuredEvidenceService.js";
import { buildWebsiteBlueprint } from "./websiteBlueprintService.js";
import { generateReport } from "./reportService.js";
import { generateForLead as generateServiceOpportunities } from "./serviceOpportunityService.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function normalizeSelectedServices(input = [], fallback = DEFAULT_REPORT_SERVICE_IDS) {
  const source = Array.isArray(input) ? input : [];
  const ids = [...new Set(source.map((item) => typeof item === "string" ? item : item?.id).filter((id) => REPORT_SERVICE_MAP.has(id)))];
  return (ids.length ? ids : fallback)
    .map((id) => REPORT_SERVICE_MAP.get(id))
    .filter(Boolean);
}

function reportServiceIdFromOpportunity(opportunity = {}) {
  const slug = String(opportunity.service?.slug || opportunity.slug || "").trim().toLowerCase();
  const name = String(opportunity.service?.name || opportunity.name || "").trim().toLowerCase();
  const direct = slug.replace(/-/g, "_");
  if (REPORT_SERVICE_MAP.has(direct)) return direct;

  const mappings = [
    [/landing-page/, "lead_generation"],
    [/local-seo/, "google_business_profile"],
    [/branding/, "branding_positioning"],
    [/booking-system/, "appointment_booking"],
    [/automation/, "whatsapp_automation"],
    [/analytics/, "conversion_rate_optimisation"],
    [/maintenance/, "website_redesign"],
    [/ecommerce/, "ecommerce_improvement"]
  ];
  for (const [pattern, id] of mappings) {
    if (pattern.test(slug) || pattern.test(name)) return id;
  }
  return null;
}

function autoSelectReportServices(analyzedServices = []) {
  const sorted = array(analyzedServices)
    .filter((item) => REPORT_SERVICE_MAP.has(item.serviceId))
    .sort((left, right) => Number(right.fitScore || 0) - Number(left.fitScore || 0));
  const primary = sorted.filter((item) => Number(item.fitScore || 0) >= 25).slice(0, 3);
  const fallback = sorted.slice(0, 2);
  const selected = (primary.length >= 2 ? primary : fallback).slice(0, 4);
  return [...new Set(selected.map((item) => item.serviceId).filter(Boolean))];
}

function leadServiceAnalysis(lead) {
  return object(leadScanEvidence(lead).serviceAnalysis);
}

function selectedServicesForLead(lead, override = []) {
  const analysis = leadServiceAnalysis(lead);
  const selected = array(override).length
    ? override
    : array(analysis.selectedReportServices).length
      ? analysis.selectedReportServices
      : array(leadScanEvidence(lead).outreachPipeline?.selectedReportServices);
  return normalizeSelectedServices(selected);
}

async function persistServiceAnalysis(leadId, updater) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, scanEvidence: true } });
  if (!lead) throw notFound("Lead not found");
  const currentEvidence = leadScanEvidence(lead);
  const currentAnalysis = object(currentEvidence.serviceAnalysis);
  const nextAnalysis = typeof updater === "function" ? updater(currentAnalysis) : updater;
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      scanEvidence: {
        ...currentEvidence,
        serviceAnalysis: nextAnalysis
      }
    }
  });
  return nextAnalysis;
}

function topServiceProblemsFromPayload(payload = {}) {
  return array(payload.serviceSections)
    .flatMap((section) => array(section.businessProblems).map((problem) => clean(problem.title || problem.whyItMatters)))
    .filter(Boolean)
    .slice(0, 4);
}

function topServiceRecommendationsFromPayload(payload = {}) {
  return array(payload.serviceSections)
    .flatMap((section) => array(section.priorityActions).map((action) => clean(action.action || action.reason)))
    .filter(Boolean)
    .slice(0, 4);
}

async function getLead(leadId) {
  if (!leadId) return null;
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      industryRef: true,
      auditReports: { orderBy: { createdAt: "desc" }, take: 1 }
    }
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
  const report = Array.isArray(lead?.auditReports) ? lead.auditReports[0] : null;
  const payload = report?.reportData && typeof report.reportData === "object" ? report.reportData : {};
  const selectedServices = normalizeSelectedServices(
    Array.isArray(input.selectedServices) && input.selectedServices.length
      ? input.selectedServices
      : selectedServicesForLead(lead).length
        ? selectedServicesForLead(lead).map((item) => item.id)
        : Array.isArray(report?.selectedServices) && report.selectedServices.length
          ? report.selectedServices
          : Array.isArray(payload.selectedServices) && payload.selectedServices.length
            ? payload.selectedServices
            : DEFAULT_REPORT_SERVICE_IDS
  );
  return {
    company: {
      name: input.company?.name || lead?.company || identity.businessName || "",
      website: input.company?.website || lead?.website || input.website || ""
    },
    industry: input.industry || identity.industry || lead?.industryRef?.name || lead?.industry || "",
    businessType: input.businessType || identity.businessType || "",
    reportContext: selectedServices.length
      ? {
          selectedServices,
          reportSummary: clean(report?.summary || payload.executiveSummary || ""),
          topServiceProblems: topServiceProblemsFromPayload(payload),
          topServiceRecommendations: topServiceRecommendationsFromPayload(payload),
          attachmentEnabled: input.attachmentEnabled !== false
        }
      : null
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

function fallbackCandidateList(scoredObservations, conversationQuality, ownerInterest) {
  const qualityById = new Map(array(conversationQuality.conversationQuality).map((item) => [item.id, item]));
  const interestById = new Map(array(ownerInterest.ownerInterest).map((item) => [item.id, item]));
  return array(scoredObservations)
    .map((observation) => {
      const confidence = observationConfidence(observation);
      return {
        observation,
        quality: qualityById.get(observation.id) || {},
        interest: interestById.get(observation.id) || {},
        confidence,
        confidenceBand: confidenceBand(Math.max(confidence, 0.6)),
        allowLowConfidence: true,
        source: "fallback"
      };
    })
    .sort((a, b) =>
      Number(b.observation.scores?.overallScore || 0) - Number(a.observation.scores?.overallScore || 0) ||
      Number(b.observation.scores?.conversationPotential || 0) - Number(a.observation.scores?.conversationPotential || 0) ||
      Number(b.observation.scores?.businessImpact || 0) - Number(a.observation.scores?.businessImpact || 0) ||
      b.confidence - a.confidence
    )
    .slice(0, 5);
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
    reportStatus: result?.report?.status || result?.reportStatus || null,
    emailSelectedServices: array(result?.emailSelectedServices || result?.email?.emailSelectedServices),
    analyzedServices: array(result?.analyzedServices),
    selectedReportServices: array(result?.selectedReportServices || result?.emailSelectedServices || result?.email?.emailSelectedServices),
    selectedServicesSource: result?.selectedServicesSource || null,
    serviceAnalysisStatus: result?.serviceAnalysisStatus || null,
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

function serviceSelectionReason(selectedServices = [], source = "auto") {
  const labels = normalizeSelectedServices(selectedServices, []).map((item) => item.label);
  const focus = labels.length ? labels.join(", ") : "selected services";
  return `Generated from analyzed services${source === "manual" ? " using the manually selected service focus" : ""}: ${focus}.`;
}

async function writeAndGate({ selectedObservation, context, sender, contact, retry = null, caution = null }) {
  const email = await writeEmail({
    selectedObservation,
    company: context.company,
    industry: context.industry,
    businessType: context.businessType,
    reportContext: context.reportContext,
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
    businessType: context.businessType,
    reportContext: context.reportContext
  });
  return { email, qualityGate };
}

async function evaluateServiceBasedDraft({ context, sender, contact }) {
  const firstAttempt = await writeAndGate({ selectedObservation: null, context, sender, contact });
  if (firstAttempt.qualityGate.approved) {
    return {
      status: "approved",
      selectedObservationId: null,
      selectedObservation: null,
      firstEmail: firstAttempt.email,
      firstQualityGate: firstAttempt.qualityGate,
      email: firstAttempt.email,
      qualityGate: firstAttempt.qualityGate
    };
  }

  const secondAttempt = await writeAndGate({
    selectedObservation: null,
    context,
    sender,
    contact,
    retry: firstAttempt.qualityGate
  });

  if (secondAttempt.qualityGate.approved) {
    return {
      status: "approved",
      selectedObservationId: null,
      selectedObservation: null,
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
    selectedObservationId: null,
    selectedObservation: null,
    firstEmail: firstAttempt.email,
    rewriteEmail: secondAttempt.email,
    secondQualityGate: secondAttempt.qualityGate,
    email: secondAttempt.email,
    qualityGate: secondAttempt.qualityGate,
    firstQualityGate: firstAttempt.qualityGate,
    reason: secondAttempt.qualityGate.reason || firstAttempt.qualityGate.reason || "Service-based email did not pass the quality gate."
  };
}

async function evaluateCandidate({ candidate, context, sender, contact }) {
  const selectedObservation = candidate.observation;
  if (candidate.confidenceBand === "low" && !candidate.allowLowConfidence) {
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

function rejectedPipelineResult(bestResult, scoring, conversationQuality, ownerInterest, evaluatedCandidates, candidates, details = {}) {
  return {
    status: "rejected",
    selectedObservationId: bestResult?.selectedObservationId || null,
    selectedObservation: bestResult?.selectedObservation || null,
    selectionReason: bestResult?.selectedObservation
      ? selectionReason(bestResult.selectedObservation, scoring, conversationQuality, ownerInterest)
      : "Automatic angle selection did not fully pass the quality gate, so the strongest draft was kept for review.",
    email: bestResult?.email || bestResult?.rewriteEmail || bestResult?.firstEmail || null,
    emailSelectedServices: bestResult?.email?.emailSelectedServices || bestResult?.rewriteEmail?.emailSelectedServices || bestResult?.firstEmail?.emailSelectedServices || [],
    qualityGate: bestResult?.qualityGate || bestResult?.secondQualityGate || bestResult?.firstQualityGate || null,
    firstQualityGate: bestResult?.firstQualityGate || null,
    reason: "No candidate passed the automatic quality gate, so the strongest draft was kept for review instead of dropping to manual-only mode.",
    debug: {
      evaluatedCandidates,
      summary: diagnosticSummary(evaluatedCandidates, candidates.length),
      ...details
    },
    analyzedServices: array(details.analyzedServices),
    selectedReportServices: array(details.selectedReportServices),
    selectedServicesSource: details.selectedServicesSource || "auto",
    serviceAnalysisStatus: details.serviceAnalysisStatus || "completed"
  };
}

async function attachReportIfEligible(result, input, userId) {
  if (!["approved", "rejected"].includes(result?.status) || !input?.leadId || input?.generateReport === false) return result;
  try {
    const report = await generateReport(input.leadId, userId, {
      selectedServices: array(result?.selectedReportServices).length ? result.selectedReportServices : input.selectedServices
    });
    return {
      ...result,
      report,
      reportStatus: report?.status || null
    };
  } catch (error) {
    return {
      ...result,
      report: null,
      reportStatus: "failed",
      reportError: error?.message || "Report generation failed"
    };
  }
}

export async function analyzeLeadServices(leadId, { force = false } = {}) {
  if (!leadId) throw new HttpError(422, "Lead is required");
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, scanEvidence: true } });
  if (!lead) throw notFound("Lead not found");
  const existing = leadServiceAnalysis(lead);
  if (!force && existing.status === "completed" && array(existing.analyzedServices).length) {
    return existing;
  }

  await persistServiceAnalysis(leadId, (current) => ({
    ...current,
    status: "analyzing",
    error: null
  }));

  try {
    const opportunities = await generateServiceOpportunities(leadId);
    const analyzedServices = opportunities
      .map((item) => {
        const serviceId = reportServiceIdFromOpportunity(item);
        if (!serviceId) return null;
        return {
          serviceId,
          serviceLabel: REPORT_SERVICE_MAP.get(serviceId)?.label || item.service?.name || serviceId,
          fitScore: Math.max(0, Math.min(100, Number(item.score || 0) * 10)),
          reason: item.reason || "",
          sourceService: item.service?.name || ""
        };
      })
      .filter(Boolean)
      .sort((left, right) => Number(right.fitScore || 0) - Number(left.fitScore || 0));
    const selectedReportServices = autoSelectReportServices(analyzedServices);
    if (!analyzedServices.length || !selectedReportServices.length) {
      throw new Error("Service analysis did not produce any compatible report services");
    }
    return await persistServiceAnalysis(leadId, (current) => ({
      ...current,
      status: "completed",
      error: null,
      analyzedAt: new Date().toISOString(),
      analyzedServices,
      selectedReportServices,
      selectedServicesSource: current.selectedServicesSource === "manual" && array(current.selectedReportServices).length
        ? "manual"
        : "auto"
    }));
  } catch (error) {
    return await persistServiceAnalysis(leadId, (current) => ({
      ...current,
      status: "failed",
      error: error?.message || "Service analysis failed",
      analyzedAt: new Date().toISOString()
    }));
  }
}

export async function updateLeadSelectedServices(leadId, selectedReportServices = [], { source = "manual" } = {}) {
  if (!leadId) throw new HttpError(422, "Lead is required");
  const normalized = normalizeSelectedServices(selectedReportServices, []).map((item) => item.id);
  if (!normalized.length) throw new HttpError(422, "Select at least one service");
  return persistServiceAnalysis(leadId, (current) => ({
    ...current,
    status: current.status || "completed",
    error: null,
    analyzedAt: current.analyzedAt || new Date().toISOString(),
    analyzedServices: array(current.analyzedServices),
    selectedReportServices: normalized,
    selectedServicesSource: source
  }));
}

export async function runOutreachPipeline(input = {}, { userId } = {}) {
  const lead = await getLead(input.leadId);
  const serviceAnalysis = input.analyzeServicesIfMissing === false
    ? leadServiceAnalysis(lead)
    : await analyzeLeadServices(input.leadId, { force: false });
  if (serviceAnalysis.status === "failed") {
    return persistPipelineResult(input.leadId, {
      status: "rejected",
      selectionReason: "Service analysis failed before the outreach pipeline could run.",
      reason: serviceAnalysis.error || "Service analysis failed",
      analyzedServices: array(serviceAnalysis.analyzedServices),
      selectedReportServices: array(serviceAnalysis.selectedReportServices),
      selectedServicesSource: serviceAnalysis.selectedServicesSource || "auto",
      serviceAnalysisStatus: serviceAnalysis.status
    }, userId);
  }
  const selectedServices = normalizeSelectedServices(
    array(input.selectedServices).length ? input.selectedServices : array(serviceAnalysis.selectedReportServices)
  );
  const selectedServiceIds = selectedServices.map((item) => item.id);
  const sender = await defaultSender(input, userId);
  const contact = input.contact || {};
  const phase1 = await phase1For(input, lead);
  if (!phase1) return persistPipelineResult(input.leadId, noSuitableAngle("Phase 1 could not identify the business confidently enough for outreach."), userId);

  const context = contextFrom({ ...input, selectedServices: selectedServiceIds }, lead, phase1);
  if (!selectedServiceIds.length) {
    return persistPipelineResult(input.leadId, noSuitableAngle("No analyzed services were available for this lead."), userId);
  }

  const serviceDraft = await evaluateServiceBasedDraft({ context, sender, contact });
  const serviceBasedResult = {
    status: serviceDraft.status,
    selectedObservationId: null,
    selectedObservation: null,
    selectionReason: serviceSelectionReason(selectedServiceIds, serviceAnalysis.selectedServicesSource || "auto"),
    email: serviceDraft.email,
    emailSelectedServices: selectedServiceIds,
    analyzedServices: array(serviceAnalysis.analyzedServices),
    selectedReportServices: selectedServiceIds,
    selectedServicesSource: serviceAnalysis.selectedServicesSource || "auto",
    serviceAnalysisStatus: serviceAnalysis.status || "completed",
    qualityGate: serviceDraft.qualityGate,
    firstQualityGate: serviceDraft.firstQualityGate || null,
    reason: serviceDraft.reason || serviceDraft.qualityGate?.reason || "",
    debug: {
      mode: "service_analysis",
      evaluatedCandidates: [candidateDiagnostics(serviceDraft)],
      summary: diagnosticSummary([candidateDiagnostics(serviceDraft)], 1)
    }
  };
  const withReport = await attachReportIfEligible(serviceBasedResult, { ...input, selectedServices: selectedServiceIds }, userId);
  return persistPipelineResult(input.leadId, withReport, userId);

  const phase4Observations = await phase4For(input, lead, phase1);
  if (!phase4Observations.length) return persistPipelineResult(input.leadId, noSuitableAngle("No Phase 4 observations were available for this lead."), userId);

  const scoring = scoreObservations({ businessUnderstanding: phase1, observations: phase4Observations });
  const conversationQuality = filterConversationQuality({ scoredObservations: scoring.scoredObservations });
  const ownerInterest = filterOwnerInterest({
    conversationQuality,
    scoredObservations: scoring.scoredObservations
  });
  let candidates = candidateList(scoring.scoredObservations, conversationQuality, ownerInterest);
  let usedFallbackCandidates = false;
  if (!candidates.length) {
    candidates = fallbackCandidateList(scoring.scoredObservations, conversationQuality, ownerInterest);
    usedFallbackCandidates = candidates.length > 0;
  }
  if (!candidates.length) {
    return persistPipelineResult(input.leadId, noSuitableAngle("No suitable outreach angle found after Phase 6 and Phase 7 filtering.", {
      summary: diagnosticSummary([], 0),
      phase6Kept: array(conversationQuality.conversationQuality).filter((item) => item.keep).length,
      phase7WouldReply: array(ownerInterest.ownerInterest).filter((item) => item.wouldReply).length,
      totalScored: scoring.scoredObservations.length
    }), userId);
  }

  const evaluatedCandidates = [];
  const evaluatedResults = [];

  for (const candidate of candidates) {
    const result = await evaluateCandidate({ candidate, context, sender, contact });
    evaluatedResults.push(result);
    evaluatedCandidates.push(candidateDiagnostics(result));
    if (result.status === "approved") {
      const approvedResult = await attachReportIfEligible({
        status: "approved",
        selectedObservationId: result.selectedObservationId,
        selectedObservation: result.selectedObservation,
        selectionReason: selectionReason(result.selectedObservation, scoring, conversationQuality, ownerInterest),
        email: result.email,
        emailSelectedServices: selectedServiceIds,
        analyzedServices: array(serviceAnalysis.analyzedServices),
        selectedReportServices: selectedServiceIds,
        selectedServicesSource: serviceAnalysis.selectedServicesSource || "auto",
        serviceAnalysisStatus: serviceAnalysis.status || "completed",
        qualityGate: result.qualityGate,
        firstQualityGate: result.firstQualityGate,
        debug: {
          evaluatedCandidates,
          summary: diagnosticSummary(evaluatedCandidates, candidates.length),
          usedFallbackCandidates
        }
      }, { ...input, selectedServices: selectedServiceIds }, userId);
      return persistPipelineResult(input.leadId, approvedResult, userId);
    }
  }

  const bestRejected = evaluatedResults.find((item) => item.status === "rejected")
    || evaluatedResults.find((item) => item.email || item.firstEmail || item.rewriteEmail)
    || null;

  if (bestRejected) {
    const rejectedResult = await attachReportIfEligible(rejectedPipelineResult(
      bestRejected,
      scoring,
      conversationQuality,
      ownerInterest,
      evaluatedCandidates,
      candidates,
      {
        candidateCount: candidates.length,
        skippedLowConfidence: evaluatedCandidates.filter((item) => item.status === "skipped_low_confidence").length,
        rejectedByQualityGate: evaluatedCandidates.filter((item) => item.status === "rejected").length,
        usedFallbackCandidates,
        analyzedServices: array(serviceAnalysis.analyzedServices),
        selectedReportServices: selectedServiceIds,
        selectedServicesSource: serviceAnalysis.selectedServicesSource || "auto",
        serviceAnalysisStatus: serviceAnalysis.status || "completed"
      }
    ), {
      ...input,
      selectedServices: selectedServiceIds
    }, userId);
    return persistPipelineResult(input.leadId, rejectedResult, userId);
  }

  return persistPipelineResult(input.leadId, noSuitableAngle("No suitable outreach angle found after every surviving observation was evaluated.", {
    evaluatedCandidates,
    summary: diagnosticSummary(evaluatedCandidates, candidates.length),
    candidateCount: candidates.length,
    skippedLowConfidence: evaluatedCandidates.filter((item) => item.status === "skipped_low_confidence").length,
    rejectedByQualityGate: evaluatedCandidates.filter((item) => item.status === "rejected").length,
    usedFallbackCandidates
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
    },
    emailSelectedServices: array(draft.emailSelectedServices || current.emailSelectedServices),
    selectedReportServices: array(draft.emailSelectedServices || current.selectedReportServices || current.emailSelectedServices)
  };
  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      scanEvidence: {
        ...scanEvidence,
        outreachPipeline: next,
        serviceAnalysis: {
          ...object(scanEvidence.serviceAnalysis),
          selectedReportServices: array(draft.emailSelectedServices || current.selectedReportServices || current.emailSelectedServices),
          selectedServicesSource: array(draft.emailSelectedServices).length ? "manual" : object(scanEvidence.serviceAnalysis).selectedServicesSource || "auto"
        }
      },
      outreachEmail: cleanDraft.fullEmail || cleanDraft.body || null
    }
  });
  return updated.scanEvidence.outreachPipeline;
}
