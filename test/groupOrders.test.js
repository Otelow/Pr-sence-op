const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const test = require('node:test');

const { createGroupOrderService } = require('../src/web/services/crafts/groupOrders');

function setupGroupOrdersDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE organizations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE weapons (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            max_sale_price INTEGER DEFAULT 0
        );
        CREATE TABLE group_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER,
            organization_name TEXT NOT NULL,
            order_date TEXT,
            subtotal_amount INTEGER NOT NULL DEFAULT 0,
            discount_percent REAL NOT NULL DEFAULT 0,
            discount_amount INTEGER NOT NULL DEFAULT 0,
            total_amount INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'open',
            note TEXT,
            created_by_id TEXT,
            created_by_name TEXT,
            updated_by_id TEXT,
            updated_by_name TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE group_order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            weapon_id INTEGER,
            weapon_name TEXT NOT NULL,
            unit_price INTEGER NOT NULL DEFAULT 0,
            quantity INTEGER NOT NULL DEFAULT 0,
            line_total INTEGER NOT NULL DEFAULT 0,
            crafted_quantity INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE group_order_crafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            item_id INTEGER NOT NULL,
            weapon_id INTEGER,
            weapon_name TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            serial_numbers TEXT DEFAULT '[]',
            crafted_by_id TEXT,
            crafted_by_name TEXT,
            craft_date TEXT,
            note TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now'))
        );
    `);
    db.prepare('INSERT INTO organizations (id, name) VALUES (1, ?)').run('Ballas');
    db.prepare('INSERT INTO weapons (id, name, max_sale_price) VALUES (10, ?, 5000000)').run('Pistolet Cal.50');
    db.prepare('INSERT INTO weapons (id, name, max_sale_price) VALUES (11, ?, 9000000)').run('Micro SMG');

    const catalog = [
        { id: 1, name: 'Pistolet Cal.50', max_sale_price: 5000000, sale_price: 4500000 },
        { id: 2, name: 'Micro SMG', max_sale_price: 9000000, sale_price: 8000000 },
        { id: 3, name: 'Prix Manquant', max_sale_price: 0, sale_price: 0 },
    ];
    const service = createGroupOrderService({
        getDb: () => db,
        getAllOrgs: () => [{ id: 1, name: 'Ballas' }],
        getAllMyWeaponNamesWithPriceLimits: () => catalog,
        getWeaponByName: name => db.prepare('SELECT * FROM weapons WHERE name = ?').get(name),
    });

    return { db, service };
}

const actor = { id: 'admin-1', username: 'Admin' };

test('création commande groupe avec prix maximal et réduction', () => {
    const { db, service } = setupGroupOrdersDb();

    const order = service.upsertGroupOrder({
        organization_id: 1,
        discount_percent: 10,
        items: [
            { weapon_name: 'Pistolet Cal.50', quantity: 3 },
            { weapon_name: 'Micro SMG', quantity: 2 },
        ],
    }, actor);

    assert.equal(order.organization_name, 'Ballas');
    assert.equal(order.subtotal_amount, 33_000_000);
    assert.equal(order.discount_amount, 3_300_000);
    assert.equal(order.total_amount, 29_700_000);
    assert.equal(order.items[0].unit_price, 5_000_000);
    assert.equal(order.status, 'open');
    db.close();
});

test('édition recalcule les montants côté serveur', () => {
    const { db, service } = setupGroupOrdersDb();
    const order = service.upsertGroupOrder({
        organization_id: 1,
        discount_percent: 0,
        items: [{ weapon_name: 'Pistolet Cal.50', quantity: 1 }],
    }, actor);

    const updated = service.upsertGroupOrder({
        organization_id: 1,
        discount_percent: 20,
        items: [{ id: order.items[0].id, weapon_name: 'Pistolet Cal.50', quantity: 4 }],
    }, actor, order.id);

    assert.equal(updated.subtotal_amount, 20_000_000);
    assert.equal(updated.discount_amount, 4_000_000);
    assert.equal(updated.total_amount, 16_000_000);
    db.close();
});

test('refuse une arme sans prix maximal configuré', () => {
    const { db, service } = setupGroupOrdersDb();

    assert.throws(
        () => service.upsertGroupOrder({
            organization_id: 1,
            items: [{ weapon_name: 'Prix Manquant', quantity: 1 }],
        }, actor),
        /Prix maximal non configuré/
    );
    db.close();
});

test('craft multiple sur plusieurs armes et statut partiel puis crafted', () => {
    const { db, service } = setupGroupOrdersDb();
    const order = service.upsertGroupOrder({
        organization_id: 1,
        items: [
            { weapon_name: 'Pistolet Cal.50', quantity: 2 },
            { weapon_name: 'Micro SMG', quantity: 1 },
        ],
    }, actor);

    const partial = service.recordGroupOrderCraft(order.id, {
        items: [
            { item_id: order.items[0].id, quantity: 1, serial_numbers: ['A-001'] },
            { item_id: order.items[1].id, quantity: 1, serial_numbers: ['B-001'] },
        ],
    }, actor);

    assert.equal(partial.status, 'partial');
    assert.equal(partial.progress.crafted, 2);
    assert.equal(partial.progress.remaining, 1);

    const crafted = service.recordGroupOrderCraft(order.id, {
        items: [{ item_id: order.items[0].id, quantity: 1, serial_numbers: ['A-002'] }],
    }, actor);

    assert.equal(crafted.status, 'crafted');
    assert.equal(crafted.progress.remaining, 0);
    db.close();
});

test('interdit de réduire une ligne sous la quantité déjà craftée', () => {
    const { db, service } = setupGroupOrdersDb();
    const order = service.upsertGroupOrder({
        organization_id: 1,
        items: [{ weapon_name: 'Pistolet Cal.50', quantity: 3 }],
    }, actor);
    service.recordGroupOrderCraft(order.id, {
        items: [{ item_id: order.items[0].id, quantity: 2, serial_numbers: ['A-010', 'A-011'] }],
    }, actor);

    assert.throws(
        () => service.upsertGroupOrder({
            organization_id: 1,
            items: [{ id: order.items[0].id, weapon_name: 'Pistolet Cal.50', quantity: 1 }],
        }, actor, order.id),
        /sous la quantité déjà craftée/
    );
    db.close();
});

test('interdit de dépasser la quantité restante et les doublons de série', () => {
    const { db, service } = setupGroupOrdersDb();
    const order = service.upsertGroupOrder({
        organization_id: 1,
        items: [{ weapon_name: 'Pistolet Cal.50', quantity: 2 }],
    }, actor);

    assert.throws(
        () => service.recordGroupOrderCraft(order.id, {
            items: [{ item_id: order.items[0].id, quantity: 3 }],
        }, actor),
        /dépasser le restant/
    );

    service.recordGroupOrderCraft(order.id, {
        items: [{ item_id: order.items[0].id, quantity: 1, serial_numbers: ['A-020'] }],
    }, actor);

    assert.throws(
        () => service.recordGroupOrderCraft(order.id, {
            items: [{ item_id: order.items[0].id, quantity: 1, serial_numbers: ['A-020'] }],
        }, actor),
        /déjà renseigné/
    );
    db.close();
});
