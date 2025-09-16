// @ts-nocheck
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
      console.log('🔧 SUBMIT CHAMBER ROUTE - Setting reactive vars:', {
        type: "chamber",
        province: params.province,
        chamber: params.chamber
      });
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
  // Default jurisdiction should be citizen (even when posting in a chamber)
  $('#postJurisdiction').val('citizen');
    } else {
      $('#postChamber').val('self');
  // Default jurisdiction for self/topic is citizen
  $('#postJurisdiction').val('citizen');
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
  images: []
};

console.log("stagedFiles initialized:", stagedFiles);

// Function to get link preview data from the HTML template
function getLinkPreviewData() {
  // Access the linkPreviewData variable from the HTML template's JavaScript
  if (typeof window.linkPreviewData !== 'undefined') {
    return window.linkPreviewData;
  }
  return null;
}

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

    // Upload the files via API using Fetch instead of XMLHttpRequest
    files.forEach((file, index) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'postImage');
      formData.append('postId', postId);
      formData.append('timeCreated', Date.now().toString());
      formData.append('timeAgo', new Date().toISOString());

      // Use Fetch API instead of XMLHttpRequest to avoid Meteor connection issues
      const token = localStorage.getItem('Meteor.loginToken');
      console.log("Submit image upload starting - token exists:", !!token, "user logged in:", !!Meteor.userId());
      fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      })
      .then(response => {
        console.log("UPLOAD END - Submit form image upload, response status:", response.status);
        console.log("User still logged in after submit image upload:", !!Meteor.userId());
        if (response.ok) {
          return response.json();
        } else {
          throw new Error('Upload failed');
        }
      })
      .then(result => {
        console.log("Upload response:", result);
        if (result.status === 'success') {
          $(`.file-item[data-index="${index}"] .file-status`).text('Uploaded');
          stagedFiles.images[index].fileId = result.fileId;
          console.log("stagedFiles updated after image upload:", stagedFiles);
          console.log("Image upload completed successfully, fileId:", result.fileId);
        } else {
          toastr.error('Error uploading file: ' + result.error);
        }
      })
      .catch(error => {
        console.error('Upload error:', error);
        toastr.error('Error uploading file.');
      });

      stagedFiles.images.push({ fileId: null }); // Store for tracking

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

  'click #savePost'(event) {
    console.log('POST button clicked - event handler fired');
    console.log('Event details:', event);
    event.preventDefault();

    // Get form values
    const postTitle = $('#postTitle').length ? ($('#postTitle').val() || '').trim() : null;
    const summernoteContent = $('#summernote').summernote('code');
    const postBody = summernoteContent ? summernoteContent.trim() : '';

    // Client-side limits
    const TITLE_MAX = 300;
    const BODY_MAX = 40000; // count plaintext characters
    if (postTitle && postTitle.length > TITLE_MAX) {
      toastr.error('Title is too long. Max 300 characters.');
      return;
    }
    const plainBody = $('<div>').html(postBody).text();
    if (plainBody.length > BODY_MAX) {
      toastr.error('Post body is too long. Max 40,000 characters.');
      return;
    }
    const postChamber = $('#postChamber').val();

    // Determine post type and context from dropdown selection
    let postType, province, chamber, topic;
    if (postChamber === 'self') {
      postType = 'self';
      province = '';
      chamber = '';
      topic = '';
    } else if (postChamber.includes('/')) {
      // Chamber post: format is "province/chamber"
      const parts = postChamber.split('/');
      if (parts.length === 2) {
        postType = 'chamber';
        province = parts[0];
        chamber = parts[1];
        topic = '';
      } else {
        // Fallback to reactive vars if parsing fails
        postType = postTypeVar.get();
        province = provinceVar.get();
        chamber = chamberVar.get();
        topic = topicVar.get();
      }
    } else {
      // Topic post
      postType = 'topic';
      province = '';
      chamber = '';
      topic = postChamber;
    }

    // Jurisdiction dropdown and NSFW flag
    const jurisdiction = ($('#postJurisdiction').val() || 'citizen').toLowerCase();
    const nsfw = $('#postNsfw').is(':checked') === true;

    let postJson = {
      type: postType,
      title: postTitle,
      body: postBody,
      chamber: chamber,
      province: province,
      topic: topic,
      jurisdiction: jurisdiction,
      nsfw: nsfw,
    };

    console.log('📤 SUBMIT POST - Post JSON being sent:', postJson);
    console.log('📤 SUBMIT POST - Dropdown value:', postChamber);

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
      } else if (attachmentId === 'linkAttachment') {
        const url = $('#postLink').val().trim();
        if (url) {
          hasAttachment = true;
          // Get link preview data from the HTML template's JavaScript
          const linkPreviewData = getLinkPreviewData();
          postJson.attachments = {
            type: 'link',
            url: url,
            preview: linkPreviewData
          };
        }
      }
    }

    // Validate inputs
  if (!postBody && !hasAttachment) {
      toastr.error('Please enter a body or add an attachment.', 'Validation Error');
      return;
    }

    // For file uploads, check if images are still uploading
    if (postJson.attachments && postJson.attachments.type === 'images') {
      const uploads = postJson.attachments.uploads || [];
      const hasIncompleteUploads = uploads.some(upload => !upload.fileId);
      if (hasIncompleteUploads) {
        toastr.warning('Please wait for image uploads to complete before submitting.', 'Upload In Progress');
        return;
      }
    }

    // Submit the post immediately - files are already uploaded and associated
    submitPost(postJson);

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
            title: postJson.title,
            body: postJson.body,
            attachments: postJson.attachments,
            type: postJson.type,
            chamber: postJson.chamber,
            province: postJson.province,
            topic: postJson.topic,
      jurisdiction: postJson.jurisdiction,
      nsfw: postJson.nsfw,
            draft: false
          }),
        })
        .then(response => response.json())
        .then(result => {
          if (result.status === 'success') {
            toastr.success(result.message, 'Success');
            // Clear current draft and prepare next one
            if (window.userManager) {
              window.userManager.clearDraftPost();
              // Immediately create a new draft post for the next submission
              window.userManager.ensureDraftPost();
            } else {
              Session.set('draftPostId', null);
            }
            // Redirect to the updated post page using seoUrl if available
            if (result.seoUrl) {
              FlowRouter.go('/post/' + result.seoUrl);
            } else {
              FlowRouter.go('/');
            }
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
            type: postJson.type,
            title: postJson.title,
            body: postJson.body,
            attachments: postJson.attachments,
            chamber: postJson.chamber,
            province: postJson.province,
            topic: postJson.topic,
      jurisdiction: postJson.jurisdiction,
      nsfw: postJson.nsfw,
            draft: false
          }),
        })
        .then(response => response.json())
        .then(result => {
          if (result.status === 'success') {
            toastr.success(result.message, 'Success');
            // Prepare next draft post for future submissions
            if (window.userManager) {
              window.userManager.ensureDraftPost();
            }
            // Redirect to the new post page using seoUrl if available
            if (result.seoUrl) {
              FlowRouter.go('/post/' + result.seoUrl);
            } else if (result.postId) {
              // Fallback: fetch post to get seoUrl then redirect
              HTTP.get(Meteor.settings.public.ROOT_URL + '/api/post', { params: { seo_url: '' } }, () => {
                FlowRouter.go('/');
              });
            } else {
              FlowRouter.go('/');
            }
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
