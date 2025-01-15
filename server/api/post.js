WebApp.connectHandlers.use('/api/post', async (req, res) => {

  const { seo_url } = req.query;

  if (!seo_url) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'SEO URL is required.' }));
    return;
  }

  try {
    const post = await Posts.findOneAsync({ seo_url });

    if (!post) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Post not found.' }));
      return;
    }

    const userMeta = await UserMeta.findOneAsync({ owner_userid: post.author_id });

    const postWithAuthor = {
      ...post,
      author: {
        username: userMeta?.username || 'Unknown User',
        avatar_url: userMeta?.avatar_url || null,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(postWithAuthor));
  } catch (error) {
    console.error('Error fetching post:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});
