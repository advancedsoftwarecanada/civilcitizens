// @ts-nocheck
/* global FlowRouter, BlazeLayout, userManager, Meteor */
FlowRouter.route('/admin/chambersBuilder', {
    name: "chambersBuilder",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'chambersBuilder',
        });
    }
});

// On render
Template.chambersBuilder.onRendered(function () {
    // Debug meta refresher
    this.intervalId = setInterval(() => {
        const userId = Meteor.userId(); // Reactively track the logged-in user
        if (!userId) return null;

        // Reactively fetch data from UserManager
    const userMeta = userManager.data || {}; // `getData()` is reactive

        // return JSON.stringify(userMeta, null, 2);
        // set the DEBUGuserMeta textarea value
    /** @type {HTMLTextAreaElement|null} */
    // @ts-ignore - JS runtime DOM typing
    const debugEl = document.getElementById('DEBUGuserMeta');
    if (debugEl) debugEl.value = JSON.stringify(userMeta, null, 2);
    }, 1000);

    // Prefill latest Hansard URL and enable Process if we have a stored scrapeId
    try {
        const token = localStorage.getItem('Meteor.loginToken');
        fetch('/api/admin/hansard/latest-url', {
            method: 'GET',
            headers: { 'Authorization': token ? `Bearer ${token}` : '' }
        }).then(async (resp) => {
            if (!resp.ok) return;
            const data = await resp.json();
            const urlEl = /** @type {HTMLInputElement} */(document.getElementById('hansardSourceUrl'));
            const noteEl = document.getElementById('hansardUrlNote');
            if (urlEl && data.url) urlEl.value = data.url;
            if (noteEl && data.note) noteEl.textContent = `(${data.note})`;
        }).catch(()=>{});
    } catch(_) {}
    // Process button is always enabled; handler will show a helpful message if missing scrapeId.

    // Initialize preview paging state
    try {
        if (!sessionStorage.getItem('Hansard.preview.offset')) sessionStorage.setItem('Hansard.preview.offset', '0');
        if (!sessionStorage.getItem('Hansard.preview.limit')) sessionStorage.setItem('Hansard.preview.limit', '25');
    } catch(_) {}
});

// on Destroyed
Template.chambersBuilder.onDestroyed(function () {
    clearInterval(this.intervalId);
});

// actions
Template.chambersBuilder.events({

    'click .uiActionBuildChambers': function (event) {

        // build the eda
        Meteor.call('admin.chambers.buildChambers', function (error, result) {
            if (error) {
                console.log(error);
            } else {
                console.log(result);
            }
        });

    }
    
    ,
        'click .uiActionHansardIngest': async function (evt) {
            const btn = evt.currentTarget;
            const out = document.getElementById('hansardResult');
            const urlEl = /** @type {HTMLInputElement} */(document.getElementById('hansardSourceUrl'));
            const xmlEl = /** @type {HTMLTextAreaElement} */(document.getElementById('hansardRawXml'));
            const token = localStorage.getItem('Meteor.loginToken');
            if (!token) { out && (out.textContent = 'Missing login token. Please log in as admin.'); return; }
            const payload = {};
            if (urlEl && urlEl.value.trim()) payload.sourceUrl = urlEl.value.trim();
            if (xmlEl && xmlEl.value.trim()) payload.xml = xmlEl.value.trim();
            if (!payload.sourceUrl && !payload.xml) { out && (out.textContent = 'Provide a source URL or paste XML.'); return; }
            btn.setAttribute('disabled', 'true');
            btn.classList.add('disabled');
            out && (out.textContent = 'Ingesting Hansard XML...');
            try {
                const resp = await fetch('/api/admin/hansard/ingest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload),
                });
                if (!resp.ok) {
                    const t = await resp.text().catch(()=> '');
                    out && (out.textContent = `HTTP ${resp.status}: ${t}`);
                    return;
                }
                const data = await resp.json();
                if (data.status === 'ok-processed' || data.status === 'exists-processed') {
                    if (data.scrapeId) localStorage.setItem('Hansard.lastScrapeId', data.scrapeId);
                    const processBtn = document.querySelector('.uiActionHansardProcess');
                    if (processBtn) processBtn.removeAttribute('disabled');
                    out && (out.textContent = `Ingest ${data.status.replace('-',' ')}. scrapeId=${data.scrapeId}, bytes=${data.bytes || data.size}\nCreated ${data.created}, skipped ${data.skipped}. Mapped: riding=${data.mapping?.byRiding}, member=${data.mapping?.byMember}, unmapped=${data.mapping?.unmapped}.`);
                } else if (data.status === 'ok') {
                    // Should not happen now, but keep fallback
                    localStorage.setItem('Hansard.lastScrapeId', data.scrapeId);
                    const processBtn = document.querySelector('.uiActionHansardProcess');
                    if (processBtn) processBtn.removeAttribute('disabled');
                    out && (out.textContent = `Ingest success. scrapeId=${data.scrapeId}, bytes=${data.bytes}`);
                } else {
                    out && (out.textContent = `Error: ${data.message || 'Unknown'}`);
                }
            } catch (e) {
                out && (out.textContent = `Network error: ${e.message}`);
            } finally {
                btn.removeAttribute('disabled');
                btn.classList.remove('disabled');
            }
        }
        ,
        'click .uiScrollHansard': function() {
            try {
                const panel = document.getElementById('hansardPanel');
                if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch(_) {}
        }
        ,
        'click .uiActionHansardProcess': async function (evt) {
            const btn = evt.currentTarget;
            const out = document.getElementById('hansardResult');
            const token = localStorage.getItem('Meteor.loginToken');
            if (!token) { out && (out.textContent = 'Missing login token. Please log in as admin.'); return; }
            const scrapeId = localStorage.getItem('Hansard.lastScrapeId');
            console.log('[Hansard UI] Process clicked. scrapeId=', scrapeId);
            if (!scrapeId) { out && (out.textContent = 'No scrapeId found. Ingest first.'); return; }
            btn.setAttribute('disabled', 'true');
            btn.classList.add('disabled');
            out && (out.textContent = `Processing scrapeId=${scrapeId} ...`);
            try {
                const resp = await fetch('/api/admin/hansard/process', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ scrapeId }),
                });
                if (!resp.ok) {
                    const t = await resp.text().catch(()=> '');
                    out && (out.textContent = `HTTP ${resp.status}: ${t}`);
                    return;
                }
                const data = await resp.json();
                out && (out.textContent = JSON.stringify(data, null, 2));
            } catch (e) {
                out && (out.textContent = `Network error: ${e.message}`);
            } finally {
                btn.removeAttribute('disabled');
                btn.classList.remove('disabled');
            }
        },
        'click .uiActionHansardPreview': async function() {
            const out = document.getElementById('hansardPreviewList');
            const meta = document.getElementById('hansardPreviewMeta');
            const token = localStorage.getItem('Meteor.loginToken');
            const scrapeId = localStorage.getItem('Hansard.lastScrapeId');
            if (!scrapeId) { if (meta) meta.textContent = 'No scrapeId. Ingest first.'; return; }
            const limit = Number(sessionStorage.getItem('Hansard.preview.limit') || '25');
            const offset = Number(sessionStorage.getItem('Hansard.preview.offset') || '0');
            meta && (meta.textContent = 'Loading preview...');
            try {
                const resp = await fetch('/api/admin/hansard/preview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ scrapeId, limit, offset })
                });
                const data = await resp.json();
                if (!resp.ok || data.status !== 'ok') {
                    meta && (meta.textContent = `Error loading preview: ${data.error || data.message || resp.status}`);
                    return;
                }
                meta && (meta.textContent = `Showing ${data.count} of ${data.total} (mapped: ${data.mapped}, unmapped: ${data.unmapped}) | offset=${data.offset}`);
                const sel = new Set(JSON.parse(localStorage.getItem('Hansard.selectedKeys') || '[]'));
                const html = data.items.map(it => {
                    const checked = sel.has(it.key) ? 'checked' : '';
                    const chamber = it.chamber ? `${it.chamber.name} (${it.chamber.province})` : '—';
                    return `<div class="form-check py-2 border-bottom border-secondary">
                        <input class="form-check-input uiHansardSel" type="checkbox" data-key="${it.key}" ${checked}>
                        <label class="form-check-label">
                            <strong>${it.speakerName}</strong> — <em>${it.riding || 'Unknown Riding'}</em>
                            <div class="small text-muted">Mapped: ${it.mappedBy} | Chamber: ${chamber}</div>
                            <div class="mt-1" style="white-space: pre-wrap;">${(it.snippet || '').replace(/</g,'&lt;')}</div>
                        </label>
                    </div>`;
                }).join('');
                if (out) out.innerHTML = html || '<div class="text-muted">No items.</div>';
            } catch (e) {
                meta && (meta.textContent = `Error: ${e.message}`);
            }
        },
        'click .uiActionHansardPrevPage': function() {
            const offset = Number(sessionStorage.getItem('Hansard.preview.offset') || '0');
            const limit = Number(sessionStorage.getItem('Hansard.preview.limit') || '25');
            const next = Math.max(0, offset - limit);
            sessionStorage.setItem('Hansard.preview.offset', String(next));
            document.querySelector('.uiActionHansardPreview')?.dispatchEvent(new Event('click')); 
        },
        'click .uiActionHansardNextPage': function() {
            const offset = Number(sessionStorage.getItem('Hansard.preview.offset') || '0');
            const limit = Number(sessionStorage.getItem('Hansard.preview.limit') || '25');
            const next = offset + limit;
            sessionStorage.setItem('Hansard.preview.offset', String(next));
            document.querySelector('.uiActionHansardPreview')?.dispatchEvent(new Event('click'));
        },
        'change .uiHansardSel': function(evt) {
            // Delegate checkbox toggles
            const target = evt.currentTarget;
            if (!(target instanceof HTMLInputElement)) return;
            const key = target.getAttribute('data-key');
            if (!key) return;
            const sel = new Set(JSON.parse(localStorage.getItem('Hansard.selectedKeys') || '[]'));
            if (target.checked) sel.add(key); else sel.delete(key);
            localStorage.setItem('Hansard.selectedKeys', JSON.stringify(Array.from(sel)));
        },
        'click .uiActionHansardCreateSelected': async function() {
            const meta = document.getElementById('hansardPreviewMeta');
            const token = localStorage.getItem('Meteor.loginToken');
            const scrapeId = localStorage.getItem('Hansard.lastScrapeId');
            const sel = JSON.parse(localStorage.getItem('Hansard.selectedKeys') || '[]');
            if (!scrapeId || sel.length === 0) { meta && (meta.textContent = 'Select some items first.'); return; }
            const overrideChamber = /** @type {HTMLInputElement} */(document.getElementById('hansardOverrideChamber'));
            const overrides = {};
            if (overrideChamber && overrideChamber.value.trim()) {
                sel.forEach(k => { overrides[k] = { chamberSeo: overrideChamber.value.trim() }; });
            }
            meta && (meta.textContent = 'Creating selected posts...');
            try {
                const resp = await fetch('/api/admin/hansard/create-posts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ scrapeId, keys: sel, overrides })
                });
                const data = await resp.json();
                if (!resp.ok || data.status !== 'ok') {
                    meta && (meta.textContent = `Error creating: ${data.error || data.message || resp.status}`);
                    return;
                }
                meta && (meta.textContent = `Created ${data.created}, skipped ${data.skipped}.`);
            } catch (e) {
                meta && (meta.textContent = `Network error: ${e.message}`);
            }
        }
    ,
    'click .uiActionScrapeMemberContacts': function (evt) {
        const btn = evt.currentTarget;
        const $out = document.getElementById('scrapeMemberContactsResult');
        console.log('[Admin] Scrape Member Contacts: click detected');
        if ($out) {
            $out.textContent = 'Scraping contacts for current members...';
            try { $out.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(e) {}
        }
        btn.setAttribute('disabled', 'true');
        btn.classList.add('disabled');
        console.log('[Admin] Calling API /api/admin/scrape-member-contacts ...');
        const token = localStorage.getItem('Meteor.loginToken');
        fetch('/api/admin/scrape-member-contacts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ onlyMissing: true, limit: 1000, delayMs: 500 })
        }).then(async (resp) => {
            btn.removeAttribute('disabled');
            btn.classList.remove('disabled');
            if (!resp.ok) {
                const t = await resp.text().catch(()=> '');
                console.error('[Admin] API error', resp.status, t);
                if ($out) $out.textContent = `HTTP ${resp.status}: ${t}`;
                return;
            }
            const data = await resp.json();
            if (data.status !== 'ok') {
                console.error('[Admin] API returned error payload', data);
                if ($out) $out.textContent = `Error: ${data.message || 'Unknown error'}`;
                return;
            }
            const result = data.result || {};
            console.log('[Admin] Scrape Member Contacts: result', result);
            const summary = {
                processed: result.processed,
                updated: result.updated,
                errorsCount: result.errorsCount,
            };
            if ($out) {
                $out.textContent = `Scrape done.\n\nSummary:\n${JSON.stringify(summary, null, 2)}\n\nExamples:\n${JSON.stringify((result.examples || []), null, 2)}\n\nFirst 5 errors:\n${JSON.stringify((result.errors || []).slice(0, 5), null, 2)}`;
                try { $out.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(e) {}
            }
        }).catch((err) => {
            btn.removeAttribute('disabled');
            btn.classList.remove('disabled');
            console.error('[Admin] Network error', err);
            if ($out) $out.textContent = `Network error: ${err.message}`;
        });
    }

});

// Helpers
Template.chambersBuilder.helpers({

});