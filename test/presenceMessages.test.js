const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPresenceOp1Message, isIslandPresenceDay } = require('../src/bot/services/presenceFlow');

const CONFIG = {
    ROLES: { MEMBRE_1: 'role-presence' },
    CHANNELS: { ABSENCE: 'absence-channel' },
    EMOJIS: {
        ATTENTION: ':warning:',
        CHECK: ':white_check_mark:',
        RETARD: ':clock1:',
        NO: ':x:',
    },
};

test('message OP1 QG lundi/mardi/jeudi/dimanche', () => {
    const monday = new Date(2026, 5, 1);
    assert.equal(isIslandPresenceDay(monday), false);
    const message = buildPresenceOp1Message({
        CONFIG,
        date: monday,
        dateStr: '01/06/2026',
        itemsList: '- Armes, munitions',
    });
    assert.match(message, /<@&role-presence>/);
    assert.match(message, /\*\*Présence OP\*\* du 01\/06\/2026 à \*\*21H00\*\*/);
    assert.match(message, /Soyez présent à \*\*21H00\*\* au QG/);
    assert.doesNotMatch(message, /Ponton/);
});

test('message OP1 ile mercredi/vendredi/samedi', () => {
    const wednesday = new Date(2026, 5, 3);
    assert.equal(isIslandPresenceDay(wednesday), true);
    const message = buildPresenceOp1Message({
        CONFIG,
        date: wednesday,
        dateStr: '03/06/2026',
        itemsList: '- Eau, nourriture',
    });
    assert.match(message, /pour l'Ile :warning:/);
    assert.match(message, /Soyez présent à \*\*21H15\*\* à côté du \*\*Ponton\*\*/);
    assert.match(message, /<#absence-channel>/);
});
