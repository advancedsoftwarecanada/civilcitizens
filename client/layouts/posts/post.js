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
    BlazeLayout.render('CivilApp_3', {
      main: 'post',
    });
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
  }
});
