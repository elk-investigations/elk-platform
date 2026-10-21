const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'elk_client.db');

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    case_number TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    subject_name TEXT,
    case_type TEXT,
    status TEXT DEFAULT 'intake',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS case_updates (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    message TEXT NOT NULL,
    posted_by TEXT DEFAULT 'ELK Investigations',
    created_at TEXT DEFAULT (datetime('now')),
    visible_to_client INTEGER DEFAULT 1,
    FOREIGN KEY (case_id) REFERENCES cases(id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    label TEXT,
    doc_type TEXT,
    nas_path TEXT,
    uploaded_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    client_visible INTEGER DEFAULT 0,
    FOREIGN KEY (case_id) REFERENCES cases(id)
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    client_response TEXT,
    responded_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id)
  );

  CREATE TABLE IF NOT EXISTS retainers (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    pdf_path TEXT,
    signature_png_path TEXT,
    signed_at TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS deliverables_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    client_email TEXT NOT NULL,
    case_id TEXT,
    case_number TEXT,
    action TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    accessed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );
`);

module.exports = db;
