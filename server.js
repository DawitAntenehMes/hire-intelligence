// server.js — Backend API server for Hire Intelligence
// Pure Node.js — no Express needed. Serves the HTML files AND the API endpoints.
//
// Usage:
//   1. npm install openai
//   2. Create a .env file with GROK_API_KEY=sk-...
//   3. node server.js
//   4. Open http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// ── Load env vars from .env file ─────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, ".env.local");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf-8")
      .split("\n")
      .filter(line => line.trim() && !line.startsWith("#"))
      .forEach(line => {
        const [key, ...rest] = line.split("=");
        process.env[key.trim()] = rest.join("=").trim();
      });
  }
}

loadEnv();

if (!process.env.GROK_API_KEY) {
  console.error("ERROR: GROK_API_KEY is not set.");
  console.error("Create a .env file with: GROK_API_KEY=sk-your-grok-key-here");
  process.exit(1);
}

const grok = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: "https://api.x.ai/v1"
});

const PORT = process.env.PORT || 3000;

// ── MIME types for static files ───────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
};

// ── Utility: parse request body ───────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// ── Utility: send JSON response ───────────────────────────────────────────────
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── Utility: safe JSON parse (strips markdown fences) ────────────────────────
function safeParseJSON(text, agentName) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw Object.assign(
      new Error(`${agentName} returned invalid JSON: ${cleaned.slice(0, 200)}`),
      { stage: agentName }
    );
  }
}

// ── Utility: retry wrapper ────────────────────────────────────────────────────
async function withRetry(fn, retries = 2, delayMs = 1000) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < retries) await new Promise(r => setTimeout(r, delayMs * 2 ** i));
    }
  }
  throw lastErr;
}

// ────────────────────────────────────────────────────────────────────────────
// AGENT PROMPTS
// ────────────────────────────────────────────────────────────────────────────

const AGENT1_PROMPT = `You are a senior HR strategist. You will be given a job description and a business scenario. Your task is to reweight the JD criteria to reflect what the role actually needs in the current context.

Return ONLY valid JSON — no preamble, no markdown fences, no explanation:
{
  "adapted_criteria": [
    {
      "criterion": "Crisis operations",
      "original_weight": 10,
      "new_weight": 35,
      "reasoning": "Role now requires rapid vendor renegotiation under pressure"
    }
  ],
  "scenario_summary": "One sentence describing the business context and what it demands of this role"
}

Rules:
- All new_weight values must sum to exactly 100
- Never rename or remove a criterion — use the exact names from the JD
- reasoning must be one sentence, max 20 words
- Output ONLY the JSON object — nothing else`;

const AGENT2_PROMPT = `You are an HR sourcing strategist. Given the adapted job criteria and the candidate pool (tagged as internal or external), evaluate whether an internal hire is viable before recommending an external search.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "sourcing_recommendation": "internal",
  "internal_analysis": {
    "best_internal_candidate": "Name or null",
    "fit_score": 72,
    "speed_weeks": 2,
    "estimated_cost_eur": 5000,
    "risk_level": "low",
    "reasoning": "One sentence explaining the internal assessment"
  },
  "external_analysis": {
    "speed_weeks": 14,
    "estimated_cost_eur": 45000,
    "risk_level": "medium",
    "reasoning": "One sentence explaining the external assessment"
  },
  "recommendation_reasoning": "Two sentences explaining the final recommendation and what drives it."
}

sourcing_recommendation must be exactly "internal", "external", or "both".
risk_level must be exactly "low", "medium", or "high".
Output ONLY the JSON object.`;

const AGENT3_PROMPT = `You are a structured hiring assessor. Score each candidate against the adapted JD criteria. Score EVERY criterion for EVERY candidate. Do NOT produce a single composite score — the per-dimension breakdown is the primary output.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "candidates": [
    {
      "name": "Anna Fischer",
      "source": "external",
      "availability_weeks": 6,
      "dimension_scores": [
        {
          "criterion": "Crisis operations",
          "weight": 35,
          "score": 95,
          "weighted_score": 33.25,
          "evidence": "Led 3 plant shutdowns and EMEA semiconductor recovery"
        }
      ],
      "total_weighted_score": 88.5,
      "rank": 1,
      "availability_note": "Available in 6 weeks. Meets urgency threshold.",
      "urgency_mismatch": false
    }
  ]
}

Rules:
- score is 0-100
- weighted_score = (score * weight) / 100
- total_weighted_score = sum of all weighted_scores, rounded to 2 decimal places
- rank candidates by total_weighted_score descending (rank 1 = highest)
- urgency_mismatch = true if availability_weeks > urgency_weeks
- evidence must be one concrete phrase from the candidate profile
- Output ONLY the JSON object`;

const AGENT4_PROMPT = `You are a senior leadership hiring advisor. Given all outputs from the previous agents, write the final hire recommendation.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "recommended_candidate": "Anna Fischer",
  "recommended_source": "external",
  "headline_recommendation": "One decisive sentence — the hire decision and primary reason",
  "key_reasons": [
    "Reason 1 — specific and evidence-based",
    "Reason 2 — specific and evidence-based",
    "Reason 3 — specific and evidence-based"
  ],
  "tradeoff_statement": {
    "if_hire_recommended": "Name. Score: X. Available: Y weeks. Cost: €Z. Risk: level.",
    "if_hire_fastest": "Name. Score: X. Available: Y weeks. Re-hire risk: level within 18 months."
  },
  "confidence_level": "high",
  "confidence_reasoning": "One sentence explaining confidence level",
  "red_flags": ["Critical gap 1", "Critical gap 2"]
}

Rules:
- recommended_source must be "internal" or "external"
- confidence_level must be "high", "medium", or "low"
- key_reasons must have exactly 3 items
- red_flags can be empty array [] if no critical gaps
- Output ONLY the JSON object`;

// ────────────────────────────────────────────────────────────────────────────
// AGENT FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────

async function runAgent1(jd, scenarioDescription) {
  return withRetry(async () => {
    const response = await grok.chat.completions.create({
      model: "grok-2-latest",
      max_tokens: 1000,
      system: AGENT1_PROMPT,
      messages: [{ role: "user", content: `JOB DESCRIPTION:\n${jd}\n\nBUSINESS SCENARIO:\n${scenarioDescription}` }]
    });
    const text = response.choices[0].message.content;
    const raw = safeParseJSON(text, "agent1");
    return {
      adaptedCriteria: raw.adapted_criteria.map(c => ({
        criterion: c.criterion,
        originalWeight: c.original_weight,
        newWeight: c.new_weight,
        reasoning: c.reasoning
      })),
      scenarioSummary: raw.scenario_summary
    };
  });
}

async function runAgent2(adaptedJD, candidates, urgencyWeeks) {
  return withRetry(async () => {
    const response = await grok.chat.completions.create({
      model: "grok-2-latest",
      max_tokens: 1000,
      system: AGENT2_PROMPT,
      messages: [{
        role: "user",
        content: `ADAPTED JD CRITERIA:\n${JSON.stringify(adaptedJD, null, 2)}\n\nCANDIDATES:\n${JSON.stringify(candidates, null, 2)}\n\nURGENCY: Role must be filled within ${urgencyWeeks} weeks`
      }]
    });
    const text = response.choices[0].message.content;
    const raw = safeParseJSON(text, "agent2");
    return {
      sourcingRecommendation: raw.sourcing_recommendation,
      internalAnalysis: {
        bestInternalCandidate: raw.internal_analysis.best_internal_candidate,
        fitScore: raw.internal_analysis.fit_score,
        speedWeeks: raw.internal_analysis.speed_weeks,
        estimatedCostEur: raw.internal_analysis.estimated_cost_eur,
        riskLevel: raw.internal_analysis.risk_level,
        reasoning: raw.internal_analysis.reasoning
      },
      externalAnalysis: {
        speedWeeks: raw.external_analysis.speed_weeks,
        estimatedCostEur: raw.external_analysis.estimated_cost_eur,
        riskLevel: raw.external_analysis.risk_level,
        reasoning: raw.external_analysis.reasoning
      },
      recommendationReasoning: raw.recommendation_reasoning
    };
  });
}

async function runAgent3(adaptedJD, candidates, urgencyWeeks) {
  return withRetry(async () => {
    const response = await grok.chat.completions.create({
      model: "grok-2-latest",
      max_tokens: 2000,
      system: AGENT3_PROMPT,
      messages: [{
        role: "user",
        content: `ADAPTED JD WEIGHTS:\n${JSON.stringify(adaptedJD.adaptedCriteria, null, 2)}\n\nCANDIDATES:\n${JSON.stringify(candidates, null, 2)}\n\nURGENCY: ${urgencyWeeks} weeks`
      }]
    });
    const text = response.choices[0].message.content;
    const raw = safeParseJSON(text, "agent3");
    return {
      candidates: raw.candidates.map(c => ({
        name: c.name,
        source: c.source,
        availabilityWeeks: c.availability_weeks,
        dimensionScores: c.dimension_scores.map(d => ({
          criterion: d.criterion,
          weight: d.weight,
          score: d.score,
          weightedScore: d.weighted_score,
          evidence: d.evidence
        })),
        totalWeightedScore: c.total_weighted_score,
        rank: c.rank,
        availabilityNote: c.availability_note,
        urgencyMismatch: c.urgency_mismatch ?? false
      }))
    };
  });
}

async function runAgent4(adaptedJD, sourcingResult, rankings) {
  return withRetry(async () => {
    const response = await grok.chat.completions.create({
      model: "grok-2-latest",
      max_tokens: 1200,
      system: AGENT4_PROMPT,
      messages: [{
        role: "user",
        content: `ADAPTED JD:\n${JSON.stringify(adaptedJD, null, 2)}\n\nSOURCING ANALYSIS:\n${JSON.stringify(sourcingResult, null, 2)}\n\nCANDIDATE RANKINGS:\n${JSON.stringify(rankings, null, 2)}`
      }]
    });
    const text = response.choices[0].message.content;
    const raw = safeParseJSON(text, "agent4");
    return {
      recommendedCandidate: raw.recommended_candidate,
      recommendedSource: raw.recommended_source,
      headlineRecommendation: raw.headline_recommendation,
      keyReasons: raw.key_reasons,
      tradeoffStatement: {
        ifHireRecommended: raw.tradeoff_statement.if_hire_recommended,
        ifHireFastest: raw.tradeoff_statement.if_hire_fastest
      },
      confidenceLevel: raw.confidence_level,
      confidenceReasoning: raw.confidence_reasoning,
      redFlags: raw.red_flags ?? []
    };
  });
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP SERVER
// ────────────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  // ── CORS headers ──────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API: GET /api/health ──────────────────────────────────────────────────
  if (url.pathname === "/api/health" && method === "GET") {
    return sendJSON(res, 200, { status: "ok", timestamp: new Date().toISOString() });
  }

  // ── API: POST /api/pipeline ───────────────────────────────────────────────
  if (url.pathname === "/api/pipeline" && method === "POST") {
    const start = Date.now();
    try {
      const body = await parseBody(req);
      const { jd, candidates, scenario, urgencyWeeks } = body;

      if (!jd || !candidates?.length || !scenario || !urgencyWeeks) {
        return sendJSON(res, 400, { success: false, error: "Missing required fields", stage: "unknown" });
      }

      console.log(`[Pipeline] Starting — scenario: ${scenario.label}, candidates: ${candidates.length}, urgency: ${urgencyWeeks}w`);

      const agent1 = await runAgent1(jd, scenario.description);
      console.log("[Agent 1] Done");

      const agent2 = await runAgent2(agent1, candidates, urgencyWeeks);
      console.log("[Agent 2] Done");

      const agent3 = await runAgent3(agent1, candidates, urgencyWeeks);
      console.log("[Agent 3] Done");

      const agent4 = await runAgent4(agent1, agent2, agent3);
      console.log("[Agent 4] Done");

      const durationMs = Date.now() - start;
      console.log(`[Pipeline] Complete in ${durationMs}ms`);

      return sendJSON(res, 200, { success: true, data: { agent1, agent2, agent3, agent4 }, durationMs });

    } catch (err) {
      console.error("[Pipeline Error]", err.message);
      return sendJSON(res, 500, { success: false, error: err.message, stage: err.stage || "unknown" });
    }
  }

  // ── API: POST /api/pipeline/rerun ─────────────────────────────────────────
  if (url.pathname === "/api/pipeline/rerun" && method === "POST") {
    try {
      const body = await parseBody(req);
      const { adaptedJD, sourcingResult, candidates, urgencyWeeks } = body;

      const agent3 = await runAgent3(adaptedJD, candidates, urgencyWeeks);
      const agent4 = await runAgent4(adaptedJD, sourcingResult, agent3);

      return sendJSON(res, 200, { success: true, data: { agent3, agent4 } });

    } catch (err) {
      console.error("[Rerun Error]", err.message);
      return sendJSON(res, 500, { success: false, error: err.message, stage: err.stage || "unknown" });
    }
  }

  // ── Static file server ────────────────────────────────────────────────────
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n✓ Hire Intelligence running at http://localhost:${PORT}`);
  console.log(`  Press Ctrl+C to stop\n`);
});
