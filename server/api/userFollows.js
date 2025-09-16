// @ts-nocheck
/* global WebApp, UserFollows, UserMeta, Accounts */

function writeJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function getUserFromToken(req) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.replace('Bearer ', '');
    const hashedToken = Accounts._hashLoginToken(token);
    const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });
    return user || null;
  } catch (e) {
    return null;
  }
}

// POST /api/user-follows/follow { targetUserId }
WebApp.connectHandlers.use('/api/user-follows/follow', async (req, res) => {
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'Method not allowed' });
  try {
    const user = await getUserFromToken(req);
    if (!user) return writeJson(res, 401, { error: 'Unauthorized' });

    // parse body
    let body = req.body; if (!body || (typeof body === 'object' && !Object.keys(body).length)) {
      body = await new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(JSON.parse(d||'{}')); } catch { resolve({}); } });});
    }
    const targetUserId = String(body.targetUserId || '').trim();
    if (!targetUserId) return writeJson(res, 400, { error: 'targetUserId required' });
    if (targetUserId === user._id) return writeJson(res, 400, { error: 'Cannot follow yourself' });

    await UserFollows.updateAsync(
      { followerId: user._id, targetUserId },
      { $set: { followerId: user._id, targetUserId, createdAt: new Date() } },
      { upsert: true }
    );
    // Update counts on both users
    try {
      const followerCount = await UserFollows.find({ targetUserId }).countAsync();
      const followingCount = await UserFollows.find({ followerId: user._id }).countAsync();
      await UserMeta.updateAsync({ ownerUserId: targetUserId }, { $set: { followersCount: followerCount } }, { upsert: true });
      await UserMeta.updateAsync({ ownerUserId: user._id }, { $set: { followingCount: followingCount } }, { upsert: true });
    } catch (e) { console.error('Failed updating follow counts', e); }
    writeJson(res, 200, { status: 'success' });
  } catch (e) {
    console.error('follow error', e); writeJson(res, 500, { error: 'Internal server error' });
  }
});

// POST /api/user-follows/unfollow { targetUserId }
WebApp.connectHandlers.use('/api/user-follows/unfollow', async (req, res) => {
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'Method not allowed' });
  try {
    const user = await getUserFromToken(req);
    if (!user) return writeJson(res, 401, { error: 'Unauthorized' });
    let body = req.body; if (!body || (typeof body === 'object' && !Object.keys(body).length)) {
      body = await new Promise((resolve) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { resolve(JSON.parse(d||'{}')); } catch { resolve({}); } });});
    }
    const targetUserId = String(body.targetUserId || '').trim();
    if (!targetUserId) return writeJson(res, 400, { error: 'targetUserId required' });
    await UserFollows.removeAsync({ followerId: user._id, targetUserId });
    // Update counts on both users
    try {
      const followerCount = await UserFollows.find({ targetUserId }).countAsync();
      const followingCount = await UserFollows.find({ followerId: user._id }).countAsync();
      await UserMeta.updateAsync({ ownerUserId: targetUserId }, { $set: { followersCount: followerCount } }, { upsert: true });
      await UserMeta.updateAsync({ ownerUserId: user._id }, { $set: { followingCount: followingCount } }, { upsert: true });
    } catch (e) { console.error('Failed updating follow counts', e); }
    writeJson(res, 200, { status: 'success' });
  } catch (e) {
    console.error('unfollow error', e); writeJson(res, 500, { error: 'Internal server error' });
  }
});

// GET /api/user-follows/is-following?username=...|userId=...
WebApp.connectHandlers.use('/api/user-follows/is-following', async (req, res) => {
  try {
    const user = await getUserFromToken(req);
    if (!user) return writeJson(res, 200, { isFollowing: false });
    const query = new URL('http://x' + req.url).searchParams;
    let targetUserId = query.get('userId');
    const username = query.get('username');
    if (!targetUserId && username) {
      const meta = await UserMeta.findOneAsync({ userName: { $regex: `^${username.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, $options: 'i' } });
      targetUserId = meta?.ownerUserId || null;
    }
    if (!targetUserId) return writeJson(res, 200, { isFollowing: false });
    const exists = await UserFollows.findOneAsync({ followerId: user._id, targetUserId });
    return writeJson(res, 200, { isFollowing: !!exists });
  } catch (e) {
    console.error('is-following error', e);
    return writeJson(res, 500, { error: 'Internal server error' });
  }
});

// GET /api/user-follows/counts?userId=... or ?username=...
WebApp.connectHandlers.use('/api/user-follows/counts', async (req, res) => {
  try {
    const query = new URL('http://x' + req.url).searchParams; // prefixed to parse easily
    let userId = query.get('userId');
    const username = query.get('username');
    if (!userId && username) {
      const meta = await UserMeta.findOneAsync({ userName: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
      userId = meta?.ownerUserId || null;
    }
    if (!userId) return writeJson(res, 400, { error: 'userId or username required' });

    const following = await UserFollows.find({ followerId: userId }).countAsync();
    const followers = await UserFollows.find({ targetUserId: userId }).countAsync();
    writeJson(res, 200, { userId, followers, following });
  } catch (e) {
    console.error('counts error', e); writeJson(res, 500, { error: 'Internal server error' });
  }
});

// GET /api/user-follows/list?userId=...&type=followers|following&limit=...&skip=...
WebApp.connectHandlers.use('/api/user-follows/list', async (req, res) => {
  try {
    const query = new URL('http://x' + req.url).searchParams;
    let userId = query.get('userId');
    const username = query.get('username');
    const type = (query.get('type') || 'followers').toLowerCase();
    const limit = Math.min(parseInt(query.get('limit') || '50', 10), 100);
    const skip = Math.max(parseInt(query.get('skip') || '0', 10), 0);
    if (!userId && username) {
      const meta = await UserMeta.findOneAsync({ userName: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
      userId = meta?.ownerUserId || null;
    }
    if (!userId) return writeJson(res, 400, { error: 'userId or username required' });

    const selector = (type === 'following')
      ? { followerId: userId }
      : { targetUserId: userId };
    const docs = await UserFollows.find(selector, { limit, skip, sort: { createdAt: -1 } }).fetchAsync();

    // Map to enriched user info
    const ids = [...new Set(docs.map(d => type === 'following' ? d.targetUserId : d.followerId))];
    const metas = await UserMeta.find({ ownerUserId: { $in: ids } }).fetchAsync();
    const byId = Object.fromEntries(metas.map(m => [m.ownerUserId, m]));
    const result = docs.map(d => {
      const uid = (type === 'following') ? d.targetUserId : d.followerId;
      const m = byId[uid] || {};
      return {
        userId: uid,
        userName: m.userName || 'unknown',
        avatarUrl: m.avatarUrl || null,
        coverUrl: m.coverUrl || null,
        bio: m.bio || '',
        followedAt: d.createdAt || null,
      };
    });

    writeJson(res, 200, { type, userId, count: result.length, users: result });
  } catch (e) {
    console.error('list error', e); writeJson(res, 500, { error: 'Internal server error' });
  }
});
