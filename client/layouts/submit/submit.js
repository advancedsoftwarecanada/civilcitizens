
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

    // Upload the files via API
    files.forEach((file, index) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'postImage');
      formData.append('postId', postId);
      formData.append('timeCreated', Date.now().toString());
      formData.append('timeAgo', new Date().toISOString());

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload', true);
      xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('Meteor.loginToken')}`);

      // Progress handler
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          const progressBar = $(`.file-item[data-index="${index}"] .upload-progress-bar`);
          progressBar.css('width', percentComplete + '%');
        }
      };

      // Load handler (success)
      xhr.onload = function() {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          if (response.status === 'success') {
            $(`.file-item[data-index="${index}"] .file-status`).text('Uploaded');
            stagedFiles.images[index].fileId = response.fileId;
          } else {
            toastr.error('Error uploading file: ' + response.error);
          }
        } else {
          toastr.error('Error uploading file.');
        }
      };

      // Error handler
      xhr.onerror = function() {
        toastr.error('Error uploading file.');
      };

      xhr.send(formData);

      stagedFiles.images.push({ xhr: xhr, fileId: null }); // Store xhr for potential cancellation

      const reader = new FileReader();
      reader.onload = function(e) {
        const item = $(`
          <div class="file-item" data-index="${index}">
            <img src="${e.target.result}" class="file-preview">
            <div class="file-info">
              <div class="file-name">${file.name}</div>
              <div class="file-status">Uploading...</div>
            </div>
            <div class="upload-progress">
              <div class="upload-progress-bar"></div>
            </div>
          </div>
        `);
        $('#imagePreview').append(item);
      };
      reader.readAsDataURL(file);
    });
  },

  'change #postVideo'(event) {
    const file = event.target.files[0];
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'postVideo');
      formData.append('postId', postId);
      formData.append('timeCreated', Date.now().toString());
      formData.append('timeAgo', new Date().toISOString());

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/files/upload', true);
      xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('Meteor.loginToken')}`);

      // Progress handler
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          const progressBar = $('#videoAttachment .upload-progress-bar');
          progressBar.css('width', percentComplete + '%');
        }
      };

      // Load handler (success)
      xhr.onload = function() {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          if (response.status === 'success') {
            $('#videoAttachment .file-status').text('Uploaded');
            stagedFiles.video = { fileId: response.fileId };
          } else {
            toastr.error('Error uploading video: ' + response.error);
          }
        } else {
          toastr.error('Error uploading video.');
        }
      };

      // Error handler
      xhr.onerror = function() {
        toastr.error('Error uploading video.');
      };

      xhr.send(formData);

      stagedFiles.video = { xhr: xhr, fileId: null };

      $('#videoAttachment .upload-box').hide();
      const item = $(`
        <div class="file-item">
          <div class="file-info">
            <div class="file-name">${file.name}</div>
            <div class="file-status">Uploading...</div>
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
            // Already uploaded
            resolve(upload.fileId);
          } else if (upload.xhr && upload.xhr.readyState === 4) {
            // Upload completed
            if (upload.xhr.status === 200) {
              const response = JSON.parse(upload.xhr.responseText);
              resolve(response.fileId);
            } else {
              reject(new Error('Upload failed'));
            }
          } else {
            // Wait for upload to complete
            upload.xhr.onload = function() {
              if (upload.xhr.status === 200) {
                const response = JSON.parse(upload.xhr.responseText);
                resolve(response.fileId);
              } else {
                reject(new Error('Upload failed'));
              }
            };
            upload.xhr.onerror = function() {
              reject(new Error('Upload failed'));
            };
          }
        }));
      }

      Promise.all(uploadPromises).then(fileIds => {
        // Files are already uploaded and associated with post on server
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
          body: JSON.stringify({
            type: json.type,
            title: json.title,
            body: json.body,
            chamber: json.chamber,
            province: json.province,
            topic: json.topic
          }),
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
