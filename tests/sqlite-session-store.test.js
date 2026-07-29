const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SqliteSessionStore } = require("../src/sqlite-session-store");

function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) =>
      error ? reject(error) : resolve(value),
    );
  });
}

test("persists and deletes LAN sessions in SQLite", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "searchops-session-"));
  const filename = path.join(directory, "sessions.sqlite");
  const first = new SqliteSessionStore({ filename });
  await call(first, "set", "session-1", {
    userId: 42,
    cookie: { expires: new Date(Date.now() + 60_000) },
  });
  first.close();

  const second = new SqliteSessionStore({ filename });
  const restored = await call(second, "get", "session-1");
  assert.equal(restored.userId, 42);
  await call(second, "destroy", "session-1");
  assert.equal(await call(second, "get", "session-1"), null);
  second.close();
});
