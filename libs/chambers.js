console.log("Loaded: chambers.js");

if (Meteor.isServer) {
    Meteor.methods({
        'userMeta.setHomeChamber': async function (chamberId) {
            check(chamberId, String);

            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            const userMeta = await UserMeta.findOneAsync({ ownerUserId: this.userId });
            if (!userMeta) {
                throw new Meteor.Error('user-meta-not-found');
            }

            await UserMeta.updateAsync({ ownerUserId: this.userId }, {
                $set: { chamberHome: chamberId }
            });

            return true;
        },
    });
}

Meteor.methods({

    // Submit a new post
    'chambers.do': async function ({ }) {

    },

    //

});
