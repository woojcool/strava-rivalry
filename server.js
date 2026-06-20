require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;

// In-memory store: { athleteId -> { name, photoUrl, token, miles } }
const riders = {};
// Track the two "slots": [athleteId1, athleteId2]
let slots = [];

app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'strava-rivalry-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false },
}));

app.get('/auth/login', (req, res) => {
  const scope = 'activity:read_all';
  const url = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=denied');

  try {
    const tokenRes = await axios.post('https://www.strava.com/oauth/token', {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    });

    const { access_token, athlete } = tokenRes.data;
    const athleteId = String(athlete.id);

    const miles = await fetchMonthlyMiles(access_token);

    riders[athleteId] = {
      name: `${athlete.firstname} ${athlete.lastname}`,
      photoUrl: athlete.profile_medium,
      miles,
    };

    // Add to slots if not already present (max 2 riders)
    if (!slots.includes(athleteId)) {
      if (slots.length < 2) slots.push(athleteId);
      else slots[1] = athleteId; // replace second slot if full
    }

    req.session.athleteId = athleteId;
    res.redirect('/');
  } catch (err) {
    console.error('Auth error:', err.response?.data || err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/api/status', (req, res) => {
  const athleteId = req.session.athleteId;
  const me = athleteId ? riders[athleteId] : null;
  const rider1 = slots[0] ? riders[slots[0]] : null;
  const rider2 = slots[1] ? riders[slots[1]] : null;

  res.json({
    connected: !!me,
    me: me ? { ...me, isMe: true } : null,
    rider1,
    rider2,
    slotCount: slots.length,
  });
});

app.post('/api/refresh', async (req, res) => {
  const athleteId = req.session.athleteId;
  if (!athleteId || !riders[athleteId]) return res.status(401).json({ error: 'Not connected' });

  try {
    const miles = await fetchMonthlyMiles(riders[athleteId].token);
    riders[athleteId].miles = miles;
    res.json({ miles });
  } catch (err) {
    res.status(500).json({ error: 'Refresh failed' });
  }
});

app.post('/api/reset', (req, res) => {
  slots = [];
  Object.keys(riders).forEach(k => delete riders[k]);
  req.session.destroy();
  res.json({ ok: true });
});

async function fetchMonthlyMiles(token) {
  const now = new Date();
  const afterTs = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  let page = 1;
  let totalMeters = 0;

  while (true) {
    const { data } = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      headers: { Authorization: `Bearer ${token}` },
      params: { after: afterTs, per_page: 100, page },
    });
    if (!data.length) break;
    data.forEach(act => {
      if (act.type === 'Ride' || act.sport_type === 'Ride') {
        totalMeters += act.distance;
      }
    });
    if (data.length < 100) break;
    page++;
  }

  return Math.round((totalMeters / 1609.344) * 10) / 10; // meters → miles, 1 decimal
}

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
