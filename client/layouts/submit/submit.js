const provinceVar = new ReactiveVar(null);
const chamberVar = new ReactiveVar(null);
const postTypeVar = new ReactiveVar(null);

FlowRouter.route('/submit', {
  name: "submit",
  action() {
      BlazeLayout.render('CivilApp_3', {
          main: 'submit',
      });
      provinceVar.set("");
      chamberVar.set("");
      postType.set("self_post");
  }
});

FlowRouter.route('/submit/c/:province/:chamber', {
  name: "submit",
  action(params) {
      BlazeLayout.render('CivilApp_3', {
          main: 'submit',
      });
      provinceVar.set(params.province);
      chamberVar.set(params.chamber);
      postTypeVar.set("chamber");
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
      $('#postChamber').val('self_post');
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
      postTitle,
      postBody,
      postChamber,
      postType: postTypeVar.get()
    };

    // Validate inputs
    if (!postTitle || !postBody) {
      toastr.error('Title and postBody are required.', 'Validation Error');
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
      // log inputs
      console.log("NO IMAGE");
      console.log('postTitle:', postTitle);
      console.log('postBody:', postBody);
      console.log('postChamber:', postChamber);
      console.log('postType:', postTypeVar.get());

      // Call the method directly if no file upload is required
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
