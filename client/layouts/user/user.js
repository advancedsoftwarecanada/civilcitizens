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
        };
        targetUserVar.set(merged);
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
        this.posts.set([...(current || []), ...(data.posts || [])]);
      } else {
        this.posts.set(data.posts || []);
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
    };
  },
  posts() {
    return Template.instance().posts.get();
  },
});
