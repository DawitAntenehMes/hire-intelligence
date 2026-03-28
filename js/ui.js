// js/ui.js — All DOM rendering functions

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#d97706";
  return "#dc2626";
}

function formatEur(amount) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
}

function riskClass(level) {
  return { low: "risk-low", medium: "risk-medium", high: "risk-high" }[level] || "";
}

// ── Setup Screen ─────────────────────────────────────────────────────────────

function renderCandidates(selectedIds = []) {
  const list = document.getElementById("candidate-list");
  list.innerHTML = CANDIDATES.map(c => `
    <div class="candidate-chip ${selectedIds.includes(c.id) ? "selected" : ""}"
         onclick="toggleCandidate('${c.id}')">
      <div class="chip-check">${selectedIds.includes(c.id) ? "✓" : ""}</div>
      <div class="chip-avatar" style="background:${c.avatarColor}; color:${c.avatarText};">${c.initials}</div>
      <div class="chip-info">
        <div class="chip-name">${c.name}</div>
        <div class="chip-role">${c.currentRole}</div>
      </div>
      <div class="chip-tags">
        <span class="tag ${c.type}">${c.type}</span>
        <span class="tag weeks">${c.availabilityWeeks}w</span>
      </div>
    </div>
  `).join("");
}

function renderScenarios(selectedId = null) {
  const grid = document.getElementById("scenario-grid");
  grid.innerHTML = SCENARIOS.map(s => `
    <div class="scenario-chip ${s.id === selectedId ? "selected" : ""}"
         onclick="selectScenario('${s.id}')">
      <div class="scenario-id">${s.id}</div>
      <div class="scenario-label">${s.label}</div>
    </div>
  `).join("") + `
    <div class="scenario-chip custom-chip ${selectedId === "CUSTOM" ? "selected" : ""}"
         onclick="selectScenario('CUSTOM')">
      <div class="scenario-id">CUSTOM</div>
      <div class="scenario-label">Custom scenario...</div>
    </div>
  `;
}

// ── Pipeline Progress ─────────────────────────────────────────────────────────

function setAgentStage(agentNum, status) {
  // status: "running" | "done" | "error"
  const el = document.getElementById(`prog-${agentNum}`);
  const statusEl = document.getElementById(`prog-status-${agentNum}`);
  el.className = `pipeline-step ${status}`;

  const labels = {
    running: "Running...",
    done: "Complete",
    error: "Failed"
  };
  statusEl.textContent = labels[status] || "Waiting...";
}

// ── Panel A: Adapted JD ───────────────────────────────────────────────────────

function renderPanelA(agent1) {
  document.getElementById("panel-a-summary").textContent = agent1.scenarioSummary;

  const table = document.getElementById("criteria-table");
  table.innerHTML = `
    <div class="criteria-header-row">
      <span class="criteria-col-label">Criterion</span>
      <span class="criteria-col-label">Weight shift</span>
      <span class="criteria-col-label">Original</span>
      <span class="criteria-col-label">Adapted</span>
      <span class="criteria-col-label">Reasoning</span>
    </div>
    ${agent1.adaptedCriteria.map(c => {
      const maxW = 60;
      return `
        <div class="criteria-row">
          <span class="criteria-name">${c.criterion}</span>
          <div class="weight-bar-wrap">
            <div class="weight-bar-orig" style="width:${(c.originalWeight / maxW) * 100}%"></div>
            <div class="weight-bar-new" style="width:${(c.newWeight / maxW) * 100}%"></div>
          </div>
          <span class="weight-num weight-orig">${c.originalWeight}%</span>
          <span class="weight-num weight-new">${c.newWeight}%</span>
          <span class="criteria-reasoning">${c.reasoning}</span>
        </div>
      `;
    }).join("")}
  `;

  // Build override sliders
  const sliders = document.getElementById("override-sliders");
  sliders.innerHTML = agent1.adaptedCriteria.map(c => `
    <div class="override-row">
      <span class="override-name">${c.criterion.length > 22 ? c.criterion.slice(0, 22) + "…" : c.criterion}</span>
      <input type="range" class="override-slider" min="0" max="60" step="1"
             value="${c.newWeight}"
             data-criterion="${c.criterion}"
             oninput="updateOverrideTotal()">
      <span class="override-val" id="ov-${c.criterion.replace(/\s+/g, "-")}">${c.newWeight}%</span>
    </div>
  `).join("");

  document.getElementById("panel-a").classList.remove("hidden");
}

// ── Panel B: Sourcing ─────────────────────────────────────────────────────────

function renderPanelB(agent2) {
  const isInternal = agent2.sourcingRecommendation === "internal";
  const ia = agent2.internalAnalysis;
  const ea = agent2.externalAnalysis;

  document.getElementById("sourcing-grid").innerHTML = `
    <div class="sourcing-card ${isInternal ? "recommended" : ""}">
      <div class="sourcing-card-title">Internal Hire ${isInternal ? "✓ Recommended" : ""}</div>
      <div class="sourcing-row">
        <span class="sourcing-key">Best candidate</span>
        <span class="sourcing-val">${ia.bestInternalCandidate || "None identified"}</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Fit score</span>
        <span class="sourcing-val">${ia.fitScore}/100</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Time to hire</span>
        <span class="sourcing-val">${ia.speedWeeks} weeks</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Estimated cost</span>
        <span class="sourcing-val">${formatEur(ia.estimatedCostEur)}</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Risk</span>
        <span class="sourcing-val ${riskClass(ia.riskLevel)}">${ia.riskLevel.toUpperCase()}</span>
      </div>
    </div>

    <div class="sourcing-card ${!isInternal ? "recommended" : ""}">
      <div class="sourcing-card-title">External Hire ${!isInternal ? "✓ Recommended" : ""}</div>
      <div class="sourcing-row">
        <span class="sourcing-key">Best candidate</span>
        <span class="sourcing-val">Market search</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Fit score</span>
        <span class="sourcing-val">TBD via search</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Time to hire</span>
        <span class="sourcing-val">${ea.speedWeeks} weeks</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Agency cost</span>
        <span class="sourcing-val">${formatEur(ea.estimatedCostEur)}</span>
      </div>
      <div class="sourcing-row">
        <span class="sourcing-key">Risk</span>
        <span class="sourcing-val ${riskClass(ea.riskLevel)}">${ea.riskLevel.toUpperCase()}</span>
      </div>
    </div>
  `;

  document.getElementById("sourcing-reasoning").textContent = agent2.recommendationReasoning;
  document.getElementById("panel-b").classList.remove("hidden");
}

// ── Panel C: Rankings ─────────────────────────────────────────────────────────

function renderPanelC(agent3) {
  const rankings = document.getElementById("rankings");
  rankings.innerHTML = agent3.candidates.map(c => `
    <div class="rank-row rank-${c.rank}" id="rank-${c.name.replace(/\s+/g,"-")}">
      <div class="rank-header" onclick="toggleRankDetail('${c.name.replace(/\s+/g,"-")}')">
        <span class="rank-number">#${c.rank}</span>
        <div>
          <div class="rank-name">${c.name}</div>
          <div class="rank-role">${CANDIDATES.find(x => x.name === c.name)?.currentRole || c.source}</div>
        </div>
        <span class="tag ${c.source}">${c.source}</span>
        ${c.urgencyMismatch ? `<span class="urgency-flag">⚠ Urgency Risk</span>` : ""}
        <div>
          <div class="rank-score">${c.totalWeightedScore.toFixed(1)}</div>
          <div class="rank-avail">${c.availabilityWeeks}w availability</div>
        </div>
        <span class="expand-icon">▾</span>
      </div>
      <div class="rank-detail">
        <div class="dimension-bars">
          ${c.dimensionScores.map(d => `
            <div class="dim-row">
              <span class="dim-name">${d.criterion.length > 20 ? d.criterion.slice(0,20) + "…" : d.criterion} (${d.weight}%)</span>
              <div class="dim-bar-wrap">
                <div class="dim-bar" style="width:${d.score}%; background:${scoreColor(d.score)};"></div>
              </div>
              <span class="dim-score" style="color:${scoreColor(d.score)};">${d.score}</span>
              <span class="dim-evidence">${d.evidence}</span>
            </div>
          `).join("")}
        </div>
        <p style="margin-top:12px; font-size:12px; color:#6b7280;">${c.availabilityNote}</p>
      </div>
    </div>
  `).join("");

  document.getElementById("panel-c").classList.remove("hidden");
}

// ── Decision Screen ───────────────────────────────────────────────────────────

function renderDecision(result) {
  const a4 = result.agent4;

  const confLabel = { high: "HIGH CONFIDENCE", medium: "MEDIUM CONFIDENCE", low: "LOW CONFIDENCE" };
  const confColor = { high: "rgba(255,255,255,0.9)", medium: "rgba(255,200,100,0.9)", low: "rgba(255,150,100,0.9)" };

  document.getElementById("decision-confidence").textContent = confLabel[a4.confidenceLevel];
  document.getElementById("decision-confidence").style.color = confColor[a4.confidenceLevel];
  document.getElementById("decision-headline").textContent = a4.headlineRecommendation;
  document.getElementById("decision-reasoning").textContent = a4.confidenceReasoning;

  document.getElementById("reasons-list").innerHTML = a4.keyReasons.map(r => `<li>${r}</li>`).join("");

  document.getElementById("tradeoff-recommended").textContent = a4.tradeoffStatement.ifHireRecommended;
  document.getElementById("tradeoff-fastest").textContent = a4.tradeoffStatement.ifHireFastest;

  if (a4.redFlags && a4.redFlags.length > 0) {
    document.getElementById("red-flags-card").classList.remove("hidden");
    document.getElementById("red-flags-list").innerHTML = a4.redFlags.map(f => `<li>${f}</li>`).join("");
  }
}
