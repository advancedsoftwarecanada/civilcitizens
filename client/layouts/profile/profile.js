FlowRouter.route('/profile', {
    name: "profile",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'profile',
        });
    }
});


Template.profile.events({
    'submit form'(event) {
        event.preventDefault();

        const myUserMeta = UserMeta.findOne({ owner_userid: Meteor.userId() });

        const target = event.target;
        const name_first = target.name_first.value;
        const name_last = target.name_last.value;
        const username = target.username.value.toLowerCase();
        const currentUsername = myUserMeta.username;

        if (username === currentUsername) {
            Meteor.call('accounts.updateUserProfile', { name_first, name_last, username }, (error, result) => {
                if (error) {
                    console.error('Error updating profile:', error);
                    toastr.error('An error occurred while updating the profile.', 'Error');
                } else {
                    console.log('Profile updated successfully');
                    toastr.success('Profile updated successfully.', 'Success');
                }
            });
        } else {
            Meteor.call('accounts.isHandleTaken', username, (error, result) => {
                if (error) {
                    console.error('Error checking username:', error);
                    toastr.error('An error occurred while checking the username.', 'Error');
                } else if (result.status === 'error') {
                    toastr.error(result.message, 'Error');
                } else {
                    Meteor.call('accounts.updateUserProfile', { name_first, name_last, username }, (error, result) => {
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
    'input #username'(event) {
        event.target.value = event.target.value.toLowerCase();
    }
});