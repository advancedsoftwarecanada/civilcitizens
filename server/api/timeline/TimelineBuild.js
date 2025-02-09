export default class TimelineBuild {
    constructor(self) {
        this.self = self; // Reference to the main instance (if needed)
    }

    /**
     * Builds a timeline based on the provided request body.
     * @param {Object} bodyRequest - The request body containing parameters for the timeline.
     * @returns {Promise<Array>} - A promise resolving to an array of posts with metadata.
     */
    async build(buildType, userId, searchProvince, searchChamber) {
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
            
                // Fetch user's home Chamber
                const userHomeChamber = userMeta.chamberHome;
            
                // Fetch all followed Chambers, INCLUDING the home Chamber
                const followedChambers = await ChamberFollows.find({ userId: userId }).fetch();
                const followedChamberIds = followedChambers.map(c => c.chamber);
            
                // Placeholder: Future connections list (for now it's empty)
                const userConnections = []; // In the future, this will contain user IDs
            
                // Fetch user's own posts
                const myPosts = await Posts.find(
                    { authorId: userId },
                    { sort: { createdAt: -1 }, limit: 3 }
                ).fetch();
            
                // Fetch posts from all followed Chambers (including home Chamber)
                const chamberPosts = await Posts.find(
                    { chamberId: { $in: followedChamberIds } },
                    { sort: { createdAt: -1 }, limit: 6 } // Adjusted to allow more variety
                ).fetch();
            
                // Merge all posts
                const seenPosts = new Set();
                let uniquePosts = [...myPosts, ...chamberPosts]
                    .filter(post => {
                        // Remove duplicates
                        if (seenPosts.has(post._id)) return false;
                        seenPosts.add(post._id);
            
                        // Handle "self" posts:
                        if (post.type === "self" && post.authorId !== userId) {
                            return false; // Only include if it's the user's own post (Connections feature coming later)
                        }
            
                        return true; // Keep valid post
                    })
                    .sort((a, b) => b.createdAt - a.createdAt) // Sort by newest first
                    .slice(0, 7); // Ensure max 7 posts
            
                // Enrich posts with user metadata
                enrichedPosts = await Promise.all(
                    uniquePosts.map(async (post) => {
                        const authorMeta = await UserMeta.findOneAsync({ ownerUserId: post.authorId });
                        return {
                            ...post,
                            author: {
                                userName: authorMeta?.userName || 'Unknown User',
                                avatarUrl: authorMeta?.avatarUrl || null,
                            },
                        };
                    })
                );
            }
            
            
            
            

            // CHAMBER NEWS FEED
            // =======================
            if( buildType === "chamber" ) {
                console.log(">>>>>> BUILDING CHAMBER NEWS FEED <<<<<<<<");

                const posts = await Posts.find({ province: searchProvince, chamber: searchChamber}, { sort: { createdAt: -1 }, limit: 7 }).fetch();

                // Add user metadata to each post
                enrichedPosts = await Promise.all(
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

            }

            return enrichedPosts;

        } catch (error) {
            console.error("Error building timeline:", error);
            throw new Error("Failed to build timeline.");
        }
    }
}
