const router = require('express').Router();
const db = require('../db');

function requireClient(req, res, next) {
  if (!req.session.clientId) return res.redirect('/');
  next();
}

// Dashboard — list all cases for this client
router.get('/dashboard', requireClient, (req, res) => {
  const cases = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM case_updates u WHERE u.case_id = c.id AND u.visible_to_client = 1) as update_count,
      (SELECT COUNT(*) FROM approvals a WHERE a.case_id = c.id AND a.status = 'pending') as pending_approvals,
      (SELECT COUNT(*) FROM documents d WHERE d.case_id = c.id AND d.client_visible = 1) as doc_count
    FROM cases c WHERE c.client_id = ?
    ORDER BY c.updated_at DESC
  `).all(req.session.clientId);

  res.sendFile(require('path').join(__dirname, '..', 'templates', 'dashboard.html'));
});

// API: dashboard — returns client info + all cases with latest update snippet
router.get('/api/dashboard', requireClient, (req, res) => {
  const client = db.prepare('SELECT id, name, email, phone FROM clients WHERE id = ?')
    .get(req.session.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const cases = db.prepare(`
    SELECT c.*,
      (SELECT message FROM case_updates u
       WHERE u.case_id = c.id AND u.visible_to_client = 1
       ORDER BY u.created_at DESC LIMIT 1) as latest_update,
      (SELECT COUNT(*) FROM approvals a WHERE a.case_id = c.id AND a.status = 'pending') as pending_approvals,
      (SELECT COUNT(*) FROM documents d WHERE d.case_id = c.id AND d.client_visible = 1) as doc_count
    FROM cases c WHERE c.client_id = ?
    ORDER BY c.updated_at DESC
  `).all(req.session.clientId);

  res.json({ client, cases });
});

// API: get case detail
router.get('/api/case/:caseId', requireClient, (req, res) => {
  const c = db.prepare('SELECT * FROM cases WHERE id = ? AND client_id = ?')
    .get(req.params.caseId, req.session.clientId);
  if (!c) return res.status(404).json({ error: 'Case not found' });

  const updates = db.prepare(`
    SELECT * FROM case_updates WHERE case_id = ? AND visible_to_client = 1 ORDER BY created_at DESC
  `).all(c.id);

  const documents = db.prepare(`
    SELECT id, label, doc_type, filename, created_at FROM documents WHERE case_id = ? AND client_visible = 1 ORDER BY created_at DESC
  `).all(c.id);

  const approvals = db.prepare(`
    SELECT * FROM approvals WHERE case_id = ? ORDER BY created_at DESC
  `).all(c.id);

  res.json({ case: c, updates, documents, approvals });
});

// API: submit approval response — accepts 'approve'|'decline' or 'approved'|'declined'
router.post('/api/approval/:approvalId/respond', requireClient, (req, res) => {
  const { response, case_id } = req.body;
  const normalized = response === 'approve' ? 'approved' : response === 'decline' ? 'declined' : response;
  if (!['approved', 'declined'].includes(normalized)) {
    return res.status(400).json({ error: 'Invalid response' });
  }

  // Verify approval belongs to this client's case
  const appr = db.prepare(`
    SELECT a.* FROM approvals a
    JOIN cases c ON a.case_id = c.id
    WHERE a.id = ? AND c.client_id = ? AND a.status = 'pending'
  `).get(req.params.approvalId, req.session.clientId);
  if (!appr) return res.status(404).json({ error: 'Not found or already resolved' });

  db.prepare(`
    UPDATE approvals SET status = ?, client_response = ?, responded_at = datetime('now')
    WHERE id = ?
  `).run(normalized, normalized, req.params.approvalId);

  res.json({ ok: true });
});

// Document download via NAS path (served securely through this app)
router.get('/api/doc/:docId/download', requireClient, (req, res) => {
  const doc = db.prepare(`
    SELECT d.* FROM documents d
    JOIN cases c ON d.case_id = c.id
    WHERE d.id = ? AND c.client_id = ? AND d.client_visible = 1
  `).get(req.params.docId, req.session.clientId);

  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const nasPath = process.env.NAS_PATH + doc.nas_path;
  res.download(nasPath, doc.filename);
});

module.exports = router;
