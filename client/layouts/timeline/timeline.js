import userManager from "../../userManager.js";


/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/c/:province/:chamber', {
  name: "home",
  action() {
      if (Meteor.userId()) {

          BlazeLayout.render('CivilApp_3', {
              main: 'timeline',
          });
      } else {
          BlazeLayout.render('CivilApp_0', {
              main: 'guest',
          });
      }
  }
});


Template.timeline.onCreated(function () {
  this.posts = new ReactiveVar([]);

  this.autorun(() => {
    HTTP.get(Meteor.settings.public.ROOT_URL+'/api/timeline?type=my_timeline', (error, response) => {
      if (error) {
        console.error('Error fetching timeline posts:', error);
      } else {
        this.posts.set(response.data);
        console.log('Timeline posts:', response.data);
      }
    });
  });

});

Template.timeline.onRendered(function () {
  this.autorun(() => {
    this.posts.get(); // Re-run when posts change
    Meteor.defer(() => {
      document.querySelectorAll('.post-content').forEach(postContent => {
        if (postContent.scrollHeight > postContent.clientHeight) {
          postContent.nextElementSibling.style.display = 'block'; // Show "Read More" button
        }
      });
    });
  });
});

Template.timeline.helpers({
  posts() {
    return Template.instance().posts.get();
  },
  isAd(post) {
    return post.ad === true;
  },
  province() {
    return FlowRouter.getParam('province');
  },
  chamber() {
    return FlowRouter.getParam('chamber');
  },
});

Template.timeline.events({
  // 'click .upvote-btn': async function () {
  //   const postId = this._id;
  //   const success = await userManager.vote(postId, 'upvote');
  //   if (success) {
  //     console.log(`Successfully upvoted post ${postId}`);
  //   }
  // },
  // 'click .downvote-btn': async function () {
  //   const postId = this._id;
  //   const success = await userManager.vote(postId, 'downvote');
  //   if (success) {
  //     console.log(`Successfully downvoted post ${postId}`);
  //   }
  // },
});