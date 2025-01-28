FlowRouter.route('/post/', {
  name: "post",
  action(params) {
    // no url paramter specificed, return to /timeline
    FlowRouter.go('/');
  }
});

FlowRouter.route('/post/:seo_url', {
  name: "post",
  action(params) {
      const checkUserDataReady = setInterval(() => {
        if (window.userDataReady) {
            clearInterval(checkUserDataReady);
            BlazeLayout.render('CivilApp_3', {
                main: 'post',
            });
        }
    }, 100);
    console.log('SEO URL:', params.seo_url);
  }
});


Template.post.onCreated(function () {
  this.post = new ReactiveVar(null);

  this.autorun(() => {
    const seoUrl = FlowRouter.getParam('seo_url');
    HTTP.get(Meteor.settings.public.ROOT_URL+`/api/post?seo_url=${seoUrl}`, (error, response) => {
      if (error) {
        console.error('Error fetching post:', error);
      } else {
        this.post.set(response.data);
        console.log('Post data:', response.data);
      }
    });
  });

});

Template.post.helpers({
  post() {
    return Template.instance().post.get();
  },
  isAd(post) {
    return post.ad === true;
  },
  comments() {
    const post = Template.instance().post.get();
    return post ? post.comments : [];
  },


  posts() {
    return Template.instance().posts.get();
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
  }

});

Template.post.events({
  'submit .comment-form'(event, instance) {
    event.preventDefault();

    const commentInput = event.target.comment;
    const comment = commentInput.value.trim();
    const postId = instance.post.get()?._id;
    const userId = Meteor.userId();
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive

    if (!comment) {
      toastr.error('Comment cannot be empty.', 'Validation Error');
      return;
    }

    HTTP.post(Meteor.settings.public.ROOT_URL + '/api/comments', {
      data: { postId, userId, comment }
    }, (error, response) => {
      if (error) {
        console.error('Error submitting comment:', error);
        toastr.error('Error submitting comment.', 'Submit Error');
      } else {
        toastr.success('Comment submitted successfully.', 'Success');
        commentInput.value = ''; // Clear the input field
        // Add the new comment to the local state
        const post = instance.post.get();
        const newComment = {
          postId,
          userId,
          comment,
          createdAt: new Date(),
          author: {
            userName: userMeta.userName,
            avatarUrl: userMeta.avatarUrl,
          },
        };
        post.comments.unshift(newComment);
        instance.post.set(post);
      }
    });
  }
});
