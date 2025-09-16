// @ts-nocheck
/* global FlowRouter, BlazeLayout, Template, Meteor, UserMeta, toastr, $, window */

FlowRouter.route('/profile', {
    name: "profile",
    action() {

        const checkUserDataReady = setInterval(() => {
            if (window.userDataReady) {
                clearInterval(checkUserDataReady);
                BlazeLayout.render('CivilApp_3', {
                    main: 'profile',
                });
            }
        }, 100);

    }
});

// Rendered
Template.profile.onRendered = function() {
    console.log('Profile template rendered, initializing Summernote...');

    // Use a reliable initialization method similar to submit page
    const initializeSummernote = setInterval(() => {
        const depsReady = (typeof $ !== 'undefined') && (typeof $.fn.summernote !== 'undefined');
        if (!depsReady) return; // wait for Summernote

        const $bioEditor = $('#bioEditor');
        if (!$bioEditor.length) return; // wait for DOM element

        clearInterval(initializeSummernote);

        console.log('All dependencies and DOM ready, initializing Summernote (bs5)...');

        const hasUserMgr = (typeof window.userManager !== 'undefined');
        const myMeta = (hasUserMgr && typeof window.userManager.getData === 'function') ? (window.userManager.getData().meta || {}) : {};
        console.log('User meta:', myMeta);

        if ($bioEditor.length > 0) {
                // Avoid double-initialization if already transformed by Summernote
                if ($bioEditor.next('.note-editor').length) {
                    console.log('Bio editor already initialized; skipping.');
                    return;
                }
                let isCleaningImages = false;
                $bioEditor.summernote({
                    placeholder: 'Tell us about yourself...',
                    tabsize: 2,
                    height: 200,
                    disableDragAndDrop: true,
                    toolbar: [
                        ['font', ['bold', 'italic', 'underline', 'clear']],
                        ['para', ['ul', 'ol', 'paragraph']],
                        ['table', ['table']],
                        ['insert', ['link']],
                        ['view', ['undo', 'redo']]
                    ],
                    popover: {
                        image: []
                    },
                    tooltip: false,
                    callbacks: {
                        onImageUpload: function(files) {
                            toastr.warning('Image uploads are disabled for bio.');
                        },
                        onPaste: function(e) {
                            const ev = e.originalEvent || e;
                            const items = ev && ev.clipboardData && ev.clipboardData.items ? ev.clipboardData.items : [];
                            for (let i = 0; i < items.length; i++) {
                                const it = items[i];
                                if (it && it.type && it.type.indexOf('image') !== -1) {
                                    e.preventDefault();
                                    toastr.warning('Pasting images is disabled for bio.');
                                    return false;
                                }
                            }
                        },
                        onChange: function(contents) {
                            if (isCleaningImages) return;
                            if (contents && contents.indexOf('<img') !== -1) {
                                isCleaningImages = true;
                                const $dom = $('<div>').html(contents);
                                if ($dom.find('img').length) {
                                    $dom.find('img').remove();
                                    setTimeout(() => {
                                        $('#bioEditor').summernote('code', $dom.html());
                                        toastr.warning('Images removed from bio content.');
                                        isCleaningImages = false;
                                    }, 0);
                                } else {
                                    isCleaningImages = false;
                                }
                            }
                        }
                    }
                });
                console.log('Summernote initialized successfully');

                // Set initial content
                if (myMeta.bio) {
                    console.log('Setting initial bio content:', myMeta.bio);
                    $bioEditor.summernote('code', myMeta.bio);
                }

                // Bio char counter
                const BIO_MAX = 10000;
                const updateBioCounter = () => {
                    const html = $bioEditor.summernote('code') || '';
                    const text = $('<div>').html(html).text();
                    const len = text.length;
                    const $c = $('#bioCounter');
                    $c.text(Math.min(len, BIO_MAX) + '/' + BIO_MAX);
                    $c.toggleClass('over', len > BIO_MAX);
                };
                $bioEditor.on('summernote.change', updateBioCounter);
                $bioEditor.on('summernote.keyup', updateBioCounter);
                $bioEditor.on('summernote.paste', () => setTimeout(updateBioCounter, 0));
                updateBioCounter();

                console.log('Bio editor setup complete');
        }
    }, 10); // Check every 10ms like the submit page
};

// After-render autorun to populate bio once userManager is ready (handles refresh before cache ready)
Template.profile.onRendered(function () {
    const self = this;
    let tries = 0;
    const maxTries = 300; // ~30s
    const timer = setInterval(() => {
        tries++;
        const hasUserMgr = (typeof window.userManager !== 'undefined');
        const hasEditor = $('#bioEditor').length && $('#bioEditor').next('.note-editor').length;
        if (hasUserMgr && hasEditor) {
            try {
                const meta = (typeof window.userManager.getData === 'function') ? (window.userManager.getData().meta || {}) : {};
                const currentHtml = $('#bioEditor').summernote('code') || '';
                const currentText = $('<div>').html(currentHtml).text().trim();
                if ((!currentText || currentText === '')) {
                    if (meta.bio) {
                        $('#bioEditor').summernote('code', meta.bio);
                    }
                }
            } catch (e) {
                // ignore
            }
            clearInterval(timer);
        } else if (tries >= maxTries) {
            clearInterval(timer);
        }
    }, 100);
});


Template.profile.events({

    'submit form'(event) {
        event.preventDefault();

        // Use front-end cache (userManager) instead of unsubscribed collections
        const meta = (window.userManager && typeof window.userManager.getData === 'function')
            ? (window.userManager.getData().meta || {})
            : {};

        // Read inputs by id (fields do not have name attribute)
        const firstName = ($('#firstName').val() || '').trim();
        const lastName  = ($('#lastName').val()  || '').trim();
        const userName  = ($('#userName').val()  || '').trim();

        const bioContent = $('#bioEditor').length && $('#bioEditor').summernote
            ? $('#bioEditor').summernote('code')
            : ($('#bioEditor').val() || '');
        const plainBio = $('<div>').html(bioContent).text();
        const currentuserName = meta.userName || '';

        // Client-side validation
        const BIO_MAX = 10000;
        if (plainBio.length > BIO_MAX) {
            toastr.error('Bio is too long. Max 10,000 characters.');
            return;
        }

        if (userName === currentuserName) {
            Meteor.call('accounts.updateUserProfile', { firstName, lastName, userName }, (error, result) => {
                if (error) {
                    console.error('Error updating profile:', error);
                    toastr.error('An error occurred while updating the profile.', 'Error');
                } else {
                    console.log('Profile updated successfully');
                    // Also update bio
                    updateBio(bioContent);
                }
            });
        } else {
            Meteor.call('accounts.isHandleTaken', userName, (error, result) => {
                if (error) {
                    console.error('Error checking userName:', error);
                    toastr.error('An error occurred while checking the userName.', 'Error');
                } else if (result.status === 'error') {
                    toastr.error(result.message, 'Error');
                } else {
                    Meteor.call('accounts.updateUserProfile', { firstName, lastName, userName }, (error, result) => {
                        if (error) {
                            console.error('Error updating profile:', error);
                            toastr.error('An error occurred while updating the profile.', 'Error');
                        } else {
                            console.log('Profile updated successfully');
                            // Also update bio
                            updateBio(bioContent);
                        }
                    });
                }
            });
        }

        function updateBio(bio) {
            // Save bio via API
            const token = localStorage.getItem('Meteor.loginToken');
            fetch('/api/user/update-bio', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    bio: bio
                }),
            })
            .then(async (response) => {
                let json;
                try { json = await response.json(); } catch (e) { json = { error: 'Invalid JSON response' }; }
                return { ok: response.ok, status: response.status, json };
            })
            .then(({ ok, status, json }) => {
                console.log('Update bio response:', status, json);
                if (ok && json.status === 'success') {
                    toastr.success('Profile updated successfully.', 'Success');
                    // Update the userManager data
                    if (window.userManager && typeof window.userManager.getData === 'function') {
                        const currentData = window.userManager.getData() || {};
                        currentData.meta = currentData.meta || {};
                        currentData.meta.bio = bio;
                        if (typeof window.userManager.setData === 'function') {
                            window.userManager.setData(currentData);
                        }
                        if (typeof window.userManager.fetchUserDataFromServer === 'function') {
                            // Refresh user data from server
                            window.userManager.fetchUserDataFromServer();
                        }
                    }
                } else {
                    const msg = (json && (json.error || json.message)) || `Error updating bio (HTTP ${status}).`;
                    toastr.error(msg);
                }
            })
            .catch(error => {
                console.error('Error updating bio:', error);
                toastr.error('Error updating bio.');
            });
        }
    },
    'input #userName'(event) {
        event.target.value = event.target.value;
    },
    'click #btnLogout'(event) {
        event.preventDefault();
        const btn = event.currentTarget;
        if (btn.dataset.loading === '1') return;
        btn.dataset.loading = '1';
        const originalHtml = btn.innerHTML;
        btn.innerHTML = 'Logging out…';
        btn.disabled = true;

        Meteor.logout(err => {
            if (err) {
                console.error('Logout error:', err);
                if (window.toastr) toastr.error('Logout failed, try again.');
                btn.innerHTML = originalHtml;
                btn.disabled = false;
                btn.dataset.loading = '0';
                return;
            }
            FlowRouter.go('/');
        });
    }
});