WebApp.connectHandlers.use('/api/comments', async (req, res) => {

  console.log("NEW COMMENT");

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
    return;
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const { postId, userId, comment } = JSON.parse(body);

      if (!postId || !userId || !comment) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Post ID, User ID, and comment are required.' }));
        return;
      }

      const newComment = {
        postId,
        userId,
        comment,
        createdAt: new Date().getTime(),
      };

      await Comments.insertAsync(newComment);

      // Update the post's comment count
      await Posts.updateAsync({ _id: postId }, { $inc: { comment_count: 1 } });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, comment: newComment }));
    } catch (error) {
      console.error('Error saving comment:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error.' }));
    }
  });
});
