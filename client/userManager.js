class UserManager {
    constructor() {
        this.dbName = 'UserManagerDB';
        this.storeName = 'userManagerData';
        this.db = null;
        this.data = { votes: {}, bookmarks: [] }; // Default structure
        this.reactiveData = new Tracker.Dependency(); // Add a Tracker dependency
        this.isDataReady = false;

        console.log("Loaded: User Manager (Constructor)");
        this.initialize(); // Centralized initialization
    }

    async initialize() {
        try {
            await this.initDatabase();
            await this.loadFromStorage(); // Only load data after DB is ready
            this.setupEventHandlers(); // Initialize event handlers

            this.startVoteCheckInterval();

        } catch (error) {
            console.error('Error initializing UserManager:', error);
        }
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            // Create the object store if the database is being initialized for the first time
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore(this.storeName, { keyPath: 'id' });
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IndexedDB initialized.');
                this.loadFromStorage();
                resolve();
            };

            request.onerror = (event) => {
                console.error('Error initializing IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    isReady(){
        return this.isDataReady;
    }

    // Call this whenever `data` is updated
    setData(newData) {
        this.data = { ...this.data, ...newData };
        this.reactiveData.changed(); // Notify reactivity
    }

    getData() {
        this.reactiveData.depend(); // Register dependency
        return this.data;
    }

    async loadFromStorage() {
        try {
            const data = await this.getFromIndexedDB('userData');
            if (data) {
                console.log('Loaded data from IndexedDB:', data);
                this.data = data;
            } else {
                console.log('No data found in IndexedDB. Using default structure.');
            }
        } catch (error) {
            console.error('Error loading data from IndexedDB:', error);
        }
    }

    async saveToStorage() {
        try {
            await this.saveToIndexedDB('userData', this.data);
            console.log('Data saved to IndexedDB:', this.data);
        } catch (error) {
            console.error('Error saving data to IndexedDB:', error);
        }
    }

    async clearStorage() {
        try {
            await this.deleteFromIndexedDB('userData');
            this.data = { votes: {}, bookmarks: [] }; // Reset structure
            console.log('Cleared storage and reset data.');
        } catch (error) {
            console.error('Error clearing IndexedDB storage:', error);
        }
    }

    // IndexedDB operations
    async getFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.storeName, 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result?.data || null);
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async saveToIndexedDB(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put({ id: key, data: value });

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async deleteFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async fetchUserDataFromServer() {
        try {
            // Validate if the user is logged in
            const user = Meteor.user();
            if (!user) {
                throw new Error('User is not logged in.');
            }

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

            // Persist to IndexedDB
            await this.saveToStorage();
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
        this.saveToStorage();
    }

    removeVote(postId) {
        console.log("REMOVING VOTE: " + postId);
        delete this.data.votes[postId];
        this.saveToStorage();
    }

    setupEventHandlers() {
        $(document).on('click', '.upvote-btn', async (event) => {
            console.log('Upvote clicked');
            const postId = $(event.target).closest('[data-post-id]').data('post-id');
            console.log("POST ID: " + postId);
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
                body: JSON.stringify({ action: newVote, postId: postId }),
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
                // console.log("User votes are:");
                // console.log(this.getVotes());

                let currentScore = parseInt(scoreElement.text(), 10) || 0;
                // console.log("Initial currentScore:", currentScore);

                const previousVote = this.getVote(postId);
                // console.log("Previous vote:", previousVote);
                // console.log("Vote state:", newVote);

                postElement.find('.upvote-btn').removeClass('active');
                postElement.find('.downvote-btn').removeClass('active');

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

                // console.log("New currentScore:", currentScore);

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
        }, 1000);
    }

    updateVoteClasses() {
        const votes = this.getVotes();
        votes.forEach((vote) => {
            // console.log(vote);
            const postElement = $(`[data-post-id="${vote.postId}"]`);
            if (postElement.length) {

                // console.log("POST ELEMENT FOUND: " + vote.postId);
                const upvoteBtn = postElement.find('.upvote-btn');
                const downvoteBtn = postElement.find('.downvote-btn');

                if (vote.vote == 'upvote' ) {
                    upvoteBtn.addClass('active');
                }
                if (vote.vote == 'downvote' ) {
                    downvoteBtn.addClass('active');
                }
            }
        });
    }


}
const userManager = new UserManager();
export default UserManager; // Ensure this is the default export
window.userManager = userManager; // Expose globally for debugging
