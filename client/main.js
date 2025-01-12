/*
 * Client Startup
    * This is the main entry point for the client
*/
Meteor.startup(() => {
    // Create a reactive variable for subscription readiness
    const userMetaSub = Meteor.subscribe('accounts.myUserMeta');

    Tracker.autorun(() => {
        if (userMetaSub.ready()) {
            console.log('UserMeta subscription is ready');
        } else {
            console.log('Waiting for UserMeta subscription...');
        }
    });
});


/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/', {
    name: "home",
    action() {
        if (Meteor.userId()) {

            BlazeLayout.render('CivilApp_3', {
                main: 'timeline',
            });
        } else {
            BlazeLayout.render('CivilApp_0', {
                main: 'guest',
            });
        }
    }
});

/*
 * CivilApp_3 layout rendered
*/
Template.CivilApp_3.onRendered(function () {
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

// Get my user information from usermeta
Template.registerHelper("myUserMeta", function () {
    const userMeta = UserMeta.findOne({ owner_userid: Meteor.userId() });
    if (Meteor.userId() && userMeta) {
        return {
            name_first: userMeta.name_first?.toLowerCase() || '',
            name_last: userMeta.name_last?.toLowerCase() || '',
            username: userMeta.username?.toLowerCase() || '',
            avatar_url: userMeta.avatar_url || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
        };
    }
    return null;
});