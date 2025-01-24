import userManager from './userManager.js';

/*
 * Client Startup
    * This is the main entry point for the client
*/
Meteor.startup(async () => {
    console.log("==================================");
    console.log("CivilCitizens Client Connected");
    console.log("----------------------------------");

    // Reactive Tracker to handle user state and UserMeta logic
    Tracker.autorun(() => {
        const user = Meteor.user(); // Reactively track the logged-in user
        const isLoggedIn = !!user; // Boolean to check if a user is logged in

        if (!isLoggedIn) {
            console.log("User is not logged in. Redirecting to home...");
            FlowRouter.go('/');
            return; // Exit early if not logged in
        }else{

            console.log("User is logged in:", user);
            console.log("Fetching User Data...");
            userManager.fetchUserData();
            window.userManager = userManager;
            console.log("User Manager: ", userManager);
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

            BlazeLayout.render('CivilApp_3', {
                main: 'timeline',
            });
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

			const upload = Files.insert({
				file: file,
				//streams: 'dynamic', // this seems to not be needed and breaks on mac
				chunkSize: 'dynamic',
				meta: {
					processing: true,
					type: uploadType,
					timeCreated: Date.now(),
					timeAgo: new Date().toISOString(),
				},
			}, false);

			upload.on('progress', function () {
				// $(".uploaderPercent").css('width', this.progress.curValue + "%");
			});

			upload.on('start', function () {
				// console.log("Start Upload");
				// toastr["success"]("", "Uploading");
			});

            upload.on('end', function (error, clientFile) {
                if (error) {
                    toastr.error('Error uploading file.');
                } else {

                    console.log("UPLOAD END");
                    console.log(clientFile);

                    // Store the file ID for future requests
                    const fileId = clientFile._id; // Ensure `_id` is present in `clientFile`
                    console.log('Uploaded file ID:', fileId);

                    // Fetch the enriched file metadata from the server
                    Meteor.call('files.fetchMeta', fileId, (err, result) => {
                        if (err) {
                            console.error('Error fetching file metadata:', err);
                            // toastr.error('Error retrieving file details.');
                        } else {
                            console.log('Fetched file metadata:', result);

                            // Extract the file's URL
                            const { url } = result.data;

                            // Update the avatar URL if this is an avatar upload
                            // Removed from client side
                            // if (clientFile.meta.type === 'avatar') {
                            //     Meteor.call('files.updateAvatarUrl', url, (updateErr, updateResult) => {
                            //         if (updateErr) {
                            //             console.error('Error updating avatar URL:', updateErr);
                            //             toastr.error('Error updating avatar URL.');
                            //         } else {
                            //             console.log('Avatar URL updated successfully:', updateResult);
                            //             toastr.success('Avatar updated successfully!');

                            //             // Update the UI
                            //             $('.preview-avatar').attr('src', url);
                            //         }
                            //     });
                            // }
                        }
                    });
                }
            });



			upload.start();
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

    const userMeta = UserMeta.findOne({ ownerUserId: Meteor.userId() });
    if (Meteor.userId() && userMeta) {
        return userMeta.admin;
    }
    return false;

});

// Get my user information from usermeta
Template.registerHelper("myUserMeta", function () {
    const userMeta = UserMeta.findOne({ ownerUserId: Meteor.userId() });
    if (Meteor.userId() && userMeta) {
        return {
            firstName: userMeta.firstName?.toLowerCase() || '',
            lastName: userMeta.lastName?.toLowerCase() || '',
            userName: userMeta.userName || '',
            avatarUrl: userMeta.avatarUrl || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
        };
    }
    return null;
});

// userMeta.chamberHomeSet
Template.registerHelper("chamberHomeSet", function () {
    const userMeta = UserMeta.findOne({ ownerUserId: Meteor.userId() });
    if (Meteor.userId() && userMeta) {
        return userMeta.chamberHome !== "UNSET";
    }
    return false;
});

Template.registerHelper("cdn", function () {
    return Meteor.settings.public.cdnPath;
});

// Nice Name (some-title-like-this) -> Some Title Like This
Template.registerHelper("niceName", function (text) {
    return text.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
});


// My Chambers - MINUS home chamber
Template.registerHelper("myChambers", function () {
    const userMeta = UserMeta.findOne({ ownerUserId: Meteor.userId() });
    if (Meteor.userId() && userMeta) {
        return userMeta.chambers.filter(chamber => chamber !== userMeta.chamberHome);
    }
    return [];
});

// My Home Chamber
Template.registerHelper("myHomeChamber", function () {
    const userMeta = UserMeta.findOne({ ownerUserId: Meteor.userId() });
    if (Meteor.userId() && userMeta) {
        return userMeta.chamberHome;
    }
    return null;
});