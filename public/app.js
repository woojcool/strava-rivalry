const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function setMonth() {
  const now = new Date();
  document.getElementById('month-label').textContent = `${monthNames[now.getMonth()]} ${now.getFullYear()} · Bike Miles`;
}

function show(id) {
  ['connect-section', 'waiting-section', 'rivalry-section'].forEach(s => {
    document.getElementById(s).classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (!data.rider1 && !data.rider2) {
      show('connect-section');
      return;
    }

    if (data.rider1 && !data.rider2) {
      show('waiting-section');
      document.getElementById('waiting-name').textContent = `${data.rider1.name} is ready!`;
      document.getElementById('share-url-text').textContent = window.location.href.split('?')[0];
      return;
    }

    // Both riders connected
    show('rivalry-section');
    renderRivalry(data.rider1, data.rider2);
  } catch {
    showError('Could not reach the server. Is it running?');
  }
}

function renderRivalry(r1, r2) {
  // Photos & names
  document.getElementById('rider1-photo').src = r1.photoUrl || '/placeholder.png';
  document.getElementById('rider1-photo').alt = r1.name;
  document.getElementById('rider1-name').textContent = firstName(r1.name);
  document.getElementById('rider1-miles').textContent = `${r1.miles} mi`;

  document.getElementById('rider2-photo').src = r2.photoUrl || '/placeholder.png';
  document.getElementById('rider2-photo').alt = r2.name;
  document.getElementById('rider2-name').textContent = firstName(r2.name);
  document.getElementById('rider2-miles').textContent = `${r2.miles} mi`;

  // Tug-of-war bar (orange = rider1, blue fills from right)
  const total = r1.miles + r2.miles;
  const pct = total === 0 ? 50 : Math.round((r1.miles / total) * 100);
  document.getElementById('tug-bar').style.width = `${pct}%`;

  // Lead message
  const msgEl = document.getElementById('lead-message');
  if (total === 0) {
    msgEl.textContent = "Nobody has ridden yet — get out there! 🚴";
    msgEl.style.color = '#888';
  } else if (r1.miles === r2.miles) {
    msgEl.textContent = "It's a dead tie! 🤝";
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

function firstName(name) {
  return name ? name.split(' ')[0] : name;
}

function copyUrl() {
  const url = window.location.href.split('?')[0];
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}

async function resetAll() {
  if (!confirm('Reset both riders? This will disconnect everyone.')) return;
  await fetch('/api/reset', { method: 'POST' });
  loadStatus();
}

// Check for errors in URL
const params = new URLSearchParams(window.location.search);
if (params.get('error') === 'denied') showError('Strava connection was denied.');
if (params.get('error') === 'auth_failed') showError('Authentication failed. Check your Strava API credentials.');

setMonth();
loadStatus();
// Auto-refresh every 60 seconds
setInterval(loadStatus, 60_000);
