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
