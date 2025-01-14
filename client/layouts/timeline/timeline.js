Template.timeline.onCreated(function () {
  this.posts = new ReactiveVar([]);

  this.autorun(() => {
    HTTP.get('/api/timeline?type=my_timeline', (error, response) => {
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
  }
});
