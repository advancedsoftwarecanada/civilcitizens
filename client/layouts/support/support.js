FlowRouter.route('/support', {
    name: "support",
    action() {
        BlazeLayout.render('CivilApp_0', {
            main: 'support',
        });
    }
});