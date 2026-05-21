const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const test = require('node:test');

const { createOrderAdvanceService } = require('../src/web/services/crafts/orderAdvances');

function setupOrderDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name TEXT, image_path TEXT);
        CREATE TABLE order_advances (
            id INTEGER PRIMARY KEY,
            title TEXT,
            order_date TEXT,
            total_amount INTEGER DEFAULT 0,
            recovered_amount INTEGER DEFAULT 0,
            remaining_amount INTEGER DEFAULT 0,
            note TEXT,
            status TEXT,
            discord_message_id TEXT,
            discord_channel_id TEXT,
            published_at INTEGER,
            created_at INTEGER,
            updated_at INTEGER
        );
        CREATE TABLE order_advance_participants (
            id INTEGER PRIMARY KEY,
            order_id INTEGER,
            user_id TEXT,
            user_name TEXT,
            amount_contributed INTEGER DEFAULT 0,
            amount_recovered INTEGER DEFAULT 0,
            amount_remaining INTEGER DEFAULT 0,
            amount_to_compensate_next_order INTEGER DEFAULT 0,
            note TEXT,
            created_at INTEGER,
            updated_at INTEGER
        );
        CREATE TABLE order_advance_items (
            id INTEGER PRIMARY KEY,
            order_id INTEGER,
            ingredient_name TEXT,
            unit_price INTEGER,
            quantity INTEGER,
            line_total INTEGER,
            created_at INTEGER
        );
        CREATE TABLE order_advance_repayments (
            id INTEGER PRIMARY KEY,
            order_id INTEGER,
            participant_id INTEGER,
            user_id TEXT,
            user_name TEXT,
            amount INTEGER,
            reason TEXT,
            weapon_name TEXT,
            repayment_date TEXT,
            created_at INTEGER,
            updated_at INTEGER
        );
    `);
    const service = createOrderAdvanceService({
        getDb: () => db,
        getBotClient: () => null,
        catalog: [{ name: 'Fer', unit_price: 100 }],
    });
    return { db, service };
}

test('une mise a jour conserve le participant stable et son remboursement', async () => {
    const { db, service } = setupOrderDb();
    const orderId = service.upsertOrderAdvance({
        title: 'Commande test',
        order_date: '2026-05-21',
        participants: [{ user_id: 'u1', user_name: 'Ancien nom', amount_contributed: 1000 }],
        items: [{ ingredient_name: 'Fer', quantity: 10 }],
    });
    const participant = db.prepare('SELECT * FROM order_advance_participants WHERE order_id = ?').get(orderId);
    const repaymentId = service.saveOrderAdvanceRepayment(orderId, {
        participant_id: participant.id,
        amount: 250,
        repayment_date: '2026-05-21',
        reason: 'vente',
    });

    service.upsertOrderAdvance({
        title: 'Commande test modifiee',
        order_date: '2026-05-21',
        participants: [{ user_id: 'u1', user_name: 'Nouveau nom', amount_contributed: 1200 }],
        items: [{ ingredient_name: 'Fer', quantity: 12 }],
    }, orderId);

    const updatedParticipant = db.prepare('SELECT * FROM order_advance_participants WHERE id = ?').get(participant.id);
    const repayment = db.prepare('SELECT * FROM order_advance_repayments WHERE id = ?').get(repaymentId);
    assert.equal(updatedParticipant.user_name, 'Nouveau nom');
    assert.equal(updatedParticipant.amount_contributed, 1200);
    assert.equal(repayment.participant_id, participant.id);
    assert.equal(repayment.user_id, 'u1');

    await new Promise(resolve => setTimeout(resolve, 5));
    db.close();
});
