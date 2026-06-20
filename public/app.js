const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let me = null; // current user data from /api/me
let currentChallengeId = null;

// ── Init ──────────────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error') === 'denied') showError('Strava connection was denied.');
  if (params.get('error') === 'auth_failed') showError('Authentication failed. Check your Strava API credentials.');

  me = await fetchMe();
  renderUserChip();

  const challengeId = params.get('challenge');
  if (challengeId) {
    await openChallenge(challengeId);
  } else {
    showHome();
  }
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

// ── Routing ───────────────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function showHome() {
  currentChallengeId = null;
  history.replaceState(null, '', '/');
  showView('home-view');

  const now = new Date();
  document.getElementById('home-month').textContent = `${MONTHS[now.getMonth()]} ${now.getFullYear()} · Bike Miles`;

  if (!me.connected) {
    document.getElementById('connect-prompt').classList.remove('hidden');
    document.getElementById('my-challenges-section').classList.add('hidden');
  } else {
    document.getElementById('connect-prompt').classList.add('hidden');
    renderChallengesList();
  }
}

function goHome() {
  history.replaceState(null, '', '/');
  showHome();
}

async function openChallenge(id) {
  currentChallengeId = id;
  history.replaceState(null, '', `/?challenge=${id}`);

  const challenge = await fetchChallenge(id);
  if (!challenge) { showError('Challenge not found.'); showHome(); return; }

  if (challenge.full) {
    showRivalry(challenge);
  } else {
    // Not full — current user may need to join or is waiting
    if (!me.connected) {
      window.location.href = `/auth/login?challenge=${id}`;
      return;
    }
    const alreadyIn = challenge.riders.some(r => r.isMe);
    if (!alreadyIn) {
      // Connected but not in this challenge — join
      const res = await fetch(`/api/challenge/${id}/join`, { method: 'POST' });
      const updated = await res.json();
      if (updated.full) { showRivalry(updated); return; }
    }
    showWaiting(challenge);
  }
}

// ── Home actions ──────────────────────────────────────────────

function toggleCreatePanel() {
  if (!me.connected) { window.location.href = '/auth/login'; return; }
  const panel = document.getElementById('create-panel');
  panel.classList.toggle('hidden');
  document.getElementById('join-panel').classList.add('hidden');
  if (!panel.classList.contains('hidden')) document.getElementById('create-name').focus();
}

async function submitCreateChallenge() {
  const name = document.getElementById('create-name').value.trim() || 'Rivalry';
  const selected = document.querySelector('.dur-btn.selected');
  const durationDays = selected ? Number(selected.dataset.days) : 30;
  const res = await fetch('/api/challenge/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, durationDays }),
  });
  const { id } = await res.json();
  await openChallenge(id);
}

function showJoinPanel() {
  const panel = document.getElementById('join-panel');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !isHidden);
  if (isHidden) document.getElementById('join-code').focus();
}

async function joinChallenge() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (code.length !== 6) { showError('Enter a 6-character code.'); return; }
  await openChallenge(code);
}

document.getElementById('join-code')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinChallenge();
});

document.querySelectorAll('.dur-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

// ── Render: user chip ─────────────────────────────────────────

function renderUserChip() {
  const chip = document.getElementById('user-chip');
  if (!me.connected) { chip.classList.add('hidden'); return; }
  chip.innerHTML = `<img src="${me.athlete.photoUrl}" /><span>${me.athlete.name.split(' ')[0]}</span>`;
  chip.classList.remove('hidden');
}

// ── Render: challenges list ───────────────────────────────────

function renderChallengesList() {
  const section = document.getElementById('my-challenges-section');
  const list = document.getElementById('challenges-list');

  if (!me.challenges || me.challenges.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = me.challenges.map(c => {
    const r1 = c.riders[0];
    const r2 = c.riders[1];
    const avatars = [r1, r2 || null].map(r =>
      r ? `<img src="${r.photoUrl}" alt="${r.name}" />`
        : `<div class="avatar-placeholder">?</div>`
    ).join('');

    const status = c.full
      ? `${r1.miles} mi vs ${r2.miles} mi`
      : 'Waiting for opponent…';

    return `
      <div class="challenge-row" onclick="openChallenge('${c.id}')">
        <div class="challenge-row-avatars">${avatars}</div>
        <div class="challenge-row-info">
          <div class="challenge-row-name">${c.name}</div>
          <div class="challenge-row-status">${status}</div>
        </div>
        <div class="challenge-row-code">${c.id}</div>
      </div>`;
  }).join('');
}

// ── Render: waiting ───────────────────────────────────────────

function showWaiting(challenge) {
  showView('waiting-view');
  document.getElementById('waiting-code').textContent = challenge.id;
  const url = `${window.location.origin}/?challenge=${challenge.id}`;
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

// ── Render: rivalry ───────────────────────────────────────────

function showRivalry(challenge) {
  showView('rivalry-view');
  document.getElementById('rivalry-name').textContent = challenge.name;
  document.getElementById('rivalry-duration').textContent = `${challenge.durationDays}d challenge`;
  const timeLeft = challenge.ended
    ? 'Ended'
    : challenge.daysLeft === 1 ? '1 day left' : `${challenge.daysLeft} days left`;
  document.getElementById('rivalry-timeleft').textContent = timeLeft;

  const [r1, r2] = challenge.riders;

  document.getElementById('rider1-photo').src = r1.photoUrl || '';
  document.getElementById('rider1-name').textContent = firstName(r1.name);
  document.getElementById('rider1-miles').textContent = `${r1.miles} mi`;

  document.getElementById('rider2-photo').src = r2.photoUrl || '';
  document.getElementById('rider2-name').textContent = firstName(r2.name);
  document.getElementById('rider2-miles').textContent = `${r2.miles} mi`;

  // Tug bar
  const total = r1.miles + r2.miles;
  const pct = total === 0 ? 50 : Math.round((r1.miles / total) * 100);
  document.getElementById('tug-bar').style.width = `${pct}%`;

  // Lead message
  const msgEl = document.getElementById('lead-message');
  if (total === 0) {
    msgEl.textContent = "Nobody has ridden yet — get out there! 🚴";
    msgEl.style.color = '#888';
  } else if (r1.miles === r2.miles) {
    msgEl.textContent = "Dead tie! 🤝";
    msgEl.style.color = '#f5c842';
  } else {
    const leader = r1.miles > r2.miles ? r1 : r2;
    const gap = Math.abs(r1.miles - r2.miles).toFixed(1);
    msgEl.textContent = `${firstName(leader.name)} leads by ${gap} miles 🔥`;
    msgEl.style.color = r1.miles > r2.miles ? '#fc4c02' : '#3b82f6';
  }

  // Individual bars
  const max = Math.max(r1.miles, r2.miles, 1);
  document.getElementById('ind1-name').textContent = firstName(r1.name);
  document.getElementById('ind1-fill').style.width = `${(r1.miles / max) * 100}%`;
  document.getElementById('ind1-val').textContent = `${r1.miles}`;
  document.getElementById('ind2-name').textContent = firstName(r2.name);
  document.getElementById('ind2-fill').style.width = `${(r2.miles / max) * 100}%`;
  document.getElementById('ind2-val').textContent = `${r2.miles}`;
}

async function refreshChallenge() {
  if (!currentChallengeId) return;
  await fetch(`/api/challenge/${currentChallengeId}/refresh`, { method: 'POST' });
  const updated = await fetchChallenge(currentChallengeId);
  if (updated) showRivalry(updated);
}

// ── Utils ─────────────────────────────────────────────────────

function firstName(name) { return name ? name.split(' ')[0] : name; }

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ── Start ─────────────────────────────────────────────────────

init();
