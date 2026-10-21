const router = require('express').Router();

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.clientId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.session.clientId, name: req.session.clientName, email: req.session.clientEmail });
});

module.exports = router;
