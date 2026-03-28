// js/app.js — Main application logic, state, navigation, event handlers

// ── App State ─────────────────────────────────────────────────────────────────

const state = {
  selectedCandidates: [],
  selectedScenario: null,
  urgencyWeeks: 8,
  jdText: "",
  pipelineResult: null,
  isRunning: false
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  renderCandidates([]);
  renderScenarios(null);
  updateUrgency(8);
  checkRunReady();

  // Watch JD input
  document.getElementById("jd-input").addEventListener("input", function () {
    state.jdText = this.value.trim();
    checkRunReady();
  });
});

// ── Setup Actions ─────────────────────────────────────────────────────────────

function loadDefaultJD() {
  document.getElementById("jd-input").value = DEFAULT_JD;
  state.jdText = DEFAULT_JD;
  checkRunReady();
}

function loadAllCandidates() {
  state.selectedCandidates = CANDIDATES.map(c => c.id);
  renderCandidates(state.selectedCandidates);
  checkRunReady();
}

function toggleCandidate(id) {
  const i = state.selectedCandidates.indexOf(id);
  if (i === -1) {
    state.selectedCandidates.push(id);
  } else {
    state.selectedCandidates.splice(i, 1);
  }
  renderCandidates(state.selectedCandidates);
  checkRunReady();
}

function selectScenario(id) {
  state.selectedScenario = id;
  renderScenarios(id);
  const customDiv = document.getElementById("custom-scenario");
  customDiv.style.display = id === "CUSTOM" ? "block" : "none";
  checkRunReady();
}

function updateUrgency(val) {
  state.urgencyWeeks = parseInt(val);
  document.getElementById("urgency-display").textContent = val;

  const hint = document.getElementById("urgency-hint");
  if (val <= 4) { hint.textContent = "Critical urgency"; hint.style.color = "#dc2626"; }
  else if (val <= 8) { hint.textContent = "Moderate urgency"; hint.style.color = "#d97706"; }
  else { hint.textContent = "Low urgency"; hint.style.color = "#16a34a"; }

  checkRunReady();
}

function checkRunReady() {
  const jdOk = state.jdText.length > 50;
  const candidatesOk = state.selectedCandidates.length >= 1;
  const scenarioOk = state.selectedScenario !== null;

  const btn = document.getElementById("run-btn");
  const status = document.getElementById("status-text");

  const missing = [];
  if (!jdOk) missing.push("job description");
  if (!candidatesOk) missing.push("at least 1 candidate");
  if (!scenarioOk) missing.push("a business scenario");

  if (missing.length === 0) {
    btn.disabled = false;
    status.textContent = `${state.selectedCandidates.length} candidate${state.selectedCandidates.length > 1 ? "s" : ""} · ${SCENARIOS.find(s => s.id === state.selectedScenario)?.label || "Custom"} · ${state.urgencyWeeks} weeks`;
  } else {
    btn.disabled = true;
    status.textContent = "Still needed: " + missing.join(", ");
  }
}

// ── Pipeline Run ──────────────────────────────────────────────────────────────

async function runPipeline() {
  if (state.isRunning) return;
  state.isRunning = true;

  // Get selected scenario description
  let scenarioObj;
  if (state.selectedScenario === "CUSTOM") {
    const customText = document.getElementById("custom-scenario-text").value.trim();
    scenarioObj = { id: "CUSTOM", label: "Custom", description: customText || "Custom business scenario" };
  } else {
    scenarioObj = SCENARIOS.find(s => s.id === state.selectedScenario);
  }

  // Get selected candidate objects
  const candidateObjs = CANDIDATES.filter(c => state.selectedCandidates.includes(c.id));

  // Navigate to analysis screen
  showScreen("analysis");
  setNavStep(2);

  // Reset panel visibility
  ["panel-a", "panel-b", "panel-c", "continue-bar"].forEach(id => {
    document.getElementById(id).classList.add("hidden");
  });

  // Reset pipeline progress
  [1, 2, 3, 4].forEach(n => {
    document.getElementById(`prog-${n}`).className = "pipeline-step";
    document.getElementById(`prog-status-${n}`).textContent = "Waiting...";
  });

  try {
    // Simulate progressive stage updates while API call runs
    // (real API call is a single POST, so we animate the steps client-side)
    const progressTimers = [];

    // Start progress animation
    setAgentStage(1, "running");
    progressTimers.push(setTimeout(() => setAgentStage(2, "running"), 7000));
    progressTimers.push(setTimeout(() => setAgentStage(3, "running"), 14000));
    progressTimers.push(setTimeout(() => setAgentStage(4, "running"), 21000));

    let result;

    // Try real API, fall back to demo data
    try {
      result = await callPipeline(
        state.jdText,
        candidateObjs,
        scenarioObj,
        state.urgencyWeeks
      );
    } catch (apiErr) {
      console.warn("API unavailable, using demo data:", apiErr.message);
      // Simulate loading time
      await new Promise(r => setTimeout(r, 2500));
      return;
    }

    // Clear timers
    progressTimers.forEach(clearTimeout);

    // Mark all done
    [1, 2, 3, 4].forEach(n => setAgentStage(n, "done"));

    // Store result
    state.pipelineResult = result;

    // Render panels sequentially
    await delay(300);
    renderPanelA(result.agent1);

    await delay(400);
    renderPanelB(result.agent2);

    await delay(400);
    renderPanelC(result.agent3);

    // Show continue button
    document.getElementById("continue-bar").classList.remove("hidden");

  } catch (err) {
    console.error("Pipeline error:", err);
    [1, 2, 3, 4].forEach(n => {
      if (document.getElementById(`prog-${n}`).classList.contains("running")) {
        setAgentStage(n, "error");
      }
    });
    alert("Pipeline failed: " + err.message);
  }

  state.isRunning = false;
}

// ── Rerun (override weights) ──────────────────────────────────────────────────

async function rerunScoring() {
  if (!state.pipelineResult) return;

  const sliders = document.querySelectorAll("#override-sliders .override-slider");
  const overriddenCriteria = state.pipelineResult.agent1.adaptedCriteria.map(c => {
    const slider = Array.from(sliders).find(s => s.dataset.criterion === c.criterion);
    return { ...c, newWeight: slider ? parseInt(slider.value) : c.newWeight };
  });

  const overriddenJD = { ...state.pipelineResult.agent1, adaptedCriteria: overriddenCriteria };

  const candidateObjs = CANDIDATES.filter(c => state.selectedCandidates.includes(c.id));

  // Temporarily hide panels 2 and 3
  document.getElementById("panel-c").classList.add("hidden");

  try {
    let rerunData;
    try {
      rerunData = await callRerun(
        overriddenJD,
        state.pipelineResult.agent2,
        candidateObjs,
        state.urgencyWeeks
      );
    } catch {
      // Demo fallback — just re-use existing agent3/4 data
      rerunData = { agent3: state.pipelineResult.agent3, agent4: state.pipelineResult.agent4 };
    }

    state.pipelineResult.agent3 = rerunData.agent3;
    state.pipelineResult.agent4 = rerunData.agent4;

    renderPanelC(rerunData.agent3);

  } catch (err) {
    alert("Rerun failed: " + err.message);
    document.getElementById("panel-c").classList.remove("hidden");
  }
}

// ── Override UI ───────────────────────────────────────────────────────────────

function toggleOverride() {
  const body = document.getElementById("override-body");
  body.classList.toggle("hidden");
}

function updateOverrideTotal() {
  const sliders = document.querySelectorAll("#override-sliders .override-slider");
  let total = 0;

  sliders.forEach(slider => {
    const val = parseInt(slider.value);
    total += val;
    const criterion = slider.dataset.criterion;
    const key = criterion.replace(/\s+/g, "-");
    const label = document.getElementById(`ov-${key}`);
    if (label) label.textContent = val + "%";
  });

  const totalEl = document.getElementById("override-total");
  const validEl = document.getElementById("override-valid");
  totalEl.textContent = total;

  const isValid = Math.abs(total - 100) < 2;
  validEl.textContent = isValid ? "✓ Valid" : "✗ Must equal 100%";
  validEl.className = isValid ? "override-ok" : "override-err";
}

// ── Navigation ────────────────────────────────────────────────────────────────

function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(`screen-${name}`).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setNavStep(num) {
  document.querySelectorAll(".step").forEach((el, i) => {
    el.classList.remove("active", "done");
    if (i + 1 === num) el.classList.add("active");
    else if (i + 1 < num) el.classList.add("done");
  });
}

function goToDecision() {
  if (!state.pipelineResult) return;
  renderDecision(state.pipelineResult);
  showScreen("decision");
  setNavStep(3);
}

function goBack() {
  showScreen("analysis");
  setNavStep(2);
}

function startOver() {
  state.pipelineResult = null;
  state.selectedCandidates = [];
  state.selectedScenario = null;
  state.jdText = "";
  document.getElementById("jd-input").value = "";
  renderCandidates([]);
  renderScenarios(null);
  showScreen("setup");
  setNavStep(1);
  checkRunReady();
}

// ── Rank expand/collapse ──────────────────────────────────────────────────────

function toggleRankDetail(nameKey) {
  const row = document.getElementById(`rank-${nameKey}`);
  row.classList.toggle("expanded");
}

// ── Decision actions ──────────────────────────────────────────────────────────

function approveDecision() {
  const note = document.getElementById("decision-note").value.trim();
  const a4 = state.pipelineResult?.agent4;

  const record = {
    timestamp: new Date().toISOString(),
    decision: "APPROVED",
    recommendedCandidate: a4?.recommendedCandidate,
    note: note || "(no note)",
    confidenceLevel: a4?.confidenceLevel
  };

  console.log("DECISION APPROVED:", record);

  const conf = document.getElementById("approval-confirmation");
  conf.classList.remove("hidden");
  conf.textContent = `✓ Decision approved and logged at ${new Date().toLocaleTimeString()}. Recommended: ${a4?.recommendedCandidate}.`;
}

function overrideDecision() {
  const note = document.getElementById("decision-note").value.trim();
  if (!note) {
    document.getElementById("decision-note").focus();
    document.getElementById("decision-note").placeholder = "Please add a note explaining the override...";
    return;
  }

  const record = {
    timestamp: new Date().toISOString(),
    decision: "OVERRIDDEN",
    note: note
  };

  console.log("DECISION OVERRIDDEN:", record);

  const conf = document.getElementById("approval-confirmation");
  conf.classList.remove("hidden");
  conf.style.background = "#fef3c7";
  conf.style.borderColor = "#fde68a";
  conf.style.color = "#d97706";
  conf.textContent = `⚠ Decision overridden and logged at ${new Date().toLocaleTimeString()}. Note recorded.`;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
