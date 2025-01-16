import bodyParser from 'body-parser';

// Use body parser middleware to parse JSON bodies
WebApp.connectHandlers.use(bodyParser.json());

WebApp.connectHandlers.use('/api/events', async (req, res) => {

    console.log("VOTE EVENT API");

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
    return;
  }

  // Authenticate the user
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized. Token is required.' }));
    return;
  }

  const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': Accounts._hashLoginToken(token) });
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized. Invalid token.' }));
    return;
  }

  const { action, post_id } = req.body;

  if (!action || !post_id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Action and post ID are required.' }));
    return;
  }

  const validActions = ['upvote', 'downvote', 'bookmark', 'share'];
  if (!validActions.includes(action)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid action.' }));
    return;
  }

  try {
    if (action === 'upvote' || action === 'downvote') {
        console.log("VOTE: " + action);
      await Meteor.callAsync('posts.vote', { userId: user._id, postId: post_id, vote: action === 'upvote' ? 'upvote' : 'downvote' });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    console.error('Error tracking event:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});
