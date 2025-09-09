import UserManager from './userManager.js';

// Instantiate UserManager
const userManager = new UserManager();
// Expose globally for modules that reference window.userManager
window["userManager"] = userManager;

/*
 * Client Startup
    * This is the main entry point for the client
*/
Meteor.startup(() => {
    console.log("==================================");
    console.log("CivilCitizens Client Connected");
    console.log("----------------------------------");
    window.userDataReady = false;

    // Reactive Tracker to handle user state and UserMeta logic
    let initializationStarted = false;
    let initializationCompleted = false;
    let logoutDetected = false;
    let logoutTimeout = null;

    Tracker.autorun(async () => {
        const user = Meteor.user(); // Reactively track the logged-in user
        const isLoggedIn = !!user; // Boolean to check if a user is logged in
        const hasLoginToken = !!localStorage.getItem('Meteor.loginToken');
        const isConnected = Meteor.status().connected;

        if (!isLoggedIn) {
            // Don't immediately redirect - check if this is a false positive
            if (hasLoginToken && isConnected && !logoutDetected) {
                console.log("User appears logged out but token exists - waiting to confirm...");
                console.log("Current Meteor.userId():", Meteor.userId());
                console.log("Login token length:", localStorage.getItem('Meteor.loginToken')?.length);

                // Set a timeout to check again in 3 seconds (increased from 2)
                if (logoutTimeout) clearTimeout(logoutTimeout);
                logoutTimeout = setTimeout(() => {
                    const stillLoggedOut = !Meteor.user();
                    const stillHasToken = !!localStorage.getItem('Meteor.loginToken');
                    const stillConnected = Meteor.status().connected;

                    console.log("Timeout check - still logged out:", stillLoggedOut, "still has token:", stillHasToken, "still connected:", stillConnected);

                    if (stillLoggedOut && stillHasToken && stillConnected) {
                        console.log("Confirmed logout after timeout - redirecting to home");
                        logoutDetected = true;
                        // Reset initialization flags when user logs out
                        initializationStarted = false;
                        initializationCompleted = false;
                        window.userDataReady = false;
                        FlowRouter.go('/');
                    } else if (!stillLoggedOut) {
                        console.log("False logout detected - user recovered");
                    } else {
                        console.log("Logout condition not met - keeping user logged in");
                    }
                }, 3000); // Increased to 3 seconds
                return; // Don't redirect yet
            } else if (!hasLoginToken || !isConnected) {
                console.log("User is not logged in. Redirecting to home...");
                console.log("Login token in localStorage:", hasLoginToken);
                console.log("Meteor.userId():", Meteor.userId());
                console.log("Connection status:", isConnected);
                logoutDetected = true;
                // Reset initialization flags when user logs out
                initializationStarted = false;
                initializationCompleted = false;
                window.userDataReady = false;
                FlowRouter.go('/');
                return; // Exit early if not logged in
            }
        } else {
            // User is logged in - clear any pending logout timeout
            if (logoutTimeout) {
                clearTimeout(logoutTimeout);
                logoutTimeout = null;
            }
            logoutDetected = false;
            // Only initialize once per session
            if (!initializationStarted && !initializationCompleted) {
                initializationStarted = true;
                console.log("User is logged in:", user);
                console.log("Initializing UserManager...");

                try {
                    await userManager.fetchUserDataFromServer(); // Fetch user data

                    // Ensure draft post exists
                    console.log("Ensuring draft post exists...");
                    await userManager.ensureDraftPost();

                    console.log("User Manager initialized and data fetched: ENABLE userDataReady");
                    window.userDataReady = true;
                    initializationCompleted = true;
                    console.log(userManager);

                    // Subscribe to user's files
                    Meteor.subscribe('files.user');
                } catch (error) {
                    console.error("Error during initialization:", error);
                    initializationStarted = false; // Allow retry on error
                }
            }
        }
    });

});


/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/', {
    name: "home",
    action() {
        if (Meteor.userId()) {

            const checkUserDataReady = setInterval(() => {
                if (window.userDataReady) {
                    clearInterval(checkUserDataReady);
                    BlazeLayout.render('CivilApp_3', {
                        main: 'timeline',
                    });
                }
            }, 100);


        } else {
            BlazeLayout.render('CivilApp_0', {
                main: 'guest',
            });
        }
    }
});

/*
 * CivilApp_0 layout rendered
*/
Template.CivilApp_0.onRendered(function () {
    renderEverywhere();
});

/*
 * CivilApp_3 layout rendered
*/
Template.CivilApp_3.onRendered(function () {
    renderEverywhere();
});

function renderEverywhere(){

    $('html, body').animate({
        scrollTop: 0
    }, 0);

    // Detect if <body> has a modal applied and remove it
    // This is a bug when coding, with hot module replace
    $('body').removeClass('modal-open modal-with-transition');
    // remove any <div class="modal-backdrop fade show"></div>
    $('.modal-backdrop').remove();

    // FILE UPLOADER
	$(document).on('change', '.fileUploader', function (event) {    // image upload

        // Skip if this is handled by specific submit form handlers
        if ($(this).is('#postImages, #postVideo')) {
            return;
        }

        // fetch this data-upload-type
        const uploadType = $(this).data('upload-type');
        const previewClass = $(this).data('upload-preview-class');
        console.log("UPLOADING: ", uploadType);

		// Access the file input using event.target
		const fileInput = event.target;
		const file = fileInput.files[0];

        // Extract the base name without the extension and the extension itself
		const baseName = file.name.replace(/\.\w+$/, '');
		const extension = file.name.split('.').pop();

        // Handle Preview
        if (file) {
            var reader = new FileReader();
            reader.onload = function(e) {
                console.log("THE PREVIEW CLASS", previewClass);

                $("."+previewClass).attr('src', e.target.result);
            };
            reader.readAsDataURL(file);
        }

		if (file) {

            console.log("STARTING UPLOAD");

			const formData = new FormData();
			formData.append('file', file);
			formData.append('type', uploadType);
			formData.append('processing', 'true');
			formData.append('timeCreated', String(Date.now()));
			formData.append('timeAgo', new Date().toISOString());

			// Include draft post ID if available
			const draftPostId = userManager.getDraftPostId();
			if (draftPostId) {
				formData.append('draftPostId', draftPostId);
			}

			// Use Fetch API instead of XMLHttpRequest to avoid Meteor connection issues
			const token = localStorage.getItem('Meteor.loginToken');
			console.log("Upload starting - token exists:", !!token, "user logged in:", !!Meteor.userId());
			fetch('/api/files/upload', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
				},
				body: formData,
			})
			.then(response => {
				console.log("UPLOAD END - General file uploader, response status:", response.status);
				console.log("User still logged in after upload:", !!Meteor.userId());
				if (response.ok) {
					return response.json();
				} else {
					throw new Error('Upload failed');
				}
			})
			.then(result => {
				console.log("Response:", result);
				// File uploaded, no need to update post here
			})
			.catch(error => {
				console.error('Upload error:', error);
				toastr.error('Error uploading file.');
			});
		}

	});


    // CORDOVA IN-APP-BROWSER
    let cordovaOpenOverride = false;
    let isOpening = false;

    if (!cordovaOpenOverride) {
        if (Meteor.isCordova) {
            // Override window.open to use InAppBrowser for Cordova
            window.open = (url) => {
                if (isOpening) return;
                isOpening = true;
                console.log("CORDOVA TRY TO OPEN: " + url);

                // Check if Cordova is on iOS platform
                if (Meteor.isCordova && cordova.platformId === 'ios') {
                    console.log("CORDOVA ON IOS AND READY TO OPEN");
                    // Open the URL using InAppBrowser
                    cordova.InAppBrowser.open(url, '_system', { location: 'yes' });
                } else {
                    console.log("CORDOVA NOT ON IOS AND READY TO OPEN: " + url);
                    // Open the URL in a new browser tab for non-iOS Cordova platforms
                    window.open(url, '_blank');
                }

                // Reset opening flag after a short timeout to avoid multiple triggers
                setTimeout(() => { isOpening = false; }, 1000);
            };
        } else {
            // Not Cordova, handle normal behavior
            console.log("IS NOT CORDOVA");
        }
        cordovaOpenOverride = true;
    }



}


// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //
// GLOBAL HELPERS
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //

/*
 * Check if the user is the owner of the post
 */
Template.registerHelper("isLoggedIn", function () {
    if(Meteor.userId() !== null) {
        return true;
    }
    return false;
});

// is Admin? Fetch userMeta.admin true/false
Template.registerHelper("isAdmin", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive
    if( userMeta.admin === true ) {
        return true;
    }
    return false;

});

// Get my user information from usermeta
Template.registerHelper("myUserMeta", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive

    // Return transformed user meta
    return {
        firstName: userMeta.firstName?.toLowerCase() || '',
        lastName: userMeta.lastName?.toLowerCase() || '',
        userName: userMeta.userName || '',
        avatarUrl: userMeta.avatarUrl || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
    };
});

// userMeta.chamberHomeSet
Template.registerHelper("chamberHomeSet", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    // Loop through each chamber to check if one is set as a home chamber
    for (const chamber of chambers) {
        if (chamber.home === true) {
            return true;
        }
    }
    return false;
});

// My Chambers
Template.registerHelper("myChambers", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return [];

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive

    // Sort chambers so `.home = true` comes first
    chambers.sort((a, b) => {
        if (a.home && !b.home) return -1; // `a` is home, `b` is not => `a` first
        if (!a.home && b.home) return 1;  // `b` is home, `a` is not => `b` first
        return 0; // No change in order for non-home chambers
    });

    console.log("Sorted MY CHAMBERS:", chambers);
    return chambers;
});

// Check if the current chamber is the user's home chamber
Template.registerHelper("isHomeChamber", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    const isChamberHome = chambers.some(c => c.province === province && c.chamber === chamber && c.home === true);
    console.log("IS HOME CHAMBER:", isChamberHome);
    return isChamberHome;
});

// Check if the user is following the current chamber
Template.registerHelper("isFollowing", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    return chambers.some(c => c.province === province && c.chamber === chamber);
});

Template.registerHelper("cdn", function () {
    return Meteor.settings.public.cdnPath;
});

// Nice Name (some-title-like-this) -> Some Title Like This
Template.registerHelper("niceName", function (text) {
    return text.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
});

// Time Ago helper
Template.registerHelper("timeAgo", function (timestamp) {
    if (!timestamp) return '';

    const now = new Date().getTime();
    const time = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diff = now - time;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    // For older posts, show the actual date
    const date = new Date(time);
    return date.toLocaleDateString();
});
/* global Meteor, Tracker, FlowRouter, BlazeLayout, Template, $, toastr, localStorage, window, cordova */
/* global Meteor, Tracker, FlowRouter, BlazeLayout, Template, $, toastr, localStorage, window, cordova */
import UserManager from './userManager.js';

// Instantiate UserManager
const userManager = new UserManager();
// Expose globally for modules that reference window.userManager
window['userManager'] = userManager;

/*
 * Client Startup
    * This is the main entry point for the client
*/
Meteor.startup(() => {
    console.log("==================================");
    console.log("CivilCitizens Client Connected");
    console.log("----------------------------------");
    window['userDataReady'] = false;

    // Reactive Tracker to handle user state and UserMeta logic
    let initializationStarted = false;
    let initializationCompleted = false;
    let logoutDetected = false;
    let logoutTimeout = null;

    Tracker.autorun(async () => {
        const user = Meteor.user(); // Reactively track the logged-in user
        const isLoggedIn = !!user; // Boolean to check if a user is logged in
        const hasLoginToken = !!localStorage.getItem('Meteor.loginToken');
        const isConnected = Meteor.status().connected;

        if (!isLoggedIn) {
            // Don't immediately redirect - check if this is a false positive
            if (hasLoginToken && isConnected && !logoutDetected) {
                console.log("User appears logged out but token exists - waiting to confirm...");
                console.log("Current Meteor.userId():", Meteor.userId());
                console.log("Login token length:", localStorage.getItem('Meteor.loginToken')?.length);

                // Set a timeout to check again in 3 seconds (increased from 2)
                if (logoutTimeout) clearTimeout(logoutTimeout);
                logoutTimeout = setTimeout(() => {
                    const stillLoggedOut = !Meteor.user();
                    const stillHasToken = !!localStorage.getItem('Meteor.loginToken');
                    const stillConnected = Meteor.status().connected;

                    console.log("Timeout check - still logged out:", stillLoggedOut, "still has token:", stillHasToken, "still connected:", stillConnected);

                    if (stillLoggedOut && stillHasToken && stillConnected) {
                        console.log("Confirmed logout after timeout - redirecting to home");
                        logoutDetected = true;
                        // Reset initialization flags when user logs out
                        initializationStarted = false;
                        initializationCompleted = false;
                        window['userDataReady'] = false;
                        FlowRouter.go('/');
                    } else if (!stillLoggedOut) {
                        console.log("False logout detected - user recovered");
                    } else {
                        console.log("Logout condition not met - keeping user logged in");
                    }
                }, 3000); // Increased to 3 seconds
                return; // Don't redirect yet
            } else if (!hasLoginToken || !isConnected) {
                console.log("User is not logged in. Redirecting to home...");
                console.log("Login token in localStorage:", hasLoginToken);
                console.log("Meteor.userId():", Meteor.userId());
                console.log("Connection status:", isConnected);
                logoutDetected = true;
                // Reset initialization flags when user logs out
                initializationStarted = false;
                initializationCompleted = false;
                window['userDataReady'] = false;
                FlowRouter.go('/');
                return; // Exit early if not logged in
            }
        } else {
            // User is logged in - clear any pending logout timeout
            if (logoutTimeout) {
                clearTimeout(logoutTimeout);
                logoutTimeout = null;
            }
            logoutDetected = false;
            // Only initialize once per session
            if (!initializationStarted && !initializationCompleted) {
                initializationStarted = true;
                console.log("User is logged in:", user);
                console.log("Initializing UserManager...");

                try {
                    await userManager.fetchUserDataFromServer(); // Fetch user data

                    // Ensure draft post exists
                    console.log("Ensuring draft post exists...");
                    await userManager.ensureDraftPost();

                    console.log("User Manager initialized and data fetched: ENABLE userDataReady");
                    window['userDataReady'] = true;
                    initializationCompleted = true;
                    console.log(userManager);

                    // Subscribe to user's files
                    Meteor.subscribe('files.user');
                } catch (error) {
                    console.error("Error during initialization:", error);
                    initializationStarted = false; // Allow retry on error
                }
            }
        }
    });

});


/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/', {
    name: "home",
    action() {
        if (Meteor.userId()) {

            const checkUserDataReady = setInterval(() => {
                if (window['userDataReady']) {
                    clearInterval(checkUserDataReady);
                    BlazeLayout.render('CivilApp_3', {
                        main: 'timeline',
                    });
                }
            }, 100);


        } else {
            BlazeLayout.render('CivilApp_0', {
                main: 'guest',
            });
        }
    }
});

/*
 * CivilApp_0 layout rendered
*/
Template.CivilApp_0.onRendered(function () {
    renderEverywhere();
});

/*
 * CivilApp_3 layout rendered
*/
Template.CivilApp_3.onRendered(function () {
    renderEverywhere();
});

function renderEverywhere(){

    $('html, body').animate({
        scrollTop: 0
    }, 0);

    // Detect if <body> has a modal applied and remove it
    // This is a bug when coding, with hot module replace
    $('body').removeClass('modal-open modal-with-transition');
    // remove any <div class="modal-backdrop fade show"></div>
    $('.modal-backdrop').remove();

    // FILE UPLOADER
	$(document).on('change', '.fileUploader', function (event) {    // image upload

        // Skip if this is handled by specific submit form handlers
        if ($(this).is('#postImages, #postVideo')) {
            return;
        }

        // fetch this data-upload-type
        const uploadType = $(this).data('upload-type');
        const previewClass = $(this).data('upload-preview-class');
        console.log("UPLOADING: ", uploadType);

		// Access the file input using event.target
		const fileInput = event.target;
		const file = fileInput.files[0];

        // Extract the base name without the extension and the extension itself
		const baseName = file.name.replace(/\.\w+$/, '');
		const extension = file.name.split('.').pop();

        // Handle Preview
        if (file) {
            var reader = new FileReader();
            reader.onload = function(e) {
                console.log("THE PREVIEW CLASS", previewClass);

                $("."+previewClass).attr('src', e.target.result);
            };
            reader.readAsDataURL(file);
        }

		if (file) {

            console.log("STARTING UPLOAD");

			const formData = new FormData();
			formData.append('file', file);
			formData.append('type', uploadType);
			formData.append('processing', 'true');
			formData.append('timeCreated', String(Date.now()));
			formData.append('timeAgo', new Date().toISOString());

			// Include draft post ID if available
			const draftPostId = userManager.getDraftPostId();
			if (draftPostId) {
				formData.append('draftPostId', draftPostId);
			}

			// Use Fetch API instead of XMLHttpRequest to avoid Meteor connection issues
			const token = localStorage.getItem('Meteor.loginToken');
			console.log("Upload starting - token exists:", !!token, "user logged in:", !!Meteor.userId());
			fetch('/api/files/upload', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
				},
				body: formData,
			})
			.then(response => {
				console.log("UPLOAD END - General file uploader, response status:", response.status);
				console.log("User still logged in after upload:", !!Meteor.userId());
				if (response.ok) {
					return response.json();
				} else {
					throw new Error('Upload failed');
				}
			})
			.then(result => {
				console.log("Response:", result);
				// File uploaded, no need to update post here
			})
			.catch(error => {
				console.error('Upload error:', error);
				toastr.error('Error uploading file.');
			});
		}

	});


    // CORDOVA IN-APP-BROWSER
    let cordovaOpenOverride = false;
    let isOpening = false;

    if (!cordovaOpenOverride) {
        if (Meteor.isCordova) {
            // Override window.open to use InAppBrowser for Cordova
            window.open = (url) => {
                if (isOpening) return;
                isOpening = true;
                console.log("CORDOVA TRY TO OPEN: " + url);

                // Check if Cordova is on iOS platform
                if (Meteor.isCordova && cordova.platformId === 'ios') {
                    console.log("CORDOVA ON IOS AND READY TO OPEN");
                    // Open the URL using InAppBrowser
                    cordova.InAppBrowser.open(url, '_system', { location: 'yes' });
                } else {
                    console.log("CORDOVA NOT ON IOS AND READY TO OPEN: " + url);
                    // Open the URL in a new browser tab for non-iOS Cordova platforms
                    window.open(url, '_blank');
                }

                // Reset opening flag after a short timeout to avoid multiple triggers
                setTimeout(() => { isOpening = false; }, 1000);
            };
        } else {
            // Not Cordova, handle normal behavior
            console.log("IS NOT CORDOVA");
        }
        cordovaOpenOverride = true;
    }



}


// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //
// GLOBAL HELPERS
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //

/*
 * Check if the user is the owner of the post
 */
Template.registerHelper("isLoggedIn", function () {
    if(Meteor.userId() !== null) {
        return true;
    }
    return false;
});

// is Admin? Fetch userMeta.admin true/false
Template.registerHelper("isAdmin", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive
    if( userMeta.admin === true ) {
        return true;
    }
    return false;

});

// Get my user information from usermeta
Template.registerHelper("myUserMeta", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive

    // Return transformed user meta
    return {
        firstName: userMeta.firstName?.toLowerCase() || '',
        lastName: userMeta.lastName?.toLowerCase() || '',
        userName: userMeta.userName || '',
        avatarUrl: userMeta.avatarUrl || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
    };
});

// userMeta.chamberHomeSet
Template.registerHelper("chamberHomeSet", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    // Loop through each chamber to check if one is set as a home chamber
    for (const chamber of chambers) {
        if (chamber.home === true) {
            return true;
        }
    }
    return false;
});

// My Chambers
Template.registerHelper("myChambers", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return [];

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive

    // Sort chambers so `.home = true` comes first
    chambers.sort((a, b) => {
        if (a.home && !b.home) return -1; // `a` is home, `b` is not => `a` first
        if (!a.home && b.home) return 1;  // `b` is home, `a` is not => `b` first
        return 0; // No change in order for non-home chambers
    });

    console.log("Sorted MY CHAMBERS:", chambers);
    return chambers;
});

// Check if the current chamber is the user's home chamber
Template.registerHelper("isHomeChamber", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    const isChamberHome = chambers.some(c => c.province === province && c.chamber === chamber && c.home === true);
    console.log("IS HOME CHAMBER:", isChamberHome);
    return isChamberHome;
});

// Check if the user is following the current chamber
Template.registerHelper("isFollowing", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    return chambers.some(c => c.province === province && c.chamber === chamber);
});

Template.registerHelper("cdn", function () {
    return Meteor.settings.public.cdnPath;
});

// Nice Name (some-title-like-this) -> Some Title Like This
Template.registerHelper("niceName", function (text) {
    return text.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
});

// Time Ago helper
Template.registerHelper("timeAgo", function (timestamp) {
    if (!timestamp) return '';

    const now = new Date().getTime();
    const time = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diff = now - time;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    // For older posts, show the actual date
    const date = new Date(time);
    return date.toLocaleDateString();
});

/* global Meteor, Tracker, FlowRouter, BlazeLayout, Template, $, toastr, localStorage, window, cordova */
import UserManager from './userManager.js';

// Instantiate UserManager
const userManager = new UserManager();
// Expose globally for modules that reference window.userManager
window["userManager"] = userManager;

/*
 * Client Startup
 * This is the main entry point for the client
*/
Meteor.startup(() => {
    console.log("==================================");
    console.log("CivilCitizens Client Connected");
    console.log("----------------------------------");
    window["userDataReady"] = false;

    // Reactive Tracker to handle user state and UserMeta logic
    let initializationStarted = false;
    let initializationCompleted = false;
    let logoutDetected = false;
    let logoutTimeout = null;

    Tracker.autorun(async () => {
        const user = Meteor.user(); // Reactively track the logged-in user
        const isLoggedIn = !!user; // Boolean to check if a user is logged in
        const hasLoginToken = !!localStorage.getItem('Meteor.loginToken');
        const isConnected = Meteor.status().connected;

        if (!isLoggedIn) {
            // Don't immediately redirect - check if this is a false positive
            if (hasLoginToken && isConnected && !logoutDetected) {
                console.log("User appears logged out but token exists - waiting to confirm...");
                console.log("Current Meteor.userId():", Meteor.userId());
                console.log("Login token length:", localStorage.getItem('Meteor.loginToken')?.length);

                // Set a timeout to check again in 3 seconds (increased from 2)
                if (logoutTimeout) clearTimeout(logoutTimeout);
                logoutTimeout = setTimeout(() => {
                    const stillLoggedOut = !Meteor.user();
                    const stillHasToken = !!localStorage.getItem('Meteor.loginToken');
                    const stillConnected = Meteor.status().connected;

                    console.log("Timeout check - still logged out:", stillLoggedOut, "still has token:", stillHasToken, "still connected:", stillConnected);

                    if (stillLoggedOut && stillHasToken && stillConnected) {
                        console.log("Confirmed logout after timeout - redirecting to home");
                        logoutDetected = true;
                        // Reset initialization flags when user logs out
                        initializationStarted = false;
                        initializationCompleted = false;
                        window["userDataReady"] = false;
                        FlowRouter.go('/');
                    } else if (!stillLoggedOut) {
                        console.log("False logout detected - user recovered");
                    } else {
                        console.log("Logout condition not met - keeping user logged in");
                    }
                }, 3000); // Increased to 3 seconds
                return; // Don't redirect yet
            } else if (!hasLoginToken || !isConnected) {
                console.log("User is not logged in. Redirecting to home...");
                console.log("Login token in localStorage:", hasLoginToken);
                console.log("Meteor.userId():", Meteor.userId());
                console.log("Connection status:", isConnected);
                logoutDetected = true;
                // Reset initialization flags when user logs out
                initializationStarted = false;
                initializationCompleted = false;
                window["userDataReady"] = false;
                FlowRouter.go('/');
                return; // Exit early if not logged in
            }
        } else {
            // User is logged in - clear any pending logout timeout
            if (logoutTimeout) {
                clearTimeout(logoutTimeout);
                logoutTimeout = null;
            }
            logoutDetected = false;
            // Only initialize once per session
            if (!initializationStarted && !initializationCompleted) {
                initializationStarted = true;
                console.log("User is logged in:", user);
                console.log("Initializing UserManager...");

                try {
                    await userManager.fetchUserDataFromServer(); // Fetch user data

                    // Ensure draft post exists
                    console.log("Ensuring draft post exists...");
                    await userManager.ensureDraftPost();

                    console.log("User Manager initialized and data fetched: ENABLE userDataReady");
                    window["userDataReady"] = true;
                    initializationCompleted = true;
                    console.log(userManager);

                    // Subscribe to user's files
                    Meteor.subscribe('files.user');
                } catch (error) {
                    console.error("Error during initialization:", error);
                    initializationStarted = false; // Allow retry on error
                }
            }
        }
    });

});


/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/', {
    name: "home",
    action() {
        if (Meteor.userId()) {

            const checkUserDataReady = setInterval(() => {
                if (window["userDataReady"]) {
                    clearInterval(checkUserDataReady);
                    BlazeLayout.render('CivilApp_3', {
                        main: 'timeline',
                    });
                }
            }, 100);


        } else {
            BlazeLayout.render('CivilApp_0', {
                main: 'guest',
            });
        }
    }
});

/*
 * CivilApp_0 layout rendered
*/
Template.CivilApp_0.onRendered(function () {
    renderEverywhere();
});

/*
 * CivilApp_3 layout rendered
*/
Template.CivilApp_3.onRendered(function () {
    renderEverywhere();
});

function renderEverywhere(){

    $('html, body').animate({
        scrollTop: 0
    }, 0);

    // Detect if <body> has a modal applied and remove it
    // This is a bug when coding, with hot module replace
    $('body').removeClass('modal-open modal-with-transition');
    // remove any <div class="modal-backdrop fade show"></div>
    $('.modal-backdrop').remove();

    // FILE UPLOADER
	$(document).on('change', '.fileUploader', function (event) {    // image upload

        // Skip if this is handled by specific submit form handlers
        if ($(this).is('#postImages, #postVideo')) {
            return;
        }

        // fetch this data-upload-type
        const uploadType = $(this).data('upload-type');
        const previewClass = $(this).data('upload-preview-class');
        console.log("UPLOADING: ", uploadType);

		// Access the file input using event.target
		const fileInput = event.target;
		const file = fileInput.files[0];

        // Extract the base name without the extension and the extension itself
		const baseName = file.name.replace(/\.\w+$/, '');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
		const extension = file.name.split('.').pop();

        // Handle Preview
        if (file) {
            var reader = new FileReader();
            reader.onload = function(e) {
                console.log("THE PREVIEW CLASS", previewClass);

                const result = e && e.target && typeof e.target.result === 'string' ? e.target.result : '';
                if (result) {
                    $("."+previewClass).attr('src', result);
                }
            };
            reader.readAsDataURL(file);
        }

		if (file) {

            console.log("STARTING UPLOAD");

			const formData = new FormData();
			formData.append('file', file);
			formData.append('type', uploadType);
			formData.append('processing', 'true');
			formData.append('timeCreated', String(Date.now()));
			formData.append('timeAgo', new Date().toISOString());

			// Include draft post ID if available
			const draftPostId = userManager.getDraftPostId();
			if (draftPostId) {
				formData.append('draftPostId', draftPostId);
			}

			// Use Fetch API instead of XMLHttpRequest to avoid Meteor connection issues
			const token = localStorage.getItem('Meteor.loginToken');
			console.log("Upload starting - token exists:", !!token, "user logged in:", !!Meteor.userId());
			fetch('/api/files/upload', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
				},
				body: formData,
			})
			.then(response => {
				console.log("UPLOAD END - General file uploader, response status:", response.status);
				console.log("User still logged in after upload:", !!Meteor.userId());
				if (response.ok) {
					return response.json();
				} else {
					throw new Error('Upload failed');
				}
			})
			.then(result => {
				console.log("Response:", result);
				// File uploaded, no need to update post here
			})
			.catch(error => {
				console.error('Upload error:', error);
				toastr.error('Error uploading file.');
			});
		}

	});


    // CORDOVA IN-APP-BROWSER
    let cordovaOpenOverride = false;
    let isOpening = false;

    if (!cordovaOpenOverride) {
        if (Meteor.isCordova) {
            // Preserve original open to avoid recursion
            const originalWindowOpen = window.open.bind(window);
            // Override window.open to use InAppBrowser for Cordova
            window.open = /** @type {any} */ ((url) => {
                if (isOpening) return window;
                isOpening = true;
                console.log("CORDOVA TRY TO OPEN: " + url);

                // Check if Cordova is on iOS platform
                if (Meteor.isCordova && cordova.platformId === 'ios') {
                    console.log("CORDOVA ON IOS AND READY TO OPEN");
                    // Open the URL using InAppBrowser
                    cordova.InAppBrowser.open(url, '_system', { location: 'yes' });
                } else {
                    console.log("CORDOVA NOT ON IOS AND READY TO OPEN: " + url);
                    // Open the URL in a new browser tab for non-iOS Cordova platforms
                    return originalWindowOpen(url, '_blank');
                }

                // Reset opening flag after a short timeout to avoid multiple triggers
                setTimeout(() => { isOpening = false; }, 1000);
                return window;
            });
        } else {
            // Not Cordova, handle normal behavior
            console.log("IS NOT CORDOVA");
        }
        cordovaOpenOverride = true;
    }



}


// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //
// GLOBAL HELPERS
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //

/*
 * Check if the user is the owner of the post
 */
Template.registerHelper("isLoggedIn", function () {
    if(Meteor.userId() !== null) {
        return true;
    }
    return false;
});

// is Admin? Fetch userMeta.admin true/false
Template.registerHelper("isAdmin", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive
    if( userMeta.admin === true ) {
        return true;
    }
    return false;

});

// Get my user information from usermeta
Template.registerHelper("myUserMeta", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive

    // Return transformed user meta
    return {
        firstName: userMeta.firstName?.toLowerCase() || '',
        lastName: userMeta.lastName?.toLowerCase() || '',
        userName: userMeta.userName || '',
        avatarUrl: userMeta.avatarUrl || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
    };
});

// userMeta.chamberHomeSet
Template.registerHelper("chamberHomeSet", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    // Loop through each chamber to check if one is set as a home chamber
    for (const chamber of chambers) {
        if (chamber.home === true) {
            return true;
        }
    }
    return false;
});

// My Chambers
Template.registerHelper("myChambers", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return [];

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive

    // Sort chambers so `.home = true` comes first
    chambers.sort((a, b) => {
        if (a.home && !b.home) return -1; // `a` is home, `b` is not => `a` first
        if (!a.home && b.home) return 1;  // `b` is home, `a` is not => `b` first
        return 0; // No change in order for non-home chambers
    });

    console.log("Sorted MY CHAMBERS:", chambers);
    return chambers;
});

// Check if the current chamber is the user's home chamber
Template.registerHelper("isHomeChamber", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    const isChamberHome = chambers.some(c => c.province === province && c.chamber === chamber && c.home === true);
    console.log("IS HOME CHAMBER:", isChamberHome);
    return isChamberHome;
});

// Check if the user is following the current chamber
Template.registerHelper("isFollowing", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    return chambers.some(c => c.province === province && c.chamber === chamber);
});

Template.registerHelper("cdn", function () {
    return Meteor.settings.public.cdnPath;
});

// Nice Name (some-title-like-this) -> Some Title Like This
Template.registerHelper("niceName", function (text) {
    return text.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
});

// Time Ago helper
Template.registerHelper("timeAgo", function (timestamp) {
    if (!timestamp) return '';

    const now = new Date().getTime();
    const time = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diff = now - time;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    // For older posts, show the actual date
    const date = new Date(time);
    return date.toLocaleDateString();
});

import UserManager from './userManager.js';

// Instantiate UserManager
const userManager = new UserManager();
// Expose globally for modules that reference window.userManager
window.userManager = userManager;

/*
 * Client Startup
    * This is the main entry point for the client
*/
Meteor.startup(() => {
    console.log("==================================");
    console.log("CivilCitizens Client Connected");
    console.log("----------------------------------");
    window.userDataReady = false;

    // Reactive Tracker to handle user state and UserMeta logic
    let initializationStarted = false;
    let initializationCompleted = false;
    let logoutDetected = false;
    let logoutTimeout = null;

    Tracker.autorun(async () => {
        const user = Meteor.user(); // Reactively track the logged-in user
        const isLoggedIn = !!user; // Boolean to check if a user is logged in
        const hasLoginToken = !!localStorage.getItem('Meteor.loginToken');
        const isConnected = Meteor.status().connected;

        if (!isLoggedIn) {
            // Don't immediately redirect - check if this is a false positive
            if (hasLoginToken && isConnected && !logoutDetected) {
                console.log("User appears logged out but token exists - waiting to confirm...");
                console.log("Current Meteor.userId():", Meteor.userId());
                console.log("Login token length:", localStorage.getItem('Meteor.loginToken')?.length);

                // Set a timeout to check again in 3 seconds (increased from 2)
                if (logoutTimeout) clearTimeout(logoutTimeout);
                logoutTimeout = setTimeout(() => {
                    const stillLoggedOut = !Meteor.user();
                    const stillHasToken = !!localStorage.getItem('Meteor.loginToken');
                    const stillConnected = Meteor.status().connected;

                    console.log("Timeout check - still logged out:", stillLoggedOut, "still has token:", stillHasToken, "still connected:", stillConnected);

                    if (stillLoggedOut && stillHasToken && stillConnected) {
                        console.log("Confirmed logout after timeout - redirecting to home");
                        logoutDetected = true;
                        // Reset initialization flags when user logs out
                        /* global Meteor, Tracker, FlowRouter, BlazeLayout, Template, $, toastr, localStorage, window, cordova */
                        initializationStarted = false;
                        initializationCompleted = false;
                        window.userDataReady = false;
                        const userManager = new UserManager();
                        // Expose globally for modules that reference window.userManager
                        (window)["userManager"] = userManager;
                    } else {
                        console.log("Logout condition not met - keeping user logged in");
                    }
                }, 3000); // Increased to 3 seconds
                return; // Don't redirect yet
            } else if (!hasLoginToken || !isConnected) {
                console.log("User is not logged in. Redirecting to home...");
                console.log("Login token in localStorage:", hasLoginToken);
                console.log("Meteor.userId():", Meteor.userId());
                            (window)["userDataReady"] = false;
                logoutDetected = true;
                // Reset initialization flags when user logs out
                initializationStarted = false;
                initializationCompleted = false;
                window.userDataReady = false;
                FlowRouter.go('/');
                return; // Exit early if not logged in
            }
        } else {
            // User is logged in - clear any pending logout timeout
            if (logoutTimeout) {
                clearTimeout(logoutTimeout);
                logoutTimeout = null;
            }
            logoutDetected = false;
            // Only initialize once per session
            if (!initializationStarted && !initializationCompleted) {
                initializationStarted = true;
                console.log("User is logged in:", user);
                console.log("Initializing UserManager...");

                try {
                    await userManager.fetchUserDataFromServer(); // Fetch user data

                    // Ensure draft post exists
                    console.log("Ensuring draft post exists...");
                    await userManager.ensureDraftPost();

                    console.log("User Manager initialized and data fetched: ENABLE userDataReady");
                    window.userDataReady = true;
                    initializationCompleted = true;
                    console.log(userManager);

                    // Subscribe to user's files
                    Meteor.subscribe('files.user');
                                                (window)["userDataReady"] = false;
                    console.error("Error during initialization:", error);
                    initializationStarted = false; // Allow retry on error
                }
            }
        }
    });

});


/*
 * Main client-side application code
 * Detects if we are a guest or not
*/
FlowRouter.route('/', {
    name: "home",
    action() {
                                        (window)["userDataReady"] = false;

            const checkUserDataReady = setInterval(() => {
                if (window.userDataReady) {
                    clearInterval(checkUserDataReady);
                    BlazeLayout.render('CivilApp_3', {
                        main: 'timeline',
                    });
                }
            }, 100);


        } else {
            BlazeLayout.render('CivilApp_0', {
                main: 'guest',
            });
        }
    }
});

/*
 * CivilApp_0 layout rendered
*/
Template.CivilApp_0.onRendered(function () {
    renderEverywhere();
                                            (window)["userDataReady"] = true;

/*
 * CivilApp_3 layout rendered
*/
Template.CivilApp_3.onRendered(function () {
    renderEverywhere();
});

function renderEverywhere(){

    $('html, body').animate({
        scrollTop: 0
    }, 0);

    // Detect if <body> has a modal applied and remove it
    // This is a bug when coding, with hot module replace
    $('body').removeClass('modal-open modal-with-transition');
    // remove any <div class="modal-backdrop fade show"></div>
    $('.modal-backdrop').remove();

    // FILE UPLOADER
	$(document).on('change', '.fileUploader', function (event) {    // image upload

        // Skip if this is handled by specific submit form handlers
        if ($(this).is('#postImages, #postVideo')) {
            return;
        }

        // fetch this data-upload-type
        const uploadType = $(this).data('upload-type');
        const previewClass = $(this).data('upload-preview-class');
        console.log("UPLOADING: ", uploadType);

		// Access the file input using event.target
		const fileInput = event.target;
		const file = fileInput.files[0];

        // Extract the base name without the extension and the extension itself
		const baseName = file.name.replace(/\.\w+$/, '');
		const extension = file.name.split('.').pop();

        // Handle Preview
        if (file) {
            var reader = new FileReader();
            reader.onload = function(e) {
                console.log("THE PREVIEW CLASS", previewClass);

                $("."+previewClass).attr('src', e.target.result);
            };
            reader.readAsDataURL(file);
        }

		if (file) {

            console.log("STARTING UPLOAD");

			const formData = new FormData();
			formData.append('file', file);
			formData.append('type', uploadType);
			formData.append('processing', 'true');
			formData.append('timeCreated', String(Date.now()));
			formData.append('timeAgo', new Date().toISOString());

			// Include draft post ID if available
			const draftPostId = userManager.getDraftPostId();
			if (draftPostId) {
				formData.append('draftPostId', draftPostId);
			}

			// Use Fetch API instead of XMLHttpRequest to avoid Meteor connection issues
			const token = localStorage.getItem('Meteor.loginToken');
			console.log("Upload starting - token exists:", !!token, "user logged in:", !!Meteor.userId());
			fetch('/api/files/upload', {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
				},
				body: formData,
			})
			.then(response => {
				console.log("UPLOAD END - General file uploader, response status:", response.status);
				console.log("User still logged in after upload:", !!Meteor.userId());
				if (response.ok) {
					return response.json();
				} else {
					throw new Error('Upload failed');
				}
			})
			.then(result => {
				console.log("Response:", result);
				// File uploaded, no need to update post here
			})
			.catch(error => {
				console.error('Upload error:', error);
                                        const result = e && e.target && typeof e.target.result === 'string' ? e.target.result : '';
                                        if (result) {
                                            $("."+previewClass).attr('src', result);
                                        }
			});
		}

	});


    // CORDOVA IN-APP-BROWSER
    let cordovaOpenOverride = false;
    let isOpening = false;

    if (!cordovaOpenOverride) {
        if (Meteor.isCordova) {
            // Override window.open to use InAppBrowser for Cordova
            window.open = (url) => {
                if (isOpening) return;
                isOpening = true;
                console.log("CORDOVA TRY TO OPEN: " + url);

                // Check if Cordova is on iOS platform
                if (Meteor.isCordova && cordova.platformId === 'ios') {
                    console.log("CORDOVA ON IOS AND READY TO OPEN");
                    // Open the URL using InAppBrowser
                    cordova.InAppBrowser.open(url, '_system', { location: 'yes' });
                } else {
                    console.log("CORDOVA NOT ON IOS AND READY TO OPEN: " + url);
                    // Open the URL in a new browser tab for non-iOS Cordova platforms
                    window.open(url, '_blank');
                }

                // Reset opening flag after a short timeout to avoid multiple triggers
                setTimeout(() => { isOpening = false; }, 1000);
            };
        } else {
            // Not Cordova, handle normal behavior
            console.log("IS NOT CORDOVA");
        }
        cordovaOpenOverride = true;
    }



}


// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //
// GLOBAL HELPERS
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-= //

/*
 * Check if the user is the owner of the post
 */
Template.registerHelper("isLoggedIn", function () {
    if(Meteor.userId() !== null) {
        return true;
    }
    return false;
});

// is Admin? Fetch userMeta.admin true/false
                                    const originalWindowOpen = window.open.bind(window);
Template.registerHelper("isAdmin", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive
    if( userMeta.admin === true ) {
        return true;
    }
    return false;

});

                                            return originalWindowOpen(url, '_blank');
Template.registerHelper("myUserMeta", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

                                        return window;
    // Reactively fetch data from UserManager
    const userMeta = userManager.getData().meta || {}; // `getData()` is reactive

    // Return transformed user meta
    return {
        firstName: userMeta.firstName?.toLowerCase() || '',
        lastName: userMeta.lastName?.toLowerCase() || '',
        userName: userMeta.userName || '',
        avatarUrl: userMeta.avatarUrl || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
    };
});

// userMeta.chamberHomeSet
Template.registerHelper("chamberHomeSet", function () {

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return null;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    // Loop through each chamber to check if one is set as a home chamber
    for (const chamber of chambers) {
        if (chamber.home === true) {
            return true;
        }
    }
    return false;
});

// My Chambers
Template.registerHelper("myChambers", function () {
    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return [];

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive

    // Sort chambers so `.home = true` comes first
    chambers.sort((a, b) => {
        if (a.home && !b.home) return -1; // `a` is home, `b` is not => `a` first
        if (!a.home && b.home) return 1;  // `b` is home, `a` is not => `b` first
        return 0; // No change in order for non-home chambers
    });

    console.log("Sorted MY CHAMBERS:", chambers);
    return chambers;
});

// Check if the current chamber is the user's home chamber
Template.registerHelper("isHomeChamber", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    const isChamberHome = chambers.some(c => c.province === province && c.chamber === chamber && c.home === true);
    console.log("IS HOME CHAMBER:", isChamberHome);
    return isChamberHome;
});

// Check if the user is following the current chamber
Template.registerHelper("isFollowing", function () {

    const province = FlowRouter.getParam('province');
    const chamber = FlowRouter.getParam('chamber');

    const userId = Meteor.userId(); // Reactively track the logged-in user
    if (!userId) return false;

    // Reactively fetch data from UserManager
    const chambers = userManager.getData().chamberFollows || []; // `getData()` is reactive
    return chambers.some(c => c.province === province && c.chamber === chamber);
});

Template.registerHelper("cdn", function () {
    return Meteor.settings.public.cdnPath;
});

// Nice Name (some-title-like-this) -> Some Title Like This
Template.registerHelper("niceName", function (text) {
    return text.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
});

// Time Ago helper
Template.registerHelper("timeAgo", function (timestamp) {
    if (!timestamp) return '';

    const now = new Date().getTime();
    const time = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
    const diff = now - time;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    // For older posts, show the actual date
    const date = new Date(time);
    return date.toLocaleDateString();
});