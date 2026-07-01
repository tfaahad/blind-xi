// ---------- State ----------
let ALL_PLAYERS = [];
let PLAYERS_BY_SLOT = {}; // slot -> array of players eligible for that slot
let currentFormation = null;
let pickedPlayerIds = new Set();
let squad = {}; // slotInstanceId -> { player, slotDef }
let activeSlotId = null;
let candidateCache = {}; // slotInstanceId -> array of 3 candidates (so re-opening shows same 3 until picked)

const FORMATION_DESCRIPTIONS = {
  "4-4-2": "Two banks of four. Balanced, old-school, no excuses.",
  "4-3-3": "Width up top, control in the middle.",
  "4-2-3-1": "A double pivot and a number 10 pulling strings.",
  "3-5-2": "Wing-backs do the running. Crowd the midfield.",
  "5-3-2": "Park the bus, hit on the counter.",
};

// ---------- Boot ----------
async function init() {
  const res = await fetch('players.json');
  ALL_PLAYERS = await res.json();

  // Pre-index players by slot group for fast random draws
  const slotGroups = new Set();
  Object.values(FORMATIONS).forEach(f => f.slots.forEach(s => slotGroups.add(s.slot)));
  slotGroups.forEach(g => {
    PLAYERS_BY_SLOT[g] = ALL_PLAYERS.filter(p => p.slots.includes(g));
  });

  renderFormationGrid();
  bindStaticEvents();
}

function renderFormationGrid() {
  const grid = document.getElementById('formationGrid');
  grid.innerHTML = '';
  Object.keys(FORMATIONS).forEach(key => {
    const f = FORMATIONS[key];
    const card = document.createElement('div');
    card.className = 'formation-card';
    card.innerHTML = `
      <div class="fname">${f.label}</div>
      <div class="fdesc">${FORMATION_DESCRIPTIONS[key] || ''}</div>
    `;
    card.addEventListener('click', () => startFormation(key));
    grid.appendChild(card);
  });
}

function bindStaticEvents() {
  document.getElementById('backToFormation').addEventListener('click', () => {
    showScreen('screen-formation');
    document.getElementById('progressPill').style.display = 'none';
  });
  document.getElementById('rebuildBtn').addEventListener('click', () => {
    showScreen('screen-formation');
    document.getElementById('progressPill').style.display = 'none';
  });
  document.getElementById('shareBtn').addEventListener('click', copyResult);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- Formation / Draft ----------
function startFormation(key) {
  currentFormation = key;
  pickedPlayerIds = new Set();
  squad = {};
  candidateCache = {};
  activeSlotId = null;

  renderPitch();
  updateProgress();
  document.getElementById('progressPill').style.display = 'inline-block';
  showScreen('screen-draft');
  renderSidePanelEmpty();
}

function renderPitch() {
  const pitch = document.getElementById('pitch');
  // Clear existing slot elements (keep markings)
  pitch.querySelectorAll('.slot').forEach(el => el.remove());

  const f = FORMATIONS[currentFormation];
  f.slots.forEach(slotDef => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.style.left = slotDef.x + '%';
    el.style.top = slotDef.y + '%';
    el.dataset.slotId = slotDef.id;
    el.innerHTML = `<span class="slabel">${slotDef.label}</span><span class="pname"></span>`;
    el.addEventListener('click', () => openSlot(slotDef));
    pitch.appendChild(el);
  });
}

function updateProgress() {
  document.getElementById('progressCount').textContent = Object.keys(squad).length;
}

function renderSidePanelEmpty() {
  document.getElementById('sidePanel').innerHTML = `
    <div class="empty-state">
      <div class="big">⚽</div>
      Tap a position on the pitch<br>to start drafting.
    </div>
  `;
}

function openSlot(slotDef) {
  activeSlotId = slotDef.id;

  // Highlight active slot
  document.querySelectorAll('.slot').forEach(el => el.classList.remove('active-pick'));
  const slotEl = document.querySelector(`.slot[data-slot-id="${slotDef.id}"]`);
  if (slotEl) slotEl.classList.add('active-pick');

  // Get or generate 3 candidates for this slot instance
  let candidates = candidateCache[slotDef.id];
  if (!candidates) {
    candidates = drawCandidates(slotDef.slot, 3);
    candidateCache[slotDef.id] = candidates;
  }

  renderSidePanel(slotDef, candidates);
}

function drawCandidates(slotGroup, count) {
  const pool = (PLAYERS_BY_SLOT[slotGroup] || []).filter(p => !pickedPlayerIds.has(p.id));

  // Split into tiers for variety: one solid pro (75-79), one quality (80-85), one star (86+)
  const low  = shuffle(pool.filter(p => p.rating <= 79));
  const mid  = shuffle(pool.filter(p => p.rating >= 80 && p.rating <= 85));
  const high = shuffle(pool.filter(p => p.rating >= 86));

  const picks = [];
  if (high.length) picks.push(high[0]);
  if (mid.length)  picks.push(mid[0]);
  if (low.length)  picks.push(low[0]);

  // If a tier runs dry late-game, fill from remaining pool
  if (picks.length < count) {
    const usedIds = new Set(picks.map(p => p.id));
    const extras = shuffle(pool.filter(p => !usedIds.has(p.id)));
    for (const p of extras) {
      if (picks.length >= count) break;
      picks.push(p);
    }
  }

  // Shuffle so the star is not always in position 0
  return shuffle(picks).slice(0, count);
}

function shuffle(arr) {
  const a = arr.slice(); // always copy — never mutate the source array
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderSidePanel(slotDef, candidates) {
  const panel = document.getElementById('sidePanel');
  const existing = squad[slotDef.id];

  if (candidates.length === 0) {
    panel.innerHTML = `
      <h2>${slotDef.label}</h2>
      <div class="hint">No more eligible players left for this position in the pool — try picking other positions first.</div>
    `;
    return;
  }

  panel.innerHTML = `
    <h2>Pick your ${slotDef.label}</h2>
    <div class="hint">${existing ? 'Already filled — pick again to replace.' : "Three players. No ratings. Go with your gut."}</div>
    <div class="candidate-list" id="candidateList"></div>
  `;

  const list = document.getElementById('candidateList');
  candidates.forEach(player => {
    const card = document.createElement('div');
    card.className = 'candidate';
    card.innerHTML = `
      <div class="pn">${player.name}</div>
      <div class="pm">${player.nation} <b>&middot;</b> ${player.club}</div>
    `;
    card.addEventListener('click', () => pickPlayer(slotDef, player));
    list.appendChild(card);
  });
}

function pickPlayer(slotDef, player) {
  // If replacing an existing pick in this slot, free up the old player id
  const prev = squad[slotDef.id];
  if (prev) pickedPlayerIds.delete(prev.player.id);

  squad[slotDef.id] = { player, slotDef };
  pickedPlayerIds.add(player.id);

  // Invalidate cached candidate lists for other slots that included this player,
  // so re-opening them will draw fresh candidates without the now-picked player.
  Object.keys(candidateCache).forEach(sid => {
    if (sid !== slotDef.id && candidateCache[sid].some(p => p.id === player.id)) {
      delete candidateCache[sid];
    }
  });

  // Update the pitch slot visual
  const slotEl = document.querySelector(`.slot[data-slot-id="${slotDef.id}"]`);
  if (slotEl) {
    slotEl.classList.add('filled');
    slotEl.classList.remove('active-pick');
    slotEl.querySelector('.pname').textContent = lastNameOf(player.name);
  }

  updateProgress();

  const allFilled = Object.keys(squad).length === FORMATIONS[currentFormation].slots.length;
  renderSidePanelPicked(slotDef, player, allFilled);
}

function renderSidePanelPicked(slotDef, player, allFilled) {
  const panel = document.getElementById('sidePanel');
  panel.innerHTML = `
    <h2>${slotDef.label} locked in</h2>
    <div class="hint">You picked <b style="color:var(--lime)">${player.name}</b> (${player.nation}, ${player.club}). Tap another position to keep drafting.</div>
    ${allFilled ? `<button class="reveal-cta" id="revealNowBtn">Reveal my team</button>` : ''}
  `;
  if (allFilled) {
    document.getElementById('revealNowBtn').addEventListener('click', showReveal);
  }
}

function lastNameOf(fullName) {
  const parts = fullName.trim().split(' ');
  return parts[parts.length - 1];
}

// ---------- Reveal ----------
function showReveal() {
  const f = FORMATIONS[currentFormation];
  document.getElementById('revealFormationLabel').textContent = `${f.label} · full XI revealed`;

  const slotOrder = f.slots; // already in a sensible order (GK first, etc. as authored)
  const picks = slotOrder.map(s => squad[s.id]).filter(Boolean);

  const overall = Math.round(picks.reduce((sum, p) => sum + p.player.rating, 0) / picks.length);

  animateOverall(overall);

  const grade = gradeFor(overall);
  const gradeTag = document.getElementById('gradeTag');
  gradeTag.textContent = grade.label;
  gradeTag.style.color = grade.color;
  gradeTag.style.borderColor = grade.color;

  const grid = document.getElementById('revealGrid');
  grid.innerHTML = '';
  picks.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'reveal-card' + (p.player.rating >= 88 ? ' tier-elite' : '');
    card.style.animationDelay = (i * 0.06) + 's';
    card.innerHTML = `
      <div class="rc-pos">${p.slotDef.label}</div>
      <div class="rc-name">${p.player.name}</div>
      <div class="rc-rating">${p.player.rating}</div>
      <div class="rc-club">${p.player.club}</div>
    `;
    grid.appendChild(card);
  });

  showScreen('screen-reveal');
}

function animateOverall(target) {
  const el = document.getElementById('overallNum');
  const duration = 900;
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = Math.round(eased * target);
    el.textContent = String(val).padStart(2, '0');
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function gradeFor(overall) {
  if (overall >= 88) return { label: 'World Class', color: '#FF5A3C' };
  if (overall >= 84) return { label: 'Elite', color: '#D4FF4F' };
  if (overall >= 80) return { label: 'Quality Starting XI', color: '#D4FF4F' };
  if (overall >= 76) return { label: 'Solid Squad', color: '#F5F2E8' };
  return { label: 'Project Team', color: '#5C7268' };
}

function copyResult() {
  const f = FORMATIONS[currentFormation];
  const overall = document.getElementById('overallNum').textContent;
  const grade = document.getElementById('gradeTag').textContent;
  const lines = [`Blind XI — ${f.label} — ${overall} OVR (${grade})`];
  f.slots.forEach(s => {
    const p = squad[s.id];
    if (p) lines.push(`${s.label}: ${p.player.name} (${p.player.rating})`);
  });
  const text = lines.join('\n');
  navigator.clipboard?.writeText(text).then(() => {
    const btn = document.getElementById('shareBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => {
    alert(text);
  });
}

init();
