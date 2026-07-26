// Admin AI Auto-Scheduling UI — one strand at a time
const AutoScheduleApp = (() => {
  let config = null;
  let lastResult = null;
  let strandProgress = {};
  let progressLog = [];
  let wizardStep = 1;
  let selectedTrack = 'Academic';
  let schedulingContext = null;
  let wizardFormData = {};
  let contextLoading = false;
  let cooldownTimerId = null;
  let cooldownUntil = 0;
  let generationState = {
    strands: [],
    currentIndex: 0,
    accumulated: [],
    notes: [],
    finalSource: 'groq_ai',
    started: false,
    allComplete: false,
  };

  const STRAND_CLASS = {
    STEM: 'stem', ABM: 'abm', HUMSS: 'humss', GAS: 'gas',
    ICT: 'ict', COOKERY: 'cookery', EIM: 'eim',
  };

  const WIZARD_STEPS = [
    'Select Track',
    'Select Strands',
    'Collect Data',
    'Generate Schedule',
  ];

  async function loadConfig() {
    const res = await AdminApp.fetchJson('/api/scheduling/config');
    config = res.data;
    return config;
  }

  function esc(str) {
    return AdminApp.escHtml ? AdminApp.escHtml(str) : String(str ?? '');
  }

  function formatSource(source) {
    const labels = {
      groq_ai: 'Groq AI',
      openrouter_ai: 'OpenRouter AI',
      gemini_ai: 'Google Gemini',
      smart_ai_fallback: 'Rule-based Scheduler',
    };
    return labels[source] || source;
  }

  function strandClass(strand) {
    return STRAND_CLASS[String(strand || '').toUpperCase()] || 'stem';
  }

  function renderAiStatus() {
    if (config?.ai_model_ready) {
      const rate = config.rate_limit || {};
      const fallbacks = (config.fallback_providers || []).join(', ') || 'none';
      return `
        <div class="auto-sched-status ok">
          ✓ Cloud AI ready — ${esc(config.ai_provider_label)} (${esc(config.ai_model)})
          <span class="auto-sched-status-sub">
            Rate-limit safe: ${rate.subject_chunk_size || 3} subjects/chunk,
            ${rate.section_delay_sec || 8}s delay, ${rate.max_retries || 8} retries.
            Fallbacks: ${esc(fallbacks)}
          </span>
        </div>`;
    }
    return `
      <div class="auto-sched-status warn">
        ⚠ Add <strong>OPENROUTER_API_KEY</strong> to .env for cloud AI.
      </div>`;
  }

  function strandsForTrack(track) {
    return config?.tracks?.[track]?.strands || [];
  }

  function renderWizardNav() {
    return `
      <div class="auto-sched-wizard">
        ${WIZARD_STEPS.map((label, i) => {
          const num = i + 1;
          const cls = num === wizardStep ? 'active' : num < wizardStep ? 'done' : '';
          return `
            <div class="auto-sched-wizard-step ${cls}">
              <span class="wiz-num">${num < wizardStep ? '✓' : num}</span>
              <span class="wiz-label">${esc(label)}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  function getSelectedStrands(form) {
    if (wizardFormData.strands?.length) return [wizardFormData.strands[0]];
    const radio = form?.querySelector('input[name="strand"]:checked');
    if (radio?.value) return [radio.value];
    const checked = [...(form?.querySelectorAll('input[name="strand"]:checked') || [])].map(el => el.value);
    if (checked.length) return [checked[0]];
    return [];
  }

  function showBanner(message, type = 'error') {
    const existing = document.getElementById('autoSchedBanner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'autoSchedBanner';
    banner.className = `auto-sched-banner ${type}`;
    banner.innerHTML = `
      <span>${esc(message)}</span>
      <button type="button" aria-label="Dismiss">&times;</button>
    `;
    banner.querySelector('button').addEventListener('click', () => banner.remove());
    const panel = document.querySelector('.auto-sched-panel');
    panel?.prepend(banner);
  }

  function renderStep4Summary() {
    const strands = wizardFormData.strands || [];
    const trackLabel = config?.tracks?.[selectedTrack]?.label || selectedTrack;
    return `
      <div class="auto-sched-review">
        <h4>Your selections</h4>
        <div class="auto-sched-review-grid">
          <div class="review-item">
            <span class="review-label">Track</span>
            <span class="review-value">${esc(trackLabel)}</span>
          </div>
          <div class="review-item">
            <span class="review-label">Strand</span>
            <span class="review-value review-strands">
              ${strands.slice(0, 1).map(s => `<span class="strand-badge ${strandClass(s)}">${esc(s)}</span>`).join('') || '—'}
            </span>
          </div>
          <div class="review-item">
            <span class="review-label">Grade / Sem</span>
            <span class="review-value">${esc(wizardFormData.gradeLevel || 'Grade 12')} · ${esc(wizardFormData.semesterCode || '1st')} sem</span>
          </div>
          <div class="review-item">
            <span class="review-label">Sections</span>
            <span class="review-value">${wizardFormData.sectionsPerStrand === '1' ? '1 (A only)' : '2 (A & B)'}</span>
          </div>
        </div>
      </div>`;
  }

  function renderSchedulingDataPanel(compact = false) {
    if (contextLoading) {
      return `
        <div class="auto-sched-data-panel loading">
          <div class="auto-sched-loading-inline">
            <div class="auto-sched-loading-spinner"></div>
            <p>Collecting teacher, room, lab, and student load data...</p>
          </div>
        </div>`;
    }

    if (!schedulingContext) {
      return `
        <div class="auto-sched-data-panel empty">
          <div class="auto-sched-data-checklist">
            <p class="auto-sched-data-lead">The system will gather:</p>
            <ul>
              <li>Teacher Availability</li>
              <li>Classroom Availability</li>
              <li>Laboratory Availability</li>
              <li>Student Load</li>
              <li>Time Constraints</li>
            </ul>
          </div>
          <button type="button" class="admin-btn secondary" id="loadContextBtn">Load Scheduling Data</button>
        </div>`;
    }

    const teachers = schedulingContext.teacher_availability || [];
    const classrooms = schedulingContext.classroom_availability || [];
    const labs = schedulingContext.laboratory_availability || [];
    const loadByStrand = schedulingContext.student_load?.by_strand || {};
    const totalStudents = schedulingContext.student_load?.total_students || 0;
    const time = schedulingContext.time_constraints || {};
    const loadText = Object.entries(loadByStrand)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ') || 'None yet';

    return `
      <div class="auto-sched-data-panel ${compact ? 'compact' : ''}">
        <div class="auto-sched-data-header">
          <div>
            <h4>AI Collects Scheduling Data</h4>
            <p class="auto-sched-data-sub">Ready — data loaded from your database.</p>
          </div>
          ${!compact ? '<button type="button" class="admin-btn secondary" id="loadContextBtn">Refresh Data</button>' : ''}
        </div>
        <ul class="auto-sched-data-checklist done">
          <li>Teacher Availability</li>
          <li>Classroom Availability</li>
          <li>Laboratory Availability</li>
          <li>Student Load</li>
          <li>Time Constraints</li>
        </ul>
        <div class="auto-sched-data-grid">
          <article class="data-card">
            <span class="data-card-icon teachers">👩‍🏫</span>
            <h5>Teachers</h5>
            <p class="data-card-stat">${teachers.length} available</p>
            ${compact ? '' : `<ul class="data-card-list">${teachers.slice(0, 5).map(t =>
              `<li>${esc(t.name)} <span class="muted">${esc((t.strands || []).join(', ') || t.department || '')}</span></li>`,
            ).join('')}${teachers.length > 5 ? `<li class="muted">+${teachers.length - 5} more</li>` : ''}</ul>`}
          </article>
          <article class="data-card">
            <span class="data-card-icon rooms">🏫</span>
            <h5>Classrooms</h5>
            <p class="data-card-stat">${classrooms.length} rooms</p>
            <p class="data-card-detail">${esc(classrooms.join(', ') || 'None')}</p>
          </article>
          <article class="data-card">
            <span class="data-card-icon labs">🔬</span>
            <h5>Laboratories</h5>
            <p class="data-card-stat">${labs.length} labs</p>
            <p class="data-card-detail">${esc(labs.join(', ') || 'None')}</p>
          </article>
          <article class="data-card">
            <span class="data-card-icon students">👥</span>
            <h5>Student Load</h5>
            <p class="data-card-stat">${totalStudents} total</p>
            <p class="data-card-detail">${esc(loadText)}</p>
          </article>
          <article class="data-card">
            <span class="data-card-icon time">🕐</span>
            <h5>Time Constraints</h5>
            <p class="data-card-stat">${esc(time.hours || '8am–5pm')}</p>
            <p class="data-card-detail">${esc((time.days || ['Mon–Fri']).join(', '))}</p>
          </article>
        </div>
      </div>`;
  }

  function renderContextPreview() {
    return renderSchedulingDataPanel(false);
  }

  async function refreshSchedulingContext(form) {
    if (contextLoading) return;
    contextLoading = true;
    schedulingContext = null;
    rerenderForm();
    try {
      const data = new FormData(form);
      wizardFormData = {
        ...wizardFormData,
        gradeLevel: data.get('gradeLevel') || wizardFormData.gradeLevel,
        semesterCode: data.get('semesterCode') || wizardFormData.semesterCode,
        sectionsPerStrand: data.get('sectionsPerStrand') || wizardFormData.sectionsPerStrand,
        rooms: data.get('rooms') || wizardFormData.rooms,
        strands: wizardFormData.strands?.length ? wizardFormData.strands : getSelectedStrands(form),
      };
      await loadSchedulingContext(form);
      const allRooms = [
        ...(schedulingContext?.classroom_availability || []),
        ...(schedulingContext?.laboratory_availability || []),
      ];
      if (allRooms.length) {
        wizardFormData.rooms = allRooms.join(', ');
      }
    } catch (err) {
      showBanner(err.message || 'Could not load scheduling data.');
    } finally {
      contextLoading = false;
      rerenderForm();
    }
  }

  async function loadSchedulingContext(form) {
    const data = new FormData(form);
    const strands = getSelectedStrands(form);
    const params = new URLSearchParams({
      gradeLevel: data.get('gradeLevel'),
      semesterCode: data.get('semesterCode'),
      strands: strands.join(','),
      rooms: data.get('rooms') || '',
    });
    const res = await AdminApp.fetchJson(`/api/scheduling/context?${params}`);
    schedulingContext = res.data;
    return schedulingContext;
  }

  function renderForm() {
    const rooms = (config?.rooms || []).join(', ');
    const trackStrands = strandsForTrack(selectedTrack);
    const pickedOne = wizardFormData.strands?.length ? wizardFormData.strands[0] : (trackStrands[0] || '');
    const strandChips = trackStrands.map(code => {
      const checked = code === pickedOne ? 'checked' : '';
    return `
      <label class="auto-sched-chip ${strandClass(code)}">
        <input type="radio" name="strand" value="${esc(code)}" ${checked}> ${esc(code)}
      </label>`;
    }).join('');

    let stepBody = '';
    if (wizardStep === 1) {
      stepBody = `
        <h3 class="auto-sched-panel-title">Step 1 — Select Track / Specialization</h3>
        <div class="auto-sched-track-grid">
          <label class="auto-sched-track-card ${selectedTrack === 'Academic' ? 'selected' : ''}">
            <input type="radio" name="track" value="Academic" ${selectedTrack === 'Academic' ? 'checked' : ''}>
            <strong>Academic</strong>
            <span>STEM, ABM, HUMSS, GAS</span>
          </label>
          <label class="auto-sched-track-card ${selectedTrack === 'TechPro' ? 'selected' : ''}">
            <input type="radio" name="track" value="TechPro" ${selectedTrack === 'TechPro' ? 'checked' : ''}>
            <strong>Technical-Professional (TechPro)</strong>
            <span>ICT, Cookery, EIM</span>
          </label>
        </div>`;
    } else if (wizardStep === 2) {
      stepBody = `
        <h3 class="auto-sched-panel-title">Step 2 — Select One Strand</h3>
        <p class="auto-sched-hint">${esc(config?.tracks?.[selectedTrack]?.label || selectedTrack)} — pick <strong>one strand only</strong> per run. Schedule other strands in a separate run after saving.</p>
        <div class="auto-sched-strands auto-sched-strands-single">${strandChips || '<p>No strands for this track.</p>'}</div>`;
    } else if (wizardStep === 3) {
      stepBody = `
        <h3 class="auto-sched-panel-title">Step 3 — AI Collects Scheduling Data</h3>
        <p class="auto-sched-hint">Set grade, semester, and rooms. Teacher, classroom, lab, student load, and time data load automatically below.</p>
          <div class="auto-sched-grid">
            <label>Grade Level
              <select name="gradeLevel" class="admin-input">
              <option value="Grade 11" ${wizardFormData.gradeLevel === 'Grade 11' ? 'selected' : ''}>Grade 11</option>
              <option value="Grade 12" ${!wizardFormData.gradeLevel || wizardFormData.gradeLevel === 'Grade 12' ? 'selected' : ''}>Grade 12</option>
              </select>
            </label>
            <label>Semester
              <select name="semesterCode" class="admin-input">
              <option value="1st" ${!wizardFormData.semesterCode || wizardFormData.semesterCode === '1st' ? 'selected' : ''}>1st Semester</option>
              <option value="2nd" ${wizardFormData.semesterCode === '2nd' ? 'selected' : ''}>2nd Semester</option>
              </select>
            </label>
            <label>Sections per Strand
              <select name="sectionsPerStrand" class="admin-input">
              <option value="2" ${wizardFormData.sectionsPerStrand !== '1' ? 'selected' : ''}>2 (A &amp; B)</option>
              <option value="1" ${wizardFormData.sectionsPerStrand === '1' ? 'selected' : ''}>1 (A only)</option>
              </select>
            </label>
          </div>
        <label class="auto-sched-block">Rooms (classrooms + labs, comma-separated)
          <input type="text" name="rooms" class="admin-input" value="${esc(wizardFormData.rooms || rooms)}">
        </label>
        ${renderContextPreview()}
        ${(wizardFormData.strands || []).slice(0, 1).map(s => `<input type="hidden" name="strand" value="${esc(s)}">`).join('')}`;
    } else {
      stepBody = `
        <h3 class="auto-sched-panel-title">Step 4 — Generate, Validate &amp; Publish</h3>
        ${renderStep4Summary()}
        ${renderSchedulingDataPanel(true)}
        <div class="auto-sched-options">
        <label class="auto-sched-check">
          <input type="checkbox" name="useAi" checked> Use free cloud AI (OpenRouter → Groq → Gemini)
          </label>
          <label class="auto-sched-check">
          <input type="checkbox" name="allowLocalFallback" checked>
          Fast rule-based scheduler first (recommended). If cloud AI conflicts, auto-switches to rule-based.
          </label>
        </div>
        <p class="auto-sched-hint">One strand per run. Classes spread 8am–5pm across ${esc(String((config?.rooms || []).length || 15))} rooms to avoid conflicts with other strands.</p>`;
    }

    return `
      <div class="auto-sched-page">
        <section class="auto-sched-hero">
          <h2>AI Auto-Scheduling</h2>
          <p>Follow the workflow: Track → Strands → Collect Data → Generate → Save → Publish</p>
          ${renderAiStatus()}
        </section>
        <section class="auto-sched-panel">
          ${renderWizardNav()}
          <form id="autoSchedForm" class="auto-sched-form">
            ${wizardStep >= 2 ? `<input type="hidden" name="track" value="${esc(selectedTrack)}">` : ''}
            ${wizardStep === 4 ? `
              <input type="hidden" name="gradeLevel" value="${esc(wizardFormData.gradeLevel || 'Grade 12')}">
              <input type="hidden" name="semesterCode" value="${esc(wizardFormData.semesterCode || '1st')}">
              <input type="hidden" name="sectionsPerStrand" value="${esc(wizardFormData.sectionsPerStrand || '2')}">
              <input type="hidden" name="rooms" value="${esc(wizardFormData.rooms || rooms)}">
              ${(wizardFormData.strands || []).map(s => `<input type="hidden" name="strand" value="${esc(s)}">`).join('')}
            ` : ''}
            ${stepBody}
          <div class="auto-sched-actions">
              <div class="auto-sched-actions-left">
                ${wizardStep > 1 ? '<button type="button" class="admin-btn secondary auto-sched-back-btn" id="wizardBackBtn">← Back</button>' : ''}
              </div>
              <div class="auto-sched-actions-right">
              ${wizardStep < 4 ? '<button type="button" class="admin-btn primary" id="wizardNextBtn">Next →</button>' : `
                <div id="cooldownBanner" class="auto-sched-cooldown" hidden></div>
                <button type="submit" class="admin-btn primary" id="generateBtn">${esc(getGenerateButtonLabel())}</button>
                <button type="button" class="admin-btn secondary" id="resetGenBtn" style="display:none">Reset Progress</button>
            <button type="button" class="admin-btn secondary" id="validateBtn" disabled>Re-validate</button>
                <button type="button" class="admin-btn success" id="savePublishBtn" disabled>Save &amp; Publish Schedule</button>
              `}
              </div>
          </div>
        </form>
        </section>
      </div>`;
  }

  function renderNotes(notes) {
    if (!notes?.length) return '';
    return `
      <ul class="auto-sched-notes">
        ${notes.map(note => `<li>${esc(note)}</li>`).join('')}
      </ul>
    `;
  }

  function shortenNote(text) {
    if (!text) return '';
    if (text.includes('rate limit')) return 'Rate limit hit — retrying with backoff / next cloud provider';
    if (text.includes('local scheduler') || text.includes('rule-based')) return text.split(':').pop()?.trim() || text;
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  function appendProgress(entries) {
    if (!entries?.length) return;
    progressLog.push(...entries);
    if (progressLog.length > 80) progressLog = progressLog.slice(-80);
  }

  function renderProgressLog() {
    if (!progressLog.length) return '';
    return `
      <div class="auto-sched-log">
        <strong>Live progress</strong>
        <ul>
          ${progressLog.slice(-20).map(entry => `
            <li class="log-${esc(entry.level || 'info')}">${esc(entry.message)}</li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  function renderProgressSteps(strands, currentIndex) {
    return `
      <div class="auto-sched-steps">
        ${strands.map((strand, index) => {
          const state = strandProgress[strand] || {};
          let statusClass = 'pending';
          let statusText = 'Waiting';
          if (state.status === 'processing') { statusClass = 'processing'; statusText = 'Generating...'; }
          if (state.status === 'done') { statusClass = 'done'; statusText = `Done (${state.count || 0})`; }
          if (state.status === 'failed') { statusClass = 'failed'; statusText = 'Failed'; }
          if (index === currentIndex && state.status === 'pending' && generationState.started) {
            statusClass = 'ready';
            statusText = 'Ready — press button';
          }
          if (index === currentIndex && state.status === 'processing') statusClass = 'processing';
      return `
            <div class="auto-sched-step ${statusClass} ${strandClass(strand)}">
              <div class="step-dot">${state.status === 'done' ? '✓' : index + 1}</div>
              <div class="step-label">${esc(strand)}</div>
              <div class="step-status">${esc(statusText)}</div>
            </div>
          `;
        }).join('')}
        </div>
      `;
    }

  function renderStrandRestPrompt(completedStrand, nextStrand, completedCount, cooldownRemaining) {
    if (!nextStrand) return '';
    const cooldownHtml = cooldownRemaining > 0
      ? `<p class="auto-sched-cooldown-inline">Cloud AI cooldown: <strong>${formatElapsed(cooldownRemaining)}</strong> remaining before next strand.</p>`
      : '<p>Cloud AI is ready — you can generate the next strand now.</p>';
    return `
      <div class="auto-sched-rest-card">
        <div class="auto-sched-rest-icon">✓</div>
        <div class="auto-sched-rest-body">
          <strong>${esc(completedStrand)} complete</strong> — ${completedCount} schedule entries added.
          ${cooldownHtml}
        </div>
      </div>
    `;
  }

  function renderStrandSummary(schedules) {
    const counts = {};
    (schedules || []).forEach(item => {
      const key = (item.strand || 'UNKNOWN').toUpperCase();
      counts[key] = (counts[key] || 0) + 1;
    });
    const strands = Object.keys(counts).sort();
    if (!strands.length) return '';

    return `
      <div class="auto-sched-summary">
        ${strands.map(strand => `
          <div class="auto-sched-summary-card ${strandClass(strand)}">
            <div class="count">${counts[strand]}</div>
            <div class="label">${esc(strand)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderTableRows(schedules, highlightStrand, { showSection = true } = {}) {
    return (schedules || []).map(item => {
      const highlight = highlightStrand && item.strand === highlightStrand ? ' auto-sched-row-new' : '';
      const sessions = (item.sessions || []).map(session => `
        <span class="session-pill">${esc(session.day)} ${esc(session.start)}-${esc(session.end)} @ ${esc(session.room)}</span>
      `).join('');
      return `
        <tr class="${highlight}">
          <td><span class="strand-badge ${strandClass(item.strand)}">${esc(item.strand)}</span></td>
          ${showSection ? `<td><span class="section-badge">${esc(item.section)}</span></td>` : ''}
          <td><strong>${esc(item.subject_code)}</strong></td>
          <td>${esc(item.subject_name)}</td>
          <td>${esc(item.faculty_name || item.faculty_id || 'TBA')}</td>
          <td>${sessions}</td>
          <td><span class="schedule-label">${esc(item.schedule_label)}</span></td>
        </tr>
      `;
    }).join('');
  }

  function schedulesForSection(schedules, section) {
    return (schedules || []).filter(item => String(item.section || '').toUpperCase() === section);
  }

  function renderSectionTable(section, schedules, highlightStrand) {
    const rows = schedulesForSection(schedules, section);
    const sectionLabel = section === 'A' ? 'Section A' : 'Section B';
    return `
      <div class="auto-sched-section-block">
        <h4 class="auto-sched-section-title">${sectionLabel} <span class="auto-sched-section-count">${rows.length} subject${rows.length === 1 ? '' : 's'}</span></h4>
        ${rows.length ? `
          <div class="auto-sched-table-wrap">
            <table class="auto-sched-table">
              <thead>
                <tr>
                  <th>Strand</th><th>Code</th><th>Subject</th><th>Professor</th><th>Sessions</th><th>Label</th>
                </tr>
              </thead>
              <tbody>${renderTableRows(rows, highlightStrand, { showSection: false })}</tbody>
            </table>
          </div>
        ` : `<p class="auto-sched-section-empty">No schedule entries for ${sectionLabel}.</p>`}
      </div>
    `;
  }

  function renderScheduleTables(schedules, highlightStrand) {
    return `
      <div class="auto-sched-sections">
        ${renderSectionTable('A', schedules, highlightStrand)}
        ${renderSectionTable('B', schedules, highlightStrand)}
      </div>
    `;
  }

  function renderResults(result, strands, currentIndex, highlightStrand, restPrompt) {
    if (!result && strands?.length) {
      return `
        <section class="auto-sched-panel">
          <h3 class="auto-sched-panel-title">Generation Progress</h3>
          ${renderProgressSteps(strands, currentIndex)}
          ${renderProgressLog()}
          <div class="auto-sched-loading-inline">
            <div class="auto-sched-loading-spinner"></div>
            <p>Processing <strong>${esc(strands[currentIndex] || '')}</strong>... please wait.</p>
          </div>
        </section>
      `;
    }

    if (!result?.success) {
      return `
        <section class="auto-sched-panel error-card">
          <h3>Generation Failed</h3>
          <p>${esc(result?.error || 'Unknown error')}</p>
          ${result?.ai_error ? `<p class="muted">${esc(result.ai_error)}</p>` : ''}
        </section>
      `;
    }

    const conflicts = result.validation?.conflicts || [];
    return `
      <section class="auto-sched-panel">
        <div class="auto-sched-result-head">
          <h3>Generated Schedule (${result.count} entries)</h3>
          <span class="admin-badge ${result.validation?.valid ? 'approved' : 'rejected'}">
            ${result.validation?.valid ? 'Zero Conflicts' : 'Has Conflicts'}
          </span>
          <span class="admin-badge pending">Source: ${esc(formatSource(result.source))}</span>
        </div>

        ${strands?.length ? renderProgressSteps(strands, currentIndex) : ''}
        ${restPrompt || ''}
        ${renderProgressLog()}
        ${renderStrandSummary(result.schedules)}
        ${result.ai_error ? renderNotes(
          String(result.ai_error).split(' | ').map(shortenNote).filter(Boolean),
        ) : ''}

        ${conflicts.length ? `
          <div class="auto-sched-conflicts">
            <strong>${conflicts.length} conflict(s)</strong>
            <ul>${conflicts.slice(0, 15).map(c => `<li>${esc(c.message)}</li>`).join('')}</ul>
            ${conflicts.length > 15 ? `<p class="muted">…and ${conflicts.length - 15} more</p>` : ''}
          </div>
        ` : ''}

        ${renderScheduleTables(result.schedules, highlightStrand)}
      </section>
    `;
  }

  function bindWizard(form) {
    form.querySelectorAll('input[name="strand"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) wizardFormData.strands = [radio.value];
      });
    });
    form.querySelectorAll('input[name="track"]').forEach(radio => {
      radio.addEventListener('change', () => {
        selectedTrack = radio.value;
        rerenderForm();
      });
    });
    const nextBtn = document.getElementById('wizardNextBtn');
    const backBtn = document.getElementById('wizardBackBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', async () => {
        if (wizardStep === 1) {
          const picked = form.querySelector('input[name="track"]:checked');
          const newTrack = picked?.value || 'Academic';
          if (newTrack !== selectedTrack) wizardFormData.strands = [];
          selectedTrack = newTrack;
        }
        if (wizardStep === 2) {
          const picked = getSelectedStrands(form);
          if (picked.length !== 1) { showBanner('Please select exactly one strand to continue.'); return; }
          wizardFormData.strands = picked;
        }
        if (wizardStep === 3) {
          const data = new FormData(form);
          const nextFormData = {
            ...wizardFormData,
            gradeLevel: data.get('gradeLevel'),
            semesterCode: data.get('semesterCode'),
            sectionsPerStrand: data.get('sectionsPerStrand'),
            rooms: data.get('rooms'),
            strands: wizardFormData.strands?.length ? wizardFormData.strands : getSelectedStrands(form),
          };
          const settingsChanged = nextFormData.gradeLevel !== wizardFormData.gradeLevel
            || nextFormData.semesterCode !== wizardFormData.semesterCode
            || nextFormData.rooms !== wizardFormData.rooms;
          wizardFormData = nextFormData;
          if (!wizardFormData.strands?.length) {
            showBanner('No strands selected. Go back to Step 2 and pick at least one.');
            return;
          }
          if (!schedulingContext || settingsChanged) {
            await refreshSchedulingContext(form);
            if (!schedulingContext) return;
          }
        }
        wizardStep += 1;
        if (wizardStep === 4) {
          const picked = wizardFormData.strands?.length
            ? wizardFormData.strands
            : getSelectedStrands(form);
          resetGenerationState(picked);
        }
        rerenderForm();
      });
    }
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (wizardStep === 4) {
          resetGenerationState(getSelectedStrands(form) || []);
        }
        wizardStep = Math.max(1, wizardStep - 1);
        rerenderForm();
      });
    }
  }

  function rerenderForm() {
    const wrap = document.querySelector('.auto-sched-page')?.parentElement;
    if (!wrap) return;
    const results = document.getElementById('resultsWrap')?.innerHTML || '';
    wrap.innerHTML = `${renderForm()}<div id="resultsWrap">${results}</div>`;
    bindForm(document.getElementById('autoSchedForm'));
  }

  function setSavePublishEnabled(enabled) {
    const btn = document.getElementById('savePublishBtn');
    if (btn) btn.disabled = !enabled;
  }

  function bindForm(form) {
    if (!form) return;
    bindWizard(form);
    form.addEventListener('submit', e => { e.preventDefault(); generate(form); });
    const loadBtn = document.getElementById('loadContextBtn');
    if (loadBtn) loadBtn.addEventListener('click', () => refreshSchedulingContext(form));
    const validateBtn = document.getElementById('validateBtn');
    const savePublishBtn = document.getElementById('savePublishBtn');
    const resetBtn = document.getElementById('resetGenBtn');
    if (validateBtn) validateBtn.addEventListener('click', validateAgain);
    if (savePublishBtn) savePublishBtn.addEventListener('click', () => saveAndPublishSchedule(form));
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const confirmed = await AdminApp.confirmDialog({
          title: 'Reset Generation?',
          message: 'Clear all generated schedules and start over? Unsaved progress will be lost.',
          confirmLabel: 'Reset',
          cancelLabel: 'Keep',
          variant: 'reject',
          icon: 'fa-rotate-left',
        });
        if (!confirmed) return;
        clearCooldownTimer();
        const strands = getSelectedStrands(form);
        resetGenerationState(strands);
        lastResult = null;
        document.getElementById('resultsWrap').innerHTML = '';
        document.getElementById('validateBtn').disabled = true;
        setSavePublishEnabled(false);
        updateGenerateControls(form);
        showBanner('Generation progress reset.', 'success');
      });
    }

    if (wizardStep === 4) {
      updateGenerateControls(form);
      resumeCooldownTimer(form);
    }

    if (wizardStep === 3 && !schedulingContext && !contextLoading) {
      refreshSchedulingContext(form);
    }
  }

  async function saveAndPublishSchedule(form) {
    if (!lastResult?.schedules?.length) return;

    const data = new FormData(form);
    const strand = (wizardFormData.strands || getSelectedStrands(form))[0];
    const gradeLevel = data.get('gradeLevel') || 'Grade 12';
    const semesterCode = data.get('semesterCode') || '1st';
    const semesterLabel = semesterCode === '2nd' ? '2nd Semester' : '1st Semester';
    const toSave = strand
      ? lastResult.schedules.filter(item => (item.strand || '').toUpperCase() === strand.toUpperCase())
      : lastResult.schedules;

    if (!toSave.length) {
      showBanner('No schedule entries to save for the selected strand.');
      return;
    }

    const confirmed = await AdminApp.confirmDialog({
      title: 'Save & Publish Schedule?',
      detail: strand ? `${strand} · ${gradeLevel} · ${semesterLabel}` : `${gradeLevel} · ${semesterLabel}`,
      message: 'This saves the schedule to the database and publishes it so students, teachers, and the registrar can view it.',
      confirmLabel: 'Save & Publish',
      cancelLabel: 'Cancel',
      variant: 'info',
      icon: 'fa-cloud-arrow-up',
    });
    if (!confirmed) return;

    const btn = document.getElementById('savePublishBtn');
    const defaultLabel = 'Save & Publish Schedule';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving...';
    }

    try {
      const applyRes = await fetch('/api/scheduling/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gradeLevel,
          semesterCode,
          schedules: toSave,
          source: lastResult.source,
        }),
      });
      const applyPayload = await applyRes.json();
      if (!applyPayload.success) {
        showBanner(applyPayload.error || applyPayload.hint || 'Save failed');
        await AdminApp.alertDialog({
          type: 'error',
          title: 'Save Failed',
          message: applyPayload.error || applyPayload.hint || 'Could not save schedule to the database.',
        });
        return;
      }

      if (btn) btn.textContent = 'Publishing...';

      let publishedCount = applyPayload.applied ?? applyPayload.count ?? toSave.length;
      const pubRes = await fetch('/api/scheduling/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gradeLevel, semesterCode }),
      });
      const pubPayload = await pubRes.json();
      if (pubPayload.success) {
        publishedCount = pubPayload.published ?? publishedCount;
      } else {
        console.warn('Publish step warning:', pubPayload.error || pubPayload.hint);
      }

      const savedCount = applyPayload.applied ?? applyPayload.count ?? toSave.length;
      const successMsg = `${strand || 'Schedule'} saved and published (${publishedCount} records). Students can view it in their portal.`;
      showBanner(successMsg, 'success');
      await AdminApp.alertDialog({
        type: 'success',
        title: 'Schedule Published',
        message: successMsg,
      });
    } catch (err) {
      showBanner(err.message || 'Save & publish failed');
      await AdminApp.alertDialog({
        type: 'error',
        title: 'Something Went Wrong',
        message: err.message || 'Could not complete save and publish.',
      });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = defaultLabel;
      }
    }
  }

  function buildPayload(form, strand, existingSchedules) {
    const data = new FormData(form);
    const useAiEl = form.querySelector('input[name="useAi"]');
    const fallbackEl = form.querySelector('input[name="allowLocalFallback"]');
    return {
      strand,
      gradeLevel: data.get('gradeLevel'),
      semesterCode: data.get('semesterCode'),
      sectionsPerStrand: parseInt(data.get('sectionsPerStrand'), 10) || 2,
      rooms: (data.get('rooms') || '').split(',').map(r => r.trim()).filter(Boolean),
      existingSchedules,
      useAi: useAiEl ? useAiEl.checked : true,
      useCloudAi: useAiEl ? useAiEl.checked : true,
      allowLocalFallback: fallbackEl ? fallbackEl.checked : true,
    };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function strandsMatch(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length) return false;
    return a.every((strand, index) => strand === b[index]);
  }

  function resetGenerationState(strands, { keepProgress = false } = {}) {
    generationState = {
      strands: [...strands],
      currentIndex: 0,
      accumulated: [],
      notes: [],
      finalSource: 'groq_ai',
      started: false,
      allComplete: false,
    };
    if (!keepProgress) {
      strandProgress = {};
      progressLog = [];
      lastResult = null;
    }
    strands.forEach(strand => {
      if (!strandProgress[strand]) {
        strandProgress[strand] = { status: 'pending', count: 0 };
      }
    });
  }

  function syncGenerationStrands(strands) {
    if (!generationState.started) {
      resetGenerationState(strands);
      return;
    }
    if (!strandsMatch(generationState.strands, strands)) {
      resetGenerationState(strands);
    }
  }

  function getCooldownRemainingSec() {
    if (!cooldownUntil) return 0;
    return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  }

  function isCooldownActive() {
    return getCooldownRemainingSec() > 0;
  }

  function clearCooldownTimer() {
    if (cooldownTimerId) {
      clearInterval(cooldownTimerId);
      cooldownTimerId = null;
    }
    cooldownUntil = 0;
    const btn = document.getElementById('generateBtn');
    if (btn) btn.classList.remove('cooldown');
    const banner = document.getElementById('cooldownBanner');
    if (banner) {
      banner.hidden = true;
      banner.textContent = '';
    }
  }

  function parseCooldownFromProgress(entries, source) {
    if (source === 'smart_ai_fallback') return 0;
    let maxPause = 0;
    let hadRateLimit = false;
    let usedCloud = false;
    for (const entry of entries || []) {
      const msg = entry.message || '';
      const lower = msg.toLowerCase();
      if (/429|rate limit/.test(lower)) hadRateLimit = true;
      if (lower.includes('cloud ai') || lower.includes('via groq') || lower.includes('one ai call')) {
        usedCloud = true;
      }
      const match = lower.match(/pausing\s+(\d+)s/);
      if (match) maxPause = Math.max(maxPause, parseInt(match[1], 10));
    }
    if (hadRateLimit) return Math.max(30, maxPause + 15);
    if (usedCloud) return 10;
    return 0;
  }

  function resolveCooldownSec(data) {
    if (typeof data?.cooldown_sec === 'number') return data.cooldown_sec;
    return parseCooldownFromProgress(data?.progress || progressLog, data?.source);
  }

  function updateCooldownBanner(remainingSec, targetLabel) {
    const banner = document.getElementById('cooldownBanner');
    if (!banner) return;
    if (remainingSec <= 0) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `
      <span class="auto-sched-cooldown-dot"></span>
      Cloud AI resting — <strong>${formatElapsed(remainingSec)}</strong> until
      <strong>${esc(targetLabel)}</strong> is available
    `;
  }

  function startCooldownTimer(form, seconds, targetLabel, { onReadyMessage } = {}) {
    clearCooldownTimer();
    if (!seconds || seconds <= 0) {
      updateGenerateControls(form);
      return;
    }

    cooldownUntil = Date.now() + seconds * 1000;

    const tick = () => {
      const remaining = getCooldownRemainingSec();
      const btn = document.getElementById('generateBtn');
      if (remaining <= 0) {
        clearCooldownTimer();
        updateGenerateControls(form);
        if (onReadyMessage) showBanner(onReadyMessage, 'success');
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.classList.add('cooldown');
        btn.textContent = `Wait ${formatElapsed(remaining)} — Generate ${targetLabel}`;
      }
      updateCooldownBanner(remaining, targetLabel);
    };

    tick();
    cooldownTimerId = setInterval(tick, 1000);
  }

  function resumeCooldownTimer(form) {
    if (!isCooldownActive() || cooldownTimerId) return;
    const index = generationState.currentIndex;
    const target = generationState.strands[index]
      ? `${generationState.strands[index]} (${index + 1} of ${generationState.strands.length})`
      : 'Next strand';

    const tick = () => {
      const remaining = getCooldownRemainingSec();
      const btn = document.getElementById('generateBtn');
      if (remaining <= 0) {
        clearCooldownTimer();
        updateGenerateControls(form);
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.classList.add('cooldown');
        btn.textContent = `Wait ${formatElapsed(remaining)} — Generate ${target}`;
      }
      updateCooldownBanner(remaining, target);
    };

    tick();
    cooldownTimerId = setInterval(tick, 1000);
  }

  function getGenerateButtonLabel() {
    if (generationState.allComplete) return 'Schedule Complete ✓';
    const strand = generationState.strands[0] || wizardFormData.strands?.[0];
    if (!strand) return 'Generate Schedule';
    const state = strandProgress[strand] || {};
    if (state.status === 'failed') return `Retry ${strand}`;
    return `Generate ${strand} Schedule`;
  }

  function updateGenerateControls(form) {
    const btn = document.getElementById('generateBtn');
    const resetBtn = document.getElementById('resetGenBtn');
    if (!btn) return;
    const strands = getSelectedStrands(form);
    syncGenerationStrands(strands);

    const remaining = getCooldownRemainingSec();
    if (remaining > 0) {
      const index = generationState.currentIndex;
      const target = generationState.strands[index] || 'Next strand';
    btn.disabled = true;
      btn.classList.add('cooldown');
      btn.textContent = `Wait ${formatElapsed(remaining)} — Generate ${target}`;
      updateCooldownBanner(remaining, target);
      if (resetBtn) {
        resetBtn.style.display = generationState.started && !generationState.allComplete ? '' : 'none';
      }
      return;
    }

    btn.classList.remove('cooldown');
    btn.textContent = getGenerateButtonLabel();
    btn.disabled = generationState.allComplete;
    if (resetBtn) {
      const showReset = generationState.started && !generationState.allComplete;
      resetBtn.style.display = showReset ? '' : 'none';
    }
  }

  function formatElapsed(seconds) {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function startElapsedTimer(strand, strandIndex, totalStrands, accumulated, strands) {
    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const last = progressLog[progressLog.length - 1];
      const tickMessage = `Generating ${strand} (${strandIndex + 1}/${totalStrands}) — ${formatElapsed(elapsed)} elapsed...`;
      if (last && last.message && last.message.startsWith(`Generating ${strand}`)) {
        last.message = tickMessage;
      } else {
        progressLog.push({ level: 'info', message: tickMessage });
      }
      if (progressLog.length > 80) progressLog = progressLog.slice(-80);
      const resultsWrap = document.getElementById('resultsWrap');
      if (resultsWrap) {
        resultsWrap.innerHTML = renderResults(
          {
            success: true,
            count: accumulated.length,
            schedules: [...accumulated],
            validation: { valid: true, conflicts: [] },
          },
          strands,
          strandIndex,
        );
      }
    };
    tick();
    return setInterval(tick, 2000);
  }

  async function finalizeGeneration(form, strands) {
    const { accumulated, notes, finalSource } = generationState;
    const btn = document.getElementById('generateBtn');

    if (!accumulated.length) {
      document.getElementById('resultsWrap').innerHTML = renderResults(
        { success: false, error: 'No schedules were generated.', ai_error: notes.join(' | ') },
        strands,
        strands.length - 1,
      );
      updateGenerateControls(form);
      return;
    }

    try {
      const res = await fetch('/api/scheduling/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules: accumulated }),
      });
      const data = await res.json();
      lastResult = {
        success: true,
        count: accumulated.length,
        schedules: accumulated,
        source: finalSource,
        ai_error: notes.length ? notes.join(' | ') : null,
        validation: data.validation,
      };
      generationState.allComplete = true;
      appendProgress([{ level: 'success', message: `${strands[0] || 'Strand'} schedule validated — ready to save.` }]);
      document.getElementById('resultsWrap').innerHTML = renderResults(lastResult, strands, strands.length);
      document.getElementById('validateBtn').disabled = !accumulated.length;
      setSavePublishEnabled(!!data.success);
      showBanner(`${strands[0] || 'Strand'} schedule ready. Save & publish when done, then run again for other strands.`, 'success');
    } catch (err) {
      document.getElementById('resultsWrap').innerHTML = `
        <section class="auto-sched-panel error-card"><p>${esc(err.message)}</p></section>`;
    } finally {
      updateGenerateControls(form);
    }
  }

  async function loadDraftSchedules(form, strand) {
    const data = new FormData(form);
    try {
      const params = new URLSearchParams({
        gradeLevel: data.get('gradeLevel') || 'Grade 12',
        semesterCode: data.get('semesterCode') || '1st',
      });
      const res = await AdminApp.fetchJson(`/api/scheduling/draft?${params}`);
      const saved = (res.schedules || []).filter(item => (
        (item.strand || '').toUpperCase() !== (strand || '').toUpperCase()
      ));
      if (saved.length) {
        generationState.accumulated = saved;
        appendProgress([{
          level: 'info',
          message: `Loaded ${saved.length} saved schedule entries from database (room/time conflict check).`,
        }]);
      }
    } catch (_) {
      // No saved draft yet — fine for first strand
    }
  }

  async function generate(form) {
    const strands = getSelectedStrands(form);
    if (strands.length !== 1) {
      showBanner('Select exactly one strand in Step 2.');
      return;
    }
    if (generationState.allComplete) return;
    if (isCooldownActive()) {
      const remaining = getCooldownRemainingSec();
      const next = generationState.strands[generationState.currentIndex] || 'next strand';
      showBanner(`Please wait ${formatElapsed(remaining)} — cloud AI is still resting before ${next}.`);
      return;
    }

    syncGenerationStrands(strands);
    const i = generationState.currentIndex;
    const strand = generationState.strands[i];
    if (!strand) return;

    const btn = document.getElementById('generateBtn');
    btn.disabled = true;
    btn.textContent = `Generating ${strand}...`;

    if (!generationState.started) {
      generationState.started = true;
      progressLog = [];
      await loadDraftSchedules(form, strand);
      document.getElementById('resultsWrap').innerHTML = renderResults(null, generationState.strands, i);
    }

    strandProgress[strand] = { status: 'processing', count: 0 };
    appendProgress([{ level: 'info', message: `Starting ${strand} schedule...` }]);
    document.getElementById('resultsWrap').innerHTML = renderResults(
      {
        success: true,
        count: generationState.accumulated.length,
        schedules: [...generationState.accumulated],
        validation: { valid: true, conflicts: [] },
      },
      generationState.strands,
      i,
    );

    const elapsedTimer = startElapsedTimer(
      strand,
      i,
      generationState.strands.length,
      generationState.accumulated,
      generationState.strands,
    );

    try {
      const res = await fetch('/api/scheduling/generate-strand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(form, strand, generationState.accumulated)),
      });
      clearInterval(elapsedTimer);
      const data = await res.json();
      appendProgress(data.progress || []);

      if (!data.success) {
        strandProgress[strand] = { status: 'failed', count: 0, error: data.error };
        generationState.notes.push(`${strand}: ${shortenNote(data.error || 'failed')}`);
        document.getElementById('resultsWrap').innerHTML = renderResults(
          {
            success: true,
            count: generationState.accumulated.length,
            schedules: [...generationState.accumulated],
            source: generationState.finalSource,
            ai_error: generationState.notes.join(' | '),
            validation: { valid: true, conflicts: [] },
          },
          generationState.strands,
          i,
        );
        updateGenerateControls(form);
        const retryCooldown = resolveCooldownSec({ progress: data.progress, source: data.source });
        if (retryCooldown > 0) {
          startCooldownTimer(form, retryCooldown, strand, {
            onReadyMessage: `Cloud AI ready — you can retry ${strand} now.`,
          });
        }
        showBanner(`${strand} failed — fix the issue or press Retry when ready.`);
        return;
      }

      generationState.accumulated.push(...(data.schedules || []));
      strandProgress[strand] = { status: 'done', count: data.count || 0, source: data.source };
      if (data.source === 'smart_ai_fallback') generationState.finalSource = 'smart_ai_fallback';
      else if (data.source === 'gemini_ai') generationState.finalSource = 'gemini_ai';
      else if (data.source === 'openrouter_ai') generationState.finalSource = 'openrouter_ai';
      if (data.ai_error) generationState.notes.push(`${strand}: ${shortenNote(data.ai_error)}`);

      lastResult = {
        success: true,
        count: generationState.accumulated.length,
        schedules: [...generationState.accumulated],
        source: generationState.finalSource,
        ai_error: generationState.notes.length ? generationState.notes.join(' | ') : null,
        validation: data.validation || { valid: data.combined_valid, conflicts: [] },
      };

      generationState.currentIndex += 1;

      appendProgress([{ level: 'success', message: `${strand} schedule complete.` }]);

      document.getElementById('resultsWrap').innerHTML = renderResults(
        lastResult,
        generationState.strands,
        generationState.currentIndex,
        strand,
      );

      await finalizeGeneration(form, generationState.strands);
    } catch (err) {
      clearInterval(elapsedTimer);
      strandProgress[strand] = { status: 'failed', count: 0, error: err.message };
      document.getElementById('resultsWrap').innerHTML = `
        <section class="auto-sched-panel error-card"><p>${esc(err.message)}</p></section>`;
      updateGenerateControls(form);
    }
  }

  async function validateAgain() {
    if (!lastResult?.schedules?.length) return;
    const res = await fetch('/api/scheduling/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedules: lastResult.schedules }),
    });
    const data = await res.json();
    lastResult.validation = data.validation;
    document.getElementById('resultsWrap').innerHTML = renderResults(lastResult);
    setSavePublishEnabled(!!data.success);
  }

  async function mount(container) {
    if (!AdminApp.requireAuth()) return;
    wizardStep = 1;
    selectedTrack = 'Academic';
    schedulingContext = null;
    wizardFormData = {};
    resetGenerationState([]);
    container.innerHTML = '<p>Loading scheduler config...</p>';
    try {
      await loadConfig();
    } catch (err) {
      container.innerHTML = `<section class="auto-sched-panel error-card"><p>${esc(err.message)}</p></section>`;
      return;
    }

    container.innerHTML = `${renderForm()}<div id="resultsWrap"></div>`;
    bindForm(document.getElementById('autoSchedForm'));
  }

  return { mount, loadConfig };
})();
