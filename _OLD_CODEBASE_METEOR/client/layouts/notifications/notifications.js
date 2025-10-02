FlowRouter.route('/notifications', {
    name: "notifications",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'notifications',
        });
    }
});
