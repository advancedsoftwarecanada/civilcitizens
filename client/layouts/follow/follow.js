// @ts-nocheck
// Routes and template logic for Followers / Following lists
/* global FlowRouter, BlazeLayout, Template, ReactiveVar, Meteor, window, fetch */

(function () {
  const fetchList = async ({ username, type, limit = 50, skip = 0 }) => {
    const params = new URLSearchParams({ username, type, limit: String(limit), skip: String(skip) });
    const res = await fetch(`/api/user-follows/list?${params.toString()}`);
    if (!res.ok) throw new Error(`Failed to fetch ${type} list`);
    return res.json();
  };

  Template.followList.onCreated(function () {
    this.state = new ReactiveVar({ title: '', username: '', users: [] });
    this.autorun(() => {
      const r = FlowRouter.current();
      const uname = r?.params?.username || '';
      const t = r?.route?.name === 'userFollowers' ? 'followers' : 'following';
      const title = t === 'followers' ? 'Followers' : 'Following';
      this.state.set({ title, username: uname, users: [] });
      fetchList({ username: uname, type: t }).then((data) => {
        const users = Array.isArray(data?.users) ? data.users.map(u => ({
          userName: u.userName,
          avatarUrl: u.avatarUrl || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
        })) : [];
        this.state.set({ title, username: uname, users });
      }).catch((e) => {
        console.error('Error loading follow list', e);
        this.state.set({ title, username: uname, users: [] });
      });
    });
  });

  Template.followList.helpers({
    title() { return Template.instance().state.get().title; },
    username() { return Template.instance().state.get().username; },
    users() { return Template.instance().state.get().users; },
    hasUsers() { return (Template.instance().state.get().users || []).length > 0; },
  });

  // Routes
  const makeAction = () => {
    const renderNow = () => BlazeLayout.render('CivilApp_3', { main: 'followList' });
    if (Meteor.userId() && !window.userDataReady) {
      const check = setInterval(() => {
        if (window.userDataReady) { clearInterval(check); renderNow(); }
      }, 100);
      setTimeout(() => { try { clearInterval(check); } catch(e){} renderNow(); }, 1500);
    } else {
      renderNow();
    }
  };

  FlowRouter.route('/u/:username/followers', {
    name: 'userFollowers',
    action() { makeAction(); }
  });

  FlowRouter.route('/u/:username/following', {
    name: 'userFollowing',
    action() { makeAction(); }
  });
})();
