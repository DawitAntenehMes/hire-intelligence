// js/app.js — Main application logic, state, navigation, event handlers

// ── Cache constants (48-hour TTL) ────────────────────────────────────────────
const LS_KEY = "hire_intelligence_candidates";
const LS_JD_KEY = "hire_intelligence_jd";
const LS_TTL_MS = 48 * 60 * 60 * 1000;

function saveToCache(candidates) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ candidates, savedAt: Date.now() }));
  } catch (_) { /* storage full or private mode — fail silently */ }
}

function loadFromCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { candidates, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > LS_TTL_MS) { localStorage.removeItem(LS_KEY); return null; }
    return Array.isArray(candidates) && candidates.length ? candidates : null;
  } catch (_) { return null; }
}

// ── JD persistence (multi-JD support) ────────────────────────────────────────

function _loadJDStore() {
  try {
    const raw = localStorage.getItem(LS_JD_KEY);
    if (!raw) return { jds: [] };
    const parsed = JSON.parse(raw);
    // Migrate legacy single-JD format → array
    if (parsed.text && !parsed.jds) {
      return { jds: [{ id: `jd_${parsed.savedAt || Date.now()}`, title: parsed.title || "", text: parsed.text, savedAt: parsed.savedAt || Date.now() }] };
    }
    return parsed;
  } catch (_) { return { jds: [] }; }
}

function _saveJDStore(store) {
  try { localStorage.setItem(LS_JD_KEY, JSON.stringify(store)); } catch (_) { /* fail silently */ }
}

function saveJD(title, text) {
  const store = _loadJDStore();
  const editId = state.editingJDId;
  if (editId) {
    const idx = store.jds.findIndex(j => j.id === editId);
    if (idx !== -1) {
      store.jds[idx] = { ...store.jds[idx], title, text, savedAt: Date.now() };
    }
    state.editingJDId = null;
  } else {
    store.jds.push({ id: `jd_${Date.now()}`, title, text, savedAt: Date.now() });
  }
  _saveJDStore(store);
}

function loadSavedJDs() {
  const store = _loadJDStore();
  const now = Date.now();
  store.jds = store.jds.filter(j => now - j.savedAt <= LS_TTL_MS);
  _saveJDStore(store);
  return store.jds;
}

function deleteJD(id) {
  if (!confirm("Delete this position? This cannot be undone.")) return;
  const store = _loadJDStore();
  store.jds = store.jds.filter(j => j.id !== id);
  _saveJDStore(store);
  // If the deleted JD was the selected position, clear selection
  if (state.selectedPosition === id) {
    state.selectedPosition = null;
    state.jdText = "";
  }
  renderJDList();
  updatePositionFilter();
  renderFilteredCandidates();
  checkRunReady();
}

function saveCurrentJD() {
  const title = document.getElementById("jd-title-input").value.trim();
  const text = document.getElementById("jd-input").value.trim();
  if (title.length < 3) {
    alert("Position title must be at least 3 characters.");
    return;
  }
  if (text.length < 50) {
    alert("Job description must be at least 50 characters.");
    return;
  }
  saveJD(title, text);
  hideJDForm();
  renderJDList();
  updatePositionFilter();
  checkRunReady();
}

function showJDForm(editId) {
  const wrap = document.getElementById("jd-form-wrap");
  const titleInput = document.getElementById("jd-title-input");
  const textInput = document.getElementById("jd-input");
  const formTitle = document.getElementById("jd-form-title");

  if (editId) {
    const jds = loadSavedJDs();
    const jd = jds.find(j => j.id === editId);
    if (jd) {
      titleInput.value = jd.title;
      textInput.value = jd.text;
      formTitle.textContent = "Edit Position";
      state.editingJDId = editId;
    }
  } else {
    titleInput.value = "";
    textInput.value = "";
    formTitle.textContent = "New Position";
    state.editingJDId = null;
  }
  wrap.style.display = "block";
  titleInput.focus();
}

function hideJDForm() {
  document.getElementById("jd-form-wrap").style.display = "none";
  state.editingJDId = null;
}

function loadDefaultJD() {
  document.getElementById("jd-title-input").value = "Director of Operations";
  document.getElementById("jd-input").value = DEFAULT_JD;
}

function selectPositionForPipeline(id) {
  const jds = loadSavedJDs();
  const jd = jds.find(j => j.id === id);
  if (!jd) return;

  if (state.selectedPosition === id) {
    // Deselect
    state.selectedPosition = null;
    state.jdText = "";
  } else {
    state.selectedPosition = id;
    state.jdText = jd.text;
  }
  renderJDList();

  // Also filter candidates by this position
  document.getElementById("position-filter-select").value = state.selectedPosition ? jd.title : "";
  state.positionFilter = state.selectedPosition ? jd.title : "";
  renderFilteredCandidates();
  checkRunReady();
}

// ── Candidate pool (fetched from backend on load) ────────────────────────────
let CANDIDATES = [];

function _normCandidate(c) {
  return {
    id: c.id,
    name: c.name,
    initials: c.initials,
    avatarColor: c.avatar_color ?? c.avatarColor,
    avatarText: c.avatar_text ?? c.avatarText,
    type: c.type,
    currentRole: c.current_role ?? c.currentRole,
    yearsExperience: c.years_experience ?? c.yearsExperience,
    availabilityWeeks: c.availability_weeks ?? c.availabilityWeeks,
    location: c.location,
    keySkills: c.key_skills ?? c.keySkills ?? [],
    notableAchievements: c.notable_achievements ?? c.notableAchievements ?? [],
    leadershipStyle: c.leadership_style ?? c.leadershipStyle,
    languages: c.languages ?? [],
    weaknesses: c.weaknesses ?? [],
    education: c.education ?? [],
    certifications: c.certifications ?? [],
    salaryExpectation: c.salary_expectation ?? c.salaryExpectation ?? null,
    noticePeriod: c.notice_period ?? c.noticePeriod ?? null,
    referencesAvailable: c.references_available ?? c.referencesAvailable ?? false,
    linkedIn: c.linked_in ?? c.linkedIn ?? null,
    appliedPosition: c.applied_position ?? c.appliedPosition ?? "",
    motivation: c.motivation ? {
      whyBestSuited: c.motivation.whyBestSuited ?? c.motivation.why_best_suited ?? "",
      biggestAchievement: c.motivation.biggestAchievement ?? c.motivation.biggest_achievement ?? c.motivation.additionalComments ?? c.motivation.additional_comments ?? "",
      leadershipApproach: c.motivation.leadershipApproach ?? c.motivation.leadership_approach ?? "",
    } : null,
    appliedToJobs: c.appliedToJobs || [],
  };
}

async function fetchCandidates() {
  // Snapshot prior cache so we can preserve appliedToJobs after a backend refresh
  const priorCache = {};
  (loadFromCache() || []).forEach(c => { priorCache[c.id] = c; });

  try {
    const res = await fetch("/api/candidates");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    CANDIDATES = data.map(c => {
      const norm = _normCandidate(c);
      // Carry over job-application tracking from the local cache
      if (priorCache[norm.id]?.appliedToJobs?.length) {
        norm.appliedToJobs = priorCache[norm.id].appliedToJobs;
      }
      // Use server-side appliedPosition as source of truth for the position tag
      if (norm.appliedPosition && !norm.appliedToJobs.includes(norm.appliedPosition)) {
        norm.appliedToJobs.push(norm.appliedPosition);
      }
      return norm;
    });
    if (CANDIDATES.length) saveToCache(CANDIDATES);
  } catch (err) {
    console.warn("Could not load candidates from API:", err.message);
    const cached = loadFromCache();
    if (cached) {
      CANDIDATES = cached;
      console.info(`Loaded ${CANDIDATES.length} candidate(s) from local cache.`);
    } else {
      CANDIDATES = [];
    }
  }
  renderFilteredCandidates();
  updatePositionFilter();
  const loadAllBtn = document.getElementById("load-all-btn");
  if (loadAllBtn) {
    loadAllBtn.textContent = CANDIDATES.length
      ? `Load all ${CANDIDATES.length}`
      : "No candidates yet";
    loadAllBtn.disabled = CANDIDATES.length === 0;
  }
  checkRunReady();
}

// ── Position filtering ────────────────────────────────────────────────────────

function getFilteredCandidates() {
  const filter = state.positionFilter;
  if (!filter) return CANDIDATES;
  return CANDIDATES.filter(c =>
    c.appliedPosition === filter || (c.appliedToJobs && c.appliedToJobs.includes(filter))
  );
}

function renderFilteredCandidates() {
  const filtered = getFilteredCandidates();
  const countEl = document.getElementById("position-filter-count");
  if (countEl) {
    countEl.textContent = state.positionFilter
      ? `${filtered.length} candidate${filtered.length !== 1 ? "s" : ""}`
      : `${CANDIDATES.length} total`;
  }
  renderCandidates(state.selectedCandidates, filtered);
}

function updatePositionFilter() {
  const select = document.getElementById("position-filter-select");
  if (!select) return;

  // Collect unique position titles from JDs and from candidates
  const jds = loadSavedJDs();
  const positions = new Set(jds.map(j => j.title));
  CANDIDATES.forEach(c => {
    if (c.appliedPosition) positions.add(c.appliedPosition);
    (c.appliedToJobs || []).forEach(j => positions.add(j));
  });

  const current = select.value;
  select.innerHTML = '<option value="">All Positions</option>' +
    [...positions].map(p => `<option value="${p}"${p === current ? " selected" : ""}>${p.length > 40 ? p.slice(0, 40) + "…" : p}</option>`).join("");
}

function onPositionFilterChange(value) {
  state.positionFilter = value;
  state.selectedCandidates = [];
  renderFilteredCandidates();
  checkRunReady();
}

// ── App State ─────────────────────────────────────────────────────────────────

const state = {
  selectedCandidates: [],
  selectedScenario: null,
  urgencyWeeks: 8,
  jdText: "",
  pipelineResult: null,
  isRunning: false,
  selectedPosition: null,  // JD id selected for pipeline
  positionFilter: "",      // position title filter for candidate list
  editingJDId: null,       // JD id being edited in the form
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  fetchCandidates();   // async — renders candidates when response arrives
  renderScenarios(null);
  updateUrgency(8);

  // Render saved JD positions
  renderJDList();

  checkRunReady();
});

// ── Setup Actions ─────────────────────────────────────────────────────────────

function loadDefaultJD() {
  document.getElementById("jd-title-input").value = "Director of Operations";
  document.getElementById("jd-input").value = DEFAULT_JD;
}

const MAX_CANDIDATES = 3;

function loadAllCandidates() {
  const filtered = getFilteredCandidates();
  if (!filtered.length) return;
  state.selectedCandidates = filtered.slice(0, MAX_CANDIDATES).map(c => c.id);
  renderFilteredCandidates();
  checkRunReady();
}

function toggleCandidate(id) {
  const i = state.selectedCandidates.indexOf(id);
  if (i === -1) {
    if (state.selectedCandidates.length >= MAX_CANDIDATES) {
      const hint = document.getElementById("candidate-limit-msg");
      if (hint) {
        hint.textContent = `Max ${MAX_CANDIDATES} candidates. Deselect one to add another.`;
        hint.style.display = "block";
        clearTimeout(hint._timer);
        hint._timer = setTimeout(() => { hint.style.display = "none"; }, 3000);
      }
      return;
    }
    state.selectedCandidates.push(id);
  } else {
    state.selectedCandidates.splice(i, 1);
  }
  renderFilteredCandidates();
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
  const positionOk = state.selectedPosition && state.jdText.length > 50;
  const candidatesOk = state.selectedCandidates.length >= 1;

  const btn = document.getElementById("run-btn");
  const status = document.getElementById("status-text");

  const missing = [];
  if (!state.selectedPosition) missing.push("select a position");
  else if (state.jdText.length <= 50) missing.push("position JD too short");
  if (!candidatesOk) missing.push("at least 1 candidate");

  if (missing.length === 0) {
    const jds = loadSavedJDs();
    const posTitle = jds.find(j => j.id === state.selectedPosition)?.title || "Position";
    const scenarioLabel = state.selectedScenario
      ? (SCENARIOS.find(s => s.id === state.selectedScenario)?.label || "Custom")
      : "No scenario";
    btn.disabled = false;
    status.textContent = `${posTitle} · ${state.selectedCandidates.length} candidate${state.selectedCandidates.length > 1 ? "s" : ""} · ${scenarioLabel} · ${state.urgencyWeeks} weeks`;
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
  } else if (state.selectedScenario) {
    scenarioObj = SCENARIOS.find(s => s.id === state.selectedScenario) || { id: state.selectedScenario, label: state.selectedScenario, description: "" };
  } else {
    scenarioObj = { id: null, label: "No scenario", description: "" };
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

    result = await callPipeline(
      state.jdText,
      candidateObjs,
      scenarioObj,
      state.urgencyWeeks
    );

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
  if (!state.pipelineResult.agent1?.adaptedCriteria?.length) {
    alert("No adapted criteria available — run the full pipeline first.");
    return;
  }

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
  state.selectedPosition = null;
  state.positionFilter = "";
  renderJDList();
  renderFilteredCandidates();
  renderScenarios(null);
  const filterSelect = document.getElementById("position-filter-select");
  if (filterSelect) filterSelect.value = "";
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

// ── Candidate Profile Modal ───────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function _pmField(label, value) {
  if (!value && value !== 0) return "";
  return `<div class="pm-field"><div class="pm-field-label">${_esc(label)}</div><div class="pm-field-value">${_esc(value)}</div></div>`;
}

function openProfileModal(id) {
  const c = CANDIDATES.find(x => x.id === id);
  if (!c) return;

  document.getElementById("profile-modal-title").textContent = c.name || "Candidate Profile";

  const m = c.motivation || {};
  const whyBestSuited = m.whyBestSuited || m.why_best_suited || "";
  const biggestAchievement = m.biggestAchievement || m.biggest_achievement || m.additionalComments || m.additional_comments || "";
  const leadershipApproach = m.leadershipApproach || m.leadership_approach || "";

  const body = document.getElementById("profile-modal-body");
  body.innerHTML = `
    <div class="pm-avatar-row">
      <div class="pm-avatar" style="background:${c.avatarColor};color:${c.avatarText};">${_esc(c.initials)}</div>
      <div>
        <div class="pm-name">${_esc(c.name)}</div>
        <div class="pm-role">${_esc(c.currentRole)}</div>
      </div>
      <span class="tag ${c.type}" style="margin-left:auto;">${_esc(c.type)}</span>
    </div>

    <!-- ── SECTION 1: Overview ─────────────────────────────────────── -->
    <div class="pm-section">
      <div class="pm-section-label">Overview</div>
      <div class="pm-grid">
        ${_pmField("Experience", c.yearsExperience ? `${c.yearsExperience} years` : null)}
        ${_pmField("Availability", c.availabilityWeeks ? `${c.availabilityWeeks} weeks` : null)}
        ${_pmField("Location", c.location)}
        ${_pmField("Notice Period", c.noticePeriod)}
        ${_pmField("Salary Expectation", c.salaryExpectation)}
        ${_pmField("References", c.referencesAvailable ? "Available" : "Not specified")}
        ${c.linkedIn ? _pmField("LinkedIn", c.linkedIn) : ""}
      </div>
    </div>

    <!-- ── SECTION 2: Screening Answers ───────────────────────────── -->
    ${(whyBestSuited || biggestAchievement || leadershipApproach) ? `
    <div class="pm-section pm-section-screening">
      <div class="pm-section-label">Screening Answers</div>
      ${whyBestSuited ? `
        <div class="pm-qa">
          <div class="pm-q">Why are you best suited for this role?</div>
          <div class="pm-a">"${_esc(whyBestSuited)}"</div>
        </div>` : ""}
      ${biggestAchievement ? `
        <div class="pm-qa">
          <div class="pm-q">Biggest relevant achievement?</div>
          <div class="pm-a">"${_esc(biggestAchievement)}"</div>
        </div>` : ""}
      ${leadershipApproach ? `
        <div class="pm-qa">
          <div class="pm-q">Leadership approach?</div>
          <div class="pm-a">"${_esc(leadershipApproach)}"</div>
        </div>` : ""}
    </div>` : ""}

    <!-- ── SECTION 3: Pipeline Agent Input ────────────────────────── -->
    <div class="pm-section pm-section-pipeline">
      <div class="pm-section-label pm-section-label-pipeline">
        Pipeline Agent Input
        <span class="pm-section-label-sub">Data sent to agents 1–4</span>
      </div>

      ${c.keySkills && c.keySkills.length ? `
      <div class="pm-subsection">
        <div class="pm-subsection-label">Key Skills</div>
        <div class="pm-tags">${c.keySkills.map(s => `<span class="pm-tag">${_esc(s)}</span>`).join("")}</div>
      </div>` : ""}

      ${c.notableAchievements && c.notableAchievements.length ? `
      <div class="pm-subsection">
        <div class="pm-subsection-label">Notable Achievements</div>
        <ul class="pm-list">${c.notableAchievements.map(a => `<li>${_esc(a)}</li>`).join("")}</ul>
      </div>` : ""}

      ${c.leadershipStyle ? `
      <div class="pm-subsection">
        <div class="pm-subsection-label">Leadership Style</div>
        <div class="pm-text">${_esc(c.leadershipStyle)}</div>
      </div>` : ""}

      ${c.weaknesses && c.weaknesses.length ? `
      <div class="pm-subsection">
        <div class="pm-subsection-label">Development Areas / Gaps</div>
        <ul class="pm-list">${c.weaknesses.map(w => `<li>${_esc(w)}</li>`).join("")}</ul>
      </div>` : ""}

      ${c.languages && c.languages.length ? `
      <div class="pm-subsection">
        <div class="pm-subsection-label">Languages</div>
        <div class="pm-tags">${c.languages.map(l => `<span class="pm-tag">${_esc(l)}</span>`).join("")}</div>
      </div>` : ""}

      ${c.education && c.education.length ? `
      <div class="pm-subsection">
        <div class="pm-subsection-label">Education</div>
        ${c.education.map(e => `<div class="pm-text">${_esc(e.degree || "")} — ${_esc(e.university || "")}${(e.graduation_year || e.graduationYear) ? `, ${e.graduation_year || e.graduationYear}` : ""}</div>`).join("")}
      </div>` : ""}

      ${c.certifications && c.certifications.length ? `
      <div class="pm-subsection">
        <div class="pm-subsection-label">Certifications</div>
        <div class="pm-tags">${c.certifications.map(cert => `<span class="pm-tag">${_esc(cert)}</span>`).join("")}</div>
      </div>` : ""}

      <div class="pm-subsection">
        <div class="pm-subsection-label">Availability &amp; Type</div>
        <div class="pm-grid">
          ${_pmField("Available in", `${c.availabilityWeeks || "?"} weeks`)}
          ${_pmField("Type", c.type)}
        </div>
      </div>
    </div>
  `;

  document.getElementById("profile-modal").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeProfileModal() {
  document.getElementById("profile-modal").classList.remove("open");
  document.body.style.overflow = "";
}
