// @ts-nocheck
/* global WebApp, UserMeta, ChamberFollows, Votes, Accounts */

WebApp.connectHandlers.use('/api/user', async (req, res, next) => {
    // Allow subpaths like /api/user/update-bio to pass through to the next handler,
    // but handle /api/user with or without query params here (e.g., /api/user?id=...)
    const url = req.url || '';
    const pathname = (url.split('?')[0]) || '';
    if (pathname && pathname !== '/' && pathname !== '') {
        return next();
    }
    try {
        // Extract the Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid token.' }));
            return;
        }

        // Extract and validate the token
        const token = authHeader.replace('Bearer ', '');
        const hashedToken = Accounts._hashLoginToken(token);
        const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });

        if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid token.' }));
            return;
        }

        // If a specific id is provided via query string, prefer that; otherwise use auth user
        let userId = user._id;
        try {
            const query = (req.url && req.url.includes('?')) ? req.url.split('?')[1] : '';
            if (query) {
                const params = new URLSearchParams(query);
                const qId = params.get('id');
                if (qId && typeof qId === 'string') {
                    userId = qId;
                }
            }
        } catch (e) {
            // ignore parsing errors, fall back to auth user
        }

        // Initialize the return object
        let returnUserMeta = {};

        // Fetch user metadata
        const userMeta = await UserMeta.findOneAsync({ ownerUserId: userId });
        returnUserMeta.meta = userMeta || {};

        // Fetch user's followed chambers
        const userChamberFollows = await ChamberFollows.find({ userId: userId }).fetch();
        returnUserMeta.chamberFollows = userChamberFollows || [];

        // Fetch user's most recent 100 votes
        const userVotes = await Votes.find({ userId: userId }, { limit: 100, sort: { createdAt: -1 } }).fetch();
        returnUserMeta.votes = userVotes || [];

        // Respond with the combined user metadata
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(returnUserMeta));
    } catch (error) {
        console.error('Error processing /api/user:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
});

// Helper: parse JSON body if not already parsed by body-parser
async function parseJsonBody(req) {
    return await new Promise((resolve) => {
        try {
            let data = '';
            req.on('data', (chunk) => { data += chunk; });
            req.on('end', () => {
                try { resolve(JSON.parse(data || '{}')); }
                catch { resolve({}); }
            });
        } catch (e) {
            resolve({});
        }
    });
}

// PUT /api/user/update-bio - Update user bio
WebApp.connectHandlers.use('/api/user/update-bio', async (req, res) => {
    if (req.method !== 'PUT') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed.' }));
        return;
    }

    try {
        // Extract the Authorization header
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid token.' }));
            return;
        }

        // Extract and validate the token
        const token = authHeader.replace('Bearer ', '');
        const hashedToken = Accounts._hashLoginToken(token);
        const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });

        if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid token.' }));
            return;
        }

        const userId = user._id;

        // Get the parsed body (supports both body-parser and manual parse)
        let body = req.body;
        if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
            body = await parseJsonBody(req);
        }
        const bio = (body && typeof body.bio === 'string') ? body.bio : '';

        // Validate bio length
        const BIO_MAX = 10000;
        const plainBio = bio ? bio.replace(/<[^>]*>/g, '') : '';
        if (plainBio.length > BIO_MAX) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Bio too long (max ${BIO_MAX} characters)` }));
            return;
        }

        // Update UserMeta
        await UserMeta.updateAsync(
            { ownerUserId: userId },
            { $set: { bio: bio || '' } },
            { upsert: true }
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'Bio updated successfully.' }));

    } catch (error) {
        console.error('Error updating bio:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
});


// Helper function to decode the userId from a token (simplified)
function getUserIdFromToken(token) {
    // Implement logic to decode and validate the token, then extract the userId
    // Example: Decode JWT or validate Meteor login token
    const hashedToken = Accounts._hashLoginToken(token.replace('Bearer ', ''));
    const user = Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });
    return user ? user._id : null;
}
