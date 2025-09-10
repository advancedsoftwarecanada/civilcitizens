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

        'chambers.follow': async function ({ userId, province, chamber }) {
            check(province, String);
            check(chamber, String);

            if (!userId) {
                throw new Meteor.Error('not-authorized');
            }

            const chamberFollow = await ChamberFollows.findOneAsync({
                userId: userId,
                province: province,
                chamber: chamber,
            });

            if (chamberFollow) {
                throw new Meteor.Error('already-following', 'You are already following this chamber.');
            }

            await ChamberFollows.insertAsync({
                userId: userId,
                province: province,
                chamber: chamber,
                home: false,
            });

            await Chambers.updateAsync({ province: province, seoUrl: chamber }, { $inc: { 'stats.followers': 1 } });

            return { status: 'success', message: 'Chamber followed successfully.' };
        },

        'chambers.unfollow': async function ({ userId, province, chamber }) {
            console.log("UNFOLLOWING CHAMBER", userId, province, chamber);

            check(province, String);
            check(chamber, String);

            if (!userId) {
                throw new Meteor.Error('not-authorized');
            }

            const chamberFollow = await ChamberFollows.findOneAsync({
                userId: userId,
                province: province,
                chamber: chamber,
            });

            if (!chamberFollow) {
                throw new Meteor.Error('not-following', 'You are not following this chamber.');
            }

            await ChamberFollows.removeAsync({ _id: chamberFollow._id });

            await Chambers.updateAsync({ province: province, seoUrl: chamber }, { $inc: { 'stats.followers': -1 } });

            return { status: 'success', message: 'Chamber unfollowed successfully.' };
        },

        // Find nearest chamber to supplied coordinates (simple Haversine over all chambers)
        async 'chambers.findNearest'(lat, lng) {
            check(lat, Number);
            check(lng, Number);

            // Optional auth: allow only logged-in to reduce abuse (can relax later)
            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            const raw = Chambers.rawCollection();
            const chambers = await raw.find({ 'location.lat': { $exists: true }, 'location.lng': { $exists: true } }, { projection: { province: 1, seoUrl: 1, name: 1, location: 1 } }).toArray();
            if (!chambers.length) {
                return null;
            }

            const R = 6371; // km
            let best = null;
            for (const c of chambers) {
                const dLat = (c.location.lat - lat) * Math.PI / 180;
                const dLng = (c.location.lng - lng) * Math.PI / 180;
                const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat*Math.PI/180)*Math.cos(c.location.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
                const d = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                if (!best || d < best.distanceKm) {
                    best = { province: c.province, seoUrl: c.seoUrl, name: c.name, distanceKm: Number(d.toFixed(1)) };
                }
            }
            return best;
        },

        // Return up to N nearest chambers
        async 'chambers.findNearestMany'(lat, lng, limit = 5) {
            check(lat, Number);
            check(lng, Number);
            check(limit, Number);
            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }
            if (limit > 25) limit = 25; // safety cap
            const raw = Chambers.rawCollection();
            const chambers = await raw.find({ 'location.lat': { $exists: true }, 'location.lng': { $exists: true } }, { projection: { province: 1, seoUrl: 1, name: 1, location: 1 } }).toArray();
            if (!chambers.length) return [];
            const R = 6371;
            const scored = chambers.map(c => {
                const dLat = (c.location.lat - lat) * Math.PI / 180;
                const dLng = (c.location.lng - lng) * Math.PI / 180;
                const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat*Math.PI/180)*Math.cos(c.location.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
                const d = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                return { province: c.province, seoUrl: c.seoUrl, name: c.name, distanceKm: Number(d.toFixed(1)) };
            });
            scored.sort((a,b)=> a.distanceKm - b.distanceKm);
            return scored.slice(0, limit);
        },
    });
}


Meteor.methods({

    // Submit a new post
    'chambers.do': async function ({ }) {

    },

    //

});
