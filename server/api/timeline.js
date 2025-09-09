import TimelineAds from '/server/api/timeline/TimelineAds.js';
import TimelineDetectType from '/server/api/timeline/TimelineDetectType.js';
import TimelineBuild from '/server/api/timeline/TimelineBuild.js';

class Timeline {
  constructor() {
    this.cdn = Meteor.settings.public.cdnPath;
    this.timelineAds = new TimelineAds(this);
    this.timelineDetectType = new TimelineDetectType(this);
    this.timelineBuild = new TimelineBuild(this);
  }

  // Example of a base method
  log(message) {
    console.log(`[Self]: ${message}`);
  }
}

export const TimelineInstance = new Timeline();

TimelineInstance.log('Timeline instance created');

WebApp.connectHandlers.use('/api/timeline', async (req, res) => {
  const { type, uid, province, chamber, offset = 0, limit = 10 } = req.query;
  const userId = uid;

  // Detect the timeline type
  const detectedTimelineType = TimelineInstance.timelineDetectType.detect(req.query);
  console.log('Detected Timeline type:', detectedTimelineType.type);

  try {
    let posts = [];

    // Fetch posts based on timeline type
    switch (detectedTimelineType.type) {
      case 'home':
        posts = await TimelineInstance.timelineBuild.build("home", userId, null, null, parseInt(offset), parseInt(limit));
        break;

      case 'chamber':
        posts = await TimelineInstance.timelineBuild.build("chamber", userId, province, chamber, parseInt(offset), parseInt(limit));
        break;

      default:
        console.warn(`Unsupported timeline type: ${detectedTimelineType.type}`);
        break;
    }

    // Insert a random ad into the posts (only for first page)
    if (parseInt(offset) === 0) {
      const { randomAd, randomPosition } = TimelineInstance.timelineAds.generateAds();
      if (randomAd) {
        posts.splice(randomPosition, 0, randomAd);
      }
    }

    // Check if there are more posts available
    const hasMore = posts.length === parseInt(limit);

    // Respond with the timeline
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      posts: posts,
      hasMore: hasMore,
      offset: parseInt(offset) + posts.length
    }));

  } catch (error) {

    // Errors
    console.error('Error fetching timeline:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});
