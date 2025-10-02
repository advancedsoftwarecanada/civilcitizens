// @ts-nocheck
/* global Template, ReactiveVar, FlowRouter, BlazeLayout, HTTP, $, Meteor, Session */
// Use the global instance created in client/main.js
const userManager = (typeof window !== 'undefined' && window.userManager) ? window.userManager : null;

// Reactive variable for thisChamber
const thisChamber = new ReactiveVar(null);

/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/c/:province/:chamber', {
  name: "home",
  action() {
      const renderNow = () => BlazeLayout.render('CivilApp_3', { main: 'timeline' });
      if (Meteor.userId() && !window.userDataReady) {
        const checkUserDataReady = setInterval(() => {
          if (window.userDataReady) {
            clearInterval(checkUserDataReady);
            renderNow();
          }
        }, 100);
        setTimeout(() => { try { clearInterval(checkUserDataReady); } catch(e){} renderNow(); }, 1500);
      } else {
        renderNow();
      }
  }
});


Template.timeline.onCreated(function () {
  this.posts = new ReactiveVar([]);
  this.isLoading = new ReactiveVar(false);
  this.hasMore = new ReactiveVar(true);
  this.currentOffset = new ReactiveVar(0);
  this.initialLoad = new ReactiveVar(true);
  this.lastPath = null; // track route changes
  // Tabs state
  this.sortTab = new ReactiveVar('latest'); // latest | hot
  this.govTab = new ReactiveVar('all'); // all | federal | provincial | municipal | citizen
  // Track prior tab values to avoid duplicate initial loads
  this._prevSort = null;
  this._prevGov = null;

  // Minimal debounce to prevent rapid re-entry
  this._loadDebounce = null;
  this.loadPosts = (append = false) => {
    if (this.isLoading.get()) return;
    if (!append && !this.hasMore.get() && !this.initialLoad.get()) return;

    this.isLoading.set(true);
    const userId = Meteor.userId();
    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');
    const path = FlowRouter.current().path;
  const offset = append ? this.currentOffset.get() : 0;
  const limit = 10; // Load 10 posts at a time
  const sort = this.sortTab.get();
  const gov = this.govTab.get();
  // Use relative URL so it works for guests and across environments
  const apiUrl = `/api/timeline?uid=${userId || ''}&path=${encodeURIComponent(path)}&province=${province || ''}&chamber=${chamber || ''}&offset=${offset}&limit=${limit}&sort=${sort}&gov=${gov}`;

    // Debounce rapid calls within 100ms window
    if (this._loadDebounce) clearTimeout(this._loadDebounce);
    this._loadDebounce = setTimeout(() => {
      HTTP.get(apiUrl, (error, response) => {
      this.isLoading.set(false);

      if (error) {
        console.error('Error fetching timeline posts:', error);
        return;
      }

      const data = response.data;
      console.log('Timeline posts response:', data);

      if (append) {
        // Append new posts to existing ones
        const currentPosts = this.posts.get();
          const mgr = (typeof window !== 'undefined' && window.userManager && typeof window.userManager.normalizePosts === 'function') ? window.userManager : null;
          const normalized = mgr ? mgr.normalizePosts(data.posts || []) : (data.posts || []);
          this.posts.set([...currentPosts, ...normalized]);
        this.currentOffset.set(data.offset);
        this.hasMore.set(data.hasMore);
        Meteor.defer(() => {
          // Re-run enhancements for newly appended nodes
          const event = new Event('posts-appended');
          window.dispatchEvent(event);
        });
      } else {
        // Replace posts for initial load
          const mgr = (typeof window !== 'undefined' && window.userManager && typeof window.userManager.normalizePosts === 'function') ? window.userManager : null;
          const normalized = mgr ? mgr.normalizePosts(data.posts || []) : (data.posts || []);
          this.posts.set(normalized);
        this.currentOffset.set(data.offset);
        this.hasMore.set(data.hasMore);
        this.initialLoad.set(false);

        // Scroll to top only on initial load
        $('html, body').animate({
          scrollTop: 0
        }, 0);
      }
      });
    }, 100);
  };

  // Reload when route/path changes (home <-> chamber, or between chambers)
  this.autorun(() => {
    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');
    const path = FlowRouter.current().path;

    if (this.lastPath !== path) {
      this.lastPath = path;
  // Reset state
      this.posts.set([]);
      this.currentOffset.set(0);
      this.hasMore.set(true);
      this.initialLoad.set(true);
      // Load fresh posts for the new route
      this.loadPosts(false);
    }
  });

});

// TODO: we want to limit the height of posts on the timeline, and show a "Read More" button if the post is too long
Template.timeline.onRendered(function () {

  console.log("TIMELINE RENDERED");

  // Scroll detection for lazy loading
  this.scrollHandler = () => {
    // Fallback window scroll detector
    const scrollTop = $(window).scrollTop();
    const windowHeight = $(window).height();
    const documentHeight = $(document).height();
    const scrollPercentage = (scrollTop + windowHeight) / documentHeight;

    // Load more posts when user scrolls to 80% of the page
    if (scrollPercentage > 0.8 && !this.isLoading.get() && this.hasMore.get()) {
      console.log('[timeline] Fallback scroll: near bottom, loading more...');
      this.loadPosts(true);
    }
  };

  // Throttle scroll events for better performance
  let scrollTimeout;
  this.throttledScrollHandler = () => {
    if (!scrollTimeout) {
      scrollTimeout = setTimeout(() => {
        this.scrollHandler();
        scrollTimeout = null;
      }, 200); // 200ms throttle
    }
  };

  // Attach scroll listener
  $(window).on('scroll.timeline', this.throttledScrollHandler);

  // IntersectionObserver-based sentinel (more reliable than window scroll in nested layouts)
  try {
    const sentinel = document.getElementById('scrollSentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            if (!this.isLoading.get() && this.hasMore.get()) {
              console.log('[timeline] Sentinel intersected, loading more...');
              this.loadPosts(true);
            } else {
              console.log('[timeline] Sentinel intersected, but either loading or no more posts.', {
                loading: this.isLoading.get(), hasMore: this.hasMore.get()
              });
            }
          }
        });
      }, { root: null, rootMargin: '200px 0px', threshold: 0 });
      observer.observe(sentinel);
      this._infiniteObserver = observer;
    }
  } catch (e) {
    console.warn('IntersectionObserver setup failed:', e);
  }

  // When posts are appended, enhance DOM again
  window.addEventListener('posts-appended', () => {
    Meteor.defer(() => {
      // Reuse same logic as initial enhance
      const enhance = () => {
        document.querySelectorAll('.timeline-page .description').forEach(el => {
          // simple idempotency: avoid double-wrapping existing links by not changing existing anchors
          // We just rerun autoLink through the helper already attached via autorun
        });
      };
      enhance();
    });
  });

  // Reload when tabs change
  this.autorun(() => {
    const s = this.sortTab.get();
    const g = this.govTab.get();
    // Skip on first run to prevent double-initial load; only reload when value actually changes
    if (this._prevSort === null && this._prevGov === null) {
      this._prevSort = s;
      this._prevGov = g;
      return;
    }
    if (this._prevSort === s && this._prevGov === g) return;
    this._prevSort = s;
    this._prevGov = g;

    this.posts.set([]);
    this.currentOffset.set(0);
    this.hasMore.set(true);
    this.initialLoad.set(true);
    this.loadPosts(false);
  });

  const enhanceTimelineDom = () => {
    // 1) Show Read More button when content overflows
    document.querySelectorAll('.post-content, .truncate-in-timeline').forEach(postContent => {
      if (postContent.scrollHeight > postContent.clientHeight) {
        const btn = postContent.nextElementSibling;
        if (btn && btn.classList.contains('read-more-btn')) btn.style.display = 'block';
      }
    });
    // 2) Make the whole card clickable, but let inner <a> links work normally
    document.querySelectorAll('.post-card-link').forEach(card => {
      // avoid stacking multiple listeners on re-renders
      if (card.__boundClick) return;
      card.__boundClick = true;
      card.addEventListener('click', (e) => {
        // If a child anchor was clicked, do nothing
        if (e.target.closest('a')) return;
        const url = card.getAttribute('data-post-url');
        if (url) FlowRouter.go(url);
      });
    });
  };

  this.autorun(() => {
    this.posts.get(); // Re-run when posts change
    Meteor.defer(() => { enhanceTimelineDom(); });
  });

  // Enable Read More toggle behavior
  $(document).off('click.timelineReadMore').on('click.timelineReadMore', '.read-more-btn', function(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    // Try sibling first (timeline template use)
    let content = btn.previousElementSibling;
    if (content && !content.classList.contains('truncate-in-timeline')) {
      // For cases where structure differs, search within the same card
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
      // Re-apply truncation
      content.style.removeProperty('display');
      content.style.removeProperty('webkit-line-clamp');
      content.style.removeProperty('line-clamp');
      content.style.removeProperty('max-height');
      btn.textContent = 'Read More';
    }
  });


    // Reactively fetch chamber details when route changes
    this.autorun(() => {
      const province = FlowRouter.getParam('province');
      const chamber = FlowRouter.getParam('chamber');

      if (province && chamber) {
        const apiUrl = `/api/chamber?province=${province}&chamber=${chamber}`;
        HTTP.get(apiUrl, (error, response) => {
          if (error) {
            console.error('Error fetching chamber:', error);
          } else {
            thisChamber.set(response.data);
          }
        });
      } else {
        // Clear when not on a chamber route
        thisChamber.set(null);
      }
    });

});

Template.timeline.onDestroyed(function() {
  // Clean up scroll event listener
  if (this.throttledScrollHandler) {
    $(window).off('scroll.timeline', this.throttledScrollHandler);
  }
  if (this._infiniteObserver) {
    try { this._infiniteObserver.disconnect(); } catch(_) {}
    this._infiniteObserver = null;
  }
});

Template.timeline.helpers({
  posts() {
    return Template.instance().posts.get();
  },
  isAd(post) {
    return post.ad === true;
  },
  isLoading() {
    return Template.instance().isLoading.get();
  },
  hasMore() {
    return Template.instance().hasMore.get();
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
  thisChamber() {
    return thisChamber.get();
  },
  currentMember() {
    const c = thisChamber.get();
    return c && c.currentMember;
  },
  // Tab helpers
  activeTab(kind, value) {
    const inst = Template.instance();
    const current = kind === 'sort' ? inst.sortTab.get() : inst.govTab.get();
    return current === value ? 'active' : '';
  },
  isGov(value) {
    return Template.instance().govTab.get() === value;
  },
  partyClass(caucus) {
    if (!caucus || typeof caucus !== 'string') return 'party-independent';
    const v = caucus.toLowerCase();
    if (/(liberal)/.test(v)) return 'party-liberal';
    if (/(conservative|tory)/.test(v)) return 'party-conservative';
    if (/(ndp|new\s+democratic)/.test(v)) return 'party-ndp';
    if (/(green)/.test(v)) return 'party-green';
    if (/(bloc)/.test(v)) return 'party-bloc';
    if (/(independent|non-affiliated)/.test(v)) return 'party-independent';
    return 'party-independent';
  },
  mpPhoto(ctx) {
    const cm = (ctx && ctx.currentMember) || (thisChamber.get() && thisChamber.get().currentMember) || {};
    return cm.photoCdnUrl || cm.photoUrl || '/theme/assets/images/user-default.png';
  },
  mpWebsite(ctx) {
    const cm = (ctx && ctx.currentMember) || (thisChamber.get() && thisChamber.get().currentMember) || {};
    if (Array.isArray(cm.websites) && cm.websites.length) return cm.websites[0];
    return null;
  },
  mpEmail(ctx) {
    const cm = (ctx && ctx.currentMember) || (thisChamber.get() && thisChamber.get().currentMember) || {};
    if (Array.isArray(cm.emails) && cm.emails.length) return cm.emails[0];
    return null;
  },
  jurisdictionLabel(post) {
    const p = post || this;
    let j = (p && p.jurisdiction) ? String(p.jurisdiction).toLowerCase() : '';
    if (!j) {
      // Fallbacks: self/topic => citizen, chamber => federal (current EDA model)
      if (p && (p.type === 'self' || p.type === 'topic')) j = 'citizen';
      else if (p && p.type === 'chamber') j = 'federal';
    }
    return j ? j.charAt(0).toUpperCase() + j.slice(1) : 'Citizen';
  },
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
  },

  linkAttachment() {
    const post = this;
    if (post && post.attachments && post.attachments.type === 'link') {
      return post.attachments;
    }
    return null;
  },

  currentChamber() {
    // Use the reactive var defined in this file
    return thisChamber.get();
  }
});

Template.timeline.events({
  'click .tab-sort'(e, inst) {
    e.preventDefault();
    const val = e.currentTarget.dataset.sort;
    if (val) inst.sortTab.set(val);
  },
  'click .tab-gov'(e, inst) {
    e.preventDefault();
    const val = e.currentTarget.dataset.gov;
    if (val) inst.govTab.set(val);
  },
  'click .post-img'(event, instance) {
    event.preventDefault();
    const postUrl = event.currentTarget.dataset.postUrl;
    if (postUrl) {
      FlowRouter.go(postUrl);
    }
  }
});
