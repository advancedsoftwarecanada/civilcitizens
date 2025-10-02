// @ts-nocheck
/* global WebApp */
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
  const { type, uid, province, chamber, offset = 0, limit = 10, sort = 'latest', gov = 'all' } = req.query;
  const userId = uid;

  // Detect the timeline type
  const detectedTimelineType = TimelineInstance.timelineDetectType.detect(req.query);
  console.log('Detected Timeline type:', detectedTimelineType.type);

  try {
    let posts = [];

  // Fetch posts based on timeline type
  switch (detectedTimelineType.type) {
      case 'home':
        posts = await TimelineInstance.timelineBuild.build("home", userId, null, null, parseInt(offset), parseInt(limit), { sort, gov });
        break;

      case 'chamber':
        posts = await TimelineInstance.timelineBuild.build("chamber", userId, province, chamber, parseInt(offset), parseInt(limit), { sort, gov });
        break;

      case 'user': {
        // Username can be provided explicitly or parsed from path
        let username = req.query.username;
        if (!username && typeof req.query.path === 'string') {
          const m = req.query.path.match(/^\/u\/([^\/?#]+)/);
          if (m) username = m[1];
        }
  posts = await TimelineInstance.timelineBuild.build("user", userId, null, null, parseInt(offset), parseInt(limit), { username, sort, gov });
        break;
      }

      default:
        console.warn(`Unsupported timeline type: ${detectedTimelineType.type}`);
        // Fallback to home to avoid blocking UI on unknown types
        try {
          posts = await TimelineInstance.timelineBuild.build("home", userId, null, null, parseInt(offset), parseInt(limit), { sort, gov });
        } catch (e) {
          console.warn('Home fallback failed:', e?.message || e);
        }
        break;
    }

    const intOffset = parseInt(offset);
    const intLimit = parseInt(limit);

    // Insert a random ad into the posts (only for first page), but compute hasMore/offset based on real posts
    let adInserted = false;
    if (intOffset === 0) {
      const { randomAd, randomPosition } = TimelineInstance.timelineAds.generateAds();
      if (randomAd) {
        posts.splice(randomPosition, 0, randomAd);
        adInserted = true;
      }
    }

  // More permissive pagination: keep loading while server returns any real posts
  const realCount = adInserted ? Math.max(0, posts.length - 1) : posts.length;
  const hasMore = realCount > 0;

    // Next offset should advance by number of REAL posts delivered
    const nextOffset = intOffset + realCount;

    // Respond with the timeline
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      posts: posts,
      hasMore: hasMore,
      offset: nextOffset
    }));

  } catch (error) {

    // Errors
    console.error('Error fetching timeline:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});
