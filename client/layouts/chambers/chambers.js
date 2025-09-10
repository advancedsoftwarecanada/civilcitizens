FlowRouter.route('/chambers', {
    name: "chambers",
    action() {
        const checkUserDataReady = setInterval(() => {
            if (window.userDataReady) {
                clearInterval(checkUserDataReady);
                BlazeLayout.render('CivilApp_3', {
                    main: 'chambers',
                });
            }
        }, 100);
    }
});

Template.chambers.onRendered(function () {
    // Attempt auto-detect nearest chamber for new users without a home chamber
    setTimeout(() => {
        try {
            const metaFn = window.userManager && window.userManager.myUserMeta;
            const meta = metaFn ? metaFn() : null;
            // If a home chamber already set OR any chambers exist, skip geolocation
            const chamberFollows = (window.userManager && window.userManager.getData && window.userManager.getData().chamberFollows) || [];
            if ((meta && meta.chamberHome) || chamberFollows.length > 0) {
                return; // already set or user has chambers
            }
            if (!navigator.geolocation) {
                return;
            }
            navigator.geolocation.getCurrentPosition((pos) => {
                const { latitude, longitude } = pos.coords;
                console.log('User geo coords:', latitude, longitude);
                // Fetch 11: 1 primary + up to 10 alternatives
                Meteor.call('chambers.findNearestMany', latitude, longitude, 11, (err, list) => {
                    if (err) { console.warn('Nearest chambers error', err); return; }
                    if (!list || !list.length) return;
                    console.log('Nearest chambers list (debug):', list);
                    const primary = list[0];
                    const alternatives = list.slice(1, 11); // up to 10 alternatives
                    if (!$('#province_territory').val()) {
                        $('#province_territory').val(primary.province).trigger('change');
                        const start = Date.now();
                        const iv = setInterval(() => {
                            const ready = $('#chamber_select option').length > 1;
                            if (ready) {
                                $('#chamber_select').val(primary.seoUrl).trigger('change');
                                clearInterval(iv);
                            } else if (Date.now() - start > 8000) {
                                clearInterval(iv);
                            }
                        }, 300);
                        toastr.info('Suggested nearest chamber: '+primary.name, 'Location Detected');
                    }

                    if (alternatives.length) {
                        const container = $('#geoSuggestionContainer');
                        if (container && !container.data('filled')) {
                            let html = '<div class="small fw-bold mb-2">Not your correct riding?</div><div class="d-flex flex-wrap gap-2">';
                            alternatives.forEach((c) => {
                                // Show name + distance for clarity
                                html += '<button type="button" class="btn btn-outline-secondary btn-sm geo-suggestion" data-province="'+c.province+'" data-seourl="'+c.seoUrl+'" title="'+c.name+' ('+c.distanceKm+' km)">'+c.name+' <span class="text-muted">('+c.distanceKm+' km)</span></button>';
                            });
                            html += '</div>';
                            container.html(html).data('filled', true);
                        }
                    }
                });
            }, (err) => {
                console.log('Geolocation denied or failed', err && err.message);
            }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 });
        } catch(e) {
            console.warn('Geolocation setup failed', e);
        }
    }, 600); // slight delay to allow DOM & select2 init script
});

Template.chambers.events({

    // Save the selected chamber as the user's home chamber
    'click #save_chamber': function (event) {

        // prevent form submit
        event.preventDefault();

        var province = $('#province_territory').val();
        var chamber = $('#chamber_select').val();
        if(chamber) {

            // #province_territory
            // #chamber_select
            // Ensure these are both set and return

            if( province == '' ){
                toastr.error('Please select a province.', 'Validation Error');
                return false;
            }

            if( chamber == '' ){
                toastr.error('Please select a chamber.', 'Validation Error');
                return false;
            }

            $('#save_chamber').prop('disabled', true).text('Saving...');
            Meteor.call('chambers.setHomeChamber', province, chamber, async function(error, result) {
                if(error) {
                    console.error('Error setting home chamber:', error);
                    toastr.error('An error occurred while setting the home chamber.', 'Error');
                    $('#save_chamber').prop('disabled', false).text('🏠 Set Home Chamber');
                } else {
                    console.log('Home chamber server result:', result);
                    // Update local userManager cache immediately so UI reacts
                    if (window.userManager) {
                        try {
                            const um = window.userManager;
                            const follows = (um.data.chamberFollows || []).map(f => ({...f, home: false}));
                            const idx = follows.findIndex(f => f.province === province && f.chamber === chamber);
                            if (idx >= 0) {
                                follows[idx].home = true;
                                follows[idx].following = true;
                            } else {
                                follows.push({ province, chamber, home: true, following: true });
                            }
                            um.data.chamberFollows = follows;
                            await um.saveToStorage();
                            um.reactiveData.changed();
                            console.log('Updated local userManager chamberFollows:', follows);
                        } catch(e) {
                            console.warn('Failed updating local userManager after setHomeChamber', e);
                        }
                    }
                    // Optionally re-fetch from server to confirm (non-blocking)
                    if (window.userManager && window.userManager.fetchUserDataFromServer) {
                        window.userManager.fetchUserDataFromServer().catch(e=>console.warn('Refresh user data failed', e));
                    }
                    toastr.success('Home chamber set, welcome to Civil!', 'Success');
                    setTimeout(()=> FlowRouter.go('/c/'+province+'/'+chamber), 400);
                }
            });

        } else {
            // alert('Please select a chamber.');
            toastr.error('Please select a chamber.', 'Validation Error');
            return false;
        }

    },

    // uiActionVisitChamber
    'click .uiActionVisitChamber': function (event) {

        // We should visit
        // /c/province/chamberSeoUrl

        var province = $('#province_territory').val();
        var chamber = $('#chamber_select').val();

        if( province == '' ){
            toastr.error('Please select a province.', 'Validation Error');
            return false;
        }

        if( chamber == '' ){
            toastr.error('Please select a chamber.', 'Validation Error');
            return false;
        }

        FlowRouter.go('/c/'+province+'/'+chamber);
    },

    'click .geo-suggestion': function (event) {
        event.preventDefault();
        const btn = $(event.currentTarget);
        const province = btn.data('province');
        const chamberSeo = btn.data('seourl');
        if (!province || !chamberSeo) return;
        const currentProvince = $('#province_territory').val();
        if (currentProvince !== province) {
            $('#province_territory').val(province).trigger('change');
        }
        const start = Date.now();
        const iv = setInterval(() => {
            if ($('#chamber_select option[value="'+chamberSeo+'"]').length) {
                $('#chamber_select').val(chamberSeo).trigger('change');
                clearInterval(iv);
            } else if (Date.now() - start > 8000) {
                clearInterval(iv);
            }
        }, 300);
        toastr.info('Selected suggested riding', 'Updated');
    }


});

Template.chambers.helpers({

});