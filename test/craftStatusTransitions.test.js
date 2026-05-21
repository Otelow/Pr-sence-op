const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const test = require('node:test');

const { createCraftRequestService } = require('../src/web/services/crafts/requests');

function setupCraftDb({ restoreThrows = false } = {}) {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE weapons (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            image_path TEXT,
            craft_price INTEGER DEFAULT 0
        );
        CREATE TABLE craft_requests (
            id INTEGER PRIMARY KEY,
            user_id TEXT,
            user_name TEXT,
            weapon_id INTEGER,
            has_plan INTEGER DEFAULT 0,
            has_money INTEGER DEFAULT 0,
            request_type TEXT,
            is_test INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            crafted INTEGER DEFAULT 0,
            serial_number TEXT,
            craft_date INTEGER,
            crafted_by_id TEXT,
            crafted_by_name TEXT,
            buyer_org TEXT,
            sale_price INTEGER,
            sale_date INTEGER,
            completed_by_id TEXT,
            completed_by_name TEXT,
            stock_consumed_at INTEGER,
            refusal_reason TEXT,
            posted_to_channel INTEGER DEFAULT 0
        );
        CREATE TABLE my_weapons (
            id INTEGER PRIMARY KEY,
            craft_request_id INTEGER,
            serial_number TEXT,
            is_sold INTEGER DEFAULT 0,
            sale_discord_message_id TEXT,
            weapons_log_message_id TEXT,
            discord_message_id TEXT
        );
    `);
    db.prepare('INSERT INTO weapons (id, name) VALUES (1, ?)').run('Carbine');

    const calls = { consume: 0, restore: 0, invalidate: 0 };
    const service = createCraftRequestService({
        getDb: () => db,
        productionStatuses: ['pending', 'waiting_materials', 'in_progress', 'crafted'],
        consumeStockForCraftRequest: (request, now) => {
            calls.consume += 1;
            db.prepare('UPDATE craft_requests SET stock_consumed_at = ? WHERE id = ?').run(now, request.id);
        },
        restoreStockForCraftRequest: (request) => {
            calls.restore += 1;
            db.prepare('UPDATE craft_requests SET stock_consumed_at = NULL WHERE id = ?').run(request.id);
            if (restoreThrows) throw new Error('restore failed');
        },
        invalidateCraftCaches: () => { calls.invalidate += 1; },
    });

    function insertRequest(values = {}) {
        const result = db.prepare(`
            INSERT INTO craft_requests (
                user_id, user_name, weapon_id, status, crafted, serial_number, craft_date,
                stock_consumed_at, completed_by_id, completed_by_name, buyer_org, sale_price, sale_date
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            values.user_id || 'u1',
            values.user_name || 'User',
            values.status || 'pending',
            values.crafted ? 1 : 0,
            values.serial_number || null,
            values.craft_date || null,
            values.stock_consumed_at || null,
            values.completed_by_id || null,
            values.completed_by_name || null,
            values.buyer_org || null,
            values.sale_price ?? null,
            values.sale_date || null
        );
        return result.lastInsertRowid;
    }

    return { db, service, calls, insertRequest };
}

test('transition simple sans stock : pending -> waiting_materials', () => {
    const { db, service, calls, insertRequest } = setupCraftDb();
    const id = insertRequest();

    service.transitionCraftRequestStatus(id, 'waiting_materials');

    assert.equal(db.prepare('SELECT status FROM craft_requests WHERE id = ?').get(id).status, 'waiting_materials');
    assert.equal(calls.consume, 0);
    assert.equal(calls.restore, 0);
    db.close();
});

test('passage en crafted consomme le stock et renseigne les champs craft', () => {
    const { db, service, calls, insertRequest } = setupCraftDb();
    const id = insertRequest({ status: 'in_progress' });

    service.updateRequestCraft(id, true, 'SER-001', 'crafter-1', 'Ney');

    const row = db.prepare('SELECT * FROM craft_requests WHERE id = ?').get(id);
    assert.equal(row.status, 'crafted');
    assert.equal(row.crafted, 1);
    assert.equal(row.serial_number, 'SER-001');
    assert.equal(row.crafted_by_id, 'crafter-1');
    assert.ok(row.stock_consumed_at);
    assert.equal(calls.consume, 1);
    db.close();
});

test('retour arriere depuis crafted restaure le stock, nettoie les champs et supprime arme non loguee', () => {
    const { db, service, calls, insertRequest } = setupCraftDb();
    const id = insertRequest({
        status: 'crafted',
        crafted: true,
        serial_number: 'SER-002',
        craft_date: 123,
        stock_consumed_at: 456,
        completed_by_id: 'seller',
        completed_by_name: 'Seller',
        buyer_org: 'Org',
        sale_price: 100,
        sale_date: 789,
    });
    db.prepare('INSERT INTO my_weapons (craft_request_id, serial_number) VALUES (?, ?)').run(id, 'SER-002');

    service.transitionCraftRequestStatus(id, 'rejected', { reason: 'absence stock' });

    const row = db.prepare('SELECT * FROM craft_requests WHERE id = ?').get(id);
    assert.equal(row.status, 'rejected');
    assert.equal(row.crafted, 0);
    assert.equal(row.serial_number, null);
    assert.equal(row.stock_consumed_at, null);
    assert.equal(row.completed_by_id, null);
    assert.equal(row.buyer_org, null);
    assert.equal(row.refusal_reason, 'absence stock');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM my_weapons').get().n, 0);
    assert.equal(calls.restore, 1);
    db.close();
});

test('transition interdite depuis completed vers un statut anterieur', () => {
    const { service, insertRequest, db } = setupCraftDb();
    const id = insertRequest({ status: 'completed' });

    assert.throws(
        () => service.transitionCraftRequestStatus(id, 'pending'),
        error => error.statusCode === 409
    );
    db.close();
});

test('rollback complet si une etape de restauration echoue', () => {
    const { db, service, insertRequest } = setupCraftDb({ restoreThrows: true });
    const id = insertRequest({
        status: 'crafted',
        crafted: true,
        serial_number: 'SER-003',
        stock_consumed_at: 999,
    });

    assert.throws(() => service.transitionCraftRequestStatus(id, 'rejected'), /restore failed/);

    const row = db.prepare('SELECT status, crafted, serial_number, stock_consumed_at FROM craft_requests WHERE id = ?').get(id);
    assert.deepEqual(row, {
        status: 'crafted',
        crafted: 1,
        serial_number: 'SER-003',
        stock_consumed_at: 999,
    });
    db.close();
});
