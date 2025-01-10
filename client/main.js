/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/', {
    name: "home",
    action() {
        if (Meteor.userId()) {
            BlazeLayout.render('CivilApp', {
                main: 'timeline',
            });
        } else {
            BlazeLayout.render('CivilApp', {
                main: 'guest',
            });
        }
    }
});

/*
 * CivilApp layout rendered
*/
Template.CivilApp.onRendered(function () {
    // Detect if <body> has a modal applied and remove it
    // This is a bug when coding, with hot module replace
    $('body').removeClass('modal-open modal-with-transition');
    // remove any <div class="modal-backdrop fade show"></div>
    $('.modal-backdrop').remove();
});


// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //
// GLOBAL HELPERS
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //

/*
 * Check if the user is the owner of the post
 */
Template.registerHelper("isLoggedIn", function () {
    if(Meteor.userId() !== null) {
        return true;
    }
    return false;
});