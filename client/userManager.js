class UserManager {
    constructor() {
        this.storageKey = 'UserManagerData';
        this.data = this.loadFromStorage();
        this.setupEventHandlers(); // Initialize event handlers
        this.startVoteCheckInterval(); // Start interval to check votes
    }

    loadFromStorage() {
        try {
            const storedData = localStorage.getItem(this.storageKey);
            return storedData ? JSON.parse(storedData) : { votes: {}, bookmarks: [] };
        } catch (error) {
            console.error('Error loading from local storage:', error);
            return { votes: {}, bookmarks: [] };
        }
    }

    saveToStorage() {
        try {
            console.log("UserManager SAVED");
            localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        } catch (error) {
            console.error('Error saving to local storage:', error);
        }
    }

    clearStorage(){
        console.log("Clearing storage");
        localStorage.removeItem(this.storageKey);
    }

    async fetchUserData() {
        try {
            // Validate if the user is logged in
            const user = Meteor.user();
            if (!user) {
                throw new Error('User is not logged in.');
            }

            // Load existing data from local storage (fallback if API fails)
            this.data = this.loadFromStorage();

            // API call to fetch the latest user data
            const token = localStorage.getItem('Meteor.loginToken');
            if (!token) {
                throw new Error('No login token found.');
            }

            const apiUrl = `${Meteor.settings.public.ROOT_URL}/api/user?id=${user._id}`;
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                const errorBody = await response.json();
                console.error('Error response from server:', errorBody);
                throw new Error(`Failed to fetch user data: ${response.statusText}`);
            }

            const userData = await response.json();
            console.log('Fetched user data:', userData);

            // Save the fetched data as the entire user object
            this.data = userData;

            // Persist to local storage
            this.saveToStorage();
            console.log('UserManager data successfully updated and saved.');
        } catch (error) {
            console.error('Error fetching user data:', error);

            // Fallback: Retain the local data if the API fails
            console.warn('Using locally cached user data.');
        }
    }



    getVotes() {
        return this.data.votes;
    }

    getVote(postId) {
        return this.data.votes[postId] || null;
    }

    addVote(postId, newVote) {
        console.log("ADDING VOTE: " + postId + " : " + newVote);
        this.data.votes[postId] = newVote;
    }

    removeVote(postId) {
        console.log("REMOVING VOTE: " + postId);
        delete this.data.votes[postId];
    }

    setupEventHandlers() {
        $(document).on('click', '.upvote-btn', async (event) => {
            console.log('Upvote clicked');
            const postId = $(event.target).closest('[data-post-id]').data('post-id');
            const success = await this.voteHttp(postId, 'upvote');
            if (success) {
                this.voteClient(postId, 'upvote');
            }
        });

        $(document).on('click', '.downvote-btn', async (event) => {
            console.log('Downvote clicked');
            const postId = $(event.target).closest('[data-post-id]').data('post-id');
            const success = await this.voteHttp(postId, 'downvote');
            if (success) {
                this.voteClient(postId, 'downvote');
            }
        });
    }

    async voteHttp(postId, newVote) {
        try {
            const token = localStorage.getItem('Meteor.loginToken');
            const previousVote = this.getVote(postId);
            const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action: newVote, post_id: postId }),
            });

            if (!response.ok) {
                const error = await response.json();
                console.error(`Error ${newVote} voting on post ${postId}:`, error);
                return false;
            }

            console.log(`HTTP Post ${postId} ${newVote} voted successfully.`);

            return true;
        } catch (error) {
            console.error(`Error ${newVote} voting on post ${postId}:`, error);
            return false;
        }
    }

    voteClient(postId, newVote) {
        console.log("CLIENT IS VOTING");
        const postElement = $(`[data-post-id="${postId}"]`);
        if (postElement.length) {
            const scoreElement = postElement.find('.score');
            if (scoreElement.length) {
                // Log the current user votes
                console.log("User votes are:");
                console.log(this.getVotes());

                let currentScore = parseInt(scoreElement.text(), 10) || 0;
                console.log("Initial currentScore:", currentScore);

                const previousVote = this.getVote(postId);
                console.log("Previous vote:", previousVote);
                console.log("Vote state:", newVote);

                // Remove active class from previous vote button
                if (previousVote) {
                    if (previousVote === 'upvote') {
                        postElement.find('.upvote-btn').removeClass('active');
                    } else {
                        postElement.find('.downvote-btn').removeClass('active');
                    }
                }

                if (previousVote) {
                    if (previousVote === newVote) {
                        // User is removing their vote
                        if (newVote === 'upvote') {
                            currentScore -= 1;
                        } else {
                            currentScore += 1;
                        }
                        this.removeVote(postId);
                    } else {
                        // User is switching their vote
                        if (newVote === 'upvote') {
                            currentScore += 2; // Remove downvote and add upvote
                        } else {
                            currentScore -= 2; // Remove upvote and add downvote
                        }
                        this.addVote(postId, newVote);
                    }
                } else {
                    // User is casting a new vote
                    if (newVote === 'upvote') {
                        currentScore += 1;
                    } else {
                        currentScore -= 1;
                    }
                    this.addVote(postId, newVote);
                }

                // Add active class to the new vote button
                if (newVote === 'upvote') {
                    postElement.find('.upvote-btn').addClass('active');
                } else {
                    postElement.find('.downvote-btn').addClass('active');
                }

                console.log("New currentScore:", currentScore);

                this.saveToStorage();

                // Update the score in the DOM
                scoreElement.text(currentScore);
            } else {
                console.warn(`Score element not found within post ${postId}`);
            }
        } else {
            console.warn(`Post element not found for postId: ${postId}`);
        }
    }

    startVoteCheckInterval() {
        setInterval(() => {
            this.updateVoteClasses();
        }, 500);
    }

    updateVoteClasses() {
        const votes = this.getVotes();
        for (const postId in votes) {
            const vote = votes[postId];
            const postElement = $(`[data-post-id="${postId}"]`);
            if (postElement.length) {
                const upvoteBtn = postElement.find('.upvote-btn');
                const downvoteBtn = postElement.find('.downvote-btn');

                upvoteBtn.removeClass('active');
                downvoteBtn.removeClass('active');

                if (vote === 'upvote' && !upvoteBtn.hasClass('active')) {
                    upvoteBtn.addClass('active');
                } else if (vote === 'downvote' && !downvoteBtn.hasClass('active')) {
                    downvoteBtn.addClass('active');
                }
            }
        }
    }

}

const userManager = new UserManager();
export default userManager;
