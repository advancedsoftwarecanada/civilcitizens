console.log("Loaded: chambers.js");

if (Meteor.isServer) {
    Meteor.methods({
        async 'chambers.setHomeChamber'(theProvince, theChamber) {
            check(theProvince, String);
            check(theChamber, String);

            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            const userMeta = await UserMeta.findOneAsync({ ownerUserId: this.userId });
            if (!userMeta) {
                throw new Meteor.Error('user-meta-not-found');
            }

            console.log("SEARCHING FOR HOME CHAMBER:", theProvince, theChamber, this.userId);

            // Remove any existing home chamber
            const existingHomeChamber = await ChamberFollows.findOneAsync({ userId: this.userId, home: true });
            if (existingHomeChamber) {
                await ChamberFollows.removeAsync({ _id: existingHomeChamber._id });
                await Chambers.updateAsync({ province: existingHomeChamber.province, seoUrl: existingHomeChamber.chamber }, { $inc: { 'stats.members': -1 } });
            }

            // Check if the specific chamber already exists
            const chamberFollow = await ChamberFollows.findOneAsync({
                userId: this.userId,
                province: theProvince,
                chamber: theChamber,
            });

            if (chamberFollow) {
                console.log("Updating chamberFollow to set as home");

                // Update existing chamberFollow to set as home
                await ChamberFollows.updateAsync(
                    { _id: chamberFollow._id },
                    { $set: { home: true } }
                );
            } else {
                console.log("Inserting new chamberFollow as home");

                // Insert new chamberFollow as home
                await ChamberFollows.insertAsync({
                    userId: this.userId,
                    province: theProvince,
                    chamber: theChamber,
                    home: true,
                });
            }

            // Increment the members stat for the new home chamber
            await Chambers.updateAsync({ province: theProvince, seoUrl: theChamber }, { $inc: { 'stats.members': 1 } });

            return { status: 'success', message: 'Home chamber set successfully.' };
        },
    });
}


Meteor.methods({

    // Submit a new post
    'chambers.do': async function ({ }) {

    },

    //

});
