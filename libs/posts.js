console.log("Loaded: posts.js");

if (Meteor.isServer) {
  // Publish posts for a specific chamber or user
  Meteor.publish('posts.byChamber', function (chamber) {
    if (!this.userId) {
      return this.ready();
    }

    check(chamber, String);

    // Publish posts by chamber, or self posts if chamber is "self"
    if (chamber === 'self') {
      return Posts.find({ author: this.userId }, { sort: { createdAt: -1 } });
    } else {
      return Posts.find({ chamber }, { sort: { createdAt: -1 } });
    }
  });

  Meteor.methods({
    // Submit a new post
    'posts.submit': async function (thePostJson ) {

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to submit a post.');
      }

      // log inputs
      console.log("++++++++++++++++++++++++++");
      console.log(thePostJson);

      // Check for existing draft if creating a draft
      if (thePostJson.draft) {
        const existingDraft = await Posts.findOneAsync({ authorId: this.userId, draft: true });
        if (existingDraft) {
          return { status: 'success', message: 'Draft post found.', postId: existingDraft._id };
        }
      }

      // Generate SEO URL
      let seoUrl;
      if (thePostJson.title && thePostJson.title.trim()) {
        seoUrl = `${thePostJson.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
      } else {
        seoUrl = `post-${Date.now()}`;
      }

      // Prepare post data
      const postData = {
        title: thePostJson.title || null,
        body: thePostJson.body || null,
        type: thePostJson.type,
        authorId: this.userId,
        voteCount: 0,
        commentCount: 0,
        bookmarkCount: 0,
        shareCount: 0,
        createdAt: new Date().getTime(),
        seoUrl: seoUrl,
        draft: thePostJson.draft || false,
      };

      // Handle attachments
      if (thePostJson.attachments) {
        const att = thePostJson.attachments;
        if (att.type === 'images') {
          postData.images = att.fileIds;
        } else if (att.type === 'video') {
          postData.video = att.fileId;
        } else if (att.type === 'link') {
          postData.link = att.url;
        } else if (att.type === 'poll') {
          postData.poll = {
            options: att.options,
            duration: att.duration,
            allowMulti: att.allowMulti,
          };
        }
      }

      // SELF POST
      if( thePostJson.type == "self"){
        try {
          const postId = await Posts.insertAsync(postData);
          console.log('Post submitted successfully:', postId);
          return { status: 'success', message: 'Post submitted successfully.', postId };
        } catch (error) {
          console.error('Error submitting post:', error);
          throw new Meteor.Error('internal-server-error', 'An error occurred while submitting the post.');
        }
      }

      // CHAMBER
      if( thePostJson.type == "chamber"){
        postData.chamber = thePostJson.chamber;
        postData.province = thePostJson.province;

        try {
          const postId = await Posts.insertAsync(postData);
          console.log('Post submitted successfully:', postId);

          // Update the Chamber stats.posts
          await Chambers.updateAsync({ province: thePostJson.province, seoUrl: thePostJson.chamber }, { $inc: { 'stats.posts': 1 } });

          return { status: 'success', message: 'Post submitted successfully.', postId };
        } catch (error) {
          console.error('Error submitting post:', error);
          throw new Meteor.Error('internal-server-error', 'An error occurred while submitting the post.');
        }
      }

      // TOPIC (if needed)
      if( thePostJson.type == "topic"){
        postData.topic = thePostJson.topic;
        try {
          const postId = await Posts.insertAsync(postData);
          console.log('Post submitted successfully:', postId);
          return { status: 'success', message: 'Post submitted successfully.', postId };
        } catch (error) {
          console.error('Error submitting post:', error);
          throw new Meteor.Error('internal-server-error', 'An error occurred while submitting the post.');
        }
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

  // Delete a post (only by the author; optional admin override if Roles available)
  'posts.delete': async function (postId) {
      check(postId, String);

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to delete posts.');
      }

      const post = await Posts.findOneAsync({ _id: postId });
      if (!post) {
        throw new Meteor.Error('not-found', 'Post not found.');
      }
      // Ownership consistency: posts store authorId (not author) elsewhere; fall back to post.author for legacy data
      const ownerId = post.authorId || post.author;
      let isAdmin = false;
      if (typeof Roles !== 'undefined' && Roles && Roles.userIsInRole) {
        try { isAdmin = !!Roles.userIsInRole(this.userId, 'admin'); } catch(e) { isAdmin = false; }
      }
      if (ownerId !== this.userId && !isAdmin) {
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

    // Update a post
    'posts.update': async function (postId, updateData) {
      check(postId, String);
      check(updateData, Object);

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to update posts.');
      }

      const post = await Posts.findOneAsync({ _id: postId });
      if (!post) {
        throw new Meteor.Error('not-found', 'Post not found.');
      }

      if (post.authorId !== this.userId) {
        throw new Meteor.Error('not-authorized', 'You can only update your own posts.');
      }

      // If title is being updated, regenerate SEO URL
      if (updateData.title !== undefined) {
        let seoUrl;
        if (updateData.title && updateData.title.trim()) {
          seoUrl = `${updateData.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
        } else {
          seoUrl = `post-${Date.now()}`;
        }
        updateData.seoUrl = seoUrl;
      }

      // Add last modified timestamp
      updateData.lastModifiedAt = new Date().getTime();

      try {
        await Posts.updateAsync({ _id: postId }, { $set: updateData });
        console.log('Post updated successfully:', postId);
        return { status: 'success', message: 'Post updated successfully.' };
      } catch (error) {
        console.error('Error updating post:', error);
        throw new Meteor.Error('internal-server-error', 'An error occurred while updating the post.');
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
        const existingVote = await Votes.findOneAsync({ userId: userId, postId: postId });

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
            userId: userId,
            postId: postId,
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
