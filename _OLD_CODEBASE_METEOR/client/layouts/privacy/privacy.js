FlowRouter.route('/privacy', {
    name: "privacy",
    action() {
        BlazeLayout.render('CivilApp_0', {
            main: 'privacy',
        });
    }
});
