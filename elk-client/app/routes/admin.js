const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'] || req.query.key;
  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Create a client account (ELK manually runs this)
router.post('/clients', requireAdmin, (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, password required' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const id = uuidv4();

  try {
    db.prepare(`
      INSERT INTO clients (id, name, email, password_hash, phone)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, email.toLowerCase().trim(), hash, phone || null);
    res.json({ ok: true, id });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
});

// List all clients
router.get('/clients', requireAdmin, (req, res) => {
  const clients = db.prepare('SELECT id, name, email, phone, created_at, active FROM clients ORDER BY created_at DESC').all();
  res.json(clients);
});

// Create a case for a client
router.post('/cases', requireAdmin, (req, res) => {
  const { client_id, case_number, subject_name, case_type, status } = req.body;
  if (!client_id || !case_number) return res.status(400).json({ error: 'client_id and case_number required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO cases (id, case_number, client_id, subject_name, case_type, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, case_number, client_id, subject_name || null, case_type || 'general', status || 'active');

  res.json({ ok: true, id });
});

// Post an update to a case (visible to client)
router.post('/cases/:caseId/update', requireAdmin, (req, res) => {
  const { message, visible_to_client } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const id = uuidv4();
  const vis = visible_to_client === false ? 0 : 1;

  db.prepare(`
    INSERT INTO case_updates (id, case_id, message, posted_by, visible_to_client)
    VALUES (?, ?, ?, 'ELK Investigations', ?)
  `).run(id, req.params.caseId, message, vis);

  db.prepare(`UPDATE cases SET updated_at = datetime('now') WHERE id = ?`).run(req.params.caseId);

  res.json({ ok: true, id });
});

// Create an approval request
router.post('/cases/:caseId/approval', requireAdmin, (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO approvals (id, case_id, title, description)
    VALUES (?, ?, ?, ?)
  `).run(id, req.params.caseId, title, description || null);

  res.json({ ok: true, id });
});

// Register a document (NAS path) as visible to client
router.post('/cases/:caseId/document', requireAdmin, (req, res) => {
  const { filename, label, doc_type, nas_path, client_visible } = req.body;
  if (!filename || !nas_path) return res.status(400).json({ error: 'filename and nas_path required' });

  const id = uuidv4();
  const vis = client_visible === true ? 1 : 0;

  db.prepare(`
    INSERT INTO documents (id, case_id, filename, label, doc_type, nas_path, uploaded_by, client_visible)
    VALUES (?, ?, ?, ?, ?, ?, 'ELK Investigations', ?)
  `).run(id, req.params.caseId, filename, label || filename, doc_type || 'report', nas_path, vis);

  res.json({ ok: true, id });
});

// Update case status
router.patch('/cases/:caseId/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare(`UPDATE cases SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.caseId);
  res.json({ ok: true });
});

// Set Synology deliverables share link on a case
router.patch('/cases/:caseId/deliverables', requireAdmin, (req, res) => {
  const { deliverables_url, deliverables_label } = req.body;
  db.prepare(`
    UPDATE cases SET deliverables_url = ?, deliverables_label = ?, updated_at = datetime('now') WHERE id = ?
  `).run(deliverables_url || null, deliverables_label || 'View Deliverables', req.params.caseId);
  res.json({ ok: true });
});

// Get all cases (admin view)
router.get('/cases', requireAdmin, (req, res) => {
  const cases = db.prepare(`
    SELECT c.*, cl.name as client_name, cl.email as client_email
    FROM cases c JOIN clients cl ON c.client_id = cl.id
    ORDER BY c.updated_at DESC
  `).all();
  res.json(cases);
});

// Get case detail (admin view)
router.get('/cases/:caseId', requireAdmin, (req, res) => {
  const c = db.prepare(`
    SELECT c.*, cl.name as client_name, cl.email as client_email
    FROM cases c JOIN clients cl ON c.client_id = cl.id
    WHERE c.id = ?
  `).get(req.params.caseId);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const updates = db.prepare(`SELECT * FROM case_updates WHERE case_id = ? ORDER BY created_at DESC`).all(c.id);
  res.json({ case: c, updates });
});

// Audit log — deliverables access
router.get('/audit-log', requireAdmin, (req, res) => {
  const log = db.prepare(`
    SELECT * FROM deliverables_access_log ORDER BY accessed_at DESC LIMIT 200
  `).all();
  res.json(log);
});

// Admin panel HTML (protected by CF Access + admin key session)
router.get('/panel', (req, res) => {
  const email = (req.headers['cf-access-authenticated-user-email'] || '').toLowerCase().trim();
  if (email !== process.env.ADMIN_EMAIL) return res.status(403).send('Access denied.');
  res.sendFile(require('path').join(__dirname, '..', 'templates', 'admin-panel.html'));
});

module.exports = router;
