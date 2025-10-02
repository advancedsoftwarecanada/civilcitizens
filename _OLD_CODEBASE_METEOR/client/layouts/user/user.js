// @ts-nocheck

const targetUserVar = new ReactiveVar(null);

FlowRouter.route('/u/:username', {
  name: 'userTimeline',
  action() {
    const renderNow = () => BlazeLayout.render('CivilApp_3', { main: 'userTimeline' });
    // If logged in and app needs user data, wait briefly; otherwise render immediately
    if (Meteor.userId() && !window.userDataReady) {
      const checkUserDataReady = setInterval(() => {
        if (window.userDataReady) {
          clearInterval(checkUserDataReady);
          renderNow();
        }
      }, 100);
      // Safety timeout: render anyway after 1.5s
      setTimeout(() => { try { clearInterval(checkUserDataReady); } catch(e){} renderNow(); }, 1500);
    } else {
      renderNow();
    }
  },
});

Template.userTimeline.onCreated(function () {
  this.posts = new ReactiveVar([]);
  this.isLoading = new ReactiveVar(false);
  this.hasMore = new ReactiveVar(true);
  this.currentOffset = new ReactiveVar(0);
  this._lastUsername = null; // track last loaded username to avoid loops
  this._followState = new ReactiveVar({ isFollowing: false, loading: false, targetUserId: null });
  this._counts = new ReactiveVar({ followers: 0, following: 0 });

  // Defaults used by UI; keep here for comparison so we can overwrite placeholders
  const DEFAULT_AVATAR_URL = 'https://civilcitizens.ca/theme/assets/images/avatar-1.png';
  const DEFAULT_COVER_URL = '/theme/assets/images/fancy-wallpaper.jpg';

  // Load target user meta by username
  this.autorun(() => {
    const username = FlowRouter.getParam('username');
    if (!username) return;

    // Include Authorization header if we have a stored Meteor login token
    const token = (typeof Accounts !== 'undefined' && Accounts._storedLoginToken && Accounts._storedLoginToken()) || null;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    HTTP.get(
      `/api/user/by-username?username=${encodeURIComponent(username)}`,
      { headers },
      (err, res) => {
      if (err) {
        console.error('Error fetching user by username:', err);
        const current = targetUserVar.get();
        // Don't clobber a good value; only set minimal fallback if nothing set yet
        if (!current) {
          targetUserVar.set({
            userName: username,
            avatarUrl: 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
            coverUrl: '/theme/assets/images/fancy-wallpaper.jpg',
            bio: '',
          });
        }
      } else {
  const data = res && res.data ? res.data : {};
        const current = targetUserVar.get() || {};
        const myMeta = (window && window.userManager && typeof window.userManager.getData === 'function') ? (window.userManager.getData().meta || {}) : {};
        const isSelf = myMeta && myMeta.userName && typeof username === 'string' && (myMeta.userName.toLowerCase() === username.toLowerCase());
        const merged = {
          userName: data.userName || current.userName || username,
          avatarUrl: data.avatarUrl || current.avatarUrl || (isSelf ? (myMeta.avatarUrl || null) : null) || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
          coverUrl: data.coverUrl || current.coverUrl || (isSelf ? (myMeta.coverUrl || null) : null) || '/theme/assets/images/fancy-wallpaper.jpg',
          bio: data.bio || current.bio || (isSelf ? (myMeta.bio || '') : ''),
        };
        targetUserVar.set(merged);
        // Store target userId for follow actions
        const tId = data.userId || null;
        const state = this._followState.get() || {};
        this._followState.set({ ...state, targetUserId: tId });

        // Seed isFollowing from UserManager cache while we also fetch from server
        try {
          const cached = (window && window.userManager && typeof window.userManager.isFollowingUser === 'function')
            ? window.userManager.isFollowingUser({ userId: tId, userName: username }) : false;
          if (cached) {
            const prior = this._followState.get() || {};
            this._followState.set({ ...prior, isFollowing: true });
          }
        } catch(_){}

        // Seed counts immediately from response if present
        const f0 = (typeof data.followersCount === 'number') ? data.followersCount : null;
        const g0 = (typeof data.followingCount === 'number') ? data.followingCount : null;
        if (f0 !== null || g0 !== null) {
          const prev = this._counts.get() || {};
          this._counts.set({ followers: f0 ?? prev.followers ?? 0, following: g0 ?? prev.following ?? 0 });
        }

        // Load isFollowing + counts
        Tracker.nonreactive(() => {
          const token = (typeof Accounts !== 'undefined' && Accounts._storedLoginToken && Accounts._storedLoginToken()) || null;
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          // is-following
          HTTP.get(`/api/user-follows/is-following?username=${encodeURIComponent(username)}`, { headers }, (e1, r1) => {
            const isFollowing = !e1 && r1 && r1.data && r1.data.isFollowing === true;
            const prior = this._followState.get() || {};
            this._followState.set({ ...prior, isFollowing });
            // counts (public)
            HTTP.get(`/api/user-follows/counts?username=${encodeURIComponent(username)}`, {}, (e2, r2) => {
              const followers = (!e2 && r2 && r2.data && typeof r2.data.followers === 'number') ? r2.data.followers : undefined;
              const following = (!e2 && r2 && r2.data && typeof r2.data.following === 'number') ? r2.data.following : undefined;
              const prev = this._counts.get() || {};
              this._counts.set({ followers: followers ?? prev.followers ?? 0, following: following ?? prev.following ?? 0 });
              // Periodic refresh of counts (15s) while on page
              if (!this._countsInterval) {
                this._countsInterval = setInterval(() => {
                  HTTP.get(`/api/user-follows/counts?username=${encodeURIComponent(FlowRouter.getParam('username') || '')}`, {}, (e3, r3) => {
                    const f1 = (!e3 && r3 && r3.data && typeof r3.data.followers === 'number') ? r3.data.followers : undefined;
                    const f2 = (!e3 && r3 && r3.data && typeof r3.data.following === 'number') ? r3.data.following : undefined;
                    const prev2 = this._counts.get() || {};
                    this._counts.set({ followers: f1 ?? prev2.followers ?? 0, following: f2 ?? prev2.following ?? 0 });
                  });
                }, 15000);
              }
            });
          });
        });
      }
    }
    );
  });

  this.loadPosts = (append = false) => {
    // Only block on hasMore when appending; first-page loads should run
    if (this.isLoading.get()) return;
    if (append && !this.hasMore.get()) return;

    this.isLoading.set(true);
  const userId = Meteor.userId() || '';
    const path = FlowRouter.current().path;
    const username = FlowRouter.getParam('username');
    const offset = append ? this.currentOffset.get() : 0;
    const limit = 10;

  const apiUrl = `/api/timeline?uid=${userId}&path=${encodeURIComponent(path)}&username=${encodeURIComponent(username)}&offset=${offset}&limit=${limit}`;

  // Include Authorization header if available (harmless for public endpoints)
  const token = (typeof Accounts !== 'undefined' && Accounts._storedLoginToken && Accounts._storedLoginToken()) || null;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
    HTTP.get(apiUrl, { headers }, (error, response) => {
      this.isLoading.set(false);
      if (error) {
        console.error('Error fetching user timeline posts:', error);
        return;
      }
      const data = response.data || {};
      if (append) {
        const current = this.posts.get();
        const normalized = (window.userManager && window.userManager.normalizePosts) ? window.userManager.normalizePosts(data.posts || []) : (data.posts || []);
        this.posts.set([...(current || []), ...normalized]);
      } else {
        const normalized = (window.userManager && window.userManager.normalizePosts) ? window.userManager.normalizePosts(data.posts || []) : (data.posts || []);
        this.posts.set(normalized);
      }
      this.currentOffset.set(data.offset || 0);
      this.hasMore.set(!!data.hasMore);

      // If this is the first page, find the first post with an author (skip ads/empties) and hydrate header
      if (!append && Array.isArray(data.posts) && data.posts.length > 0) {
        const firstWithAuthor = data.posts.find(p => p && p.author && (p.author.avatarUrl || p.author.coverUrl || p.author.userName)) || {};
        const firstAuthor = firstWithAuthor.author || {};
        const currentMeta = targetUserVar.get() || {};
        const merged = {
          userName: currentMeta.userName || firstAuthor.userName || FlowRouter.getParam('username') || '',
          avatarUrl: currentMeta.avatarUrl || firstAuthor.avatarUrl || DEFAULT_AVATAR_URL,
          coverUrl: currentMeta.coverUrl || firstAuthor.coverUrl || DEFAULT_COVER_URL,
          bio: currentMeta.bio || '',
        };
  // Improve if existing missing/placeholder OR differs and firstAuthor has a value
  const betterAvatar = firstAuthor.avatarUrl && firstAuthor.avatarUrl !== currentMeta.avatarUrl;
  const betterCover = firstAuthor.coverUrl && firstAuthor.coverUrl !== currentMeta.coverUrl;
  if (betterAvatar) merged.avatarUrl = firstAuthor.avatarUrl;
  if (betterCover) merged.coverUrl = firstAuthor.coverUrl;
  if (betterAvatar || betterCover) targetUserVar.set(merged);
      }
    });
  };

  // Initial load and when username changes
  this.autorun(() => {
    const username = FlowRouter.getParam('username');
    if (!username) return;

    // Only react when the username route param actually changes
    if (this._lastUsername !== username) {
      this._lastUsername = username;
      this.posts.set([]);
      this.currentOffset.set(0);
      this.hasMore.set(true);
      // Prevent this autorun from depending on inner ReactiveVars in loadPosts
      Tracker.nonreactive(() => this.loadPosts(false));
    }
  });
});

Template.userTimeline.onRendered(function() {
  // IntersectionObserver for infinite scrolling on user timeline
  try {
    const sentinel = document.getElementById('userScrollSentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            if (!this.isLoading.get() && this.hasMore.get()) {
              console.log('[userTimeline] Sentinel intersected, loading more...');
              this.loadPosts(true);
            } else {
              console.log('[userTimeline] Sentinel intersected, but either loading or no more posts.', {
                loading: this.isLoading.get(), hasMore: this.hasMore.get()
              });
            }
          }
        });
      }, { root: null, rootMargin: '200px 0px', threshold: 0 });
      observer.observe(sentinel);
      this._userInfiniteObserver = observer;
    }
  } catch (e) {
    console.warn('User timeline IntersectionObserver setup failed:', e);
  }
  const enhanceUserTimelineDom = () => {
    // 1) Read More button when content overflows
    document.querySelectorAll('.post-content, .truncate-in-timeline').forEach(postContent => {
      if (postContent.scrollHeight > postContent.clientHeight) {
        const btn = postContent.closest('.top-area')?.querySelector('.read-more-btn');
        if (btn) btn.style.display = 'block';
      }
    });
    // 2) Card click-through behavior
    document.querySelectorAll('.post-card-link').forEach(card => {
      if (card.__boundClick) return;
      card.__boundClick = true;
      card.addEventListener('click', (e) => {
        if (e.target.closest('a')) return; // let inner links work
        const url = card.getAttribute('data-post-url');
        if (url) FlowRouter.go(url);
      });
    });
  };

  // Enhance on initial render and whenever posts change
  this.autorun(() => {
    (this.posts && this.posts.get && this.posts.get());
    Meteor.defer(() => enhanceUserTimelineDom());
  });

  // Enhance on posts appended (if timeline code dispatches such event)
  window.addEventListener('posts-appended', () => {
    Meteor.defer(() => enhanceUserTimelineDom());
  });

  // Enable Read More toggle behavior on user page
  $(document).off('click.userTimelineReadMore').on('click.userTimelineReadMore', '.read-more-btn', function(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    let content = btn.previousElementSibling;
    if (content && !content.classList.contains('truncate-in-timeline')) {
      content = btn.closest('.post-single-box')?.querySelector('.truncate-in-timeline');
    }
    if (!content) return;
    const expanded = content.classList.toggle('expanded');
    if (expanded) {
      content.style.display = 'block';
      content.style.webkitLineClamp = 'unset';
      content.style.lineClamp = 'unset';
      content.style.maxHeight = 'none';
      btn.textContent = 'Show Less';
    } else {
      content.style.removeProperty('display');
      content.style.removeProperty('-webkit-line-clamp');
      content.style.removeProperty('line-clamp');
      content.style.removeProperty('max-height');
      btn.textContent = 'Read More';
    }
  });
});

Template.userTimeline.onDestroyed(function () {
  if (this._countsInterval) {
    try { clearInterval(this._countsInterval); } catch(_){}
    this._countsInterval = null;
  if (this._userInfiniteObserver) {
    try { this._userInfiniteObserver.disconnect(); } catch(_) {}
    this._userInfiniteObserver = null;
  }
  }
});

Template.userTimeline.helpers({
  targetUser() {
    const meta = targetUserVar.get() || {};
    const myMeta = (window && window.userManager && typeof window.userManager.getData === 'function') ? (window.userManager.getData().meta || {}) : {};
    const username = FlowRouter.getParam('username');
    const isSelf = myMeta && myMeta.userName && typeof username === 'string' && (myMeta.userName.toLowerCase() === username.toLowerCase());
    return {
      // Always display the route handle to match the URL
      userName: username || meta.userName || '',
      avatarUrl: (isSelf && myMeta.avatarUrl) ? myMeta.avatarUrl : (meta.avatarUrl || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png'),
      coverUrl: (isSelf && myMeta.coverUrl) ? myMeta.coverUrl : (meta.coverUrl || '/theme/assets/images/fancy-wallpaper.jpg'),
      bio: (isSelf && myMeta.bio) ? myMeta.bio : (meta.bio || ''),
    };
  },
  posts() {
    return Template.instance().posts.get();
  },
  isFollowing() {
    return Template.instance()._followState.get()?.isFollowing === true;
  },
  showFollowButton() {
    const meta = (window && window.userManager && typeof window.userManager.getData === 'function') ? (window.userManager.getData().meta || {}) : {};
    const username = FlowRouter.getParam('username');
    return !(meta && meta.userName && username && (String(meta.userName).toLowerCase() === String(username).toLowerCase()));
  },
  followButtonLabel() {
    const st = Template.instance()._followState.get() || {};
    return st.isFollowing ? 'Following' : 'Follow';
  },
  followersCount() {
    return (Template.instance()._counts.get() || {}).followers || 0;
  },
  followingCount() {
    return (Template.instance()._counts.get() || {}).following || 0;
  },
});

// Helpers for the user timeline posts subtemplate
Template.timelinePosts.helpers({
  postType(type) {
    const post = this;
    if (type === 'self' && post.type === 'self') {
      return true;
    } else if (type === 'chamber' && post.type === 'chamber') {
      return true;
    } else if (type === 'topic' && post.type === 'topic') {
      return true;
    }
    return false;
  }
});

Template.userTimeline.events({
  'click #followActionBtn'(e, tpl) {
    e.preventDefault();
    const st = tpl._followState.get() || {};
    const targetUserId = st.targetUserId || null;
    if (!targetUserId) return;
    if (st.loading) return;
    const token = localStorage.getItem('Meteor.loginToken');
    const isFollowing = !!st.isFollowing;
    tpl._followState.set({ ...st, loading: true });
    const url = isFollowing ? '/api/user-follows/unfollow' : '/api/user-follows/follow';
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ targetUserId }),
    }).then(async (resp) => {
      const ok = resp.ok; let json = null; try { json = await resp.json(); } catch(_){}
      if (!ok) throw new Error((json && (json.error || json.message)) || 'Request failed');
  // toggle state
  const nowFollowing = !isFollowing;
      const prev = tpl._followState.get() || {};
      tpl._followState.set({ ...prev, isFollowing: nowFollowing, loading: false });
      // update cache
      try {
        if (window && window.userManager) {
          if (nowFollowing) window.userManager.addFollowingUser({ userId: targetUserId, userName: FlowRouter.getParam('username') });
          else window.userManager.removeFollowingUser(targetUserId);
        }
      } catch(_){}
      // refresh counts immediately
      HTTP.get(`/api/user-follows/counts?username=${encodeURIComponent(FlowRouter.getParam('username') || '')}`, {}, (e2, r2) => {
        const followers = (!e2 && r2 && r2.data && typeof r2.data.followers === 'number') ? r2.data.followers : undefined;
        const following = (!e2 && r2 && r2.data && typeof r2.data.following === 'number') ? r2.data.following : undefined;
        const prev = tpl._counts.get() || {};
        tpl._counts.set({ followers: followers ?? prev.followers ?? 0, following: following ?? prev.following ?? 0 });
      });
      // button label updates via helper
    }).catch((err) => {
      console.error('Follow/unfollow error', err);
      const prev = tpl._followState.get() || {};
      tpl._followState.set({ ...prev, loading: false });
      if (window.toastr) toastr.error(err?.message || 'Action failed');
    });
  }
});
