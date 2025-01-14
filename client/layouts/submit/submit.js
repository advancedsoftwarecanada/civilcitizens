FlowRouter.route('/submit', {
    name: "submit",
    action() {
        BlazeLayout.render('CivilApp_3', {
            main: 'submit',
        });
    }
});

Template.submit.events({
    'click #savePost'(event) {
      event.preventDefault();

      // Get form values
      const title = $('#postTitle').val().trim();
      const body = $('#summernote').summernote('code').trim(); // Get HTML from Summernote
      const chamber = $('#postChamber').val();
      const fileInput = $('#postImage')[0];
      const file = fileInput.files[0];

      // Validate inputs
      if (!title || !body) {
        toastr.error('Title and body are required.', 'Validation Error');
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
            Meteor.call('files.fetchMeta', fileId, (err, result) => {
              if (err) {
                console.error('Error fetching file metadata:', err);
                toastr.error('Error retrieving file details.');
              } else {
                const imageUrl = result.data.url;
                // Call the method once image upload is complete
                Meteor.call('posts.submit', { title, body, chamber, image: imageUrl }, (error, result) => {
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
        // Call the method directly if no file upload is required
        Meteor.call('posts.submit', { title, body, chamber }, (error, result) => {
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
