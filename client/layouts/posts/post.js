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
        console.log('Post data received:', response.data);
        console.log('Post images:', response.data.images);
        this.post.set(response.data);
      }
    });
  });

});

Template.post.onRendered(function() {
  // Add gallery event listeners when template is rendered
  this.addGalleryEventListeners = () => {
    // Remove existing listeners to avoid duplicates
    if (this.removeGalleryEventListeners) {
      this.removeGalleryEventListeners();
    }

    // Note: Gallery event listeners are now attached when gallery opens
    // This ensures elements exist before attaching listeners
  };

  this.removeGalleryEventListeners = () => {
    // Clean up will be handled when gallery closes
  };

  // Add listeners when template is rendered
  this.addGalleryEventListeners();
});

Template.post.onDestroyed(function() {
  // Clean up event listeners when template is destroyed
  if (this.removeGalleryEventListeners) {
    this.removeGalleryEventListeners();
  }
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
  },

  linkAttachment() {
    const post = Template.instance().post.get();
    if (post && post.attachments && post.attachments.type === 'link') {
      return post.attachments;
    }
    return null;
  },

  isAuthor(post) {
    const currentUserId = Meteor.userId();
    return currentUserId && post.authorId === currentUserId;
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
  },

  'click .post-img'(event, instance) {
    event.preventDefault();
    const imageUrl = event.currentTarget.dataset.imageUrl;
    const post = instance.post.get();

    if (imageUrl && post && post.images) {
      // Find the index of the clicked image
      const clickedIndex = post.images.findIndex(img => img.url === imageUrl);

      if (clickedIndex !== -1) {
        openImageGallery(post.images, clickedIndex);
      }
    }
  },

  'click .image-modal .close-btn'(event, instance) {
    event.preventDefault();
    const modal = document.getElementById('imageModal');
    if (modal) {
      modal.classList.remove('active');
      console.log('Closing modal');
    }
  },

  'click .image-modal'(event, instance) {
    // Close modal when clicking on the background (not the image)
    if (event.target.id === 'imageModal') {
      const modal = document.getElementById('imageModal');
      if (modal) {
        modal.classList.remove('active');
        console.log('Closing modal (background click)');
      }
    }
  },

  'keydown'(event, instance) {
    // Close modal with ESC key
    if (event.key === 'Escape') {
      const modal = document.getElementById('imageModal');
      if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
        console.log('Closing modal (ESC key)');
      }
    }
  },

  'click .edit-post-btn'(event, instance) {
    event.preventDefault();
    const postId = event.currentTarget.dataset.postId;
    const post = instance.post.get();

    if (!post || post._id !== postId) return;
    // Redirect to unified submit/edit page with query param
    if (window.FlowRouter) {
      window.FlowRouter.go('/submit?id=' + postId);
    }
  },

  'click .delete-post-btn'(event, instance) {
    event.preventDefault();
    const postId = event.currentTarget.dataset.postId;
    const post = instance.post.get();

    if (!post || post._id !== postId) return;

    // Show confirmation dialog
    if (confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
      Meteor.call('posts.delete', postId, (error, result) => {
        if (error) {
          console.error('Error deleting post:', error);
          if (window.toastr) window.toastr.error('Failed to delete post.', 'Error');
        } else {
          if (window.toastr) window.toastr.success('Post deleted.', 'Success');
          // Redirect to home
          if (window.FlowRouter) window.FlowRouter.go('/');
        }
      });
    }
  },

  'click #saveEditPostBtn'(event, instance) {
    event.preventDefault();
    const form = document.getElementById('editPostForm');
    const postId = form ? form.dataset.postId : null;
    const titleInput = document.getElementById('editPostTitle');
    const bodyInput = document.getElementById('editPostBody');

    const title = titleInput ? titleInput.value.trim() : '';
    const body = bodyInput ? bodyInput.value.trim() : '';

    if (!body) {
      if (window.toastr) window.toastr.error('Post content cannot be empty.', 'Validation Error');
      return;
    }

    // Disable button during save
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = 'Saving...';

    Meteor.call('posts.update', postId, {
      title: title || null,
      body: body
    }, (error, result) => {
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = 'Save Changes';

      if (error) {
        console.error('Error updating post:', error);
        if (window.toastr) window.toastr.error('Failed to update post.', 'Error');
      } else {
        if (window.toastr) window.toastr.success('Post updated successfully.', 'Success');

        // Close modal
        const modalElement = document.getElementById('editPostModal');
        if (modalElement && window.bootstrap) {
          const modal = window.bootstrap.Modal.getInstance(modalElement);
          if (modal) modal.hide();
        }

        // Refresh the post data
        if (window.FlowRouter && instance && instance.post) {
          // If title was updated, the SEO URL might have changed, so redirect
          const currentPost = instance.post.get();
          const newSeoUrl = result && result.seoUrl ? result.seoUrl : currentPost.seoUrl;
          if (newSeoUrl !== currentPost.seoUrl) {
            window.FlowRouter.go('/post/' + newSeoUrl);
          } else {
            // Just refresh the data
            const seoUrl = window.FlowRouter.getParam('seo_url');
            if (window.HTTP && window.Meteor && window.Meteor.settings) {
              window.HTTP.get(window.Meteor.settings.public.ROOT_URL + `/api/post?seo_url=${seoUrl}`, (error, response) => {
                if (!error && response.data && instance.post) {
                  instance.post.set(response.data);
                }
              });
            }
          }
        }
      }
    });
  }
});

// Global gallery state
let currentGalleryImages = [];
let currentGalleryIndex = 0;

// Enhanced Image Gallery Functions
function openImageGallery(images, startIndex = 0) {
  currentGalleryImages = images;
  currentGalleryIndex = startIndex;

  const modal = document.getElementById('imageGalleryModal');
  const mainImage = document.getElementById('galleryMainImage');
  const counter = document.getElementById('galleryCounter');
  const currentNumber = document.getElementById('currentImageNumber');
  const totalImages = document.getElementById('totalImages');
  const thumbnailsContainer = document.getElementById('thumbnailsContainer');
  const prevBtn = document.getElementById('galleryPrevBtn');
  const nextBtn = document.getElementById('galleryNextBtn');
  const loading = document.getElementById('galleryLoading');

  if (!modal || !mainImage) return;

  // Show loading state
  loading.style.display = 'flex';
  mainImage.style.opacity = '0';

  // Update counter
  currentNumber.textContent = (startIndex + 1).toString();
  totalImages.textContent = images.length.toString();

  // Show/hide navigation buttons
  if (images.length <= 1) {
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
  } else {
    if (prevBtn) prevBtn.style.display = 'block';
    if (nextBtn) nextBtn.style.display = 'block';
  }

  // Generate thumbnails
  thumbnailsContainer.innerHTML = '';
  images.forEach((image, index) => {
    const thumbnail = document.createElement('div');
    thumbnail.className = `gallery-thumbnail ${index === startIndex ? 'active' : ''}`;
    thumbnail.innerHTML = `<img src="${image.url}" alt="Thumbnail ${index + 1}">`;
    thumbnail.addEventListener('click', () => showGalleryImage(index));
    thumbnailsContainer.appendChild(thumbnail);
  });

  // Load initial image
  showGalleryImage(startIndex);

  // Show modal
  modal.classList.add('active');
  document.body.style.overflow = 'hidden'; // Prevent background scrolling

  // Attach event listeners after modal is shown and elements exist
  attachGalleryEventListeners();
}

function attachGalleryEventListeners() {
  // Clean up any existing listeners first
  removeGalleryEventListeners();

  const closeBtn = document.getElementById('galleryCloseBtn');
  const modal = document.getElementById('imageGalleryModal');
  const prevBtn = document.getElementById('galleryPrevBtn');
  const nextBtn = document.getElementById('galleryNextBtn');

  // Close button event
  if (closeBtn) {
    closeBtn.addEventListener('click', closeImageGallery);
  }

  // Modal background click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeImageGallery();
      }
    });
  }

  // Navigation buttons
  if (prevBtn) {
    prevBtn.addEventListener('click', () => navigateGallery(-1));
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => navigateGallery(1));
  }

  // Keyboard navigation
  document.addEventListener('keydown', handleGalleryKeydown);

  // Touch/swipe support
  if (modal) {
    modal.addEventListener('touchstart', handleGalleryTouchStart);
    modal.addEventListener('touchend', handleGalleryTouchEnd);
  }
}

function removeGalleryEventListeners() {
  const closeBtn = document.getElementById('galleryCloseBtn');
  const modal = document.getElementById('imageGalleryModal');
  const prevBtn = document.getElementById('galleryPrevBtn');
  const nextBtn = document.getElementById('galleryNextBtn');

  if (closeBtn) {
    closeBtn.removeEventListener('click', closeImageGallery);
  }

  if (modal) {
    modal.removeEventListener('click', (e) => {
      if (e.target === modal) {
        closeImageGallery();
      }
    });
    modal.removeEventListener('touchstart', handleGalleryTouchStart);
    modal.removeEventListener('touchend', handleGalleryTouchEnd);
  }

  if (prevBtn) {
    prevBtn.removeEventListener('click', () => navigateGallery(-1));
  }

  if (nextBtn) {
    nextBtn.removeEventListener('click', () => navigateGallery(1));
  }

  document.removeEventListener('keydown', handleGalleryKeydown);
}

// Global variables for touch handling
let touchStartX = 0;
let touchEndX = 0;

function handleGalleryKeydown(e) {
  const galleryModal = document.getElementById('imageGalleryModal');
  if (!galleryModal || !galleryModal.classList.contains('active')) return;

  switch (e.key) {
    case 'Escape':
      closeImageGallery();
      break;
    case 'ArrowLeft':
      navigateGallery(-1);
      break;
    case 'ArrowRight':
      navigateGallery(1);
      break;
  }
}

function handleGalleryTouchStart(e) {
  touchStartX = e.changedTouches[0].screenX;
}

function handleGalleryTouchEnd(e) {
  touchEndX = e.changedTouches[0].screenX;
  const diff = touchStartX - touchEndX;

  if (Math.abs(diff) > 50) {
    if (diff > 0) {
      navigateGallery(1); // Swipe left - next image
    } else {
      navigateGallery(-1); // Swipe right - previous image
    }
  }
}

function showGalleryImage(index) {
  const mainImage = document.getElementById('galleryMainImage');
  const loading = document.getElementById('galleryLoading');
  const thumbnails = document.querySelectorAll('.gallery-thumbnail');
  const currentNumber = document.getElementById('currentImageNumber');

  if (!mainImage || !currentGalleryImages[index]) return;

  currentGalleryIndex = index;

  // Update active thumbnail
  thumbnails.forEach((thumb, i) => {
    thumb.classList.toggle('active', i === index);
  });

  // Update counter
  currentNumber.textContent = (index + 1).toString();

  // Show loading
  loading.style.display = 'flex';
  mainImage.style.opacity = '0';

  // Load new image
  const imgElement = mainImage;
  imgElement.src = currentGalleryImages[index].url;

  imgElement.onload = () => {
    loading.style.display = 'none';
    imgElement.style.opacity = '1';
  };

  imgElement.onerror = () => {
    loading.style.display = 'none';
    imgElement.style.opacity = '1';
    console.error('Failed to load gallery image:', currentGalleryImages[index].url);
  };
}

function navigateGallery(direction) {
  if (currentGalleryImages.length <= 1) return;

  let newIndex = currentGalleryIndex + direction;

  if (newIndex < 0) {
    newIndex = currentGalleryImages.length - 1;
  } else if (newIndex >= currentGalleryImages.length) {
    newIndex = 0;
  }

  showGalleryImage(newIndex);
}

function closeImageGallery() {
  const modal = document.getElementById('imageGalleryModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = ''; // Restore scrolling
    currentGalleryImages = [];
    currentGalleryIndex = 0;

    // Remove event listeners when gallery closes
    removeGalleryEventListeners();
  }
}


