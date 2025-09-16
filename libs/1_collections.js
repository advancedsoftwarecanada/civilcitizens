UserMeta = new Mongo.Collection('UserMeta');

Posts = new Mongo.Collection('Posts');

Votes = new Mongo.Collection('Votes');
// If server
if (Meteor.isServer) {
    Votes.rawCollection().createIndex({ userid: 1 });
    Votes.rawCollection().createIndex({ postId: 1 });
}

Bookmarks = new Mongo.Collection('Bookmarks');

Shares = new Mongo.Collection('Shares');

Comments = new Mongo.Collection('Comments');


Chambers = new Mongo.Collection('Chambers');
if (Meteor.isServer) {
    Chambers.rawCollection().createIndex({ province: 1 });
}
ChamberFollows = new Mongo.Collection('ChamberFollows');
if (Meteor.isServer) {
    ChamberFollows.rawCollection().createIndex({ userId: 1 });
    ChamberFollows.rawCollection().createIndex({ chamberId: 1 });
}

// User-to-user follows
UserFollows = new Mongo.Collection('UserFollows');
if (Meteor.isServer) {
    // Fast lookups by follower and by target
    UserFollows.rawCollection().createIndex({ followerId: 1 });
    UserFollows.rawCollection().createIndex({ targetUserId: 1 });
    // Prevent duplicate follows
    UserFollows.rawCollection().createIndex({ followerId: 1, targetUserId: 1 }, { unique: true });
}

// Files collection (ostrio:files)
if (Meteor.isServer) {
    Files = new FilesCollection({
        collectionName: 'Files',
        storagePath: Meteor.settings.public.filesPath + '/_processing/',
        allowClientCode: true,
        debug: false,
    });
}
