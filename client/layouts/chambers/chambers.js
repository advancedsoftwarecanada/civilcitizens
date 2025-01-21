FlowRouter.route('/chambers', {
    name: "chambers",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'chambers',
        });
    }
});

Template.chambers.onRendered(function () {



});

Template.chambers.events({

    // Save the selected chamber as the user's home chamber
    'click #save_chamber': function (event) {

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

            Meteor.call('userMeta.setHomeChamber', chamber, function(error, result) {
                if(error) {
                    console.error('Error setting home chamber:', error);
                    alert('Error setting home chamber.');
                } else {
                    // toastr
                    toastr.success('Home chamber set, welcome to Civil!.', 'Success');
                    FlowRouter.go('/timeline');
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