
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

  // Subscribe to files
  // this.subscribe('files.user');

  // Draft post is already ensured by userManager during initialization
  // Just verify it's available
  const draftId = window.userManager ? window.userManager.getDraftPostId() : Session.get('draftPostId');
  if (draftId) {
    console.log('Draft post ready:', draftId);
  } else {
    console.warn('Draft post not found - userManager may not be initialized yet');
  }
});

let stagedFiles = {
  images: [],
  video: null
};

Template.submit.events({
  'change #postImages'(event) {
    const files = Array.from(event.target.files);
    stagedFiles.images = [];
    $('#imagePreview').empty();

    const postId = window.userManager ? window.userManager.getDraftPostId() : Session.get('draftPostId');
    if (!postId) {
      toastr.error('Draft post not ready yet.');
      return;
    }

    // Upload the files
    files.forEach((file, index) => {
      const upload = Files.insert({
        file: file,
        chunkSize: 'dynamic',
        meta: {
          processing: true,
          type: 'postImage',
          postId: postId,
          timeCreated: Date.now(),
          timeAgo: new Date().toISOString(),
        },
      }, false);

      stagedFiles.images.push(upload);

      const reader = new FileReader();
      reader.onload = function(e) {
        const item = $(`
          <div class="file-item" data-index="${index}">
            <img src="${e.target.result}" class="file-preview">
            <div class="file-info">
              <div class="file-name">${file.name}</div>
              <div class="file-status">Ready to upload</div>
            </div>
            <div class="upload-progress">
              <div class="upload-progress-bar"></div>
            </div>
          </div>
        `);
        $('#imagePreview').append(item);
      };
      reader.readAsDataURL(file);

      upload.on('progress', function (progress) {
        const progressBar = $(`.file-item[data-index="${index}"] .upload-progress-bar`);
        progressBar.css('width', progress + '%');
      });

      upload.on('end', function (error, clientFile) {
        if (error) {
          toastr.error('Error uploading file.');
        } else {
          // File uploaded and post updated on server
          $(`.file-item[data-index="${index}"] .file-status`).text('Uploaded');
          stagedFiles.images[index].fileId = clientFile._id;
        }
      });

      upload.start();
    });
  },

  'change #postVideo'(event) {
    const file = event.target.files[0];
    if (file) {
      const upload = Files.insert({
        file: file,
        chunkSize: 'dynamic',
        meta: {
          processing: true,
          type: 'postVideo',
          timeCreated: Date.now(),
          timeAgo: new Date().toISOString(),
        },
      }, false);

      stagedFiles.video = upload;

      $('#videoAttachment .upload-box').hide();
      const item = $(`
        <div class="file-item">
          <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-status">Ready to upload</div>
          </div>
          <div class="upload-progress">
            <div class="upload-progress-bar"></div>
          </div>
        </div>
      `);
      $('#videoAttachment').append(item);
    }
  },

  'click #savePost'(event) {
    console.log('POST button clicked - event handler fired');
    event.preventDefault();

    // Get form values
    const postTitle = $('#postTitle').length ? ($('#postTitle').val() || '').trim() : null;
    const summernoteContent = $('#summernote').summernote('code');
    const postBody = summernoteContent ? summernoteContent.trim() : '';
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
        if (stagedFiles.images.length > 0) {
          hasAttachment = true;
          postJson.attachments = { type: 'images', uploads: stagedFiles.images };
        }
      } else if (attachmentId === 'videoAttachment') {
        if (stagedFiles.video) {
          hasAttachment = true;
          postJson.attachments = { type: 'video', upload: stagedFiles.video };
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
      const uploads = postJson.attachments.type === 'images' ? postJson.attachments.uploads : [postJson.attachments.upload];
      const uploadPromises = [];

      for (let i = 0; i < uploads.length; i++) {
        const upload = uploads[i];

        uploadPromises.push(new Promise((resolve, reject) => {
          if (upload.fileId) {
            // Already uploaded, get the file ID
            resolve(upload.fileId);
          } else if (upload.state && upload.state.get() === 'completed') {
            // Upload completed but no fileId set yet, wait for it
            upload.on('end', function (error, clientFile) {
              if (error) {
                reject(error);
              } else {
                resolve(clientFile._id);
              }
            });
          } else {
            // Not yet uploaded, wait for end
            upload.on('end', function (error, clientFile) {
              if (error) {
                reject(error);
              } else {
                resolve(clientFile._id);
              }
            });
            // Do not start again, assume already started
          }
        }));
      }

      Promise.all(uploadPromises).then(fileIds => {
        if (postJson.attachments.type === 'images') {
          postJson.attachments.fileIds = fileIds;
        } else {
          postJson.attachments.fileId = fileIds[0];
        }
        delete postJson.attachments.uploads;
        delete postJson.attachments.upload;

        submitPost(postJson);
      }).catch(error => {
        toastr.error('Error uploading files: ' + error.message, 'Upload Error');
      });
    } else {
      submitPost(postJson);
    }

    function submitPost(json) {
      const postId = window.userManager ? window.userManager.getDraftPostId() : Session.get('draftPostId');
      if (postId) {
        // Use API call instead of Meteor.call
        const token = localStorage.getItem('Meteor.loginToken');
        fetch('/api/posts/update', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            postId: postId,
            title: json.title,
            body: json.body,
            draft: false
          }),
        })
        .then(response => response.json())
        .then(result => {
          if (result.status === 'success') {
            toastr.success(result.message, 'Success');
            if (window.userManager) {
              window.userManager.clearDraftPost();
            } else {
              Session.set('draftPostId', null);
            }
            FlowRouter.go('/'); // Redirect to home or another page after submission
          } else {
            toastr.error(result.error || 'Error updating the post.', 'Submit Error');
          }
        })
        .catch(error => {
          toastr.error('Error updating the post.', 'Submit Error');
        });
      } else {
        // Use API call instead of Meteor.call
        const token = localStorage.getItem('Meteor.loginToken');
        fetch('/api/posts/submit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(json),
        })
        .then(response => response.json())
        .then(result => {
          if (result.status === 'success') {
            toastr.success(result.message, 'Success');
            FlowRouter.go('/'); // Redirect to home or another page after submission
          } else {
            toastr.error(result.error || 'Error submitting the post.', 'Submit Error');
          }
        })
        .catch(error => {
          toastr.error('Error submitting the post.', 'Submit Error');
        });
      }
    }
  }
});
