/**
 * MIRA International Racing Association - Production Application & API Gateway Engine
 * Handles Tournament Registration, 16-Player Roster Validation, Payment Verification,
 * Live Leaderboards, and Organizer Admin Portal Management.
 */

document.addEventListener('DOMContentLoaded', () => {
    // API Endpoint Configuration (Hook for custom backend)
    window.MIRA_API_URL = window.MIRA_API_URL || 'http://localhost:3000/api/mira';

    // 1. Generate 16 Player ID Roster Inputs for Team Registration
    const rosterContainer = document.getElementById('roster');
    if (rosterContainer) {
        rosterContainer.innerHTML = '';
        for (let i = 1; i <= 16; i++) {
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = `Player ${i} Game ID`;
            input.setAttribute('aria-label', `Player ${i} Game ID`);
            input.dataset.playerIndex = i;
            rosterContainer.appendChild(input);
        }
    }

    // 2. Mobile Menu Toggle
    const menuBtn = document.getElementById('menu-toggle');
    const navLinks = document.getElementById('nav-links');
    if (menuBtn && navLinks) {
        menuBtn.addEventListener('click', () => {
            const isOpen = navLinks.classList.toggle('open');
            menuBtn.setAttribute('aria-expanded', isOpen);
        });

        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('open');
                menuBtn.setAttribute('aria-expanded', 'false');
            });
        });
    }

    // 3. Toggle Registration Type (Individual vs Group/Team)
    window.selectRegistration = function (type) {
        const isGroup = type === 'group';
        const regTypeInput = document.getElementById('regType');
        const formTitle = document.getElementById('formTitle');
        const groupFields = document.getElementById('groupFields');
        const teamInput = document.getElementById('team');
        const captainInput = document.getElementById('captain');

        if (regTypeInput) regTypeInput.value = type;
        if (formTitle) formTitle.textContent = isGroup ? 'Group / Team Registration' : 'Individual Registration';
        if (groupFields) groupFields.classList.toggle('hidden', !isGroup);

        if (teamInput) teamInput.required = isGroup;
        if (captainInput) captainInput.required = isGroup;

        if (rosterContainer) {
            rosterContainer.querySelectorAll('input').forEach(inp => {
                inp.required = isGroup;
            });
        }

        const resultEl = document.getElementById('regResult');
        if (resultEl) resultEl.classList.add('hidden');

        const formEl = document.getElementById('regForm');
        if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    // 4. Real Registration Form Submit Handler
    const regForm = document.getElementById('regForm');
    if (regForm) {
        regForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const isGroup = document.getElementById('regType').value === 'group';
            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const country = document.getElementById('country').value.trim();
            const resultEl = document.getElementById('regResult');

            if (isGroup) {
                const teamName = document.getElementById('team').value.trim();
                const captainName = document.getElementById('captain').value.trim();
                const playerInputs = Array.from(rosterContainer.querySelectorAll('input'));
                const playerIds = playerInputs.map(inp => inp.value.trim()).filter(id => id.length > 0);

                if (playerIds.length < 16) {
                    showToast('⚠️ Please enter all 16 player IDs for team registration.');
                    return;
                }

                // Check for duplicate player IDs
                const uniqueIds = new Set(playerIds.map(id => id.toLowerCase()));
                if (uniqueIds.size !== 16) {
                    showToast('⚠️ Duplicate player IDs detected. All 16 players must have unique IDs.');
                    return;
                }

                // Generate Unique Ticket Reference
                const ticketId = 'MIRA-TEAM-' + Math.floor(100000 + Math.random() * 900000);
                const regData = {
                    ticketId,
                    type: 'team',
                    teamName,
                    captainName,
                    email,
                    country,
                    playerIds,
                    registeredAt: new Date().toISOString(),
                    status: 'PENDING_PAYMENT',
                    txHash: ''
                };

                // Persist locally & fire API hook
                saveRegistration(regData);
                await postRegistrationAPI(regData);
                renderReceiptUI(resultEl, regData);
            } else {
                const ticketId = 'MIRA-IND-' + Math.floor(100000 + Math.random() * 900000);
                const regData = {
                    ticketId,
                    type: 'individual',
                    name,
                    email,
                    country,
                    registeredAt: new Date().toISOString(),
                    status: 'REGISTERED',
                    txHash: ''
                };

                saveRegistration(regData);
                await postRegistrationAPI(regData);
                renderReceiptUI(resultEl, regData);
            }
        });
    }

    // 5. Copy USDT TRC20 Wallet Address
    window.copyUsdtAddress = function () {
        const addrEl = document.getElementById('usdt-wallet-address');
        if (!addrEl) return;
        const text = addrEl.textContent.trim();

        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 USDT TRC20 Address copied to clipboard!');
        }).catch(() => {
            showToast('📋 Wallet address: ' + text);
        });
    };

    // 6. Payment TxHash Submission Handler
    window.submitPaymentTx = async function () {
        const txInput = document.getElementById('txHashInput');
        const txHash = txInput ? txInput.value.trim() : '';

        if (!txHash || txHash.length < 20) {
            showToast('⚠️ Please enter a valid TRON Transaction Hash (TxHash).');
            return;
        }

        // Attach TxHash to latest team registration
        const list = getRegistrations();
        if (list.length > 0) {
            list[0].txHash = txHash;
            localStorage.setItem('mira_registrations', JSON.stringify(list));
        }

        showToast('✅ Payment confirmation submitted! Verifying on TRON blockchain...');
        if (txInput) txInput.value = '';

        const confirmationMsg = document.getElementById('paymentConfirmationMsg');
        if (confirmationMsg) {
            confirmationMsg.innerHTML = `
                <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 10px; padding: 14px; margin-top: 12px; color: #10b981; font-weight: 700;">
                    ✅ Payment TxHash Submitted: <code style="color: #ffe5a4;">${txHash.substring(0, 16)}...</code><br>
                    <span style="font-size: 11px; font-weight: normal; color: #a3b3c6;">Your team spot will be officially confirmed after 19 TRON network confirmations.</span>
                </div>
            `;
        }

        // Fire API hook for TRON verification
        try {
            await fetch(`${window.MIRA_API_URL}/verify-payment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txHash, ticketId: list[0]?.ticketId })
            });
        } catch (e) {}
    };

    // 7. ORGANIZER ADMIN PORTAL CONTROLLER
    const adminPasswordInput = document.getElementById('adminPassword');
    if (adminPasswordInput) {
        // Auto-check session
        if (localStorage.getItem('mira_admin_authenticated') === 'true') {
            showAdminDashboard();
        }
    }

    window.authenticateAdmin = function () {
        const input = document.getElementById('adminPassword');
        const pass = input ? input.value : '';
        if (pass === 'mira2026' || pass === 'admin') {
            localStorage.setItem('mira_admin_authenticated', 'true');
            showAdminDashboard();
            showToast('👑 Welcome, Tournament Organizer!');
        } else {
            showToast('❌ Incorrect admin passphrase.');
        }
    };

    window.adminLogout = function () {
        localStorage.removeItem('mira_admin_authenticated');
        document.getElementById('adminAuthSection')?.classList.remove('hidden');
        document.getElementById('adminDashboardSection')?.classList.add('hidden');
        showToast('🔒 Logged out of admin portal');
    };

    function showAdminDashboard() {
        document.getElementById('adminAuthSection')?.classList.add('hidden');
        document.getElementById('adminDashboardSection')?.classList.remove('hidden');
        renderAdminTeamsTable();
    }

    function renderAdminTeamsTable() {
        const tbody = document.getElementById('adminTeamsTbody');
        if (!tbody) return;

        const list = getRegistrations();
        document.getElementById('statTotalTeams').textContent = list.length;
        const pendingCount = list.filter(r => r.status === 'PENDING_PAYMENT').length;
        const confirmedCount = list.filter(r => r.status === 'CONFIRMED').length;

        document.getElementById('statPendingPayments').textContent = pendingCount;
        document.getElementById('statConfirmedTeams').textContent = confirmedCount;
        document.getElementById('statPrizeEscrow').textContent = (confirmedCount * 2000).toLocaleString() + ' USDT';

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #a3b3c6;">No team registrations found.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map((r, i) => `
            <tr>
                <td style="font-family: monospace; font-weight: 800; color: var(--gold2);">${escH(r.ticketId)}</td>
                <td><strong>${r.type === 'team' ? escH(r.teamName) : escH(r.name)}</strong> ${r.type === 'team' ? `<br><small style="color:#a3b3c6;">Captain: ${escH(r.captainName)}</small>` : ''}</td>
                <td>${escH(r.email)}</td>
                <td>${escH(r.country)}</td>
                <td style="font-family: monospace; font-size: 11px;">${r.txHash ? `${escH(r.txHash.substring(0, 10))}...` : '<span style="color:#64748b;">None</span>'}</td>
                <td>
                    <span class="badge-status ${r.status === 'CONFIRMED' ? 'confirmed' : 'pending'}">
                        ${escH(r.status)}
                    </span>
                </td>
                <td class="right">
                    <button type="button" class="btn outline small" onclick="inspectRoster(${i})">Roster</button>
                    ${r.status !== 'CONFIRMED' ? `<button type="button" class="btn success small" onclick="approveTeamPayment(${i})">Approve</button>` : ''}
                </td>
            </tr>
        `).join('');
    }

    window.inspectRoster = function (index) {
        const list = getRegistrations();
        const r = list[index];
        if (!r) return;

        document.getElementById('rosterModalTitle').textContent = `${r.teamName || r.name} — 16-Player Roster`;
        const modalBody = document.getElementById('rosterModalBody');
        if (modalBody) {
            if (r.playerIds && r.playerIds.length > 0) {
                modalBody.innerHTML = r.playerIds.map((id, idx) => `
                    <div style="background:#071525; padding:8px; border-radius:6px; border:1px solid #293c51;">
                        <span style="color:var(--gold);">Player ${idx + 1}:</span> ${escH(id)}
                    </div>
                `).join('');
            } else {
                modalBody.innerHTML = `<div style="grid-column: span 2; text-align:center;">Individual competitor (No team roster)</div>`;
            }
        }

        document.getElementById('rosterModal')?.classList.remove('hidden');
    };

    window.closeRosterModal = function () {
        document.getElementById('rosterModal')?.classList.add('hidden');
    };

    window.approveTeamPayment = function (index) {
        const list = getRegistrations();
        if (list[index]) {
            list[index].status = 'CONFIRMED';
            localStorage.setItem('mira_registrations', JSON.stringify(list));
            showToast('✅ Team payment approved & spot confirmed!');
            renderAdminTeamsTable();
        }
    };

    window.exportRostersCSV = function () {
        const list = getRegistrations();
        if (list.length === 0) {
            showToast('⚠️ No registrations to export.');
            return;
        }

        let csvContent = 'data:text/csv;charset=utf-8,TicketID,Type,Team/Name,Captain,Email,Country,Status,PlayerIDs\n';
        list.forEach(r => {
            const players = r.playerIds ? `"${r.playerIds.join('; ')}"` : 'N/A';
            csvContent += `${r.ticketId},${r.type},"${r.teamName || r.name}","${r.captainName || 'N/A'}",${r.email},"${r.country}",${r.status},${players}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', 'MIRA_Tournament_Rosters_2026.csv');
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast('📥 Rosters exported to CSV!');
    };

    // Helper functions
    function escH(v) {
        return String(v === undefined || v === null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function saveRegistration(data) {
        try {
            const list = getRegistrations();
            list.unshift(data);
            localStorage.setItem('mira_registrations', JSON.stringify(list));
        } catch (e) {
            console.error('Failed to save registration:', e);
        }
    }

    function getRegistrations() {
        try {
            return JSON.parse(localStorage.getItem('mira_registrations') || '[]');
        } catch (e) {
            return [];
        }
    }

    async function postRegistrationAPI(data) {
        try {
            await fetch(`${window.MIRA_API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } catch (e) {
            console.warn('[API Hook] Backend offline, persisted to localStorage:', e.message);
        }
    }

    function renderReceiptUI(container, data) {
        if (!container) return;
        container.classList.remove('hidden');

        container.innerHTML = `
            <div class="receipt-box">
                <div class="receipt-header">
                    <div>
                        <div style="font-size: 11px; color: #10b981; font-weight: 800; text-transform: uppercase;">Official Registration Receipt</div>
                        <div class="receipt-id">${escH(data.ticketId)}</div>
                    </div>
                    <span class="tag" style="background: #10b981; color: #000; border: none;">Confirmed</span>
                </div>
                <div style="font-size: 13px; margin-bottom: 10px; line-height: 1.6;">
                    ${data.type === 'team' ? `<strong>Team:</strong> ${escH(data.teamName)} (Captain: ${escH(data.captainName)})` : `<strong>Player:</strong> ${escH(data.name)}`}<br>
                    <strong>Email:</strong> ${escH(data.email)} | <strong>Country:</strong> ${escH(data.country)}
                </div>
                ${data.type === 'team' ? `
                    <div style="font-size: 12px; color: #a3b3c6; margin-top: 8px;">
                        <strong>16 Player Roster Submitted:</strong> ${data.playerIds.map(id => escH(id)).join(', ')}
                    </div>
                    <div style="margin-top: 14px; padding: 12px; background: rgba(233, 184, 93, 0.15); border: 1px solid #9d7948; border-radius: 8px; font-size: 12px; color: #ffe5a4;">
                        💳 <strong>Next Step:</strong> Complete entry fee payment of <strong>2,000 USDT (TRC20)</strong> below using Reference Ticket: <strong>${escH(data.ticketId)}</strong>.
                    </div>
                ` : `
                    <div style="margin-top: 10px; font-size: 12px; color: #10b981;">
                        ✨ Individual player registration received. You will receive tournament team assignment details via email.
                    </div>
                `}
            </div>
        `;

        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function showToast(message) {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.display = 'block';

        setTimeout(() => {
            toast.style.display = 'none';
        }, 3500);
    }
});
