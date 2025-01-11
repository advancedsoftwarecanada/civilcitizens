console.log("Loaded: accounts.js");

if (Meteor.isServer) {

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
    });

    /*
    * Accounts.onCreateUser
    *
    * This function is called whenever a new user is created.
    * It is called before the user is inserted into the database.
    */
    Accounts.onCreateUser(async function (options, user) {
        try {
            console.log('New account creation process started!');
            console.log('User:', user);
            console.log('Options:', options);

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
                // Insert user metadata
                const userMetaId = await UserMeta.insertAsync({
                    owner_userid: user._id,
                    username: user.profile.username,
                    email: email,
                    createdTimestamp: new Date().getTime(),
                });

                // Update user metadata (if required)
                await UserMeta.updateAsync(userMetaId, {
                    $set: {}, // Add fields to update if necessary
                });

                console.log('UserMeta successfully created:', userMetaId);
            }

            console.log('Account creation process completed!');
            return user; // Return the user object
        } catch (error) {
            console.error('Error in onCreateUser:', error);
            throw new Meteor.Error('account-creation-failed', error.message || 'Failed to create account.');
        }
    });

}