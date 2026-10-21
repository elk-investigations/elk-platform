const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

function requireClient(req, res, next) {
  if (!req.session.clientId) return res.redirect('/');
  next();
}

const upload = multer({
  dest: '/tmp/elk_uploads/',
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Onboarding page
router.get('/', requireClient, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'templates', 'onboard.html'));
});

// API: submit intake form
router.post('/api/intake', requireClient, (req, res) => {
  const { case_type, subject_name, description } = req.body;
  if (!case_type) return res.status(400).json({ error: 'Case type required' });

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();

  const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(req.session.clientId);
  const initials = (client.name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'CL';

  const seq = db.prepare(`
    SELECT COUNT(*) as cnt FROM cases
    WHERE client_id = ? AND strftime('%Y-%m', created_at) = ?
  `).get(req.session.clientId, `${year}-${month}`).cnt + 1;

  const subjInitials = (subject_name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3) || 'UNK';
  const caseNumber = `ELK-${initials}-${year}-${month}-${String(seq).padStart(3, '0')}-${subjInitials}`;

  const caseId = uuidv4();
  db.prepare(`
    INSERT INTO cases (id, case_number, client_id, subject_name, case_type, status)
    VALUES (?, ?, ?, ?, ?, 'intake')
  `).run(caseId, caseNumber, req.session.clientId, subject_name || null, case_type);

  if (description) {
    db.prepare(`
      INSERT INTO case_updates (id, case_id, message, posted_by, visible_to_client)
      VALUES (?, ?, ?, 'Client', 1)
    `).run(uuidv4(), caseId, description);
  }

  res.json({ ok: true, caseId, caseNumber });
});

// API: save canvas e-signature for retainer
router.post('/api/sign/:caseId', requireClient, (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE id = ? AND client_id = ?')
    .get(req.params.caseId, req.session.clientId);
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const { signature_data_url } = req.body;
  if (!signature_data_url || !signature_data_url.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Invalid signature data' });
  }

  // Strip the data URL prefix and save as PNG
  const base64 = signature_data_url.replace('data:image/png;base64,', '');
  const sigDir = path.join(process.env.NAS_PATH || '/nas', '04 — Case Files', 'Retainers');
  const sigFilename = `SIG_${c.case_number}_${Date.now()}.png`;
  const sigPath = path.join(sigDir, sigFilename);

  try {
    fs.mkdirSync(sigDir, { recursive: true });
    fs.writeFileSync(sigPath, Buffer.from(base64, 'base64'));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save signature' });
  }

  const nasRelPath = `/04 — Case Files/Retainers/${sigFilename}`;

  // Create or update retainer record
  const existing = db.prepare('SELECT id FROM retainers WHERE case_id = ?').get(c.id);
  if (existing) {
    db.prepare(`
      UPDATE retainers SET signature_png_path = ?, signed_at = datetime('now'), status = 'signed'
      WHERE case_id = ?
    `).run(nasRelPath, c.id);
  } else {
    db.prepare(`
      INSERT INTO retainers (id, case_id, client_id, signature_png_path, signed_at, status)
      VALUES (?, ?, ?, ?, datetime('now'), 'signed')
    `).run(uuidv4(), c.id, req.session.clientId, nasRelPath);
  }

  db.prepare(`UPDATE cases SET status = 'retainer_signed', updated_at = datetime('now') WHERE id = ?`).run(c.id);

  res.json({ ok: true });
});

module.exports = router;
