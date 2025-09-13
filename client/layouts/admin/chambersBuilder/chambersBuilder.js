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