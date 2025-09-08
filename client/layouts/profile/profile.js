FlowRouter.route('/profile', {
    name: "profile",
    action() {

        const checkUserDataReady = setInterval(() => {
            if (window.userDataReady) {
                clearInterval(checkUserDataReady);
                BlazeLayout.render('CivilApp_3', {
                    main: 'profile',
                });
            }
        }, 100);

    }
});

// Rendered
Template.profile.rendered = function() {


};


Template.profile.events({

    'submit form'(event) {
        event.preventDefault();

        const myUserMeta = UserMeta.find({ ownerUserId: Meteor.userId() }).fetch()[0];

        const target = event.target;
        const firstName = target.firstName.value;
        const lastName = target.lastName.value;
        const userName = target.userName.value;
        const currentuserName = myUserMeta.userName;

        if (userName === currentuserName) {
            Meteor.call('accounts.updateUserProfile', { firstName, lastName, userName }, (error, result) => {
                if (error) {
                    console.error('Error updating profile:', error);
                    toastr.error('An error occurred while updating the profile.', 'Error');
                } else {
                    console.log('Profile updated successfully');
                    toastr.success('Profile updated successfully.', 'Success');
                }
            });
        } else {
            Meteor.call('accounts.isHandleTaken', userName, (error, result) => {
                if (error) {
                    console.error('Error checking userName:', error);
                    toastr.error('An error occurred while checking the userName.', 'Error');
                } else if (result.status === 'error') {
                    toastr.error(result.message, 'Error');
                } else {
                    Meteor.call('accounts.updateUserProfile', { firstName, lastName, userName }, (error, result) => {
                        if (error) {
                            console.error('Error updating profile:', error);
                            toastr.error('An error occurred while updating the profile.', 'Error');
                        } else {
                            console.log('Profile updated successfully');
                            toastr.success('Profile updated successfully.', 'Success');
                        }
                    });
                }
            });
        }
    },
    'input #userName'(event) {
        event.target.value = event.target.value;
    }
});