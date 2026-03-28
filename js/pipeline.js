// js/pipeline.js
// Handles all API calls to the backend agent pipeline.
// If you're running without a backend (demo mode), this file
// falls back to simulated data so you can still demo the UI.

const API_BASE = "/api"; // Change to your deployed backend URL if separate

function createRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Run the full 4-agent pipeline.
 * Calls POST /api/pipeline
 */
async function callPipeline(jd, candidates, scenario, urgencyWeeks) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  console.info("[pipeline] request.start", {
    requestId,
    scenarioId: scenario?.id,
    candidateCount: candidates.length,
    urgencyWeeks
  });

  const res = await fetch(`${API_BASE}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId
    },
    body: JSON.stringify({ jd, candidates, scenario, urgencyWeeks })
  });

  const json = await res.json();

  console.info("[pipeline] request.end", {
    requestId,
    status: res.status,
    success: Boolean(json.success),
    durationMs: Date.now() - startedAt
  });

  if (!json.success) {
    throw new Error(json.error || "Pipeline failed at stage: " + (json.stage || "unknown"));
  }

  return json.data;
}

/**
 * Rerun agents 3 + 4 only with overridden weights.
 * Calls POST /api/pipeline/rerun
 */
async function callRerun(adaptedJD, sourcingResult, candidates, urgencyWeeks) {
  const requestId = createRequestId();
  const startedAt = Date.now();
  console.info("[pipeline-rerun] request.start", {
    requestId,
    criteriaCount: adaptedJD?.adaptedCriteria?.length || 0,
    candidateCount: candidates.length,
    urgencyWeeks
  });

  const res = await fetch(`${API_BASE}/pipeline/rerun`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId
    },
    body: JSON.stringify({ adaptedJD, sourcingResult, candidates, urgencyWeeks })
  });

  const json = await res.json();

  console.info("[pipeline-rerun] request.end", {
    requestId,
    status: res.status,
    success: Boolean(json.success),
    durationMs: Date.now() - startedAt
  });

  if (!json.success) {
    throw new Error(json.error || "Rerun failed");
  }

  return json.data; // { agent3, agent4 }
}

// ── DEMO MODE FALLBACK ────────────────────────────────────────────────────────
// If the backend isn't running, the app will use this simulated data.
// Remove this section once your backend is live.

// const DEMO_RESULT = {
//   agent1: {
//     adaptedCriteria: [
//       { criterion: "Strategic Planning & Long-term Vision", originalWeight: 30, newWeight: 10, reasoning: "Long-horizon strategy is secondary during active supply disruption" },
//       { criterion: "Leadership Experience",                 originalWeight: 25, newWeight: 20, reasoning: "Leadership remains important but operational urgency takes precedence" },
//       { criterion: "Stakeholder Management",               originalWeight: 20, newWeight: 20, reasoning: "Critical at all times — unchanged" },
//       { criterion: "Digital Fluency",                      originalWeight: 15, newWeight: 15, reasoning: "Needed for supply visibility tools — unchanged" },
//       { criterion: "Crisis Operations",                    originalWeight: 10, newWeight: 35, reasoning: "Role now requires rapid vendor renegotiation and production continuity under pressure" }
//     ],
//     scenarioSummary: "Active supply chain crisis demands prioritisation of crisis operations and stakeholder coordination over long-term strategic planning."
//   },
//   agent2: {
//     sourcingRecommendation: "external",
//     internalAnalysis: {
//       bestInternalCandidate: "Marcus Weber",
//       fitScore: 72,
//       speedWeeks: 2,
//       estimatedCostEur: 5000,
//       riskLevel: "medium",
//       reasoning: "Marcus is fast and cheap but his crisis operations score (72) is insufficient for the severity of the current disruption."
//     },
//     externalAnalysis: {
//       speedWeeks: 6,
//       estimatedCostEur: 45000,
//       riskLevel: "medium",
//       reasoning: "External search via Anna Fischer delivers a candidate with proven crisis track record within an acceptable urgency window."
//     },
//     recommendationReasoning: "Anna Fischer's crisis operations experience is the decisive factor. The cost premium (€40,000) is justified given the production-halt severity and 18-month re-hire risk of a crisis mismatch."
//   },
//   agent3: {
//     candidates: [
//       {
//         name: "Anna Fischer",
//         source: "external",
//         availabilityWeeks: 6,
//         dimensionScores: [
//           { criterion: "Strategic Planning & Long-term Vision", weight: 10, score: 68, weightedScore: 6.8, evidence: "Strong strategic track record at Continental AG" },
//           { criterion: "Leadership Experience",                 weight: 20, score: 85, weightedScore: 17.0, evidence: "14 years, led 200+ person EMEA supply function" },
//           { criterion: "Stakeholder Management",               weight: 20, score: 82, weightedScore: 16.4, evidence: "Board-level reporting at Continental AG" },
//           { criterion: "Digital Fluency",                      weight: 15, score: 78, weightedScore: 11.7, evidence: "SAP S/4HANA certified, led digitalisation programme" },
//           { criterion: "Crisis Operations",                    weight: 35, score: 95, weightedScore: 33.25, evidence: "Led EMEA semiconductor shortage recovery in 6 weeks" }
//         ],
//         totalWeightedScore: 85.15,
//         rank: 1,
//         availabilityNote: "Available in 6 weeks. Meets urgency threshold.",
//         urgencyMismatch: false
//       },
//       {
//         name: "Priya Sharma",
//         source: "external",
//         availabilityWeeks: 10,
//         dimensionScores: [
//           { criterion: "Strategic Planning & Long-term Vision", weight: 10, score: 74, weightedScore: 7.4, evidence: "Built CATL Europe strategy from greenfield" },
//           { criterion: "Leadership Experience",                 weight: 20, score: 72, weightedScore: 14.4, evidence: "9 years, led 80-person ops team at CATL" },
//           { criterion: "Stakeholder Management",               weight: 20, score: 76, weightedScore: 15.2, evidence: "Managed European OEM relationships at CATL" },
//           { criterion: "Digital Fluency",                      weight: 15, score: 80, weightedScore: 12.0, evidence: "Led digital supply chain implementation for EV platform" },
//           { criterion: "Crisis Operations",                    weight: 35, score: 70, weightedScore: 24.5, evidence: "Limited large-scale crisis management experience" }
//         ],
//         totalWeightedScore: 73.5,
//         rank: 2,
//         availabilityNote: "Available in 10 weeks — exceeds urgency by 2 weeks.",
//         urgencyMismatch: true
//       },
//       {
//         name: "Marcus Weber",
//         source: "internal",
//         availabilityWeeks: 2,
//         dimensionScores: [
//           { criterion: "Strategic Planning & Long-term Vision", weight: 10, score: 81, weightedScore: 8.1, evidence: "Led BMW Munich 5-year logistics strategy" },
//           { criterion: "Leadership Experience",                 weight: 20, score: 74, weightedScore: 14.8, evidence: "11 years, led 40-person team at BMW Munich" },
//           { criterion: "Stakeholder Management",               weight: 20, score: 70, weightedScore: 14.0, evidence: "Strong internal stakeholder network across BMW" },
//           { criterion: "Digital Fluency",                      weight: 15, score: 85, weightedScore: 12.75, evidence: "Built BMW's first digitised logistics dashboard" },
//           { criterion: "Crisis Operations",                    weight: 35, score: 52, weightedScore: 18.2, evidence: "No documented large-scale crisis management experience" }
//         ],
//         totalWeightedScore: 67.85,
//         rank: 3,
//         availabilityNote: "Available in 2 weeks — fastest of all candidates.",
//         urgencyMismatch: false
//       }
//     ]
//   },
//   agent4: {
//     recommendedCandidate: "Anna Fischer",
//     recommendedSource: "external",
//     headlineRecommendation: "Hire Anna Fischer — her crisis operations track record is the decisive differentiator for the current production-halt situation.",
//     keyReasons: [
//       "Highest weighted score (85.2) driven by a 95/100 crisis operations rating, the criterion most critical to the current scenario",
//       "Proven at EMEA scale: restored 95% supply output in 6 weeks during the 2021 semiconductor shortage — directly analogous to today's disruption",
//       "Available in 6 weeks, meeting the urgency threshold with no mismatch risk"
//     ],
//     tradeoffStatement: {
//       ifHireRecommended: "Anna Fischer. Score: 85.2. Available: 6 weeks. Cost: €45,000. Risk: medium (external hire, no BMW network).",
//       ifHireFastest: "Marcus Weber. Score: 67.9. Available: 2 weeks. Cost: €5,000. Crisis ops score: 52/100. Re-hire risk: high within 18 months given crisis mismatch."
//     },
//     confidenceLevel: "high",
//     confidenceReasoning: "All three analytical layers — scenario adaptation, sourcing matrix, and candidate scores — converge on Anna Fischer.",
//     redFlags: [
//       "Anna Fischer has no EV/battery supply chain experience — flag if the role shifts toward SC03 within 12 months as the crisis resolves",
//       "No existing BMW internal network may slow stakeholder onboarding in the first 60 days"
//     ]
//   }
// };
