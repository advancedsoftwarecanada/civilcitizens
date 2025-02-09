import bodyParser from 'body-parser';

// Use body parser middleware to parse JSON bodies
WebApp.connectHandlers.use(bodyParser.json());

WebApp.connectHandlers.use('/api/events', async (req, res) => {
  // ---------------
  // Checks
  // ---------------

  //  Only allow POST requests
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

  console.log("EVENT API");

  // Find the user by token
  const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': Accounts._hashLoginToken(token) });
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized. Invalid token.' }));
    return;
  }

  const { action, postId, province, chamber } = req.body;

  // Validate the action and post ID
  if (!action || (!postId && !province && !chamber)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Action and post ID or province and chamber are required.' }));
    return;
  }

  // ---------------
  // Event
  // ---------------

  // Check for valid Event
  const validActions = ['upvote', 'downvote', 'bookmark', 'share', 'follow', 'unfollow'];
  if (!validActions.includes(action)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid action.' }));
    return;
  }

  try {
    // Upvotes and downvotes!
    if (action === 'upvote' || action === 'downvote') {
      console.log("VOTE: " + action);
      await Meteor.callAsync('posts.vote', { userId: user._id, postId: postId, vote: action === 'upvote' ? 'upvote' : 'downvote' });
    }

    // Follow and unfollow actions
    if (action === 'follow') {
      await Meteor.callAsync('chambers.follow', {userId: user._id, province: province, chamber: chamber});
    }

    if (action === 'unfollow') {
      await Meteor.callAsync('chambers.unfollow', {userId: user._id, province: province, chamber: chamber});
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    console.error('Error tracking event:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});
