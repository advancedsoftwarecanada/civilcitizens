console.log('🚀 API POST ENDPOINTS LOADING...');

// Global declarations for Meteor collections and WebApp
/* global WebApp, Posts, UserMeta, Comments, Chambers, Accounts */

// Add body parser middleware for JSON parsing
import bodyParser from 'body-parser';
import { WebApp } from 'meteor/webapp';
WebApp.connectHandlers.use(bodyParser.json({ limit: '10mb' })); // Add size limit

// Very simple test endpoint to check if basic request handling works
WebApp.connectHandlers.use('/ping', (req, res) => {
  console.log('🏓 PING received!');
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('pong');
});

WebApp.connectHandlers.use('/api/post', async (req, res) => {
  const { seo_url } = req.query;

  if (!seo_url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'SEO URL is required.' }));
    return;
  }

  try {
    const post = await Posts.findOneAsync({ seoUrl: seo_url });

    if (!post) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Post not found.' }));
      return;
    }

    const userMeta = await UserMeta.findOneAsync({ ownerUserId: post.authorId });

    const comments = await Comments.find({ postId: post._id }, { sort: { createdAt: -1 }, limit: 100 }).fetchAsync();

    const commentsWithUserMeta = await Promise.all(comments.map(async (comment) => {
      const commentUserMeta = await UserMeta.findOneAsync({ ownerUserId: comment.userId });
      return {
        ...comment,
        author: {
          userName: commentUserMeta?.userName || 'Unknown User',
          avatarUrl: commentUserMeta?.avatarUrl || null,
        },
      };
    }));

    const postWithAuthorAndComments = {
      ...post,
      author: {
        userName: userMeta?.userName || 'Unknown User',
        avatarUrl: userMeta?.avatarUrl || null,
      },
      comments: commentsWithUserMeta,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(postWithAuthorAndComments));
  } catch (error) {
    console.error('Error fetching post:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});

// POST /api/posts/submit - Submit a new post
WebApp.connectHandlers.use('/api/posts/submit', async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  console.log('📡 POST /api/posts/submit called');
  console.log('📡 Request method:', req.method);
  console.log('📡 Request URL:', req.url);
  console.log('📡 Content-Type header:', req.headers['content-type']);
  console.log('📡 Content-Length header:', req.headers['content-length']);
  console.log('📡 All headers:', JSON.stringify(req.headers, null, 2));
  console.log('📡 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📡 Method:', req.method);
  console.log('📡 URL:', req.url);

  try {
    // Extract the Authorization header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Missing or invalid authorization header');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid token.' }));
      return;
    }

    // Extract and validate the token
    const token = authHeader.replace('Bearer ', '');
    const hashedToken = Accounts._hashLoginToken(token);
    const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });

    if (!user) {
      console.log('❌ Invalid token - user not found');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid token.' }));
      return;
    }

    console.log('✅ User authenticated:', user._id);

    const userId = user._id;

    // Get the parsed body from body-parser
    const thePostJson = req.body;
    console.log('📝 Received post data from body-parser:', thePostJson);

    // Check for existing draft if creating a draft
    if (thePostJson.draft) {
      const existingDraft = await Posts.findOneAsync({ authorId: userId, draft: true });
      if (existingDraft) {
        console.log('Found existing draft post:', existingDraft._id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'Draft post found.', postId: existingDraft._id }));
        return;
      }
    }

    // Generate SEO URL
    let seoUrl;
    if (thePostJson.title && thePostJson.title.trim()) {
      seoUrl = `${thePostJson.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    } else {
      seoUrl = `post-${Date.now()}`;
    }

    // Prepare post data
    const postData = {
      title: thePostJson.title || null,
      body: thePostJson.body || null,
      type: thePostJson.type,
      authorId: userId,
      voteCount: 0,
      commentCount: 0,
      bookmarkCount: 0,
      shareCount: 0,
      createdAt: new Date().getTime(),
      seoUrl: seoUrl,
      draft: thePostJson.draft || false,
    };

    // Handle attachments
    if (thePostJson.attachments) {
      const att = thePostJson.attachments;
      if (att.type === 'images') {
        postData.images = att.fileIds;
      } else if (att.type === 'video') {
        postData.video = att.fileId;
      } else if (att.type === 'link') {
        postData.link = att.url;
      } else if (att.type === 'poll') {
        postData.poll = {
          options: att.options,
          duration: att.duration,
          allowMulti: att.allowMulti,
        };
      }
    }

    let postId;

    // SELF POST
    if (thePostJson.type === "self") {
      console.log('💾 Inserting self post into database...');
      postId = await Posts.insertAsync(postData);
      console.log('✅ Self post inserted with ID:', postId);
    }

    // CHAMBER
    if (thePostJson.type === "chamber") {
      postData.chamber = thePostJson.chamber;
      postData.province = thePostJson.province;
      console.log('💾 Inserting chamber post into database...');
      postId = await Posts.insertAsync(postData);
      console.log('✅ Chamber post inserted with ID:', postId);

      // Update the Chamber stats.posts
      await Chambers.updateAsync({ province: thePostJson.province, seoUrl: thePostJson.chamber }, { $inc: { 'stats.posts': 1 } });
    }

    // TOPIC
    if (thePostJson.type === "topic") {
      postData.topic = thePostJson.topic;
      console.log('💾 Inserting topic post into database...');
      postId = await Posts.insertAsync(postData);
      console.log('✅ Topic post inserted with ID:', postId);
    }

    console.log('📤 Sending success response with postId:', postId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', message: 'Post submitted successfully.', postId }));

  } catch (error) {
    console.error('Error submitting post:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});

// PUT /api/posts/update - Update an existing post
WebApp.connectHandlers.use('/api/posts/update', async (req, res) => {
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

    // Get the parsed body from body-parser
    const { postId, ...updateData } = req.body;

    const post = await Posts.findOneAsync({ _id: postId });
    if (!post) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Post not found.' }));
      return;
    }

    if (post.authorId !== userId) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'You can only update your own posts.' }));
      return;
    }

    await Posts.updateAsync({ _id: postId }, { $set: updateData });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', message: 'Post updated successfully.' }));

  } catch (error) {
    console.error('Error updating post:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});

// Simple test endpoint to check if basic request handling works
WebApp.connectHandlers.use('/api/test', async (req, res) => {
  console.log('🧪 TEST endpoint called - REQUEST RECEIVED!');
  console.log('🧪 Method:', req.method);
  console.log('🧪 URL:', req.url);
  console.log('🧪 Headers:', JSON.stringify(req.headers, null, 2));

  if (req.method === 'POST') {
    console.log('🧪 POST request detected, using body-parser...');
    console.log('🧪 Body from body-parser:', req.body);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      method: req.method,
      body: req.body,
      bodyLength: JSON.stringify(req.body).length,
      headers: req.headers
    }));
  } else {
    console.log('🧪 Non-POST request, responding immediately');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, method: req.method }));
  }
});
