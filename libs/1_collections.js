UserMeta = new Mongo.Collection('UserMeta');

Posts = new Mongo.Collection('Posts');

Votes = new Mongo.Collection('Votes');
// If server
if (Meteor.isServer) {
    Votes.rawCollection().createIndex({ user_id: 1 });
    Votes.rawCollection().createIndex({ post_id: 1 });
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
