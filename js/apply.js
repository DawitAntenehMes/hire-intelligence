// js/apply.js — Handles the candidate application intake form.
// Submits CV + screening answers to POST /api/apply.
// Shows loading state while Agent 0 parses the CV, then renders the extracted profile.

(function () {
    "use strict";

    // ── Populate position dropdown from localStorage JDs ─────────────────────
    (function populatePositions() {
        try {
            const LS_JD_KEY = "hire_intelligence_jd";
            const TTL = 48 * 60 * 60 * 1000;
            const raw = localStorage.getItem(LS_JD_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);

            let jds = [];
            if (parsed.jds && Array.isArray(parsed.jds)) {
                const now = Date.now();
                jds = parsed.jds.filter(j => now - j.savedAt <= TTL);
            } else if (parsed.text) {
                // Legacy single-JD format
                jds = [{ title: parsed.title || "", savedAt: parsed.savedAt || Date.now() }];
            }

            const select = document.getElementById("position-select");
            const hint = document.getElementById("position-hint");
            if (!select) return;

            if (jds.length === 0) {
                hint.textContent = "No open positions available. Ask the hiring team to add positions first.";
                return;
            }

            jds.forEach(j => {
                if (j.title) {
                    const opt = document.createElement("option");
                    opt.value = j.title;
                    opt.textContent = j.title;
                    select.appendChild(opt);
                }
            });

            // Auto-select if only one position
            if (jds.length === 1 && jds[0].title) {
                select.value = jds[0].title;
            }

            hint.textContent = `${jds.length} open position${jds.length !== 1 ? "s" : ""} available`;

            // Update subtitle
            const subtitle = document.querySelector(".apply-header p");
            if (subtitle) {
                subtitle.textContent = "Select a position, upload your CV, and answer a few short questions.";
            }

            select.addEventListener("change", checkReady);
        } catch (_) { /* fail silently */ }
    })();

    const form = document.getElementById("apply-form");
    const submitBtn = document.getElementById("submit-btn");
    const submitHint = document.getElementById("submit-hint");
    const loadingOverlay = document.getElementById("loading-overlay");
    const errorBanner = document.getElementById("error-banner");
    const successCard = document.getElementById("success-card");
    const fileInput = document.getElementById("cv-file");
    const fileDrop = document.getElementById("file-drop");
    const fileSelected = document.getElementById("file-selected");
    const fileNameDisplay = document.getElementById("file-name-display");

    // ── File drag-and-drop ────────────────────────────────────────────────────

    fileDrop.addEventListener("dragover", (e) => {
        e.preventDefault();
        fileDrop.classList.add("drag-over");
    });

    fileDrop.addEventListener("dragleave", () => {
        fileDrop.classList.remove("drag-over");
    });

    fileDrop.addEventListener("drop", (e) => {
        e.preventDefault();
        fileDrop.classList.remove("drag-over");
        const file = e.dataTransfer.files[0];
        if (file) {
            setFile(file);
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) {
            setFile(fileInput.files[0]);
        }
    });

    function setFile(file) {
        // Replace the input's file list via DataTransfer
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        fileNameDisplay.textContent = `${file.name} (${formatBytes(file.size)})`;
        fileSelected.classList.add("visible");
        checkReady();
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    // ── Form validation ───────────────────────────────────────────────────────

    const requiredTextareas = ["why-best-suited", "biggest-achievement", "leadership-approach"];

    requiredTextareas.forEach((id) => {
        document.getElementById(id).addEventListener("input", checkReady);
    });
    document.getElementById("full-name").addEventListener("input", checkReady);

    function checkReady() {
        const hasPosition = document.getElementById("position-select").value.trim().length > 0;
        const hasFile = fileInput.files && fileInput.files.length > 0;
        const hasName = document.getElementById("full-name").value.trim().length >= 2;
        const allAnswered = requiredTextareas.every((id) => {
            return document.getElementById(id).value.trim().length >= 10;
        });

        const ready = hasPosition && hasFile && hasName && allAnswered;
        submitBtn.disabled = !ready;

        if (!hasPosition) {
            submitHint.textContent = "Select a position to continue";
        } else if (!hasFile) {
            submitHint.textContent = "Upload your CV to continue";
        } else if (!hasName) {
            submitHint.textContent = "Enter your full name to continue";
        } else if (!allAnswered) {
            submitHint.textContent = "Answer all three screening questions to continue";
        } else {
            submitHint.textContent = "Ready to submit";
        }
    }

    // ── Form submit ───────────────────────────────────────────────────────────

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await submitApplication();
    });

    async function submitApplication() {
        hideError();

        // Build FormData from the form
        const fd = new FormData(form);

        // Ensure references_available is always sent as a proper boolean string
        fd.set("references_available", document.getElementById("references-available").checked.toString());

        // Show loading
        loadingOverlay.classList.add("visible");
        submitBtn.disabled = true;

        try {
            const res = await fetch("/api/apply", {
                method: "POST",
                body: fd,
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.detail || `Server error ${res.status}`);
            }

            renderSuccess(data);

        } catch (err) {
            showError(err.message || "Something went wrong. Please try again.");
        } finally {
            loadingOverlay.classList.remove("visible");
            submitBtn.disabled = false;
        }
    }

    // ── Success rendering ─────────────────────────────────────────────────────

    function _appendToCache(profile) {
        const LS_KEY = "hire_intelligence_candidates";
        const LS_TTL_MS = 48 * 60 * 60 * 1000;
        try {
            let cached = [];
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Date.now() - parsed.savedAt <= LS_TTL_MS && Array.isArray(parsed.candidates)) {
                    cached = parsed.candidates;
                }
            }
            // Normalise snake_case API response to camelCase before caching
            const norm = {
                id: profile.id,
                name: profile.name,
                initials: profile.initials,
                avatarColor: profile.avatar_color,
                avatarText: profile.avatar_text,
                type: profile.type,
                currentRole: profile.current_role,
                yearsExperience: profile.years_experience,
                availabilityWeeks: profile.availability_weeks,
                location: profile.location,
                keySkills: profile.key_skills ?? [],
                notableAchievements: profile.notable_achievements ?? [],
                leadershipStyle: profile.leadership_style,
                languages: profile.languages ?? [],
                weaknesses: profile.weaknesses ?? [],
                education: profile.education ?? [],
                certifications: profile.certifications ?? [],
                salaryExpectation: profile.salary_expectation ?? null,
                noticePeriod: profile.notice_period ?? null,
                referencesAvailable: profile.references_available ?? false,
                appliedPosition: profile.applied_position ?? "",
                motivation: profile.motivation ? {
                    whyBestSuited: profile.motivation.why_best_suited ?? "",
                    biggestAchievement: profile.motivation.biggest_achievement ?? profile.motivation.additional_comments ?? "",
                    leadershipApproach: profile.motivation.leadership_approach ?? "",
                } : null,
                appliedToJobs: [],
            };

            // Replace if already present (re-submission), otherwise append
            const idx = cached.findIndex((c) => c.id === norm.id);
            if (idx !== -1) cached[idx] = norm; else cached.push(norm);

            // Tag which job this candidate applied for (using the position select)
            const positionTitle = norm.appliedPosition || document.getElementById("position-select")?.value || "";
            if (positionTitle) {
                const entry = cached.find(c => c.id === norm.id);
                if (entry) {
                    entry.appliedToJobs = entry.appliedToJobs || [];
                    if (!entry.appliedToJobs.includes(positionTitle)) {
                        entry.appliedToJobs.push(positionTitle);
                    }
                }
            }

            localStorage.setItem(LS_KEY, JSON.stringify({ candidates: cached, savedAt: Date.now() }));
        } catch (_) { /* fail silently */ }
    }

    function renderSuccess(profile) {
        _appendToCache(profile);
        successCard.classList.add("visible");

        const preview = document.getElementById("profile-preview");
        preview.innerHTML = `
      <div class="profile-grid">
        ${field("Name", profile.name)}
        ${field("Current Role", profile.current_role || "—")}
        ${field("Experience", profile.years_experience ? `${profile.years_experience} years` : "—")}
        ${field("Location", profile.location || "—")}
        ${field("Availability", profile.availability_weeks ? `${profile.availability_weeks} weeks` : "—")}
        ${field("Notice Period", profile.notice_period || "—")}
        ${field("Salary Expectation", profile.salary_expectation || "—")}
        ${field("References", profile.references_available ? "Available" : "Not specified")}
      </div>

      ${profile.key_skills && profile.key_skills.length ? `
        <div style="margin-bottom:12px;">
          <div class="profile-field-label" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--gray-400);margin-bottom:6px;">Key Skills</div>
          <div class="profile-tags">
            ${profile.key_skills.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}
          </div>
        </div>
      ` : ""}

      ${profile.education && profile.education.length ? `
        <div style="margin-bottom:12px;">
          <div class="profile-field-label" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--gray-400);margin-bottom:6px;">Education</div>
          ${profile.education.map((e) =>
            `<div style="font-size:13px;color:var(--gray-700);">${esc(e.degree)} — ${esc(e.university)}${e.graduation_year ? `, ${e.graduation_year}` : ""}</div>`
        ).join("")}
        </div>
      ` : ""}

      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--gray-100);display:flex;gap:12px;flex-wrap:wrap;">
        <button class="btn-primary" onclick="window.location.href='/'">
          Go to Pipeline →
        </button>
        <button class="btn-ghost" onclick="resetForm()">
          Submit another application
        </button>
      </div>
    `;

        // Scroll to success card
        successCard.scrollIntoView({ behavior: "smooth", block: "start" });

        // Hide the form sections
        document.querySelectorAll(".apply-section").forEach((el) => (el.style.display = "none"));
        document.querySelector(".submit-bar").style.display = "none";
    }

    function field(label, value) {
        return `
      <div class="profile-field">
        <div class="profile-field-label">${esc(label)}</div>
        <div class="profile-field-value">${esc(String(value))}</div>
      </div>
    `;
    }

    function esc(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    window.resetForm = function () {
        form.reset();
        fileSelected.classList.remove("visible");
        successCard.classList.remove("visible");
        document.querySelectorAll(".apply-section").forEach((el) => (el.style.display = ""));
        document.querySelector(".submit-bar").style.display = "";
        checkReady();
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // ── Error helpers ─────────────────────────────────────────────────────────

    function showError(msg) {
        errorBanner.textContent = `Error: ${msg}`;
        errorBanner.classList.add("visible");
        errorBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function hideError() {
        errorBanner.classList.remove("visible");
        errorBanner.textContent = "";
    }

    // ── Initial state ─────────────────────────────────────────────────────────
    checkReady();
})();
