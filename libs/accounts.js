console.log("Loaded: accounts.js");

if (Meteor.isServer) {

    Meteor.methods({
        'accounts.isHandleTaken': async function (userName) {
            try {
                const userMeta = await UserMeta.findOneAsync({ userName: userName });
                if (userMeta) {
                    return { status: 'error', message: 'That handle is taken.' };
                }
                return { status: 'success', message: 'Handle is available.' };
            } catch (error) {
                console.error('Error in accounts.isHandleTaken:', error);
                throw new Meteor.Error('internal-server-error', 'An error occurred while checking the userName.');
            }
        },
        'accounts.isEmailRegistered': async function (email) {
            try {
                const user = await Meteor.users.findOneAsync({ "emails.address": email });
                if (user) {
                    return { status: 'error', message: 'That email is already registered.' };
                }
                return { status: 'success', message: 'Email is available.' };
            } catch (error) {
                console.error('Error in accounts.isEmailRegistered:', error);
                throw new Meteor.Error('internal-server-error', 'An error occurred while checking the email.');
            }
        },
        'accounts.updateUserProfile': async function ({ firstName, lastName, userName }) {
            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            try {
                const existingUserMeta = await UserMeta.findOneAsync({ userName: userName });
                if (existingUserMeta && existingUserMeta.ownerUserId !== this.userId) {
                    throw new Meteor.Error('userName-taken', 'That userName is already taken.');
                }

                await Meteor.users.updateAsync(this.userId, {
                    $set: {
                        'profile.firstName': firstName.toLowerCase(),
                        'profile.lastName': lastName.toLowerCase(),
                        'profile.userName': userName,
                    }
                });

                await UserMeta.updateAsync({ ownerUserId: this.userId }, {
                    $set: {
                        firstName: firstName.toLowerCase(),
                        lastName: lastName.toLowerCase(),
                        userName: userName,
                        chamberHome: "UNSET",
                    }
                });

                return { status: 'success', message: 'Profile updated successfully.' };
            } catch (error) {
                console.error('Error updating profile:', error);
                throw new Meteor.Error('internal-server-error', 'An error occurred while updating the profile.');
            }
        }
    });

    /*
    * Accounts.onCreateUser
    *
    * This function is called whenever a new user is created.
    * It is called before the user is inserted into the database.
    */
    Accounts.onCreateUser(async function (options, user) {
        try {
            // console.log('New account creation process started!');
            // console.log('User:', user);
            // console.log('Options:', options);

            const email = options.email.toLowerCase();
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            // Validate email
            if (!emailRegex.test(email)) {
                throw new Meteor.Error('invalid-email', 'The provided email is invalid.');
            }

            // Normalize profile fields
            user.profile = {
                ...options.profile,
                firstName: options.profile.firstName.toLowerCase(),
                lastName: options.profile.lastName.toLowerCase(),
                userName: options.profile.userName,
            };

            if (user.services.password) {

                // User Defaults
                const random_1_4 = Math.floor(Math.random() * 4) + 1;
                const random_avatar = "avatar-" + random_1_4 + ".png";
                const avatarUrl = "/theme/assets/images/" + random_avatar;

                // Insert user metadata
                const userMetaId = await UserMeta.insertAsync({
                    ownerUserId: user._id,
                    firstName: user.profile.firstName,
                    lastName: user.profile.lastName,
                    userName: user.profile.userName,
                    email: email,
                    createdTimestamp: new Date().getTime(),

                    avatarUrl: avatarUrl,

                });

                // Update user metadata (if required)
                await UserMeta.updateAsync(userMetaId, {
                    $set: {}, // Add fields to update if necessary
                });

                // console.log('UserMeta successfully created:', userMetaId);
            }

            // console.log('Account creation process completed!');
            return user; // Return the user object
        } catch (error) {
            console.error('Error in onCreateUser:', error);
            throw new Meteor.Error('account-creation-failed', error.message || 'Failed to create account.');
        }
    });

    // Accounts on login attempt (server side console log)
    Accounts.onLogin(function (loginInfo) {
        // console.log('User logged in:', loginInfo.user);
    });
    // on ATTEMPT
    Accounts.onLoginFailure(function (loginInfo) {
        // console.log('User login attempt failed:', loginInfo);
    });


}