FlowRouter.route('/notifications', {
    name: "notifications",
    action() {
        BlazeLayout.render('CivilApp', {
            main: 'notifications',
        });
    }
});
