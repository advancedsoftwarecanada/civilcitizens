// Define the FilesCollection
Files = new FilesCollection({
    debug: true,
    collectionName: 'Files',
    storagePath: Meteor.settings.public.filesPath + '/_processing/',
    allowClientCode: false,
    debug: false,
});

// Publish files to the client
if (Meteor.isServer) {

    Meteor.methods({

        'files.fetchMeta'(fileId) {
            check(fileId, String);

            const file = Files.findOne({ _id: fileId });
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

        'files.updateAvatarUrl'(url, userId) {
            check(url, String);
            check(userId, String);

            // Skip authorization check if called from the server
            if (Meteor.isClient && !this.userId) {
                throw new Meteor.Error('not-authorized', 'You must be logged in to update your avatar.');
            }

            // Update the user's avatar URL in their `UserMeta` document
            const updateResult = UserMeta.updateAsync(
                { owner_userid: userId },
                { $set: { avatar_url: url } }
            );

            if (updateResult === 0) {
                throw new Meteor.Error('not-found', 'User meta data not found.');
            }

            console.log(`Avatar URL updated for user ${userId}: ${url}`);
            return { status: 'success', message: 'Avatar updated successfully.', url };
        },

    });

}