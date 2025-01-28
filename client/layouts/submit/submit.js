
const postTypeVar = new ReactiveVar(null);
const provinceVar = new ReactiveVar(null);
const chamberVar = new ReactiveVar(null);

const topicVar = new ReactiveVar(null);

FlowRouter.route('/submit', {
  name: "submit",
  action() {
        const checkUserDataReady = setInterval(() => {
          if (window.userDataReady) {
              clearInterval(checkUserDataReady);
              BlazeLayout.render('CivilApp_3', {
                  main: 'submit',
              });
          }
      }, 100);
      postTypeVar.set("self");
      provinceVar.set("");
      chamberVar.set("");
  }
});

FlowRouter.route('/submit/c/:province/:chamber', {
  name: "submit",
  action(params) {
    const checkUserDataReady = setInterval(() => {
      if (window.userDataReady) {
          clearInterval(checkUserDataReady);
          BlazeLayout.render('CivilApp_3', {
              main: 'submit',
          });
      }
  }, 100);
      postTypeVar.set("chamber");
      provinceVar.set(params.province);
      chamberVar.set(params.chamber);
  }
});

FlowRouter.route('/submit/t/:topic', {
  name: "submit",
  action(params) {
    const checkUserDataReady = setInterval(() => {
      if (window.userDataReady) {
          clearInterval(checkUserDataReady);
          BlazeLayout.render('CivilApp_3', {
              main: 'submit',
          });
      }
  }, 100);
      postTypeVar.set("topic");
      provinceVar.set("");
      chamberVar.set("");
  }
});



Template.submit.onRendered(function() {
  this.autorun(() => {
    const province = provinceVar.get();
    const chamber = chamberVar.get();
    if (province && chamber) {
      $('#postChamber').append(`<option value="${province}/${chamber}">${province}/${chamber}</option>`);
      $('#postChamber').val(`${province}/${chamber}`);
    } else {
      $('#postChamber').val('self');
    }
  });
});

Template.submit.events({
  'click #savePost'(event) {
    event.preventDefault();

    // Get form values
    const postTitle = $('#postTitle').val().trim();
    const postBody = $('#summernote').summernote('code').trim(); // Get HTML from Summernote
    const postChamber = $('#postpostChamber').val();
    const fileInput = $('#postImage')[0];
    const file = fileInput.files[0];


    let postJson = {
      type: postTypeVar.get(),
      title: postTitle,
      body: postBody,

      chamber: chamberVar.get(),
      province: provinceVar.get(),

      topic: topicVar.get(),

    };

    // Validate inputs
    if (!postTitle || !postBody) {
      toastr.error('Title and Text are required.', 'Validation Error');
      return;
    }

    // Handle optional file upload
    if (file) {
      const upload = Files.insert({
        file: file,
        chunkSize: 'dynamic',
        meta: {
          processing: true,
          type: 'postImage',
          timeCreated: Date.now(),
          timeAgo: new Date().toISOString(),
        },
      }, false);

      upload.on('end', function (error, clientFile) {
        if (error) {
          toastr.error('Error uploading image: ' + error.message, 'Upload Error');
        } else {
          const fileId = clientFile._id;

          // log inputs
          console.log('postTitle:', postTitle);
          console.log('postBody:', postBody);
          console.log('postChamber:', postChamber);
          console.log('postType:', postTypeVar.get());
          console.log('file:', file);

          Meteor.call('files.fetchMeta', fileId, (err, result) => {
            if (err) {
              console.error('Error fetching file metadata:', err);
            } else {
              const postImageUrl = result.data.url;
              postJson.image = fileId;

              // Call the method once image upload is complete
              Meteor.call('posts.submit', postJson, (error, result) => {
                if (error) {
                  toastr.error(error.reason || 'Error submitting the post.', 'Submit Error');
                } else {
                  toastr.success(result.message, 'Success');
                  FlowRouter.go('/'); // Redirect to home or another page after submission
                }
              });
            }
          });
        }
      });

      upload.start();
    } else {

      // // log inputs
      // console.log('postType:', postTypeVar.get());
      // console.log('postTitle:', postTitle);
      // console.log('postBody:', postBody);
      // console.log('postChamber:', postChamber);
      // console.log("NO IMAGE");

      // Call the method directly if no file upload is required
      console.log("SUBMITTING POST JSON:");
      console.log(postJson);
      Meteor.call('posts.submit', postJson, (error, result) => {
        if (error) {
          toastr.error(error.reason || 'Error submitting the post.', 'Submit Error');
        } else {
          toastr.success(result.message, 'Success');
          FlowRouter.go('/'); // Redirect to home or another page after submission
        }
      });
    }
  }
});
