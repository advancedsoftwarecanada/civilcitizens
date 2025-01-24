export default class TimelineBuild {
    constructor(self) {
        this.self = self; // Reference to the main instance (if needed)
    }

    /**
     * Builds a timeline based on the provided request body.
     * @param {Object} bodyRequest - The request body containing parameters for the timeline.
     * @returns {Promise<Array>} - A promise resolving to an array of posts with metadata.
     */
    async build(buildType, searchProvince, searchChamber) {
        console.log("=============== BUILDING TIMELINE ===============");

        try {

            let enrichedPosts = [];

            // HOME TIMELINE
            if( buildType === "home" ) {
                console.log(">>>>>> BUILDING HOME TIMELINE <<<<<<<<");
                // Fetch posts (modify query based on `bodyRequest` if needed)
                const posts = await Posts.find({}, { sort: { createdAt: -1 }, limit: 7 }).fetch();

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

            if( buildType === "chamber" ) {
                console.log(">>>>>> BUILDING CHAMBER TIMELINE <<<<<<<<");
                // Fetch posts (modify query based on `bodyRequest` if needed)
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
