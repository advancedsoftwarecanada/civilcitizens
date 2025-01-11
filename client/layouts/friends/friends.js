
FlowRouter.route('/friends', {
    name: "friends",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'friends',
        });
    }
});
