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
    'posts.submit': async function ({ postTitle, postBody, postChamber, image, postType }) {

      check(postTitle, Match.Maybe(String));
      check(postBody, Match.Maybe(String));
      check(postChamber, Match.Maybe(String));
      check(image, Match.Maybe(String));
      check(postType, Match.Maybe(String));

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to submit a post.');
      }

      // log inputs
      console.log("++++++++++++++++++++++++++");
      console.log('postTitle:', postTitle);
      console.log('postBody:', postBody);
      console.log('postChamber:', postChamber);
      console.log('image:', image);
      console.log('postType:', postType);

      let province = "";
      let chamber = "self_post";
      let chamberParts = "";

      // See if this is self_post or a chamber post
      if(postChamber !== 'self_post') {
        chamberParts = postChamber.split('/');
      }

      // Create an SEO friendly url that is no longer than 30 characters and has a timestamp to ensure uniqueness
      const seoUrl = `${postTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;

      if (chamberParts.length > 1) {
        province = chamberParts[0];
        chamber = chamberParts[1];

        // Ensure the province and chamber are valid
        if (!province || !chamber) {
          throw new Meteor.Error('invalid-chamber', 'Invalid chamber format.');
        }

        // Ensure the province and chamber are valid
        if (!['nl', 'pe', 'ns', 'nb', 'qc', 'on', 'mb', 'sk', 'ab', 'bc', 'yt', 'nt', 'nu'].includes(province)) {
          throw new Meteor.Error('invalid-province', 'Invalid province.');
        }

        // Could do a check later.
        // if (!['house-of-assembly', 'legislative-assembly', 'national-assembly'].includes(chamber)) {
        //   throw new Meteor.Error('invalid-chamber', 'Invalid chamber.');
        // }

      }

      try {
        const postId = await Posts.insertAsync({
          title: postTitle,
          body: postBody,
          province: province,
          chamber: chamber,
          image: image || null,
          authorId: this.userId,
          voteCount: 0,
          commentCount: 0,
          bookmarkCount: 0,
          shareCount: 0,
          createdAt: new Date().getTime(),
          seoUrl: seoUrl,
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

    'posts.vote': async function ({ userId, postId, vote }) {
      check(userId, String);
      check(postId, String);
      check(vote, String);

      if (!userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to vote.');
      }

      if (!['upvote', 'downvote'].includes(vote)) {
        throw new Meteor.Error('invalid-vote', 'Vote must be either "up" or "down".');
      }

      try {
        const existingVote = await Votes.findOneAsync({ user_id: userId, post_id: postId });

        if (existingVote) {
          if (existingVote.vote === vote) {
            // User is removing their vote
            await Votes.removeAsync({ _id: existingVote._id });

            // Decrease vote count for the current vote type
            if (vote === 'upvote') {
              await Posts.updateAsync({ _id: postId }, { $inc: { voteCount: -1 } });
            } else {
              await Posts.updateAsync({ _id: postId }, { $inc: { voteCount: 1 } });
            }
          } else {
            // User is switching their vote
            await Votes.updateAsync({ _id: existingVote._id }, { $set: { vote } });

            // Adjust the vote count: remove the old vote and add the new vote
            if (vote === 'upvote') {
              await Posts.updateAsync({ _id: postId }, { $inc: { voteCount: 2 } }); // Remove downvote and add upvote
            } else {
              await Posts.updateAsync({ _id: postId }, { $inc: { voteCount: -2 } }); // Remove upvote and add downvote
            }
          }
        } else {
          // User is casting a new vote
          await Votes.insertAsync({
            user_id: userId,
            post_id: postId,
            vote,
            timestamp: Date.now(),
          });

          // Increase or decrease the vote count based on the vote type
          if (vote === 'upvote') {
            await Posts.updateAsync({ _id: postId }, { $inc: { voteCount: 1 } });
          } else {
            await Posts.updateAsync({ _id: postId }, { $inc: { voteCount: -1 } });
          }
        }

        return { status: 'success', message: 'Vote recorded successfully.' };
      } catch (error) {
        console.error('Error recording vote:', error);
        throw new Meteor.Error('internal-server-error', 'An error occurred while recording the vote.');
      }
    },



  });

  // Server-side startup logging
  Meteor.startup(() => {
    console.log('Posts server methods and publications initialized.');
  });
}
