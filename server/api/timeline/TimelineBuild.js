// @ts-nocheck
/* global Posts, UserMeta, ChamberFollows */

export default class TimelineBuild {
    constructor(self) {
        this.self = self; // Reference to the main instance (if needed)
    }

    /**
     * Build a timeline
     * @param {('home'|'chamber'|'user')} buildType
     * @param {string} userId
     * @param {string|null} searchProvince
     * @param {string|null} searchChamber
     * @param {number} offset
     * @param {number} limit
     * @param {{username?: string}} options
     */
    async build(buildType, userId, searchProvince, searchChamber, offset = 0, limit = 10, options = {}) {
        console.log("=============== BUILDING TIMELINE ===============");

        try {

            let enrichedPosts = [];

            // If there is a user id

            // HOME TIMELINE
            // =======================
            // if( buildType === "home" ) {
            //     console.log(">>>>>> BUILDING HOME NEWS FEED <<<<<<<<");

            //     const posts = await Posts.find({}, { sort: { createdAt: -1 }, limit: 7 }).fetch();

                
            //     enrichedPosts = await Promise.all(
            //         posts.map(async (post) => {

            //             // Add user metadata to each post
            //             const userMeta = await UserMeta.findOneAsync({ ownerUserId: post.authorId });
            //             return {
            //                 ...post,
            //                 author: {
            //                     userName: userMeta?.userName || 'Unknown User',
            //                     avatarUrl: userMeta?.avatarUrl || null,
            //                 },
            //             };

            //         })
            //     );

            // }


            if (buildType === "home") {
                console.log(">>>>>> BUILDING HOME NEWS FEED FOR USER:", userId, "<<<<<<<<");

                // Fetch the userMeta from ownerUserId
                const userMeta = await UserMeta.findOneAsync({ ownerUserId: userId });

                // Get user's home chamber
                const userHomeChamber = userMeta?.chamberHome;

                // Fetch all followed Chambers
                const followedChambers = await ChamberFollows.find({ userId: userId }).fetch();
                const followedChamberIds = followedChambers.map(c => c.chamber);

                // Always include user's home chamber in the feed (if they have one)
                if (userHomeChamber && !followedChamberIds.includes(userHomeChamber)) {
                    followedChamberIds.push(userHomeChamber);
                }

                console.log("User home chamber:", userHomeChamber);
                console.log("Followed chambers:", followedChamberIds);

                // Fetch user's own posts (self posts - like blog posts, visible to all)
                const mySelfPosts = await Posts.find(
                    { authorId: userId, type: "self", draft: false },
                    { sort: { createdAt: -1 }, skip: offset, limit: Math.ceil(limit / 3) }
                ).fetch();

                // Fetch posts from user's home chamber (if they have one)
                let homeChamberPosts = [];
                if (userHomeChamber) {
                    homeChamberPosts = await Posts.find(
                        { province: userMeta?.province, chamber: userHomeChamber, type: 'chamber', draft: false },
                        { sort: { createdAt: -1 }, skip: offset, limit: Math.ceil(limit / 3) }
                    ).fetch();
                }

                // Fetch posts from all followed Chambers
                const followedChamberPosts = await Posts.find(
                    { chamber: { $in: followedChamberIds }, type: 'chamber', draft: false },
                    { sort: { createdAt: -1 }, skip: offset, limit: Math.ceil(limit / 3) }
                ).fetch();

                // Merge all posts and remove duplicates
                const seenPosts = new Set();
                let allPosts = [...mySelfPosts, ...homeChamberPosts, ...followedChamberPosts];

                let uniquePosts = allPosts
                    .filter(post => {
                        // Remove duplicates
                        if (seenPosts.has(post._id)) return false;
                        seenPosts.add(post._id);
                        return true;
                    })
                    .sort((a, b) => b.createdAt - a.createdAt) // Sort by newest first
                    .slice(0, limit); // Ensure max limit posts

                console.log(`Timeline built: ${uniquePosts.length} posts (${mySelfPosts.length} self, ${homeChamberPosts.length} home, ${followedChamberPosts.length} followed)`);

                // Enrich posts with user metadata
                enrichedPosts = await Promise.all(
                    uniquePosts.map(async (post) => {
                        const authorMeta = await UserMeta.findOneAsync({ ownerUserId: post.authorId });
                        return {
                            ...post,
                            commentCount: typeof post.commentCount === 'number' ? post.commentCount : 0,
                            author: {
                                userName: authorMeta?.userName || 'Unknown User',
                                avatarUrl: authorMeta?.avatarUrl || null,
                                coverUrl: authorMeta?.coverUrl || null,
                            },
                            images: post.images || [],
                            attachments: post.attachments || null,
                        };
                    })
                );
            }
            
            
            
            

            // CHAMBER NEWS FEED
            // =======================
            if( buildType === "chamber" ) {
                console.log(">>>>>> BUILDING CHAMBER NEWS FEED FOR:", searchProvince, "/", searchChamber, "<<<<<<<");

                const posts = await Posts.find({
                    province: searchProvince,
                    chamber: searchChamber,
                    type: 'chamber',
                    draft: false
                }, {
                    sort: { createdAt: -1 },
                    skip: offset,
                    limit: limit
                }).fetch();

                console.log(`Found ${posts.length} posts in chamber ${searchProvince}/${searchChamber}`);

                // Add user metadata to each post
                enrichedPosts = await Promise.all(
                    posts.map(async (post) => {
                        const userMeta = await UserMeta.findOneAsync({ ownerUserId: post.authorId });
                        return {
                            ...post,
                            commentCount: typeof post.commentCount === 'number' ? post.commentCount : 0,
                            author: {
                                userName: userMeta?.userName || 'Unknown User',
                                avatarUrl: userMeta?.avatarUrl || null,
                                coverUrl: userMeta?.coverUrl || null,
                            },
                            images: post.images || [],
                            attachments: post.attachments || null,
                        };
                    })
                );
            }

            // USER NEWS FEED
            // =======================
            if (buildType === 'user') {
                const username = options && options.username ? options.username : null;
                console.log(">>>>>> BUILDING USER NEWS FEED FOR:", username, "<<<<<<");

                if (!username) {
                    return [];
                }

                // Find the user by username in UserMeta (case-insensitive) and handle duplicates
                const metas = await UserMeta.find({ userName: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).fetchAsync();
                if (!metas || metas.length === 0) {
                    console.log('User not found for username:', username);
                    return [];
                }
                const targetMeta = metas.find(m => !!m.avatarUrl || !!m.coverUrl) ||
                                   metas.slice().sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0))[0] ||
                                   metas[0];

                const posts = await Posts.find({ authorId: targetMeta.ownerUserId, draft: false }, {
                    sort: { createdAt: -1 },
                    skip: offset,
                    limit: limit,
                }).fetch();

                enrichedPosts = await Promise.all(posts.map(async (post) => {
                    const authorMeta = targetMeta; // same user
                    return {
                        ...post,
                        commentCount: typeof post.commentCount === 'number' ? post.commentCount : 0,
                        author: {
                            userName: authorMeta?.userName || 'Unknown User',
                            avatarUrl: authorMeta?.avatarUrl || null,
                            coverUrl: authorMeta?.coverUrl || null,
                        },
                        images: post.images || [],
                        attachments: post.attachments || null,
                    };
                }));
            }

            return enrichedPosts;

        } catch (error) {
            console.error("Error building timeline:", error);
            throw new Error("Failed to build timeline.");
        }
    }
}
