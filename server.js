require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = (process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`).trim();

const athletes = {};
const challenges = {};

function generateId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'strava-rivalry-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false },
}));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.get('/auth/login', (req, res) => {
  req.session.pendingChallenge = req.query.challenge || null;
  const url = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=activity:read_all`;
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

    athletes[athleteId] = {
      name: `${athlete.firstname} ${athlete.lastname}`,
      photoUrl: athlete.profile_medium,
      token: access_token,
    };
    req.session.athleteId = athleteId;
    if (!req.session.myChallenges) req.session.myChallenges = [];

    const pendingId = req.session.pendingChallenge;
    if (pendingId && challenges[pendingId]) {
      const c = challenges[pendingId];
      if (!c.riders.includes(athleteId) && c.riders.length < 2) {
        const miles = await fetchMilesSince(access_token, c.startDate);
        c.riders.push(athleteId);
        c.miles[athleteId] = miles;
        if (!req.session.myChallenges.includes(pendingId)) req.session.myChallenges.push(pendingId);
      }
      return res.redirect(`/c/${pendingId}`);
    }

    res.redirect('/');
  } catch (err) {
    console.error('Auth error:', err.response?.data || err.message);
    res.redirect('/?error=auth_failed');
  }
});

// ── API ───────────────────────────────────────────────────────────────────────

app.post('/api/challenge/create', async (req, res) => {
  const athleteId = req.session.athleteId;
  if (!athleteId) return res.status(401).json({ error: 'Not connected' });

  const { name = 'Rivalry', startDate, endDate } = req.body;

  // startDate/endDate are Unix seconds from the client
  const start = startDate || Math.floor(Date.now() / 1000);
  const end = endDate || start + 30 * 86400;

  const miles = await fetchMilesSince(athletes[athleteId].token, start);
  const challengeId = generateId();
  challenges[challengeId] = {
    id: challengeId,
    name,
    startDate: start,
    endDate: end,
    riders: [athleteId],
    miles: { [athleteId]: miles },
  };
  if (!req.session.myChallenges) req.session.myChallenges = [];
  req.session.myChallenges.push(challengeId);
  res.json({ id: challengeId });
});

app.get('/api/me', (req, res) => {
  const athleteId = req.session.athleteId;
  const myChallenges = (req.session.myChallenges || []).filter(id => challenges[id]);
  res.json({
    connected: !!athleteId,
    athlete: athleteId ? { id: athleteId, name: athletes[athleteId]?.name, photoUrl: athletes[athleteId]?.photoUrl } : null,
    challenges: myChallenges.map(id => formatChallenge(id, athleteId)),
  });
});

app.get('/api/challenge/:id', (req, res) => {
  const c = challenges[req.params.id];
  if (!c) return res.status(404).json({ error: 'Challenge not found' });
  res.json(formatChallenge(req.params.id, req.session.athleteId));
});

app.post('/api/challenge/:id/join', async (req, res) => {
  const athleteId = req.session.athleteId;
  const c = challenges[req.params.id];
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!athleteId) return res.status(401).json({ error: 'Not connected' });
  if (c.riders.length >= 2) return res.status(400).json({ error: 'Challenge is full' });
  if (c.riders.includes(athleteId)) return res.status(400).json({ error: 'Already in this challenge' });

  const miles = await fetchMilesSince(athletes[athleteId].token, c.startDate);
  c.riders.push(athleteId);
  c.miles[athleteId] = miles;
  if (!req.session.myChallenges) req.session.myChallenges = [];
  if (!req.session.myChallenges.includes(req.params.id)) req.session.myChallenges.push(req.params.id);
  res.json(formatChallenge(req.params.id, athleteId));
});

app.post('/api/challenge/:id/refresh', async (req, res) => {
  const athleteId = req.session.athleteId;
  const c = challenges[req.params.id];
  if (!c || !athleteId || !c.riders.includes(athleteId)) return res.status(401).json({ error: 'Not authorized' });
  const miles = await fetchMilesSince(athletes[athleteId].token, c.startDate);
  c.miles[athleteId] = miles;
  res.json(formatChallenge(req.params.id, athleteId));
});

function formatChallenge(id, currentAthleteId) {
  const c = challenges[id];
  const nowSec = Math.floor(Date.now() / 1000);
  const secondsLeft = Math.max(0, c.endDate - nowSec);
  const daysLeft = Math.ceil(secondsLeft / 86400);
  const totalDays = Math.ceil((c.endDate - c.startDate) / 86400);
  return {
    id: c.id,
    name: c.name,
    startDate: c.startDate,
    endDate: c.endDate,
    totalDays,
    daysLeft,
    ended: secondsLeft === 0,
    full: c.riders.length === 2,
    riders: c.riders.map(aid => ({
      id: aid,
      name: athletes[aid]?.name,
      photoUrl: athletes[aid]?.photoUrl,
      miles: c.miles[aid] || 0,
      isMe: aid === currentAthleteId,
    })),
  };
}

async function fetchMilesSince(token, afterTs) {
  let page = 1, totalMeters = 0;
  while (true) {
    const { data } = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      headers: { Authorization: `Bearer ${token}` },
      params: { after: afterTs, per_page: 100, page },
    });
    if (!data.length) break;
    data.forEach(act => {
      if (act.type === 'Ride' || act.sport_type === 'Ride') totalMeters += act.distance;
    });
    if (data.length < 100) break;
    page++;
  }
  return Math.round((totalMeters / 1609.344) * 10) / 10;
}

// Serve index.html for all non-API routes (SPA routing)
app.get(/^(?!\/api|\/auth).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
