const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let me = null;
let currentChallengeId = null;

// ── Init / Router ─────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error') === 'denied') showError('Strava connection was denied.');
  if (params.get('error') === 'auth_failed') showError('Authentication failed. Check your API credentials.');

  me = await fetchMe();
  renderUserChip();

  route(window.location.pathname);
}

function route(pathname) {
  if (pathname === '/create') {
    showCreate();
  } else if (pathname.startsWith('/c/')) {
    const id = pathname.split('/')[2];
    openChallenge(id);
  } else {
    showHome();
  }
}

window.addEventListener('popstate', () => route(window.location.pathname));

// ── Navigation ────────────────────────────────────────────────

function goHome() {
  currentChallengeId = null;
  history.pushState(null, '', '/');
  showView('home-view');
  refreshHome();
}

function goCreate() {
  if (!me.connected) { window.location.href = '/auth/login'; return; }
  history.pushState(null, '', '/create');
  showCreate();
}

function goChallenge(id) {
  history.pushState(null, '', `/c/${id}`);
  openChallenge(id);
}

// ── Data ──────────────────────────────────────────────────────

async function fetchMe() {
  const res = await fetch('/api/me');
  return res.json();
}

async function fetchChallenge(id) {
  const res = await fetch(`/api/challenge/${id}`);
  if (!res.ok) return null;
  return res.json();
}

// ── Views ─────────────────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Home ──────────────────────────────────────────────────────

function showHome() {
  showView('home-view');
  const now = new Date();
  document.getElementById('home-month').textContent =
    `${MONTHS[now.getMonth()]} ${now.getFullYear()} · Bike Miles`;
  refreshHome();
}

function refreshHome() {
  if (!me.connected) {
    document.getElementById('connect-prompt').classList.remove('hidden');
    document.getElementById('my-challenges-section').classList.add('hidden');
  } else {
    document.getElementById('connect-prompt').classList.add('hidden');
    renderChallengesList();
  }
}

function showJoinPanel() {
  const panel = document.getElementById('join-panel');
  const wasHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !wasHidden);
  if (wasHidden) document.getElementById('join-code').focus();
}

async function joinChallenge() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 6) { showError('Enter a 6-character code.'); return; }
  goChallenge(code);
}

document.getElementById('join-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinChallenge();
});

function renderUserChip() {
  const chip = document.getElementById('user-chip');
  if (!me.connected) { chip.classList.add('hidden'); return; }
  chip.innerHTML = `<img src="${me.athlete.photoUrl}" /><span>${firstName(me.athlete.name)}</span>`;
  chip.classList.remove('hidden');
}

function renderChallengesList() {
  const section = document.getElementById('my-challenges-section');
  const list = document.getElementById('challenges-list');
  if (!me.challenges || me.challenges.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  list.innerHTML = me.challenges.map(c => {
    const r1 = c.riders[0];
    const r2 = c.riders[1] || null;
    const av1 = r1 ? `<img src="${r1.photoUrl}" alt="${r1.name}" />` : '';
    const av2 = r2 ? `<img src="${r2.photoUrl}" alt="${r2.name}" />` : '<div class="av-placeholder"></div>';
    const status = c.full
      ? `${r1.miles} mi vs ${r2.miles} mi · ${c.daysLeft}d left`
      : 'Waiting for opponent…';
    return `<div class="challenge-row" onclick="goChallenge('${c.id}')">
      <div class="cr-avatars">${av1}${av2}</div>
      <div class="cr-info">
        <div class="cr-name">${c.name}</div>
        <div class="cr-status">${status}</div>
      </div>
      <div class="cr-code">${c.id}</div>
    </div>`;
  }).join('');
}

// ── Create ────────────────────────────────────────────────────

function showCreate() {
  showView('create-view');
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  document.getElementById('this-month-btn').textContent =
    `${MONTHS_SHORT[now.getMonth()]} (ends ${endOfMonth.getDate()})`;

  // Set default dates for custom picker
  const toDateStr = d => d.toISOString().split('T')[0];
  document.getElementById('custom-start').value = toDateStr(now);
  document.getElementById('custom-end').value = toDateStr(endOfMonth);
}

// Duration button selection
document.querySelectorAll('.dur-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    const isCustom = btn.dataset.type === 'custom';
    document.getElementById('custom-dates').classList.toggle('hidden', !isCustom);
  });
});

async function submitCreate() {
  const name = document.getElementById('create-name').value.trim() || 'Rivalry';
  const selected = document.querySelector('.dur-btn.selected');
  const type = selected?.dataset.type;

  let startDate, endDate;
  const nowSec = Math.floor(Date.now() / 1000);

  if (type === 'days') {
    startDate = nowSec;
    endDate = nowSec + Number(selected.dataset.days) * 86400;
  } else if (type === 'month') {
    const now = new Date();
    startDate = nowSec;
    // End at midnight of last day of month
    endDate = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime() / 1000);
  } else if (type === 'custom') {
    const s = document.getElementById('custom-start').value;
    const e = document.getElementById('custom-end').value;
    if (!s || !e) { showError('Pick a start and end date.'); return; }
    startDate = Math.floor(new Date(s).getTime() / 1000);
    endDate   = Math.floor(new Date(e + 'T23:59:59').getTime() / 1000);
    if (endDate <= startDate) { showError('End date must be after start date.'); return; }
  } else {
    showError('Pick a duration.'); return;
  }

  const res = await fetch('/api/challenge/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, startDate, endDate }),
  });
  const { id } = await res.json();

  // Refresh me so new challenge appears in list
  me = await fetchMe();
  history.pushState(null, '', `/c/${id}`);
  openChallenge(id);
}

// ── Challenge ─────────────────────────────────────────────────

async function openChallenge(id) {
  currentChallengeId = id;

  const challenge = await fetchChallenge(id);
  if (!challenge) { showError('Challenge not found.'); goHome(); return; }

  if (challenge.full) {
    showRivalry(challenge);
    return;
  }

  if (!me.connected) {
    window.location.href = `/auth/login?challenge=${id}`;
    return;
  }

  const alreadyIn = challenge.riders.some(r => r.isMe);
  if (!alreadyIn) {
    const res = await fetch(`/api/challenge/${id}/join`, { method: 'POST' });
    const updated = await res.json();
    if (updated.full) { showRivalry(updated); return; }
    showWaiting(updated);
    return;
  }

  showWaiting(challenge);
}

// ── Waiting ───────────────────────────────────────────────────

function showWaiting(challenge) {
  showView('waiting-view');
  document.getElementById('waiting-code').textContent = challenge.id;
  document.getElementById('waiting-title').textContent = challenge.name;
  document.getElementById('waiting-meta').textContent = formatDateRange(challenge);
  const url = `${window.location.origin}/c/${challenge.id}`;
  document.getElementById('share-url-text').textContent = url;
}

function copyUrl() {
  const url = document.getElementById('share-url-text').textContent;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

// ── Rivalry ───────────────────────────────────────────────────

function showRivalry(challenge) {
  showView('rivalry-view');

  document.getElementById('rivalry-name').textContent = challenge.name;
  document.getElementById('rivalry-dates').textContent = formatDateRange(challenge);
  const timeLeft = challenge.ended ? 'Ended'
    : challenge.daysLeft === 1 ? '1 day left'
    : `${challenge.daysLeft} days left`;
  document.getElementById('rivalry-timeleft').textContent = timeLeft;

  const [r1, r2] = challenge.riders;

  // Horizontal bars
  const max = Math.max(r1.miles, r2.miles, 1);
  document.getElementById('hname1').textContent = firstName(r1.name);
  document.getElementById('hname2').textContent = firstName(r2.name);
  document.getElementById('hval1').textContent = `${r1.miles} mi`;
  document.getElementById('hval2').textContent = `${r2.miles} mi`;
  requestAnimationFrame(() => {
    document.getElementById('hfill1').style.width = `${(r1.miles / max) * 100}%`;
    document.getElementById('hfill2').style.width = `${(r2.miles / max) * 100}%`;
  });

  // Stats grid
  renderStats(r1, r2);

  // Lead message
  const msgEl = document.getElementById('lead-message');
  const total = r1.miles + r2.miles;
  if (total === 0) {
    msgEl.textContent = "Nobody has ridden yet — get pedaling! 🚴";
    msgEl.style.color = '#555';
  } else if (r1.miles === r2.miles) {
    msgEl.textContent = "Dead tie! 🤝";
    msgEl.style.color = '#f5c842';
  } else {
    const leader = r1.miles > r2.miles ? r1 : r2;
    const gap = Math.abs(r1.miles - r2.miles).toFixed(1);
    msgEl.textContent = `${firstName(leader.name)} leads by ${gap} miles 🔥`;
    msgEl.style.color = r1.miles > r2.miles ? '#fc4c02' : '#3b82f6';
  }
}

function renderStats(r1, r2) {
  const fmtTime = s => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const fmtElev = ft => ft >= 1000 ? `${(ft/1000).toFixed(1)}k ft` : `${ft} ft`;

  const stats = [
    { label: '🚴 Rides',        v1: r1.rides,          v2: r2.rides,          fmt: v => `${v}` },
    { label: '⛰️ Elevation',    v1: r1.elevationFt,    v2: r2.elevationFt,    fmt: fmtElev },
    { label: '⏱️ Time riding',  v1: r1.movingTimeSec,  v2: r2.movingTimeSec,  fmt: fmtTime },
    { label: '🏁 Longest ride', v1: r1.longestRideMi,  v2: r2.longestRideMi,  fmt: v => `${v} mi` },
  ];

  const grid = document.getElementById('stat-grid');
  grid.innerHTML = stats.map(({ label, v1, v2, fmt }) => {
    const max = Math.max(v1, v2, 1);
    const pct1 = Math.round((v1 / max) * 100);
    const pct2 = Math.round((v2 / max) * 100);
    const c1 = v1 > v2 ? 'winner-orange' : v1 < v2 ? '' : '';
    const c2 = v2 > v1 ? 'winner-blue'   : v2 < v1 ? '' : '';
    return `
      <div class="stat-row">
        <div class="stat-label">${label}</div>
        <div class="stat-values">
          <div class="stat-val ${c1}">${fmt(v1)}</div>
          <div class="stat-bar-track">
            <div class="stat-bar-fill"      style="width:${pct1}%"></div>
            <div class="stat-bar-fill-blue" style="width:${pct2}%"></div>
          </div>
          <div class="stat-val stat-val-right ${c2}">${fmt(v2)}</div>
        </div>
      </div>`;
  }).join('');
}

async function refreshChallenge() {
  if (!currentChallengeId) return;
  await fetch(`/api/challenge/${currentChallengeId}/refresh`, { method: 'POST' });
  const updated = await fetchChallenge(currentChallengeId);
  if (updated) showRivalry(updated);
}

// ── Utils ─────────────────────────────────────────────────────

function firstName(name) { return name ? name.split(' ')[0] : name; }

function formatDateRange(challenge) {
  const s = new Date(challenge.startDate * 1000);
  const e = new Date(challenge.endDate * 1000);
  const fmt = d => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  return `${fmt(s)} – ${fmt(e)}`;
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

init();
