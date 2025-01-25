FlowRouter.route('/admin/chambersBuilder', {
    name: "chambersBuilder",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'chambersBuilder',
        });
    }
});

// On render
Template.chambersBuilder.onRendered(function () {
    this.intervalId = setInterval(() => {
        const userId = Meteor.userId(); // Reactively track the logged-in user
        if (!userId) return null;

        // Reactively fetch data from UserManager
        const userMeta = userManager.data || {}; // `getData()` is reactive

        // return JSON.stringify(userMeta, null, 2);
        // set the DEBUGuserMeta textarea value
        document.getElementById('DEBUGuserMeta').value = JSON.stringify(userMeta, null, 2);
    }, 1000);
});

// on Destroyed
Template.chambersBuilder.onDestroyed(function () {
    clearInterval(this.intervalId);
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

// Helpers
Template.chambersBuilder.helpers({

});