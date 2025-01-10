console.log("Loaded: accounts.js");

if (Meteor.isServer) {

    /*
    * Accounts.onCreateUser
    *
    * This function is called whenever a new user is created.
    * It is called before the user is inserted into the database.
    */
    Accounts.onCreateUser(async function(options, user) {

        console.log('New account created!');
        console.log(user);
        console.log(options);

        console.log("-----------------------------------");

        user.profile = options.profile;

        if (user.services.password) {

            await UserMeta.insertAsync({
                owner_userid: user._id,
                username: user.username,
                email: options.email,
                createdTimestamp: new Date(),
            });

            const theUserMeta = await UserMeta.findOneAsync({ owner_userid: user._id });

            await UserMeta.updateAsync(theUserMeta._id, {
                $set: { }
            });

        }

        return user; // Return the user object
    });
}