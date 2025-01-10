
FlowRouter.route('/logout', {
    name: "logout",
    action() {
        if (Meteor.userId()) {
            BlazeLayout.render('CivilApp', {
                main: 'logout',
            });
        } else {
            BlazeLayout.render('CivilApp', {
                main: 'logout',
            });
        }
    }
});

// on rendered
Template.logout.rendered = function() {

    $('body').css('display', 'none');
    Meteor.logout();
    setTimeout(function(){
        FlowRouter.go('/');
        // refresh
        location.reload();
    }, 1000);

};