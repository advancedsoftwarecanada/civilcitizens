FlowRouter.route('/admin/chambersBuilder', {
    name: "chambersBuilder",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'chambersBuilder',
        });
    }
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

});