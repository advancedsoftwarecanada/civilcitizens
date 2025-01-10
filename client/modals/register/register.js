Template.modalRegister.events({
    'submit #registerModal form': function(event) {
        event.preventDefault();
        const firstName = event.target.registerFirstName.value.trim();
        const lastName = event.target.registerLastName.value.trim();
        const email = event.target.registerEmail.value.trim();
        const password = event.target.registerPassword.value.trim();
        const termsChecked = event.target.termsCheck.checked;

        if (!termsChecked) {
            Swal.fire({
                title: "You must agree to the terms and conditions",
                text: "",
                type: "error"
            });
            return;
        }

        const random_id = Math.random().toString(36).substring(2, 15); // Ensure random_id is defined

        Accounts.createUser({
            email: email,
            password: password,
            profile: {
                name_first: firstName,
                name_last: lastName,
                username: (firstName + lastName + random_id).toLowerCase(),
            },
            username: (firstName + lastName + random_id).toLowerCase(), // Must be doubled here, sadly, for the Guest Account logic. Cleanup one day...
            host: window.location.hostname // Pass the domain/url to the server
        }, function(error){
            if(error){
                Swal.fire({
                    title: error.reason,
                    text: "",
                    type: "error"
                });
            } else {
                setTimeout(function(){
                    FlowRouter.go("/"); // Redirect user if registration succeeds
                }, 100);
                setTimeout(function(){
                    location.reload();
                }, 1000);
            }
        });
    },
    'input #registerPassword': function(event) {
        const password = event.target.value;
        const strengthIndicator = document.getElementById('passwordStrength');
        const strength = getPasswordStrength(password);
        strengthIndicator.textContent = `Password strength: ${strength}`;
    }
});

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
