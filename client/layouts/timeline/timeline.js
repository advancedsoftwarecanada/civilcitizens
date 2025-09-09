import userManager from "../../userManager.js";

// Reactive variable for thisChamber
const thisChamber = new ReactiveVar(null);

/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/c/:province/:chamber', {
  name: "home",
  action() {
      if (Meteor.userId()) {

        const checkUserDataReady = setInterval(() => {
          if (window.userDataReady) {
              clearInterval(checkUserDataReady);
              BlazeLayout.render('CivilApp_3', {
                  main: 'timeline',
              });
          }
      }, 100);
      } else {
          BlazeLayout.render('CivilApp_0', {
              main: 'guest',
          });
      }
  }
});


Template.timeline.onCreated(function () {
  this.posts = new ReactiveVar([]);
  this.isLoading = new ReactiveVar(false);
  this.hasMore = new ReactiveVar(true);
  this.currentOffset = new ReactiveVar(0);
  this.initialLoad = new ReactiveVar(true);

  this.loadPosts = (append = false) => {
    if (this.isLoading.get() || (!append && !this.hasMore.get())) return;

    this.isLoading.set(true);
    const userId = Meteor.userId();
    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');
    const path = FlowRouter.current().path;
    const offset = append ? this.currentOffset.get() : 0;
    const limit = 10; // Load 10 posts at a time

    const apiUrl = `${Meteor.settings.public.ROOT_URL}/api/timeline?uid=${userId}&path=${path}&province=${province}&chamber=${chamber}&offset=${offset}&limit=${limit}`;

    HTTP.get(apiUrl, (error, response) => {
      this.isLoading.set(false);

      if (error) {
        console.error('Error fetching timeline posts:', error);
        return;
      }

      const data = response.data;
      console.log('Timeline posts response:', data);

      if (append) {
        // Append new posts to existing ones
        const currentPosts = this.posts.get();
        this.posts.set([...currentPosts, ...data.posts]);
        this.currentOffset.set(data.offset);
        this.hasMore.set(data.hasMore);
      } else {
        // Replace posts for initial load
        this.posts.set(data.posts);
        this.currentOffset.set(data.offset);
        this.hasMore.set(data.hasMore);
        this.initialLoad.set(false);

        // Scroll to top only on initial load
        $('html, body').animate({
          scrollTop: 0
        }, 0);
      }
    });
  };

  // Initial load
  this.autorun(() => {
    const userId = Meteor.userId();
    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    if (userId && this.initialLoad.get()) {
      this.loadPosts(false);
    }
  });

});

// TODO: we want to limit the height of posts on the timeline, and show a "Read More" button if the post is too long
Template.timeline.onRendered(function () {

  console.log("TIMELINE RENDERED");

  // Scroll detection for lazy loading
  this.scrollHandler = () => {
    const scrollTop = $(window).scrollTop();
    const windowHeight = $(window).height();
    const documentHeight = $(document).height();
    const scrollPercentage = (scrollTop + windowHeight) / documentHeight;

    // Load more posts when user scrolls to 80% of the page
    if (scrollPercentage > 0.8 && !this.isLoading.get() && this.hasMore.get()) {
      console.log('Loading more posts...');
      this.loadPosts(true);
    }
  };

  // Throttle scroll events for better performance
  let scrollTimeout;
  this.throttledScrollHandler = () => {
    if (!scrollTimeout) {
      scrollTimeout = setTimeout(() => {
        this.scrollHandler();
        scrollTimeout = null;
      }, 200); // 200ms throttle
    }
  };

  // Attach scroll listener
  $(window).on('scroll.timeline', this.throttledScrollHandler);

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


    let province = FlowRouter.getParam('province');
    let chamber = FlowRouter.getParam('chamber');

    if (province && chamber) {
      // This is a chamber we must request its details over http and update the reactive var
      console.log("CHAMBER PAGE IS LOADED");
      const apiUrl = `${Meteor.settings.public.ROOT_URL}/api/chamber?province=${province}&chamber=${chamber}`;
      console.log("API URL", apiUrl);
      HTTP.get(apiUrl, (error, response) => {
        if (error) {
          console.error('Error fetching chamber:', error);
        } else {
          thisChamber.set(response.data);
          console.log('Chamber:', response.data);
        }
      });
    }

});

Template.timeline.onDestroyed(function() {
  // Clean up scroll event listener
  if (this.throttledScrollHandler) {
    $(window).off('scroll.timeline', this.throttledScrollHandler);
  }
});

Template.timeline.helpers({
  posts() {
    return Template.instance().posts.get();
  },
  isAd(post) {
    return post.ad === true;
  },
  isLoading() {
    return Template.instance().isLoading.get();
  },
  hasMore() {
    return Template.instance().hasMore.get();
  },
  province() {
    return FlowRouter.getParam('province');
  },
  chamber() {
    return FlowRouter.getParam('chamber');
  },
  isViewingChamber() {
    let province = FlowRouter.getParam('province');
    let chamber = FlowRouter.getParam('chamber');

    if (province && chamber) {
      return true;
    }
    return false;

  },
  thisChamber() {
    return thisChamber.get();
  },
  postType(type) {
    const post = this;
    if (type === 'self' && post.chamber === "self") {
      return true;
    } else if (type === 'chamber' && post.chamber) {
      return true;
    } else if (type === 'topic' && !post.chamber) {
      return true;
    }
    return false;
  },

  linkAttachment() {
    const post = this;
    if (post && post.attachments && post.attachments.type === 'link') {
      return post.attachments;
    }
    return null;
  },

  currentChamber() {
    return userManager.currentChamber.get();
  }
});

Template.timeline.events({
  'click .post-img'(event, instance) {
    event.preventDefault();
    const postUrl = event.currentTarget.dataset.postUrl;
    if (postUrl) {
      FlowRouter.go(postUrl);
    }
  }
});
