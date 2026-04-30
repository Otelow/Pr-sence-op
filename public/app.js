// ==========================================
// 21 BLOCK SAVAGE — Dashboard JS
// ==========================================

const PAGE_TITLES = {
    presence: { title: 'Présence OP', sub: 'Suivi temps réel' },
    commands: { title: 'Commandes', sub: 'Centre de contrôle' },
    stats: { title: 'Statistiques', sub: 'Suivi hebdomadaire' },
    sanctions: { title: 'Sanctions', sub: 'Historique des avertissements' },
};

let currentTab = 'presence';
let refreshTimer = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    await loadUser();
    setupNav();
    refreshAll();
    refreshTimer = setInterval(refreshAll, 15_000); // Refresh toutes les 15s
});

async function loadUser() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) { window.location = '/'; return; }
        const user = await res.json();
        document.getElementById('userName').textContent = user.username;
        if (user.avatar) document.getElementById('userAvatar').src = user.avatar;
    } catch {
        window.location = '/';
    }
}

function setupNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));

    const titles = PAGE_TITLES[tab];
    document.getElementById('pageTitle').textContent = titles.title;
    document.getElementById('pageSub').textContent = titles.sub;

    refreshAll();
}

async function refreshAll() {
    if (currentTab === 'presence') {
        await Promise.all([loadStats(), loadPresence()]);
    } else if (currentTab === 'stats') {
        await loadWeekly();
    } else if (currentTab === 'sanctions') {
        await loadSanctions();
    }
}

// ===== STATS GLOBALES =====
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const s = await res.json();
        document.getElementById('statTotal').textContent = s.totalMembers;
        document.getElementById('statAbsences').textContent = s.totalUnjustified;
        document.getElementById('statConsecutive').textContent = s.membersWithConsecutive;
        document.getElementById('statOPs').textContent = `${s.op1Active ? 1 : 0}/${s.op2Active ? 1 : 0}`;

        // Highlight si alertes KP
        document.getElementById('statConsecutiveCard').classList.toggle('stat-warning', s.membersWithConsecutive > 0);
    } catch (e) {
        console.error('Stats:', e);
    }
}

// ===== PRÉSENCE =====
async function loadPresence() {
    try {
        const res = await fetch('/api/presence');
        const data = await res.json();

        renderOP('op1', data.op1);
        renderOP('op2', data.op2);
        renderAbsencesSalon(data.absencesSalon);
    } catch (e) {
        console.error('Presence:', e);
    }
}

function renderOP(prefix, op) {
    const status = document.getElementById(`${prefix}Status`);
    const cats = document.getElementById(`${prefix}Categories`);

    if (!op.active) {
        status.textContent = 'INACTIVE';
        status.className = 'op-status inactive';
        cats.innerHTML = '<p class="empty-cat">⚠ Pas de présence active</p>';
        return;
    }

    status.textContent = 'EN COURS';
    status.className = 'op-status active';

    const total = op.present.length + op.late.length + op.absentReact.length + op.absentValid.length + op.noReaction.length;

    const categories = [
        { icon: '✅', label: 'Présents', list: op.present, color: 'green' },
        { icon: '⏰', label: 'Retards', list: op.late, color: 'orange' },
        { icon: '❌', label: 'Absents non justifiés', list: op.absentReact, color: 'red' },
        { icon: '📋', label: 'Absents justifiés', list: op.absentValid, color: 'blue' },
        { icon: '⚠️', label: 'Pas de réaction', list: op.noReaction, color: 'gray' },
    ];

    cats.innerHTML = `
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">
            👥 <strong style="color:var(--text);">${total}</strong> membres
        </div>
    ` + categories.map(c => `
        <div class="op-category" onclick="this.classList.toggle('open')">
            <div class="op-cat-header">
                <span><span class="op-cat-icon">${c.icon}</span>${c.label}</span>
                <span class="op-cat-count">${c.list.length}</span>
            </div>
            <div class="op-cat-list">
                ${c.list.length === 0
                    ? '<div class="empty-cat">Aucun</div>'
                    : c.list.map(m => `<div class="member"><span class="member-dot"></span>${m.name}</div>`).join('')}
            </div>
        </div>
    `).join('');
}

function renderAbsencesSalon(data) {
    const validList = document.getElementById('validList');
    const invalidList = document.getElementById('invalidList');

    document.getElementById('validCount').textContent = data.valid.length;
    document.getElementById('invalidCount').textContent = data.invalid.length;

    validList.innerHTML = data.valid.length === 0
        ? '<p class="empty">Aucune</p>'
        : data.valid.map(n => `<div class="item">• ${n}</div>`).join('');

    invalidList.innerHTML = data.invalid.length === 0
        ? '<p class="empty">Aucune</p>'
        : data.invalid.map(n => `<div class="item">• ${n}</div>`).join('');
}

// ===== WEEKLY =====
async function loadWeekly() {
    try {
        const res = await fetch('/api/weekly');
        const data = await res.json();

        const consecutive = data.tracking.filter(t => t.consecutiveDays >= 2);
        const classic = data.tracking.filter(t => t.consecutiveDays < 2);

        const consecutiveList = document.getElementById('consecutiveList');
        const classicList = document.getElementById('classicList');

        consecutiveList.innerHTML = consecutive.length === 0
            ? '<p class="empty">Aucune absence consécutive ✨</p>'
            : consecutive.map(m => renderMemberRow(m, true)).join('');

        classicList.innerHTML = classic.length === 0
            ? '<p class="empty">Aucune absence cette semaine</p>'
            : classic.map(m => renderMemberRow(m, false)).join('');
    } catch (e) {
        console.error('Weekly:', e);
    }
}

function renderMemberRow(m, isAlert) {
    const detailsHtml = m.details && m.details.length > 0
        ? `<div class="member-details-list">
            ${m.details.map(d => `<div class="detail">${d.justified ? '✅' : '❌'} ${d.date} • ${d.op}</div>`).join('')}
          </div>`
        : '';

    return `
        <div class="member-row">
            <div class="member-row-info">
                <div class="member-row-name">${m.username}</div>
                <div class="member-row-details">
                    ${isAlert ? `<span class="member-row-badge">${m.consecutiveDays} JOURS</span> ` : ''}
                    ${m.count} absence(s) • cette semaine
                </div>
                ${detailsHtml}
            </div>
            <div class="member-row-count">${m.count}</div>
        </div>
    `;
}

// ===== SANCTIONS =====
async function loadSanctions() {
    try {
        const res = await fetch('/api/sanctions');
        const data = await res.json();
        const list = document.getElementById('sanctionsList');

        if (!data.sanctions || data.sanctions.length === 0) {
            list.innerHTML = '<p class="empty">Aucune sanction récente</p>';
            return;
        }

        list.innerHTML = data.sanctions.map(s => {
            const date = new Date(s.timestamp);
            const dateStr = date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
            return `
                <div class="sanction">
                    <span class="sanction-time">${dateStr}</span>
                    ${s.content}
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Sanctions:', e);
    }
}

// ===== COMMANDES =====
async function runCmd(command) {
    if (!confirm(`Lancer la commande "${command}" ?`)) return;

    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        const data = await res.json();

        if (res.ok) {
            toast(data.frequency
                ? `📻 Radio envoyée : ${data.frequency}`
                : `✅ Commande "${command}" lancée`);
        } else {
            toast(`❌ ${data.error || 'Erreur'}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

// ===== TOAST =====
function toast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(100%)';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}
