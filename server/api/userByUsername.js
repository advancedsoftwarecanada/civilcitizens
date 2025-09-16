// @ts-nocheck
/* global WebApp, UserMeta */
import { ApiFiles } from '/libs/apiFiles.js';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

WebApp.connectHandlers.use('/api/user/by-username', async (req, res) => {
  try {
    const { username } = req.query || {};
    if (!username) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'username is required' }));
      return;
    }

  // Case-insensitive username match to avoid casing issues; handle duplicates robustly
  const metas = await UserMeta.find({ userName: { $regex: `^${escapeRegex(username)}$`, $options: 'i' } }).fetchAsync();
  if (!metas || metas.length === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

  // Prefer a meta that has an ownerUserId and avatar/cover; then any with ownerUserId; then newest; then first
  let meta = metas.find(m => m.ownerUserId && (m.avatarUrl || m.coverUrl)) ||
             metas.find(m => m.ownerUserId) ||
             metas.slice().sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0))[0] ||
             metas[0];

    // Fallbacks: if avatar/cover missing, try the most recent uploads tagged as such
    let avatarUrl = meta.avatarUrl || null;
    let coverUrl = meta.coverUrl || null;

    try {
      // Use a valid ownerUserId from any matching meta to enable fallbacks
      const ownerIdForFallback = meta.ownerUserId || (metas.find(m => !!m.ownerUserId)?.ownerUserId);
      if (!avatarUrl && ownerIdForFallback) {
        const lastAvatar = await ApiFiles.findOneAsync(
          { userId: ownerIdForFallback, 'meta.type': 'avatar' },
          { sort: { createdAt: -1 } }
        );
        if (lastAvatar?.url) avatarUrl = lastAvatar.url;
      }
      if (!coverUrl && ownerIdForFallback) {
        const lastCover = await ApiFiles.findOneAsync(
          { userId: ownerIdForFallback, 'meta.type': 'cover' },
          { sort: { createdAt: -1 } }
        );
        if (lastCover?.url) coverUrl = lastCover.url;
      }
    } catch (fallbackErr) {
      console.error('Fallback lookup error in /api/user/by-username:', fallbackErr);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      userName: meta.userName,
      avatarUrl,
      coverUrl,
      bio: meta.bio || '',
    }));
  } catch (e) {
    console.error('Error in /api/user/by-username:', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});
