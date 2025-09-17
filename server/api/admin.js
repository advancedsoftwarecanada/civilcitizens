// @ts-nocheck
/* global Meteor, UserMeta */
const { WebApp } = require('meteor/webapp');
const { Accounts } = require('meteor/accounts-base');

// Small helper to read admin API token from env or settings
function getAdminToken() {
  try {
    // Prefer env var for ops
    if (process.env.ADMIN_API_TOKEN) return process.env.ADMIN_API_TOKEN;
    if (Meteor.settings && Meteor.settings.private && Meteor.settings.private.adminApiToken) {
      return Meteor.settings.private.adminApiToken;
    }
  } catch (e) {}
  return null;
}

function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function readJsonBody(req) {
  // body-parser is globally installed in server/api/links.js
  // If not parsed, manually read
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

// Narrowly mount only on the specific path to avoid intercepting other /api/admin/* routes
WebApp.connectHandlers.use('/api/admin/scrape-member-contacts', async (req, res) => {
  // Debug: log every request hitting this handler
  try {
    const ip = req.headers['x-forwarded-for'] || (req.connection && req.connection.remoteAddress) || 'unknown-ip';
    const ua = req.headers['user-agent'] || 'unknown-ua';
    console.log(`[API Admin] -> ${req.method} ${req.url} from ${ip} ua="${ua}" authHeader=${Boolean(req.headers['authorization'])}`);
  } catch (e) {
    // ignore logging issues
  }

  // Only allow POST
  if (req.method !== 'POST') {
    console.log(`[API Admin] 405 Method not allowed: ${req.method} ${req.url}`);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Method not allowed' }));
    return;
  }

  // Auth: accept either static ADMIN_API_TOKEN or a Meteor login token for an admin user
  const provided = getBearerToken(req);
  const staticToken = getAdminToken();
  let authedUserId = null;
  let isAuthorized = false;

  if (staticToken && provided === staticToken) {
    // Static token path (ops)
    isAuthorized = true;
    console.log('[API Admin] Auth success via static ADMIN_API_TOKEN');
  } else if (provided) {
    try {
      const hashedToken = Accounts._hashLoginToken(provided);
      const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });
      if (user) {
        const meta = await UserMeta.findOneAsync({ ownerUserId: user._id });
        if (meta && meta.admin === true) {
          isAuthorized = true;
          authedUserId = user._id;
          console.log(`[API Admin] Auth success via Meteor login token. userId=${authedUserId}`);
        } else {
          console.log(`[API Admin] Auth failed: user found but not admin. userId=${user && user._id}`);
        }
      } else {
        console.log('[API Admin] Auth failed: no user found for provided login token');
      }
    } catch (e) {
      // fall through
      console.log('[API Admin] Auth error during token validation:', e && (e.reason || e.message) || e);
    }
  }

  if (!isAuthorized) {
    console.log('[API Admin] 401 Unauthorized for', req.method, req.url, 'authHeaderPresent=', !!provided);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Unauthorized' }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const options = {
      onlyMissing: body.onlyMissing !== undefined ? !!body.onlyMissing : true,
      limit: Number.isFinite(body.limit) ? body.limit : 1000,
      delayMs: Number.isFinite(body.delayMs) ? body.delayMs : 500,
      userId: authedUserId || null,
    };

    // Call the shared task directly; we've already authorized above
    console.log('[API Admin] Starting task scrapeMemberContacts with options:', options);
    const result = await global.AdminChambers.scrapeMemberContactsTask(options);
    try {
      // Log a concise summary if available
      if (result && typeof result === 'object') {
        const summary = {
          processed: result.processed,
          updated: result.updated,
          errorsCount: result.errorsCount,
        };
        console.log('[API Admin] Task completed. Summary:', summary);
      } else {
        console.log('[API Admin] Task completed.');
      }
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', result }));
  } catch (err) {
    console.error('API /api/admin/scrape-member-contacts failed:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: err && (err.reason || err.message) || 'Server error' }));
  }
});
