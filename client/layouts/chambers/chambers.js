/* global FlowRouter toastr */
// Declaring intentional global references used in Meteor + Blaze environment
// window.userManager and custom globals are provided elsewhere at runtime.

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
    // If user clicks manual detect button first, they can set window.__manualRidingDetect = true to skip auto attempt (optional)
    setTimeout(() => {
        try {
            if (window.__manualRidingDetect) { return; }
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
                
                // First try geofencing to find exact containing riding
                Meteor.call('chambers.findContainingPolygon', latitude, longitude, (err, primary) => {
                    if (err) { 
                        console.warn('Geofencing error, falling back to nearest:', err); 
                        // Fall back to nearest method
                        Meteor.call('chambers.findNearestMany', latitude, longitude, 11, (err2, list) => {
                            if (err2) { console.warn('Nearest chambers error', err2); return; }
                            if (!list || !list.length) return;
                            handleChamberSelection(list[0], list.slice(1, 11));
                        });
                        return;
                    }
                    
                    if (!primary) {
                        console.warn('No primary chamber found, falling back to nearest');
                        Meteor.call('chambers.findNearestMany', latitude, longitude, 11, (err2, list) => {
                            if (err2) { console.warn('Nearest chambers error', err2); return; }
                            if (!list || !list.length) return;
                            handleChamberSelection(list[0], list.slice(1, 11));
                        });
                        return;
                    }
                    
                    console.log('Geofenced primary chamber:', primary);
                    
                    // Get additional alternatives using nearest method
                    Meteor.call('chambers.findNearestMany', latitude, longitude, 10, (err2, alternatives) => {
                        if (err2) { 
                            console.warn('Alternatives error:', err2);
                            alternatives = [];
                        }
                        
                        // Filter out the primary from alternatives if it's there
                        alternatives = alternatives.filter(alt => 
                            !(alt.province === primary.province && alt.seoUrl === primary.seoUrl)
                        );
                        
                        handleChamberSelection(primary, alternatives);
                    });
                });
                
                function handleChamberSelection(primary, alternatives) {
                    console.log('Primary chamber:', primary);
                    console.log('Alternative chambers:', alternatives);
                    
                    // Auto-select the primary chamber
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
                        
                        const methodText = primary.method === 'geofenced' ? 'Geofenced' : 'Nearest';
                        toastr.success(`Auto-detected: ${primary.name}`, `${methodText} Location Found`);
                    }

                    // Show alternatives
                    if (alternatives && alternatives.length) {
                        const container = $('#geoSuggestionContainer');
                        if (container && !container.data('filled')) {
                            let html = '<div class="small fw-bold mb-2">Not your correct riding?</div><div class="d-flex flex-wrap gap-2">';
                            alternatives.forEach((c) => {
                                const distanceText = c.distanceKm ? ` (${c.distanceKm} km)` : '';
                                html += '<button type="button" class="btn btn-outline-secondary btn-sm geo-suggestion" data-province="'+c.province+'" data-seourl="'+c.seoUrl+'" title="'+c.name+distanceText+'">'+c.name+' <span class="text-muted">'+distanceText+'</span></button>';
                            });
                            html += '</div>';
                            container.html(html).data('filled', true);
                        }
                    }
                }
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