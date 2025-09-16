// @ts-nocheck
/* global Meteor, Tracker, ReactiveVar, Session, FlowRouter, BlazeLayout, Template, $, toastr, indexedDB, localStorage, window */

class UserManager {
    constructor() {
        this.dbName = 'UserManagerDB';
        this.storeName = 'userManagerData';
        this.db = null;
    this.data = { chambers: {}, votes: {}, bookmarks: [], chamberFollows: [], userFollowing: [] }; // Default structure
        this.reactiveData = new Tracker.Dependency(); // Add a Tracker dependency
        this.isDataReady = false;
        this.thisChamber = new ReactiveVar(null); // Add a reactive variable for the current chamber
    this._handlersBound = false; // ensure we only bind once
    this._requestsInFlight = {}; // prevent rapid double-clicks

        console.log("Loaded: User Manager (Constructor)");
        this.initialize(); // Centralized initialization
    }


    // =============
    //
    // SETUP 
    //
    // =============

    async initialize() {
        try {
            console.log('🚀 UserManager initialization started');
            await this.initDatabase();
            await this.loadFromStorage(); // Only load data after DB is ready
            this.setupEventHandlers(); // Initialize event handlers

            // Ensure draft post exists immediately after initialization
            console.log('📝 Ensuring draft post exists...');
            await this.ensureDraftPost();

            this.DOMRENDER();
            console.log('✅ UserManager initialization completed');
        } catch (error) {
            console.error('❌ Error initializing UserManager:', error);
        }
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            // Create the object store if the database is being initialized for the first time
            request.onupgradeneeded = (event) => {
                const target = /** @type {any} */ (event.target);
                const db = target.result;
                db.createObjectStore(this.storeName, { keyPath: 'id' });
            };

            request.onsuccess = (event) => {
                const target = /** @type {any} */ (event.target);
                this.db = target.result;
                console.log('IndexedDB initialized.');
                this.loadFromStorage();
                resolve();
            };

            request.onerror = (event) => {
                const target = /** @type {any} */ (event.target);
                console.error('Error initializing IndexedDB:', target.error);
                reject(target.error);
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

    // Convenience: check if current user follows a specific userId or username
    isFollowingUser({ userId = null, userName = null }) {
        const list = this.data.userFollowing || [];
        if (userId) return list.some(u => u.userId === userId);
        if (userName) return list.some(u => (u.userName || '').toLowerCase() === String(userName).toLowerCase());
        return false;
    }

    // Update following cache after an action
    addFollowingUser(entry) {
        const list = this.data.userFollowing || [];
        const exists = list.some(u => u.userId === entry.userId);
        if (!exists) {
            this.data.userFollowing = [...list, entry];
            this.saveToStorage();
            this.reactiveData.changed();
        }
    }
    removeFollowingUser(userId) {
        const list = this.data.userFollowing || [];
        const next = list.filter(u => u.userId !== userId);
        this.data.userFollowing = next;
        this.saveToStorage();
        this.reactiveData.changed();
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
            this.data = { chambers: {}, votes: {}, bookmarks: [], chamberFollows: [] }; // Reset structure
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





    // =============
    //
    // FETCH USER DATA 
    //
    // =============
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

            // Prefer relative URL to avoid mismatches with ROOT_URL and ensure same-origin cookies/headers
            const apiUrl = `/api/user?id=${user._id}`;
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




    // =============
    //
    // UNIVERSAL EVENT HANDLING
    //
    // =============
    setupEventHandlers() {
        if (this._handlersBound) return;

        // Use namespaced events and clear any existing ones from hot reloads
        $(document)
            .off('click.userManagerUpvote')
            .on('click.userManagerUpvote', '.upvote-btn', this.handleUpvoteClick.bind(this));

        $(document)
            .off('click.userManagerDownvote')
            .on('click.userManagerDownvote', '.downvote-btn', this.handleDownvoteClick.bind(this));

        $(document)
            .off('click.userManagerFollow')
            .on('click.userManagerFollow', '.follow-btn', this.handleFollowClick.bind(this));

        $(document)
            .off('click.userManagerUnfollow')
            .on('click.userManagerUnfollow', '.unfollow-btn', this.handleUnfollowClick.bind(this));

        this._handlersBound = true;
    }




    // =============
    //
    // DOMRENDER 
    //
    // =============
    //     
    DOMRENDER() {
        setInterval(() => {
            this.updateVoteClasses();
            this.updateChamberClasses();
        }, 1000);
    }



    // =============
    //
    // VOTING 
    //
    // =============

    
    async handleUpvoteClick(event) {
        console.log('Upvote clicked');
        const token = localStorage.getItem('Meteor.loginToken');
        if (!token) {
            try { toastr && toastr.info('Please log in to vote.'); } catch(e){}
            return;
        }
        const postId = $(event.target).closest('[data-post-id]').data('post-id');
        console.log("POST ID: " + postId);
        const success = await this.voteHttp(postId, 'upvote');
        if (success) {
            this.voteClient(postId, 'upvote');
        }
    }

    async handleDownvoteClick(event) {
        console.log('Downvote clicked');
        const token = localStorage.getItem('Meteor.loginToken');
        if (!token) {
            try { toastr && toastr.info('Please log in to vote.'); } catch(e){}
            return;
        }
        const postId = $(event.target).closest('[data-post-id]').data('post-id');
        const success = await this.voteHttp(postId, 'downvote');
        if (success) {
            this.voteClient(postId, 'downvote');
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

            console.log(`HTTP Post ${postId} ${newVote}🧪 POST request detected, setting up body parsi voted successfully.`);

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

    updateVoteClasses() {
        const votes = this.getVotes() || {};
        const list = Array.isArray(votes)
            ? votes
            : Object.keys(votes).map((postId) => ({ postId, vote: votes[postId] }));
        list.forEach((vote) => {
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



    // =============
    //
    // DRAFT POST MANAGEMENT
    //
    // =============

    async ensureDraftPost() {
        try {
            console.log('🔍 ensureDraftPost called');
            console.log('Current data.draftPostId:', this.data.draftPostId);

            // Check if we already have a draft post ID stored
            if (this.data.draftPostId) {
                console.log('✅ Draft post already exists:', this.data.draftPostId);
                Session.set('draftPostId', this.data.draftPostId);
                return this.data.draftPostId;
            }else{
                console.log('❌ No draft post ID found in data. Proceeding to create one.');
            }

            // First test the simple endpoint
            console.log('🧪 Testing simple endpoint first...');
            console.log('🧪 Current window location:', window.location.href);
            console.log('🧪 Fetching from URL:', '/api/test');

            // First test the simple ping endpoint
            console.log('🏓 Testing ping endpoint...');
            try {
                const pingResponse = await fetch('/ping');
                const pingText = await pingResponse.text();
                console.log('🏓 Ping response:', pingText);
            } catch (pingError) {
                console.error('🏓 Ping failed:', pingError);
            }

            // Try with absolute URL first
            const baseUrl = window.location.origin;
            const testUrl = `${baseUrl}/api/test`;
            console.log('🧪 Trying absolute URL:', testUrl);

            try {
                const testResponse = await fetch(testUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ test: 'data' }),
                });
                const testResult = await testResponse.json();
                console.log('🧪 Test endpoint result:', testResult);
            } catch (testError) {
                console.error('🧪 Test endpoint failed with absolute URL:', testError);
                console.error('🧪 Error details:', {
                    message: testError.message,
                    stack: testError.stack
                });

                // Try with relative URL as fallback
                console.log('🧪 Trying relative URL as fallback...');
                try {
                    const fallbackResponse = await fetch('/api/test', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ test: 'data' }),
                    });
                    const fallbackResult = await fallbackResponse.json();
                    console.log('🧪 Fallback test endpoint result:', fallbackResult);
                } catch (fallbackError) {
                    console.error('🧪 Fallback also failed:', fallbackError);
                }
            }

            // Check if user has an existing draft post in the database
            const token = localStorage.getItem('Meteor.loginToken');
            console.log('🔑 Login token available:', !!token);

            if (!token) {
                console.error('❌ No login token found for draft post creation');
                return null;
            }

            console.log('📡 Making API call to create draft post...');

            const requestData = {
                type: 'self', // Default to self post
                title: null,
                body: '',
                chamber: null,
                province: null,
                topic: null,
                attachments: null,
                draft: true
            };

            console.log('📡 Request data:', requestData);
            console.log('📡 Request JSON:', JSON.stringify(requestData));
            console.log('📡 Request JSON length:', JSON.stringify(requestData).length);

            const response = await fetch('/api/posts/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(requestData),
            });

            console.log('📡 Fetch response status:', response.status);
            console.log('📡 Fetch response ok:', response.ok);

            console.log('📡 API response status:', response.status);

            const result = await response.json();
            console.log('📡 API response:', result);

            if (result.status === 'success') {
                console.log('✅ Draft post created:', result.postId);
                this.data.draftPostId = result.postId;
                this.saveToStorage();
                Session.set('draftPostId', result.postId);
                return result.postId;
            } else {
                console.error('❌ Failed to create draft post:', result.error);
                return null;
            }
        } catch (error) {
            console.error('❌ Error ensuring draft post:', error);
            return null;
        }
    }

    getDraftPostId() {
        return this.data.draftPostId || Session.get('draftPostId');
    }

    clearDraftPost() {
        this.data.draftPostId = null;
        Session.set('draftPostId', null);
        this.saveToStorage();
    }
    async handleFollowClick(event) {
        const token = localStorage.getItem('Meteor.loginToken');
        if (!token) {
            try { toastr && toastr.info('Please log in to follow chambers.'); } catch(e){}
            return;
        }
        const province = FlowRouter.getParam('province');
        const chamber = FlowRouter.getParam('chamber');

        const key = `${province}/${chamber}`;
        if (this._requestsInFlight[key]) return; // prevent double-click

        // Avoid duplicate follows client-side
        const follows = this.data.chamberFollows || [];
        const already = follows.some(c => c.province === province && c.chamber === chamber);
        if (already) {
            toastr.info('Already following this chamber.');
            return;
        }

        try {
            this._requestsInFlight[key] = true;

        const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ 
                    action: 'follow', 
                    province, 
                    chamber 
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('Error following chamber:', error);
                throw new Error('Failed to follow chamber');
            }

            toastr.success('You will see this on your news feed.', 'Following');
            console.log('Chamber followed successfully:', await response.json());

            // Update local follows without duplicates
            this.data.chamberFollows = [
                ...follows,
                { province, chamber, following: true }
            ];
            this.saveToStorage();
            this.reactiveData.changed(); // Notify reactivity

        } catch (error) {
            console.error('Error following chamber:', error);
        } finally {
            delete this._requestsInFlight[key];
        }
    }

    async handleUnfollowClick(event) {
        const token = localStorage.getItem('Meteor.loginToken');
        if (!token) {
            try { toastr && toastr.info('Please log in to modify follows.'); } catch(e){}
            return;
        }
        const province = FlowRouter.getParam('province');
        const chamber = FlowRouter.getParam('chamber');

        const key = `${province}/${chamber}`;
        if (this._requestsInFlight[key]) return; // prevent double-click

        // If not following, do nothing
        const follows = this.data.chamberFollows || [];
        const isFollowing = follows.some(c => c.province === province && c.chamber === chamber);
        if (!isFollowing) return;

        try {
            this._requestsInFlight[key] = true;

        const response = await fetch('/api/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ 
                    action: 'unfollow', 
                    province, 
                    chamber 
                }),
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('Error unfollowing chamber:', error);
                throw new Error('Failed to unfollow chamber');
            }

            toastr.warning('You will not longer see this on your news feed', 'Unfollowed');
            console.log('Chamber unfollowed successfully:', await response.json());

            // Update follows and save
            this.data.chamberFollows = follows.filter((ch) => ch.province !== province || ch.chamber !== chamber);
            this.saveToStorage();
            this.reactiveData.changed(); // Notify reactivity

        } catch (error) {
            console.error('Error unfollowing chamber:', error);
        } finally {
            delete this._requestsInFlight[key];
        }
    }


    updateChamberClasses() {
        const chambers = this.getData().chamberFollows
        if(chambers){
            chambers.forEach((chamber) => {
                const chamberElement = $(`[data-chamber-id="${chamber.chamber}"]`);
                if (chamberElement.length) {
                    if (chamber.following) {
                        chamberElement.find('.follow-btn').addClass('active');
                        chamberElement.find('.unfollow-btn').removeClass('active');
                    } else {
                        chamberElement.find('.follow-btn').removeClass('active');
                        chamberElement.find('.unfollow-btn').addClass('active');
                    }
                }
            });
        }
    }



}
export default UserManager; // Export the class; instance created in main.js
