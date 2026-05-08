// ============================================================
// ADMIN PANEL — JS
// ============================================================
let adminWeapons = [];
let adminMyWeaponNames = [];
let adminIngredients = [];
let adminOrgs = [];
let adminRoles = [];
let editingIngredients = []; // [{ ingredient_id, name, amount }]
let adminWeaponQuery = '';
let adminIngredientQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
    // Vérifier admin
    try {
        const r = await fetch('/api/admin/check');
        const d = await r.json();
        if (!d.isAdmin) {
            window.location.href = '/dashboard';
            return;
        }
    } catch {
        window.location.href = '/dashboard';
        return;
    }

    loadAdminWeapons();
    loadAdminMyWeaponNames();
    loadAdminIngredients();
    loadAdminOrgs();
    loadAdminRoles();

    document.getElementById('adminWeaponSearch')?.addEventListener('input', e => {
        adminWeaponQuery = e.target.value.trim().toLowerCase();
        renderAdminWeapons();
    });
    document.getElementById('adminIngredientSearch')?.addEventListener('input', e => {
        adminIngredientQuery = e.target.value.trim().toLowerCase();
        renderAdminIngredients();
    });
});

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeJsArg(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function safeImageUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    try {
        const parsed = new URL(value, window.location.origin);
        if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
        if (parsed.protocol === 'data:' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return value;
    } catch {}
    return '';
}

function safeColor(color) {
    const value = String(color || '').trim();
    return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#888';
}

function toast(msg, type) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

function confirmAction(options = {}) {
    const {
        title = 'Confirmer',
        message = 'Confirmer cette action ?',
        confirmText = 'Confirmer',
        cancelText = 'Annuler',
        danger = false,
    } = options;

    return new Promise(resolve => {
        let modal = document.getElementById('confirmActionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirmActionModal';
            modal.className = 'confirm-action-modal';
            modal.innerHTML = `
                <div class="confirm-action-backdrop" data-confirm-cancel></div>
                <div class="confirm-action-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmActionTitle">
                    <div class="confirm-action-icon">!</div>
                    <h3 id="confirmActionTitle" class="confirm-action-title"></h3>
                    <p class="confirm-action-message"></p>
                    <div class="confirm-action-buttons">
                        <button type="button" class="btn-secondary" data-confirm-cancel></button>
                        <button type="button" class="btn-primary" data-confirm-ok></button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const okButton = modal.querySelector('[data-confirm-ok]');
        const cancelButtons = modal.querySelectorAll('[data-confirm-cancel]');
        modal.querySelector('.confirm-action-title').textContent = title;
        modal.querySelector('.confirm-action-message').textContent = message;
        modal.querySelector('.confirm-action-buttons [data-confirm-cancel]').textContent = cancelText;
        okButton.textContent = confirmText;
        modal.classList.toggle('danger', !!danger);
        modal.style.display = 'flex';
        okButton.focus();

        const cleanup = value => {
            modal.style.display = 'none';
            okButton.removeEventListener('click', onOk);
            cancelButtons.forEach(btn => btn.removeEventListener('click', onCancel));
            document.removeEventListener('keydown', onKey);
            resolve(value);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onKey = e => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        };
        okButton.addEventListener('click', onOk);
        cancelButtons.forEach(btn => btn.addEventListener('click', onCancel));
        document.addEventListener('keydown', onKey);
    });
}

// ─── TABS ───────────────────────────────────────
function switchAdminTab(name) {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.adminTab === name));
    document.querySelectorAll('.admin-tab-content').forEach(s => {
        s.style.display = (s.id === `adminTab-${name}`) ? 'block' : 'none';
    });
}
window.switchAdminTab = switchAdminTab;

// ─── ROLES (impersonate) ────────────────────────
async function loadAdminRoles() {
    try {
        const r = await fetch('/api/roles');
        const d = await r.json();
        adminRoles = d.roles || [];
        renderImpersonateDropdown();
    } catch {}
}

function renderImpersonateDropdown() {
    const list = document.getElementById('impersonateList');
    if (!list) return;
    list.innerHTML = adminRoles.map(role => {
        const color = safeColor(role.color);
        const colorDot = `<span class="role-color-dot" style="background:${color};"></span>`;
        return `
            <div class="custom-dropdown-item" data-role-name="${escapeHtml(role.name).toLowerCase()}" onclick="selectImpersonateRole('${escapeJsArg(role.id)}', '${escapeJsArg(role.name)}', '${color}')">
                ${colorDot}
                <span class="custom-dropdown-item-label" style="color:${color};">@${escapeHtml(role.name)}</span>
                <span class="custom-dropdown-item-count">${role.memberCount || 0}</span>
            </div>
        `;
    }).join('');

    const search = document.getElementById('impersonateSearch');
    if (search) {
        search.oninput = () => {
            const q = search.value.toLowerCase().trim();
            list.querySelectorAll('.custom-dropdown-item').forEach(item => {
                const name = item.dataset.roleName || '';
                item.style.display = !q || name.includes(q) ? 'flex' : 'none';
            });
        };
    }
}

function toggleImpersonateDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('impersonateMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    if (menu.style.display === 'block') {
        const search = document.getElementById('impersonateSearch');
        if (search) {
            search.value = '';
            document.querySelectorAll('#impersonateList .custom-dropdown-item').forEach(i => i.style.display = 'flex');
            setTimeout(() => search.focus(), 50);
        }
    }
}

function selectImpersonateRole(id, name, color) {
    document.getElementById('impersonateRoleId').value = id;
    const label = document.getElementById('impersonateLabel');
    const safe = safeColor(color);
    if (label) {
        label.classList.remove('custom-dropdown-placeholder');
        label.innerHTML = `<span class="role-color-dot" style="background:${safe};margin-right:8px;"></span> @${escapeHtml(name)}`;
        label.style.color = safe;
    }
    document.getElementById('impersonateMenu').style.display = 'none';
}

window.toggleImpersonateDropdown = toggleImpersonateDropdown;
window.selectImpersonateRole = selectImpersonateRole;

document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.style.display = 'none');
    }
});

function applyImpersonate() {
    const roleId = document.getElementById('impersonateRoleId').value;
    if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
    localStorage.setItem('impersonate_role', roleId);
    toast('✅ Vue impersonate active. Retourne au dashboard.');
}

function resetImpersonate() {
    localStorage.removeItem('impersonate_role');
    toast('↩ Vue impersonate désactivée');
}
window.applyImpersonate = applyImpersonate;
window.resetImpersonate = resetImpersonate;

// ─── ARMES ─────────────────────────────────────
async function loadAdminWeapons() {
    try {
        const r = await fetch('/api/crafts/weapons');
        const d = await r.json();
        adminWeapons = d.weapons || [];
        renderAdminWeapons();
    } catch {}
}

function renderAdminWeapons() {
    const list = document.getElementById('adminWeaponsList');
    if (adminWeapons.length === 0) {
        list.innerHTML = '<p class="empty">Aucune arme. Clique sur "+ Ajouter" pour commencer.</p>';
        return;
    }

    const filtered = adminWeapons.filter(w => {
        if (!adminWeaponQuery) return true;
        const haystack = [
            w.name,
            w.craft_price,
            w.sale_price,
            ...(w.ingredients || []).map(i => i.name),
        ].join(' ').toLowerCase();
        return haystack.includes(adminWeaponQuery);
    });

    if (filtered.length === 0) {
        list.innerHTML = '<p class="empty">Aucune arme ne correspond a la recherche.</p>';
        return;
    }

    list.innerHTML = filtered.map(w => {
        const imageUrl = safeImageUrl(w.image_url);
        return `
        <div class="admin-weapon-row">
            ${imageUrl ? `<img class="admin-weapon-img" src="${imageUrl}" alt="${escapeHtml(w.name)}">` : '<span class="admin-weapon-placeholder">Arme</span>'}
            <div class="admin-weapon-info">
                <strong>${escapeHtml(w.name)}</strong>
                <small>
                    ${w.craft_time ? formatTime(w.craft_time) : ''}
                    ${w.craft_price ? ' - Craft : ' + w.craft_price.toLocaleString('fr-FR') + '$' : ''}
                    ${w.sale_price ? ' - Vente : ' + w.sale_price.toLocaleString('fr-FR') + '$' : ''}
                    - ${(w.ingredients || []).length} ingredients
                </small>
            </div>
            <div class="admin-weapon-actions">
                <button class="btn-secondary btn-small" onclick="openWeaponEditor(${w.id})">Modifier</button>
                <button class="btn-danger btn-small" onclick="deleteWeapon(${w.id})">Supprimer</button>
            </div>
        </div>
    `;
    }).join('');
}

function formatTime(s) {
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

function openWeaponEditor(id) {
    const modal = document.getElementById('weaponEditorModal');
    const title = document.getElementById('weaponEditorTitle');

    document.getElementById('weaponEditorForm').reset();
    document.getElementById('weaponImagePreview').innerHTML = '';
    document.getElementById('weaponPlanImagePreview').innerHTML = '';
    document.getElementById('planImageField').style.display = 'none';
    editingIngredients = [];

    const saleInput = document.getElementById('weaponSalePrice');
    if (saleInput) saleInput.value = 0;

    if (id) {
        const w = adminWeapons.find(w => w.id === id);
        if (!w) return;

        title.textContent = `Modifier : ${w.name}`;
        document.getElementById('weaponId').value = w.id;
        document.getElementById('weaponName').value = w.name;
        document.getElementById('weaponCraftTime').value = w.craft_time || 0;
        document.getElementById('weaponCraftPrice').value = w.craft_price || 0;

        // Prix de vente conseillé
        if (saleInput) saleInput.value = w.sale_price || 0;

        document.getElementById('weaponRequiresPlan').checked = !!w.requires_plan;
        if (w.requires_plan) document.getElementById('planImageField').style.display = 'block';
        if (safeImageUrl(w.image_url)) document.getElementById('weaponImagePreview').innerHTML = `<img src="${safeImageUrl(w.image_url)}" alt="">`;
        if (safeImageUrl(w.plan_image_url)) document.getElementById('weaponPlanImagePreview').innerHTML = `<img src="${safeImageUrl(w.plan_image_url)}" alt="">`;

        editingIngredients = (w.ingredients || []).map(ing => ({
            ingredient_id: ing.ingredient_id || null,
            name: ing.name || '',
            amount: ing.amount || 0,
        }));
    } else {
        title.textContent = 'Ajouter une arme';
        document.getElementById('weaponId').value = '';
    }

    renderIngredientsEditor();
    modal.style.display = 'flex';
}

function closeWeaponEditor() {
    document.getElementById('weaponEditorModal').style.display = 'none';
}
window.openWeaponEditor = openWeaponEditor;
window.closeWeaponEditor = closeWeaponEditor;

function addIngredient() {
    editingIngredients.push({ ingredient_id: null, name: '', amount: 0 });
    renderIngredientsEditor();
}

function renderIngredientsEditor() {
    const list = document.getElementById('ingredientsList');
    if (!editingIngredients.length) {
        list.innerHTML = '<p class="empty-small">Aucun ingrédient — clique sur "+ Ajouter"</p>';
        return;
    }
    list.innerHTML = editingIngredients.map((ing, i) => {
        const options = '<option value="">— Choisir —</option>' +
            adminIngredients.map(opt => {
                const selected = ing.name === opt.name ? 'selected' : '';
                return `<option value="${opt.id}" data-name="${escapeHtml(opt.name)}" data-image="${opt.image_url || ''}" ${selected}>${escapeHtml(opt.name)}</option>`;
            }).join('');

        const previewImg = ing.name && adminIngredients.find(opt => opt.name === ing.name)?.image_url;
        const preview = previewImg ? `<img src="${previewImg}" class="ingredient-row-preview" alt="">` : '<span class="ingredient-row-placeholder">🧪</span>';

        return `
            <div class="ingredient-row">
                ${preview}
                <select onchange="updateIngredientName(${i}, this)">${options}</select>
                <input type="number" placeholder="Quantité" value="${ing.amount || 0}" oninput="updateIngredientAmount(${i}, this.value)" min="0">
                <button type="button" class="btn-danger btn-small" onclick="removeIngredient(${i})">×</button>
            </div>
        `;
    }).join('');
}

function updateIngredientName(index, selectEl) {
    if (!editingIngredients[index]) return;
    const opt = selectEl.options[selectEl.selectedIndex];
    editingIngredients[index].name = opt.dataset.name || '';
    editingIngredients[index].ingredient_id = parseInt(opt.value) || null;
    renderIngredientsEditor();
}

function updateIngredientAmount(index, value) {
    if (!editingIngredients[index]) return;
    editingIngredients[index].amount = parseInt(value) || 0;
}

function removeIngredient(index) {
    editingIngredients.splice(index, 1);
    renderIngredientsEditor();
}

window.addIngredient = addIngredient;
window.updateIngredientName = updateIngredientName;
window.updateIngredientAmount = updateIngredientAmount;
window.removeIngredient = removeIngredient;

// Toggle plan image field + previews images
document.addEventListener('change', (e) => {
    if (e.target.id === 'weaponRequiresPlan') {
        document.getElementById('planImageField').style.display = e.target.checked ? 'block' : 'none';
    }
    if (e.target.id === 'weaponImage') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('weaponImagePreview').innerHTML = `<img src="${ev.target.result}">`;
        };
        reader.readAsDataURL(file);
    }
    if (e.target.id === 'weaponPlanImage') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('weaponPlanImagePreview').innerHTML = `<img src="${ev.target.result}">`;
        };
        reader.readAsDataURL(file);
    }
    if (e.target.id === 'ingredientImage') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('ingredientImagePreview').innerHTML = `<img src="${ev.target.result}">`;
        };
        reader.readAsDataURL(file);
    }
});

async function saveWeapon(e) {
    e.preventDefault();

    const id = document.getElementById('weaponId').value;
    const formData = new FormData();

    formData.append('name', document.getElementById('weaponName').value);
    formData.append('craft_time', document.getElementById('weaponCraftTime').value || '0');
    formData.append('craft_price', document.getElementById('weaponCraftPrice').value || '0');

    // Prix de vente conseillé
    const saleInput = document.getElementById('weaponSalePrice');
    formData.append('sale_price', saleInput ? (saleInput.value || '0') : '0');

    formData.append('requires_plan', document.getElementById('weaponRequiresPlan').checked ? '1' : '0');
    formData.append('ingredients', JSON.stringify(editingIngredients));

    const file = document.getElementById('weaponImage').files[0];
    if (file) formData.append('image', file);

    const planFile = document.getElementById('weaponPlanImage').files[0];
    if (planFile) formData.append('plan_image', planFile);

    try {
        const url = id ? `/api/crafts/weapons/${id}` : '/api/crafts/weapons';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, { method, body: formData });
        const data = await res.json();

        if (res.ok) {
            toast('✅ Arme enregistrée');
            closeWeaponEditor();
            await loadAdminWeapons();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}
window.saveWeapon = saveWeapon;

async function deleteWeapon(id) {
    if (!await confirmAction({ title: 'Supprimer l’arme', message: 'Supprimer cette arme du catalogue ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/weapons/${id}`, { method: 'DELETE' });
        if (res.ok) {
            toast('🗑 Supprimée');
            await loadAdminWeapons();
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}
window.deleteWeapon = deleteWeapon;

// ─── ARMES A VENDRE (Vos Armes) ───────────────────────────
async function loadAdminMyWeaponNames() {
    try {
        const r = await fetch('/api/crafts/myweapon-names');
        const d = await r.json();
        adminMyWeaponNames = d.names || [];
        renderAdminMyWeaponNames();
    } catch {
        adminMyWeaponNames = [];
        renderAdminMyWeaponNames();
    }
}

function renderAdminMyWeaponNames() {
    const list = document.getElementById('adminMyWeaponNamesList');
    if (!list) return;
    if (!adminMyWeaponNames.length) {
        list.innerHTML = '<p class="empty">Aucun nom configuré. Ajoute les armes disponibles pour Vos Armes.</p>';
        return;
    }
    list.innerHTML = adminMyWeaponNames.map(item => `
        <div class="admin-myweapon-name-row">
            <strong>${escapeHtml(item.name)}</strong>
            <button class="btn-danger btn-small" onclick="deleteMyWeaponNameFromAdmin(${item.id})">Supprimer</button>
        </div>
    `).join('');
}

async function addMyWeaponNameFromAdmin() {
    const input = document.getElementById('newMyWeaponName');
    const name = input?.value?.trim();
    if (!name) { toast('❌ Nom requis', 'error'); return; }
    try {
        const res = await fetch('/api/crafts/myweapon-names', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (res.ok) {
            toast('✅ Nom ajouté');
            input.value = '';
            await loadAdminMyWeaponNames();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

async function deleteMyWeaponNameFromAdmin(id) {
    if (!await confirmAction({ title: 'Supprimer le nom', message: 'Retirer ce nom du menu Vos Armes ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/myweapon-names/${id}`, { method: 'DELETE' });
        if (res.ok) {
            toast('🗑 Nom supprimé');
            await loadAdminMyWeaponNames();
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

window.addMyWeaponNameFromAdmin = addMyWeaponNameFromAdmin;
window.deleteMyWeaponNameFromAdmin = deleteMyWeaponNameFromAdmin;

// ─── INGRÉDIENTS ─────────────────────
async function loadAdminIngredients() {
    try {
        const r = await fetch('/api/crafts/ingredients');
        const d = await r.json();
        adminIngredients = d.ingredients || [];
        renderAdminIngredients();
    } catch {}
}

function renderAdminIngredients() {
    const list = document.getElementById('adminIngredientsList');
    if (!adminIngredients.length) {
        list.innerHTML = '<p class="empty">Aucun ingredient.</p>';
        return;
    }

    const filtered = adminIngredients.filter(i => !adminIngredientQuery || String(i.name || '').toLowerCase().includes(adminIngredientQuery));
    if (!filtered.length) {
        list.innerHTML = '<p class="empty">Aucun ingredient ne correspond a la recherche.</p>';
        return;
    }

    list.innerHTML = filtered.map(i => {
        const imageUrl = safeImageUrl(i.image_url);
        return `
        <div class="admin-ingredient-card">
            ${imageUrl ? `<img class="admin-ingredient-img" src="${imageUrl}" alt="${escapeHtml(i.name)}">` : '<span class="admin-ingredient-placeholder">Ingredient</span>'}
            <div class="admin-ingredient-name">${escapeHtml(i.name)}</div>
            <div class="admin-ingredient-actions">
                <button class="btn-secondary btn-small" onclick="openIngredientEditor(${i.id})">Modifier</button>
                <button class="btn-danger btn-small" onclick="deleteIngredient(${i.id})">Supprimer</button>
            </div>
        </div>
    `;
    }).join('');
}

function openIngredientEditor(id) {
    const modal = document.getElementById('ingredientEditorModal');
    const title = document.getElementById('ingredientEditorTitle');
    document.getElementById('ingredientEditorForm').reset();
    document.getElementById('ingredientImagePreview').innerHTML = '';

    if (id) {
        const ing = adminIngredients.find(i => i.id === id);
        if (!ing) return;
        title.textContent = `Modifier : ${ing.name}`;
        document.getElementById('ingredientId').value = ing.id;
        document.getElementById('ingredientName').value = ing.name;
        if (safeImageUrl(ing.image_url)) document.getElementById('ingredientImagePreview').innerHTML = `<img src="${safeImageUrl(ing.image_url)}" alt="">`;
    } else {
        title.textContent = 'Ajouter un ingrédient';
        document.getElementById('ingredientId').value = '';
    }
    modal.style.display = 'flex';
}

function closeIngredientEditor() {
    document.getElementById('ingredientEditorModal').style.display = 'none';
}
window.openIngredientEditor = openIngredientEditor;
window.closeIngredientEditor = closeIngredientEditor;

async function saveIngredient(e) {
    e.preventDefault();
    const id = document.getElementById('ingredientId').value;
    const formData = new FormData();
    formData.append('name', document.getElementById('ingredientName').value);
    const file = document.getElementById('ingredientImage').files[0];
    if (file) formData.append('image', file);

    try {
        const url = id ? `/api/crafts/ingredients/${id}` : '/api/crafts/ingredients';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, { method, body: formData });
        const data = await res.json();
        if (res.ok) {
            toast('✅ Ingrédient enregistré');
            closeIngredientEditor();
            await loadAdminIngredients();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.saveIngredient = saveIngredient;

async function deleteIngredient(id) {
    if (!await confirmAction({ title: 'Supprimer l’ingrédient', message: 'Supprimer cet ingrédient ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/ingredients/${id}`, { method: 'DELETE' });
        if (res.ok) { toast('🗑 Supprimé'); await loadAdminIngredients(); }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.deleteIngredient = deleteIngredient;

// ─── ORGANISATIONS ──────────────────
async function loadAdminOrgs() {
    try {
        const r = await fetch('/api/crafts/organizations');
        const d = await r.json();
        adminOrgs = d.organizations || [];
        renderAdminOrgs();
    } catch {}
}

function renderAdminOrgs() {
    const list = document.getElementById('adminOrgsList');
    if (adminOrgs.length === 0) {
        list.innerHTML = '<p class="empty">Aucune organisation</p>';
        return;
    }
    list.innerHTML = adminOrgs.map(o => `
        <div class="admin-org-row">
            <span>🏢 ${escapeHtml(o.name)}</span>
            <button class="btn-danger btn-small" onclick="deleteOrg(${o.id})">×</button>
        </div>
    `).join('');
}

async function addOrgFromAdmin() {
    const name = document.getElementById('newOrgName').value.trim();
    if (!name) return;
    try {
        const res = await fetch('/api/crafts/organizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            document.getElementById('newOrgName').value = '';
            toast('✅ Ajoutée');
            await loadAdminOrgs();
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

async function deleteOrg(id) {
    if (!await confirmAction({ title: 'Supprimer l’organisation', message: 'Supprimer cette organisation ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/organizations/${id}`, { method: 'DELETE' });
        if (res.ok) await loadAdminOrgs();
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.addOrgFromAdmin = addOrgFromAdmin;
window.deleteOrg = deleteOrg;
