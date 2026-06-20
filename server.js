require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = (process.env.REDIRECT_URI || `http://localhost:${PORT}/auth/callback`).trim();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS athletes (
      id TEXT PRIMARY KEY,
      name TEXT,
      photo_url TEXT,
      token TEXT
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      name TEXT,
      start_date BIGINT,
      end_date BIGINT
    );
    CREATE TABLE IF NOT EXISTS challenge_riders (
      challenge_id TEXT REFERENCES challenges(id),
      athlete_id  TEXT REFERENCES athletes(id),
      miles       REAL DEFAULT 0,
      PRIMARY KEY (challenge_id, athlete_id)
    );
  `);
}

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

    await pool.query(
      `INSERT INTO athletes (id, name, photo_url, token)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name=$2, photo_url=$3, token=$4`,
      [athleteId, `${athlete.firstname} ${athlete.lastname}`, athlete.profile_medium, access_token]
    );

    req.session.athleteId = athleteId;

    const pendingId = req.session.pendingChallenge;
    if (pendingId) {
      const { rows } = await pool.query('SELECT * FROM challenges WHERE id=$1', [pendingId]);
      if (rows.length) {
        const c = rows[0];
        const { rows: existing } = await pool.query(
          'SELECT * FROM challenge_riders WHERE challenge_id=$1', [pendingId]
        );
        const alreadyIn = existing.some(r => r.athlete_id === athleteId);
        if (!alreadyIn && existing.length < 2) {
          const miles = await fetchMilesSince(access_token, c.start_date);
          await pool.query(
            'INSERT INTO challenge_riders (challenge_id, athlete_id, miles) VALUES ($1,$2,$3)',
            [pendingId, athleteId, miles]
          );
        }
        return res.redirect(`/c/${pendingId}`);
      }
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
  const start = startDate || Math.floor(Date.now() / 1000);
  const end   = endDate   || start + 30 * 86400;

  const { rows: [athlete] } = await pool.query('SELECT token FROM athletes WHERE id=$1', [athleteId]);
  const miles = await fetchMilesSince(athlete.token, start);

  const id = generateId();
  await pool.query(
    'INSERT INTO challenges (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)',
    [id, name, start, end]
  );
  await pool.query(
    'INSERT INTO challenge_riders (challenge_id, athlete_id, miles) VALUES ($1,$2,$3)',
    [id, athleteId, miles]
  );
  res.json({ id });
});

app.get('/api/me', async (req, res) => {
  const athleteId = req.session.athleteId;
  if (!athleteId) return res.json({ connected: false, athlete: null, challenges: [] });

  const { rows: [athlete] } = await pool.query('SELECT id, name, photo_url FROM athletes WHERE id=$1', [athleteId]);
  if (!athlete) return res.json({ connected: false, athlete: null, challenges: [] });

  const { rows: riderRows } = await pool.query(
    'SELECT challenge_id FROM challenge_riders WHERE athlete_id=$1', [athleteId]
  );
  const challengeIds = riderRows.map(r => r.challenge_id);
  const challenges = await Promise.all(challengeIds.map(id => formatChallenge(id, athleteId)));

  res.json({
    connected: true,
    athlete: { id: athlete.id, name: athlete.name, photoUrl: athlete.photo_url },
    challenges: challenges.filter(Boolean),
  });
});

app.get('/api/challenge/:id', async (req, res) => {
  const c = await formatChallenge(req.params.id, req.session.athleteId);
  if (!c) return res.status(404).json({ error: 'Challenge not found' });
  res.json(c);
});

app.post('/api/challenge/:id/join', async (req, res) => {
  const athleteId = req.session.athleteId;
  if (!athleteId) return res.status(401).json({ error: 'Not connected' });

  const { rows: [c] } = await pool.query('SELECT * FROM challenges WHERE id=$1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });

  const { rows: riders } = await pool.query(
    'SELECT * FROM challenge_riders WHERE challenge_id=$1', [req.params.id]
  );
  if (riders.length >= 2) return res.status(400).json({ error: 'Challenge is full' });
  if (riders.some(r => r.athlete_id === athleteId)) return res.status(400).json({ error: 'Already in this challenge' });

  const { rows: [athlete] } = await pool.query('SELECT token FROM athletes WHERE id=$1', [athleteId]);
  const miles = await fetchMilesSince(athlete.token, c.start_date);
  await pool.query(
    'INSERT INTO challenge_riders (challenge_id, athlete_id, miles) VALUES ($1,$2,$3)',
    [req.params.id, athleteId, miles]
  );

  res.json(await formatChallenge(req.params.id, athleteId));
});

app.post('/api/challenge/:id/refresh', async (req, res) => {
  const athleteId = req.session.athleteId;
  const { rows: [c] } = await pool.query('SELECT * FROM challenges WHERE id=$1', [req.params.id]);
  const { rows: riders } = await pool.query(
    'SELECT * FROM challenge_riders WHERE challenge_id=$1 AND athlete_id=$2',
    [req.params.id, athleteId]
  );
  if (!c || !athleteId || !riders.length) return res.status(401).json({ error: 'Not authorized' });

  const { rows: [athlete] } = await pool.query('SELECT token FROM athletes WHERE id=$1', [athleteId]);
  const miles = await fetchMilesSince(athlete.token, c.start_date);
  await pool.query(
    'UPDATE challenge_riders SET miles=$1 WHERE challenge_id=$2 AND athlete_id=$3',
    [miles, req.params.id, athleteId]
  );
  res.json(await formatChallenge(req.params.id, athleteId));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function formatChallenge(id, currentAthleteId) {
  const { rows: [c] } = await pool.query('SELECT * FROM challenges WHERE id=$1', [id]);
  if (!c) return null;

  const { rows: riders } = await pool.query(
    `SELECT cr.miles, cr.athlete_id, a.name, a.photo_url
     FROM challenge_riders cr
     JOIN athletes a ON a.id = cr.athlete_id
     WHERE cr.challenge_id = $1`,
    [id]
  );

  const nowSec = Math.floor(Date.now() / 1000);
  const secondsLeft = Math.max(0, c.end_date - nowSec);
  const daysLeft = Math.ceil(secondsLeft / 86400);
  const totalDays = Math.ceil((c.end_date - c.start_date) / 86400);

  return {
    id: c.id,
    name: c.name,
    startDate: c.start_date,
    endDate: c.end_date,
    totalDays,
    daysLeft,
    ended: secondsLeft === 0,
    full: riders.length === 2,
    riders: riders.map(r => ({
      id: r.athlete_id,
      name: r.name,
      photoUrl: r.photo_url,
      miles: r.miles,
      isMe: r.athlete_id === currentAthleteId,
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

initDb()
  .then(() => app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
