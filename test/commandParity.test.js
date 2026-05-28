const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildSlashCommands } = require('../src/bot/commands/definitions');
const { COMMANDS } = require('../src/web/routes/directory');
const { buildAlertMessages } = require('../src/web/routes/dashboardActions');

const ALERT_COMMANDS = [
    'qg',
    'garage',
    'alignement',
    'tir',
    'position',
    'defense',
    'weed',
    'traitement-weed',
    'yellowjack',
    'megamall',
    'parking5',
    'ile',
    'trash',
];

test('commandes terrain slash/dashboard gardent la parité', () => {
    const slashNames = new Set(buildSlashCommands().map(cmd => cmd.toJSON().name));
    const directoryNames = new Set(COMMANDS.map(cmd => cmd.id));
    const interactionsSource = fs.readFileSync(path.join(__dirname, '..', 'src/bot/events/interactions.js'), 'utf8');
    const dashboardMessages = buildAlertMessages({
        CONFIG: {
            ROLES: { MEMBRE_1: '1485270431291277383' },
            EMOJIS: { BS21: ':21bs:' },
        },
    });

    for (const command of ALERT_COMMANDS) {
        assert.equal(slashNames.has(command), true, `${command} manque en slash`);
        assert.equal(directoryNames.has(command), true, `${command} manque dans /api/commands`);
        assert.match(interactionsSource, new RegExp(`case '${command}'`), `${command} manque dans interactions`);
        assert.equal(typeof dashboardMessages[command], 'string', `${command} manque dans buildAlertMessages`);
    }
});
