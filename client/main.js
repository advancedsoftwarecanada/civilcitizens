import userManager from './userManager.js';

/*
 * Client Startup
    * This is the main entry point for the client
*/
Meteor.startup(async () => {

    console.log("==================================");
    console.log("CivilCitizens Client Connected");
    console.log("----------------------------------");

    // Create a reactive variable for subscription readiness
    const userMetaSub = Meteor.subscribe('accounts.myUserMeta');

    Tracker.autorun(() => {
        if (userMetaSub.ready()) {
            console.log('UserMeta subscription is ready');
        } else {
            console.log('Waiting for UserMeta subscription...');
        }
    });


    // User Manager// Create a singleton instance of UserManager
    console.log("User Manager: ", userManager);
    await userManager.fetchUserData();
    window.userManager = userManager;


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

    // #templateMain scroll to top
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
                            toastr.error('Error retrieving file details.');
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

// Get my user information from usermeta
Template.registerHelper("myUserMeta", function () {
    const userMeta = UserMeta.findOne({ owner_userid: Meteor.userId() });
    if (Meteor.userId() && userMeta) {
        return {
            name_first: userMeta.name_first?.toLowerCase() || '',
            name_last: userMeta.name_last?.toLowerCase() || '',
            username: userMeta.username?.toLowerCase() || '',
            avatar_url: userMeta.avatar_url || 'https://civilcitizens.ca/theme/assets/images/avatar-1.png',
        };
    }
    return null;
});

Template.registerHelper("cdn", function () {
    return Meteor.settings.public.cdnPath;
});