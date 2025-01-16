console.log("Loaded: accounts.js");

if (Meteor.isServer) {

    Meteor.publish('accounts.myUserMeta', function() {

        if (!this.userId) {
            return this.ready();
        }

        // Use an async function to handle async calls
        return (async () => {
            try {
                const user = await Meteor.users.findOneAsync(this.userId);
                if (!user || !user.profile || !user.profile.username) {
                    return this.ready();
                }

                const userMeta = await UserMeta.findOneAsync({ owner_userid: this.userId });
                if (!userMeta) {
                    return this.ready();
                }

                return UserMeta.find({ owner_userid: this.userId });

            } catch (error) {
                console.error("Error publishing userMeta:", error);
                return this.ready();
            }
        })();
    });

    Meteor.methods({
        'accounts.isHandleTaken': async function (username) {
            try {
                const userMeta = await UserMeta.findOneAsync({ username: username });
                if (userMeta) {
                    return { status: 'error', message: 'That handle is taken.' };
                }
                return { status: 'success', message: 'Handle is available.' };
            } catch (error) {
                console.error('Error in accounts.isHandleTaken:', error);
                throw new Meteor.Error('internal-server-error', 'An error occurred while checking the username.');
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
        'accounts.updateUserProfile': async function ({ name_first, name_last, username }) {
            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            try {
                const existingUserMeta = await UserMeta.findOneAsync({ username: username.toLowerCase() });
                if (existingUserMeta && existingUserMeta.owner_userid !== this.userId) {
                    throw new Meteor.Error('username-taken', 'That username is already taken.');
                }

                await Meteor.users.updateAsync(this.userId, {
                    $set: {
                        'profile.name_first': name_first.toLowerCase(),
                        'profile.name_last': name_last.toLowerCase(),
                        'profile.username': username.toLowerCase(),
                    }
                });

                await UserMeta.updateAsync({ owner_userid: this.userId }, {
                    $set: {
                        name_first: name_first.toLowerCase(),
                        name_last: name_last.toLowerCase(),
                        username: username.toLowerCase(),
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
                name_first: options.profile.name_first.toLowerCase(),
                name_last: options.profile.name_last.toLowerCase(),
                username: options.profile.username.toLowerCase(),
            };

            if (user.services.password) {

                // User Defaults
                const random_1_4 = Math.floor(Math.random() * 4) + 1;
                const random_avatar = "avatar-" + random_1_4 + ".png";
                const avatar_url = "/theme/images/" + random_avatar;

                // Insert user metadata
                const userMetaId = await UserMeta.insertAsync({
                    owner_userid: user._id,
                    username: user.profile.username,
                    email: email,
                    createdTimestamp: new Date().getTime(),

                    avatar_url: avatar_url,

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