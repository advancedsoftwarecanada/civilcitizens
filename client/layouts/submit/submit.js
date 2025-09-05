
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
    const postTitle = $('#postTitle').length ? ($('#postTitle').val() || '').trim() : null;
    const postBody = $('#summernote').summernote('code').trim(); // Get HTML from Summernote
    const postChamber = $('#postChamber').val();

    let postJson = {
      type: postTypeVar.get(),
      title: postTitle,
      body: postBody,
      chamber: chamberVar.get(),
      province: provinceVar.get(),
      topic: topicVar.get(),
    };

    // Check for attachments
    const visibleAttachment = $('.attachment-area:visible');
    let hasAttachment = false;

    if (visibleAttachment.length > 0) {
      const attachmentId = visibleAttachment.attr('id');
      if (attachmentId === 'imageAttachment') {
        const files = $('#postImages')[0].files;
        if (files.length > 0) {
          hasAttachment = true;
          postJson.attachments = { type: 'images', files: files };
        }
      } else if (attachmentId === 'videoAttachment') {
        const file = $('#postVideo')[0].files[0];
        if (file) {
          hasAttachment = true;
          postJson.attachments = { type: 'video', file: file };
        }
      } else if (attachmentId === 'linkAttachment') {
        const url = $('#postLink').val().trim();
        if (url) {
          hasAttachment = true;
          postJson.attachments = { type: 'link', url: url };
        }
      } else if (attachmentId === 'pollAttachment') {
        const options = $('.poll-option').map(function() { return $(this).val().trim(); }).get().filter(val => val);
        const duration = $('#pollDuration').val();
        const allowMulti = $('#allowMulti').is(':checked');
        if (options.length >= 2) {
          hasAttachment = true;
          postJson.attachments = { type: 'poll', options: options, duration: duration, allowMulti: allowMulti };
        }
      }
    }

    // Validate inputs
    if (!postBody && !hasAttachment) {
      toastr.error('Please enter a body or add an attachment.', 'Validation Error');
      return;
    }

    // Handle file uploads if any
    if (postJson.attachments && (postJson.attachments.type === 'images' || postJson.attachments.type === 'video')) {
      const files = postJson.attachments.type === 'images' ? postJson.attachments.files : [postJson.attachments.file];
      const uploadPromises = [];

      for (let file of files) {
        const upload = Files.insert({
          file: file,
          chunkSize: 'dynamic',
          meta: {
            processing: true,
            type: postJson.attachments.type === 'images' ? 'postImage' : 'postVideo',
            timeCreated: Date.now(),
            timeAgo: new Date().toISOString(),
          },
        }, false);

        uploadPromises.push(new Promise((resolve, reject) => {
          upload.on('end', function (error, clientFile) {
            if (error) {
              reject(error);
            } else {
              resolve(clientFile._id);
            }
          });
          upload.start();
        }));
      }

      Promise.all(uploadPromises).then(fileIds => {
        if (postJson.attachments.type === 'images') {
          postJson.attachments.fileIds = fileIds;
        } else {
          postJson.attachments.fileId = fileIds[0];
        }
        delete postJson.attachments.files;
        delete postJson.attachments.file;

        submitPost(postJson);
      }).catch(error => {
        toastr.error('Error uploading files: ' + error.message, 'Upload Error');
      });
    } else {
      submitPost(postJson);
    }

    function submitPost(json) {
      console.log("SUBMITTING POST JSON:");
      console.log(json);
      Meteor.call('posts.submit', json, (error, result) => {
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
