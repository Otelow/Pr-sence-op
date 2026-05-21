const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBetterSqliteSessionStore } = require('../src/web/services/sessionStore');

function callStore(store, method, ...args) {
    return new Promise((resolve, reject) => {
        store[method](...args, (err, value) => {
            if (err) reject(err);
            else resolve(value);
        });
    });
}

test('store de session better-sqlite3 persiste, lit et supprime une session', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '21bs-session-'));
    let store;
    try {
        store = createBetterSqliteSessionStore({ dir, db: 'sessions.db', table: 'sessions_test', ttlMs: 60_000 });
        const expires = new Date(Date.now() + 60_000).toISOString();
        const session = { user: { id: '42', username: 'Otelow' }, cookie: { expires } };

        await callStore(store, 'set', 'sid-1', session);
        assert.deepEqual(await callStore(store, 'get', 'sid-1'), session);
        assert.equal(await callStore(store, 'length'), 1);

        await callStore(store, 'destroy', 'sid-1');
        assert.equal(await callStore(store, 'get', 'sid-1'), null);
    } finally {
        if (store) store.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
