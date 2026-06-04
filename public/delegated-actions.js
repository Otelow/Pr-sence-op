// SECURITY 04/06/2026 - delegated data-* actions, no inline handlers
(function installDelegatedActions() {
    if (window.__delegatedActionsInstalled) return;
    window.__delegatedActionsInstalled = true;

    const EVENT_ATTRS = {
        click: 'data-click-call',
        change: 'data-change-call',
        input: 'data-input-call',
        blur: 'data-blur-call',
        submit: 'data-submit-call',
        error: 'data-error-call',
    };

    function splitStatements(raw) {
        const out = [];
        let current = '';
        let quote = null;
        let depth = 0;
        for (let i = 0; i < String(raw || '').length; i += 1) {
            const ch = raw[i];
            const prev = raw[i - 1];
            if ((ch === '"' || ch === "'") && prev !== '\\') {
                quote = quote === ch ? null : (quote || ch);
            }
            if (!quote) {
                if (ch === '(') depth += 1;
                if (ch === ')') depth = Math.max(0, depth - 1);
                if (ch === ';' && depth === 0) {
                    if (current.trim()) out.push(current.trim());
                    current = '';
                    continue;
                }
            }
            current += ch;
        }
        if (current.trim()) out.push(current.trim());
        return out;
    }

    function splitArgs(raw) {
        const out = [];
        let current = '';
        let quote = null;
        let depth = 0;
        for (let i = 0; i < String(raw || '').length; i += 1) {
            const ch = raw[i];
            const prev = raw[i - 1];
            if ((ch === '"' || ch === "'") && prev !== '\\') {
                quote = quote === ch ? null : (quote || ch);
            }
            if (!quote) {
                if (ch === '(' || ch === '[' || ch === '{') depth += 1;
                if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
                if (ch === ',' && depth === 0) {
                    out.push(current.trim());
                    current = '';
                    continue;
                }
            }
            current += ch;
        }
        if (current.trim()) out.push(current.trim());
        return out;
    }

    function unquote(value) {
        const raw = String(value || '').trim();
        if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
            return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        return raw;
    }

    function parseArg(raw, event, target) {
        const value = String(raw || '').trim();
        if (value === 'event') return event;
        if (value === 'this') return target;
        if (value === 'this.value') return target.value;
        if (value === 'this.checked') return Boolean(target.checked);
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (value === 'null') return null;
        if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
            return unquote(value);
        }
        return value;
    }

    function resolveFunction(name) {
        return String(name || '').split('.').reduce((obj, key) => {
            if (!obj || !/^[A-Za-z_$][\w$]*$/.test(key)) return null;
            return obj[key];
        }, window);
    }

    function replaceOuterHtml(statement, target) {
        const match = statement.match(/^this\.outerHTML\s*=\s*(['"])([\s\S]*)\1$/);
        if (!match) return false;
        target.outerHTML = unquote(match[1] + match[2] + match[1]);
        return true;
    }

    function executeStatement(statement, event, target) {
        if (!statement) return;
        if (statement === 'event.stopPropagation()') {
            event.stopPropagation();
            return;
        }
        const toggle = statement.match(/^this\.classList\.toggle\((['"])([^'"]+)\1\)$/);
        if (toggle) {
            target.classList.toggle(toggle[2]);
            return;
        }
        if (replaceOuterHtml(statement, target)) return;

        const call = statement.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(([\s\S]*)\)$/);
        if (!call) return;
        const fn = resolveFunction(call[1]);
        if (typeof fn !== 'function') return;
        fn(...splitArgs(call[2]).map(arg => parseArg(arg, event, target)));
    }

    function runAction(event, attr, options = {}) {
        const target = options.directTarget || event.target.closest(`[${attr}]`);
        if (!target) return;
        if (event.type === 'submit') event.preventDefault();
        splitStatements(target.getAttribute(attr)).forEach(statement => executeStatement(statement, event, target));
    }

    ['click', 'change', 'input', 'blur', 'submit'].forEach(type => {
        document.addEventListener(type, event => runAction(event, EVENT_ATTRS[type]), type === 'blur');
    });

    document.addEventListener('error', event => {
        const target = event.target;
        if (target && target.hasAttribute && target.hasAttribute(EVENT_ATTRS.error)) {
            runAction(event, EVENT_ATTRS.error, { directTarget: target });
        }
    }, true);
})();
