// ABSENCE PARSING 01/06/2026 - date souple sans casser la template

function dateOnly(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildValidDate(year, month, day) {
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
}

function dateFromDayMonthNearTarget(day, month, targetDate) {
    const target = dateOnly(targetDate);
    let candidate = buildValidDate(target.getFullYear(), month, day);
    if (!candidate) return null;

    const halfYearMs = 183 * 24 * 60 * 60 * 1000;
    if (candidate.getTime() - target.getTime() > halfYearMs) {
        candidate = buildValidDate(target.getFullYear() - 1, month, day);
    } else if (target.getTime() - candidate.getTime() > halfYearMs) {
        candidate = buildValidDate(target.getFullYear() + 1, month, day);
    }
    return candidate;
}

function isSameAbsenceDay(day, month, targetDate) {
    const candidate = dateFromDayMonthNearTarget(day, month, targetDate);
    if (!candidate) return false;
    const target = dateOnly(targetDate);
    return candidate.getTime() === target.getTime();
}

function isTargetInAbsenceRange(startDay, startMonth, endDay, endMonth, targetDate) {
    const target = dateOnly(targetDate);
    let start = buildValidDate(target.getFullYear(), startMonth, startDay);
    let end = buildValidDate(target.getFullYear(), endMonth, endDay);
    if (!start || !end) return false;

    if (end < start) {
        if (target <= end) start = buildValidDate(target.getFullYear() - 1, startMonth, startDay);
        else end = buildValidDate(target.getFullYear() + 1, endMonth, endDay);
    }
    if (!start || !end) return false;
    return target >= start && target <= end;
}

function extractAbsenceDateText(content) {
    const text = String(content || '');
    const match = text.match(/^\s*Date(?:\(s\)|s)?\s*(?::|\s)\s*(.+?)\s*$/im);
    return match ? match[1].trim() : '';
}

function getAbsenceTemplateState(content) {
    const text = String(content || '');
    const dateText = extractAbsenceDateText(text);
    const hasNom = /^\s*Nom\s*:/im.test(text);
    const hasPrenom = /^\s*Pr[ée]nom\s*:/im.test(text);
    const hasDate = Boolean(dateText);
    const hasRaison = /^\s*Raison\s*:/im.test(text);
    return {
        hasNom,
        hasPrenom,
        hasDate,
        hasRaison,
        dateText,
        isTemplateComplete: hasNom && hasPrenom && hasDate && hasRaison,
    };
}

function absenceDateTextHasRecognizedDate(dateText) {
    const text = String(dateText || '');
    const range = text.match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/);
    if (range) {
        return Boolean(
            buildValidDate(2026, Number(range[2]), Number(range[1])) &&
            buildValidDate(2026, Number(range[4]), Number(range[3]))
        );
    }

    const single = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (!single) return false;
    return Boolean(buildValidDate(2026, Number(single[2]), Number(single[1])));
}

function absenceDateTextCoversTarget(dateText, targetDate = new Date()) {
    const text = String(dateText || '');
    const target = targetDate instanceof Date ? targetDate : new Date(targetDate);
    if (Number.isNaN(target.getTime())) return false;

    const range = text.match(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/);
    if (range) {
        return isTargetInAbsenceRange(
            Number(range[1]),
            Number(range[2]),
            Number(range[3]),
            Number(range[4]),
            target
        );
    }

    const single = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (!single) return false;
    return isSameAbsenceDay(Number(single[1]), Number(single[2]), target);
}

module.exports = {
    absenceDateTextCoversTarget,
    absenceDateTextHasRecognizedDate,
    extractAbsenceDateText,
    getAbsenceTemplateState,
    isSameAbsenceDay,
    isTargetInAbsenceRange,
};
