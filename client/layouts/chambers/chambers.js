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

            Meteor.call('chambers.setHomeChamber', province, chamber, function(error, result) {
                if(error) {
                    console.error('Error setting home chamber:', error);
                    toastr.error('An error occurred while setting the home chamber.', 'Error');
                } else {
                    // toastr
                    toastr.success('Home chamber set, welcome to Civil!.', 'Success');
                    FlowRouter.go('/c/'+province+'/'+chamber);
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
    }


});

Template.chambers.helpers({

});