WebApp.connectHandlers.use('/api/timeline', async (req, res) => {

  const cdn = Meteor.settings.public.cdnPath

  const { type, province, chamber } = req.query;

  console.log('Province:', province);
  console.log('Chamber:', chamber);

  if (!type) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Timeline type is required.' }));
    return;
  }

  try {
    let posts;
    if (type === 'my_timeline') {
      // Fetch up to 7 posts
      posts = await Posts.find({}, { sort: { createdAt: -1 }, limit: 7 }).fetch();

      // Fetch user metadata for each post
      posts = await Promise.all(
        posts.map(async (post) => {
          const userMeta = await UserMeta.findOneAsync({ ownerUserId: post.authorId });

          return {
            ...post,
            author: {
              userName: userMeta?.userName || 'Unknown User',
              avatarUrl: userMeta?.avatarUrl || null,
            },
          };
        })
      );
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid timeline type.' }));
      return;
    }

    // console.log(posts);

    // Array of ads
    const ads = [
      {
        _id: 'economic-charter',
        title: null,
        body: 'The Canadian Economic Charter of Rights and Responsibilities empowers Canadians to embrace economic growth while balancing social and environmental responsibilities. Together, let us make sustainable and impactful decisions for a brighter, shared future.',
        chamber: null,
        image: cdn + '/uploads/disk1/economic-charter-rect.jpg',
        createdAt: Date.now(), // Current timestamp
        author: {
          userName: 'economiccharter',
          avatarUrl: cdn + '/uploads/disk1/economic-charter-avatar.jpg',
          firstName: null,
          lastName: null,
        },
        ad: true,
        url: "https://economiccharter.ca",
      },
      {
        _id: 'guhaway',
        title: null,
        body: 'GUHAWAY offers innovative solutions to redefine sustainable living. From eco-friendly designs to smart, renewable energy systems, we are committed to creating homes that are in harmony with nature. Step into a future that prioritizes both comfort and the environment.',
        chamber: null,
        image: cdn + '/uploads/disk1/guhaway-rect.jpg',
        createdAt: Date.now(),
        author: {
          userName: 'guhaway',
          avatarUrl: cdn + '/uploads/disk1/guhaway-avatar.jpg',
          firstName: null,
          lastName: null,
        },
        ad: true,
        url: "https://www.guhahway.com/",
      },
      {
        _id: 'elby-bikes',
        title: null,
        body: 'Elby Bikes brings you the joy of cycling combined with cutting-edge technology. Our electric bikes offer unmatched convenience, comfort, and freedom. Whether commuting to work or exploring scenic trails, Elby Bikes are designed for a smooth and eco-conscious ride.',
        chamber: null,
        image: cdn + '/uploads/disk1/elby-rect.jpg',
        createdAt: Date.now(),
        author: {
          userName: 'elbybikes',
          avatarUrl: cdn + '/uploads/disk1/elby-bikes-avatar.jpg',
          firstName: null,
          lastName: null,
        },
        ad: true,
        url: "https://elbymobility.com/",
      },
      {
        _id: 'sarit-mobility',
        title: null,
        body: 'SARIT revolutionizes urban mobility with compact, eco-friendly vehicles designed for modern city living. Experience the perfect blend of convenience, sustainability, and innovation. Join the SARIT movement and redefine how you travel through the urban landscape.',
        chamber: null,
        image: cdn + '/uploads/disk1/sarit-rect.jpg',
        createdAt: Date.now(),
        author: {
          userName: 'saritmobility',
          avatarUrl: cdn + '/uploads/disk1/sarit-mobility-avatar.jpg',
          firstName: null,
          lastName: null,
        },
        ad: true,
        url: "https://saritmobility.com",
      },
      {
        _id: 'franks-organic-garden',
        title: null,
        body: "Frank's Organic Garden provides fresh, organic produce straight from our farms to your table. Discover the benefits of wholesome, sustainable agriculture. By choosing Frank's, you're supporting local farmers and a healthier lifestyle for yourself and your loved ones.",
        chamber: null,
        image: cdn + '/uploads/disk1/organic-garden-rect.jpg',
        createdAt: Date.now(),
        author: {
          userName: 'organicgarden',
          avatarUrl: cdn + '/uploads/disk1/organic-garden-avatar.jpg',
          firstName: null,
          lastName: null,
        },
        ad: true,
        url: "https://franksorganicgarden.com",
      },
      {
        _id: 'stronach-academy',
        title: null,
        body: 'The Stronach Academy is dedicated to empowering future leaders with innovative education and hands-on learning experiences. Join us to unlock your potential and shape a brighter tomorrow. Together, we can pave the way for transformative growth and success.',
        chamber: null,
        image: cdn + '/uploads/disk1/academy-rect.jpg',
        createdAt: Date.now(),
        author: {
          userName: 'stronachacademy',
          avatarUrl: cdn + '/uploads/disk1/academy-avatar.jpg',
          firstName: null,
          lastName: null,
        },
        ad: true,
        url: "https://stronachinternational.com",
      },
    ];

    // Select one random ad
    const randomAd = ads[Math.floor(Math.random() * ads.length)];

    // Generate a random position between 1, 2, and 3
    const randomPosition = Math.floor(Math.random() * 3) + 1;

    // Insert the random ad into the posts array at the random position
    posts.splice(randomPosition, 0, randomAd);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(posts));
  } catch (error) {
    console.error('Error fetching timeline:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});
