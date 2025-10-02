/* global FlowRouter toastr */
// Type annotations / ambient declarations (for linters / TypeScript in JS mode)
// eslint-disable-next-line no-unused-vars
// eslint-disable-next-line no-unused-vars
// eslint-disable-next-line no-unused-vars
// Declaring intentional global references used in Meteor + Blaze environment
// window.userManager and custom globals are provided elsewhere at runtime.
/* global FlowRouter toastr BlazeLayout */
// @ts-ignore (runtime global provided by app)
window.userManager;

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

// Overlay helper functions (overlay markup is now static in the template)
// @ts-ignore (expose overlay show helper globally)
window.__showGeoOverlay = function(msg){
    const ov=document.getElementById('geoDetectScreenOverlay');
    if(!ov) return;
    if(msg){ const m=document.getElementById('geoDetectOverlayMsg'); if(m) m.textContent=msg; }
    ov.style.transition='opacity .25s ease';
    ov.style.display='flex';
    ov.style.visibility='visible';
    ov.style.pointerEvents='auto';
    ov.style.opacity='1';
    document.documentElement.style.overflow='hidden';
};
// @ts-ignore (expose overlay hide helper globally)
window.__hideGeoOverlay = function(){
    const ov=document.getElementById('geoDetectScreenOverlay');
    if(!ov) return;
    ov.style.opacity='0';
    ov.style.pointerEvents='none';
    setTimeout(()=>{ if(ov.style.opacity==='0'){ ov.style.visibility='hidden'; document.documentElement.style.overflow=''; } },250);
};

Template.chambers.onRendered(function () {
    // No automatic geolocation; overlay already present in DOM.
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
    ,
    'click #btnAutoDetectRiding': function(event){
        event.preventDefault();
        const $btn = $('#btnAutoDetectRiding');
        const $status = $('#geoDetectStatus');
        if ($btn.prop('disabled')) return;
        if (!navigator.geolocation){
            $status.text('Not supported');
            return;
        }
    function showOverlay(msg){ window.__showGeoOverlay && window.__showGeoOverlay(msg); }
    function hideOverlay(){ window.__hideGeoOverlay && window.__hideGeoOverlay(); }
        $btn.prop('disabled', true); $status.text('Requesting permission…');
        showOverlay('Please wait while we detect your EDA based on your location…');
        navigator.geolocation.getCurrentPosition((pos)=>{
            const { latitude, longitude } = pos.coords;
            $status.text('Locating riding…');
            // Call geofencing first
            Meteor.call('chambers.findContainingPolygon', latitude, longitude, (err, primary) => {
                if (err || !primary) {
                    // fallback to nearest many
                    Meteor.call('chambers.findNearestMany', latitude, longitude, 11, (err2, list) => {
                        if (err2 || !list || !list.length){ $status.text('Failed'); hideOverlay(); $btn.prop('disabled', false); return; }
                        applySelection(list[0], list.slice(1));
                    });
                    return;
                }
                Meteor.call('chambers.findNearestMany', latitude, longitude, 10, (err2, alts)=>{
                    if (err2) alts = [];
                    alts = (alts||[]).filter(a=>!(a.province===primary.province && a.seoUrl===primary.seoUrl));
                    applySelection(primary, alts);
                });
            });
            function applySelection(primary, alternatives){
                if(primary){
                    if(!$('#province_territory').val()){
                        $('#province_territory').val(primary.province).trigger('change');
                        const start=Date.now();
                        const iv=setInterval(()=>{
                            const ready=$('#chamber_select option').length>1;
                            if(ready){ $('#chamber_select').val(primary.seoUrl).trigger('change'); clearInterval(iv); }
                            else if(Date.now()-start>8000){ clearInterval(iv); }
                        },300);
                    } else {
                        if($('#province_territory').val()!==primary.province){
                            $('#province_territory').val(primary.province).trigger('change');
                            const start=Date.now();
                            const iv=setInterval(()=>{
                                const opt=$('#chamber_select option[value="'+primary.seoUrl+'"]').length;
                                if(opt){ $('#chamber_select').val(primary.seoUrl).trigger('change'); clearInterval(iv);} else if(Date.now()-start>8000){ clearInterval(iv);} },300);
                        } else {
                            $('#chamber_select').val(primary.seoUrl).trigger('change');
                        }
                    }
                    toastr.success('Auto-detected: '+primary.name, (primary.method==='geofenced'?'Geofenced':'Nearest')+' Location');
                }
                if(alternatives && alternatives.length){
                    const container=$('#geoSuggestionContainer');
                    container.empty().data('filled', false);
                    let html='<div class="small fw-bold mb-2">Not your correct riding?</div><div class="d-flex flex-wrap gap-2">';
                    alternatives.forEach(c=>{ const distanceText=c.distanceKm?' ('+c.distanceKm+' km)':''; html+='<button type="button" class="btn btn-outline-secondary btn-sm geo-suggestion" data-province="'+c.province+'" data-seourl="'+c.seoUrl+'" title="'+c.name+distanceText+'">'+c.name+' <span class="text-muted">'+distanceText+'</span></button>'; });
                    html+='</div>';
                    container.html(html).data('filled', true);
                }
                $status.text('Done');
                setTimeout(()=>{ if($status.text()==='Done'){ $status.text(''); } }, 2500);
                hideOverlay();
                $btn.prop('disabled', false);
            }
        }, (err)=>{
            if (err && err.code === 1) {
                // Permission denied
                if (navigator.permissions && navigator.permissions.query) {
                    navigator.permissions.query({name: 'geolocation'}).then(result => {
                        if (result.state === 'denied') {
                            $status.html('Permission denied. <a href="#" id="geoHelpLink">How to enable?</a>');
                            $('#geoHelpLink').on('click', e => {
                                e.preventDefault();
                                // @ts-ignore
                                toastr.info('Go to browser settings > Site permissions > Location > Allow', 'Enable Location', {timeOut: 10000});
                            });
                        } else {
                            $status.text('Permission denied');
                        }
                    }).catch(() => {
                        $status.text('Permission denied');
                    });
                } else {
                    $status.text('Permission denied');
                }
            } else {
                $status.text('Location failed');
            }
            hideOverlay();
            $btn.prop('disabled', false);
        }, { enableHighAccuracy:false, timeout:10000, maximumAge:600000 });
    }


});

Template.chambers.helpers({

});