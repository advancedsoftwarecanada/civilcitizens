console.log("Loaded: posts.js");

if (Meteor.isServer) {
  // Publish posts for a specific chamber or user
  Meteor.publish('posts.byChamber', function (chamber) {
    if (!this.userId) {
      return this.ready();
    }

    check(chamber, String);

    // Publish posts by chamber, or self posts if chamber is "self_post"
    if (chamber === 'self_post') {
      return Posts.find({ author: this.userId }, { sort: { createdAt: -1 } });
    } else {
      return Posts.find({ chamber }, { sort: { createdAt: -1 } });
    }
  });

  Meteor.methods({
    // Submit a new post
    'posts.submit': async function ({ title, body, chamber, image }) {
      check(title, String);
      check(body, String);
      check(chamber, String);
      check(image, Match.Maybe(String));

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to submit a post.');
      }

      try {
        const postId = await Posts.insertAsync({
          title,
          body,
          chamber,
          image: image || null,
          author_id: this.userId,
          createdAt: new Date().getTime(),
        });

        console.log('Post submitted successfully:', postId);
        return { status: 'success', message: 'Post submitted successfully.', postId };
      } catch (error) {
        console.error('Error submitting post:', error);
        throw new Meteor.Error('internal-server-error', 'An error occurred while submitting the post.');
      }
    },

    // Fetch a single post by ID
    'posts.getPost': async function (postId) {
      check(postId, String);

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to view posts.');
      }

      try {
        const post = await Posts.findOneAsync({ _id: postId });
        if (!post) {
          throw new Meteor.Error('not-found', 'Post not found.');
        }
        return post;
      } catch (error) {
        console.error('Error fetching post:', error);
        throw new Meteor.Error('internal-server-error', 'An error occurred while fetching the post.');
      }
    },

    // Delete a post (only by the author or admin)
    'posts.delete': async function (postId) {
      check(postId, String);

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to delete posts.');
      }

      const post = await Posts.findOneAsync({ _id: postId });
      if (!post) {
        throw new Meteor.Error('not-found', 'Post not found.');
      }

      if (post.author !== this.userId && !Roles.userIsInRole(this.userId, 'admin')) {
        throw new Meteor.Error('not-authorized', 'You can only delete your own posts.');
      }

      try {
        await Posts.removeAsync({ _id: postId });
        console.log('Post deleted successfully:', postId);
        return { status: 'success', message: 'Post deleted successfully.' };
      } catch (error) {
        console.error('Error deleting post:', error);
        throw new Meteor.Error('internal-server-error', 'An error occurred while deleting the post.');
      }
    },
  });

  // Server-side startup logging
  Meteor.startup(() => {
    console.log('Posts server methods and publications initialized.');
  });
}
