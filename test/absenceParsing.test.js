const test = require('node:test');
const assert = require('node:assert/strict');

const {
    absenceDateTextCoversTarget,
    absenceDateTextHasRecognizedDate,
    getAbsenceTemplateState,
} = require('../src/bot/services/absenceParsing');

test('absence parsing accepte Date sans deux-points avec texte libre', () => {
    const content = [
        'Nom : Oliveira',
        'Prénom : Joao',
        'Date 01/06 ce soir',
        'Raison : foot',
    ].join('\n');

    const state = getAbsenceTemplateState(content);

    assert.equal(state.isTemplateComplete, true);
    assert.equal(state.dateText, '01/06 ce soir');
    assert.equal(absenceDateTextHasRecognizedDate(state.dateText), true);
    assert.equal(absenceDateTextCoversTarget(state.dateText, new Date(2026, 5, 1, 20, 45)), true);
});

test('absence parsing garde Date(s) avec plage de jours', () => {
    const content = [
        'Nom : Test',
        'Prénom : User',
        'Date(s) : 31/05 - 02/06',
        'Raison : indispo',
    ].join('\n');

    const state = getAbsenceTemplateState(content);

    assert.equal(state.isTemplateComplete, true);
    assert.equal(absenceDateTextCoversTarget(state.dateText, new Date(2026, 5, 1, 21, 0)), true);
});

test('absence parsing refuse une date invalide', () => {
    const content = [
        'Nom : Test',
        'Prénom : User',
        'Date 32/14 ce soir',
        'Raison : indispo',
    ].join('\n');

    const state = getAbsenceTemplateState(content);

    assert.equal(state.isTemplateComplete, true);
    assert.equal(absenceDateTextHasRecognizedDate(state.dateText), false);
    assert.equal(absenceDateTextCoversTarget(state.dateText, new Date(2026, 5, 1, 21, 0)), false);
});
