// @ts-nocheck
// Global declarations for Meteor collections and ostrio:files
/* global FilesCollection, UserMeta, Files */

// Publish files to the client
if (Meteor.isServer) {

    Meteor.publish('files.user', function () {
        if (!this.userId) {
            this.ready();
            return; // Do not return the result of ready()
        }

        // Guard: if Files collection is not available, just mark ready
        if (typeof Files === 'undefined' || !Files || typeof Files.find !== 'function') {
            this.ready();
            return;
        }

        // Return a cursor as required by Meteor publish
        return Files.find({ userId: this.userId });
    });

    Meteor.methods({

        'files.fetchMeta'(fileId) {
            check(fileId, String);

            const file = Files.findOne(fileId);
            if (!file) {
                throw new Meteor.Error('file-not-found', 'File not found.');
            }

            return {
                status: 'success',
                data: {
                    url: file.url,
                    dimensions: file.dimensions || null,
                    type: file.meta?.type || 'unknown',
                },
            };
        },

    'files.updateAvatarUrl': async function (url, userId) {
            check(url, String);
            check(userId, String);

            // Skip authorization check if called from the server
            if (Meteor.isClient && !this.userId) {
                throw new Meteor.Error('not-authorized', 'You must be logged in to update your avatar.');
            }

            // Update the user's avatar URL in their `UserMeta` document
            const updateResult = await UserMeta.updateAsync(
                { ownerUserId: userId },
                { $set: { avatarUrl: url } }
            );

            if (updateResult === 0) {
                throw new Meteor.Error('not-found', 'User meta data not found.');
            }

            console.log(`Avatar URL updated for user ${userId}: ${url}`);
            return { status: 'success', message: 'Avatar updated successfully.', url };
        },

        'files.updateCoverUrl': async function (url, userId) {
            check(url, String);
            check(userId, String);

            // Skip authorization check if called from the server
            if (Meteor.isClient && !this.userId) {
                throw new Meteor.Error('not-authorized', 'You must be logged in to update your cover.');
            }

            const updateResult = await UserMeta.updateAsync(
                { ownerUserId: userId },
                { $set: { coverUrl: url } }
            );

            if (updateResult === 0) {
                throw new Meteor.Error('not-found', 'User meta data not found.');
            }

            console.log(`Cover URL updated for user ${userId}: ${url}`);
            return { status: 'success', message: 'Cover updated successfully.', url };
        },

    });

}