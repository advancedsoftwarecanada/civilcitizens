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

  this.autorun(() => {
    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');
    const path = FlowRouter.current().path;
    const apiUrl = `${Meteor.settings.public.ROOT_URL}/api/timeline?path=${path}&province=${province}&chamber=${chamber}`;

    HTTP.get(apiUrl, (error, response) => {
      if (error) {
        console.error('Error fetching timeline posts:', error);
      } else {
        this.posts.set(response.data);
        console.log('Timeline posts:', response.data);
        $('html, body').animate({
          scrollTop: 0
        }, 0);

      }
    });

  });

});

// TODO: we want to limit the height of posts on the timeline, and show a "Read More" button if the post is too long
Template.timeline.onRendered(function () {

  console.log("TIMELINE RENDERED");

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
  currentChamber() {
    return userManager.currentChamber.get();
  }
});

Template.timeline.events({
});
