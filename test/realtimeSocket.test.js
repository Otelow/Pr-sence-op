const assert = require('node:assert/strict');
const test = require('node:test');

const { getRealtimeRoomForEvent, getSocketRoomsForUser } = require('../src/web/realtimeSocket');
const { ADMIN_USER_ID, FULL_ACCESS_ROLES } = require('../src/shared/permissions');

test('rooms socket : utilisateur simple pas admin, admin oui', () => {
    assert.deepEqual(getSocketRoomsForUser({ id: 'simple', roles: [] }), ['authenticated']);

    const adminRoomsById = getSocketRoomsForUser({ id: ADMIN_USER_ID, roles: [] });
    assert.ok(adminRoomsById.includes('admin'));

    const adminRoomsByRole = getSocketRoomsForUser({ id: 'role-admin', roles: [FULL_ACCESS_ROLES[0]] });
    assert.ok(adminRoomsByRole.includes('admin'));
    assert.ok(adminRoomsByRole.includes('full'));
});

test('routage realtime : audit admin, evenement public global', () => {
    assert.equal(getRealtimeRoomForEvent('audit:new'), 'admin');
    assert.equal(getRealtimeRoomForEvent('sanction:update'), 'admin');
    assert.equal(getRealtimeRoomForEvent('craft:status'), 'craft');
    assert.equal(getRealtimeRoomForEvent('presence:reaction'), 'full');
    assert.equal(getRealtimeRoomForEvent('channel:message'), null);
});
