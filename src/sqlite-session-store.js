const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const session = require("express-session");

class SqliteSessionStore extends session.Store {
  constructor({ filename, cleanupIntervalMs = 15 * 60 * 1000 }) {
    super();
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_at
        ON sessions (expires_at);
    `);
    this.cleanupTimer = setInterval(() => this.prune(), cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    try {
      const row = this.db
        .prepare("SELECT data, expires_at FROM sessions WHERE sid = ?")
        .get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }
      callback(null, JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, value, callback = () => {}) {
    try {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.db
        .prepare(
          `INSERT INTO sessions (sid, expires_at, data)
           VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET
             expires_at = excluded.expires_at,
             data = excluded.data`,
        )
        .run(sid, expiresAt, JSON.stringify(value));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, value, callback = () => {}) {
    try {
      const expiresAt = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      this.db
        .prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?")
        .run(expiresAt, sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  prune() {
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
  }

  close() {
    clearInterval(this.cleanupTimer);
    this.db.close();
  }
}

module.exports = { SqliteSessionStore };
