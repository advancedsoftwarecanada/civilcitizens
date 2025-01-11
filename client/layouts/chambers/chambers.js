FlowRouter.route('/chambers', {
    name: "chambers",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'chambers',
        });
    }
});


Template.chambers.events({

});