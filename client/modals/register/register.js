Template.modalRegister.events({
    'submit #registerModal form': async function (event) {
        event.preventDefault();

        // disable #registerModal form with jquery
        $('#registerModal form').addClass('disabled');

        const firstName = event.target.registerFirstName.value.trim();
        const lastName = event.target.registerLastName.value.trim();
        const handle = event.target.registerHandle.value.trim();
        const email = event.target.registerEmail.value.trim();
        const password = event.target.registerPassword.value.trim();
        const termsChecked = event.target.termsCheck.checked;

        // Check if terms are accepted
        if (!termsChecked) {
            Swal.fire({
                title: "You must agree to the terms and conditions",
                text: "",
                icon: "error",
            });
            $('#registerModal form').removeClass('disabled');
            return;
        }

        // Check if the userName length is valid
        if (handle.length < 5 || handle.length > 20) {
            Swal.fire({
                title: "Invalid userName Length",
                text: "userName must be between 5 and 20 characters long.",
                icon: "error",
            });
            $('#registerModal form').removeClass('disabled');
            return;
        }

        let userName = handle;

        try {
            // Check if the userName is taken
            const userNameResult = await new Promise((resolve, reject) => {
                Meteor.call('accounts.isHandleTaken', userName, (error, result) => {
                    if (error) {
                        console.error('Error checking userName:', error);
                        reject(new Meteor.Error('internal-error', 'An error occurred while checking the userName.'));
                    } else {
                        resolve(result);
                    }
                });
            });

            if (userNameResult.status === 'error') {
                Swal.fire({
                    title: "userName Taken",
                    text: userNameResult.message || "Please choose another userName.",
                    icon: "warning",
                });
                $('#registerModal form').removeClass('disabled');
                return;
            }

            // Check if the email is already registered
            const emailResult = await new Promise((resolve, reject) => {
                Meteor.call('accounts.isEmailRegistered', email, (error, result) => {
                    if (error) {
                        console.error('Error checking email:', error);
                        reject(new Meteor.Error('internal-error', 'An error occurred while checking the email.'));
                    } else {
                        resolve(result);
                    }
                });
            });

            if (emailResult.status === 'error') {
                Swal.fire({
                    title: "Email Already Registered",
                    text: emailResult.message || "Please use another email address.",
                    icon: "warning",
                });
                $('#registerModal form').removeClass('disabled');
                return;
            }

            // Create user account
            Accounts.createUser(
                {
                    email: email,
                    password: password,
                    profile: {
                        firstName: firstName,
                        lastName: lastName,
                        userName: userName,
                    },
                },
                function (error) {
                    if (error) {
                        console.error('Error creating account:', error);
                        Swal.fire({
                            title: "Registration Error",
                            text: error.reason || "Unable to create account. Please try again.",
                            icon: "error",
                        });
                        $('#registerModal form').removeClass('disabled');
                    } else {

                        // close modals
                        $('#registerModal').modal('hide');
                        $('#loginModal').modal('hide');

                        // remove modal backdrop
                        $('.modal-backdrop').remove();

                        // hide #guestContainer
                        $('#guestContainer').hide();

                        // show #welcomeToCivilCitizens
                        $('#welcomeToCivilCitizens').show();

                        const end = Date.now() + 2000;

                        // New colors: red shades
                        const colors = ['#FF0000', '#FF6347']; // Red and tomato shades

                        function frame() {
                            confetti({
                                particleCount: 4,
                                angle: 60,
                                spread: 180,
                                startVelocity: 60,
                                origin: { x: 0 },
                                colors: colors
                            });
                            confetti({
                                particleCount: 4,
                                angle: 120,
                                spread: 180,
                                startVelocity: 60,
                                origin: { x: 1 },
                                colors: colors
                            });

                            if (Date.now() < end) {
                                requestAnimationFrame(frame);
                            }
                        }

                        frame();

                        setTimeout(() => {

                            FlowRouter.go("/"); // Redirect to homepage

                            setTimeout(() => {
                                location.reload();
                            },500);

                        }, 3000);
                    }
                }
            );
        } catch (error) {
            console.error('Unexpected error:', error);
            Swal.fire({
                title: "Error",
                text: error.reason || "An unexpected error occurred. Please try again.",
                icon: "error",
            });
            $('#registerModal form').removeClass('disabled');
        }
    },

    'input #registerFirstName, input #registerLastName': function () {
        const firstName = document.getElementById('registerFirstName').value.trim();
        const lastName = document.getElementById('registerLastName').value.trim();
        const handleInput = document.getElementById('registerHandle');
        const autoGeneratedHandle = `${firstName}${lastName}`;
        handleInput.value = autoGeneratedHandle;
    },

    'input #registerHandle': function (event) {
        const handleInput = event.target;
        handleInput.value = handleInput.value;

        // Check if the userName length is valid
        if (handleInput.value.length < 5 || handleInput.value.length > 20) {
            handleInput.setCustomValidity("userName must be between 5 and 20 characters long.");
        } else {
            handleInput.setCustomValidity("");
        }
    },

    'input #registerPassword': function (event) {
        const password = event.target.value;
        const strengthIndicator = document.getElementById('passwordStrength');
        const strength = getPasswordStrength(password);
        strengthIndicator.textContent = `Password strength: ${strength}`;
    },
});

// Helper function to evaluate password strength
function getPasswordStrength(password) {
    let strength = 'Weak';
    if (password.length >= 6) {
        strength = 'Medium';
    }
    if (password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password)) {
        strength = 'Strong';
    }
    return strength;
}
