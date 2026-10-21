const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const authRoutes = require('./routes/auth');
const caseRoutes = require('./routes/case');
const adminRoutes = require('./routes/admin');
const onboardRoutes = require('./routes/onboard');

const app = express();
const PORT = process.env.PORT || 8070;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'static')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'elk-client-session-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,  // Cloudflare Tunnel handles HTTPS upstream
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000  // 8 hours
  }
}));

// Deliverables access logging middleware
app.post('/log/deliverables-access', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  const { case_id, case_number, action } = req.body;
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
  const ua = req.headers['user-agent'] || '';
  try {
    db.prepare(`
      INSERT INTO deliverables_access_log (client_id, client_email, case_id, case_number, action, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.session.clientId, req.session.clientEmail, case_id || null, case_number || null, action || 'view_deliverables', ip, ua);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Log failed' });
  }
});

// Routes
app.use('/auth', authRoutes);
app.use('/case', caseRoutes);
app.use('/admin', adminRoutes);
app.use('/onboard', onboardRoutes);

// Root — auto-login from Cloudflare Access header
app.get('/', (req, res) => {
  const email = (req.headers['cf-access-authenticated-user-email'] || '').toLowerCase().trim();

  if (!email) {
    return res.status(401).send('Authentication required. Please access this portal through the secure link provided by ELK Investigations.');
  }

  if (req.session.clientId) {
    return res.redirect('/case/dashboard');
  }

  const client = db.prepare('SELECT * FROM clients WHERE email = ? AND active = 1').get(email);
  if (!client) {
    return res.status(403).sendFile(path.join(__dirname, 'templates', 'not_authorized.html'));
  }

  req.session.clientId = client.id;
  req.session.clientName = client.name;
  req.session.clientEmail = client.email;
  res.redirect('/case/dashboard');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ELK Client Portal running on port ${PORT}`);
});
