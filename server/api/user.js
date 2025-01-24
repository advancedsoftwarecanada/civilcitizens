WebApp.connectHandlers.use('/api/user', async (req, res) => {
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

        // Initialize the return object
        let returnUserMeta = {};

        // Fetch user metadata
        const userMeta = await UserMeta.findOneAsync({ ownerUserId: userId });
        returnUserMeta.meta = userMeta || {};

        // Fetch user's followed chambers
        const userChamberFollows = await ChamberFollows.find({ user_id: userId }).fetch();
        returnUserMeta.chamberFollows = userChamberFollows || [];

        // Fetch user's most recent 100 votes
        const userVotes = await Votes.find({ user_id: userId }, { limit: 100, sort: { createdAt: -1 } }).fetch();
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


// Helper function to decode the userId from a token (simplified)
function getUserIdFromToken(token) {
    // Implement logic to decode and validate the token, then extract the userId
    // Example: Decode JWT or validate Meteor login token
    const hashedToken = Accounts._hashLoginToken(token.replace('Bearer ', ''));
    const user = Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });
    return user ? user._id : null;
}
