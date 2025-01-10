Template.modals.events({
    'submit #loginModal form': function(event) {
        event.preventDefault();
        const email = event.target.loginEmail.value;
        const password = event.target.loginPassword.value;

        // Add your login logic here
        console.log('Login with', email, password);
    },
    'submit #registerModal form': function(event) {
        event.preventDefault();
        const firstName = event.target.registerFirstName.value;
        const lastName = event.target.registerLastName.value;
        const email = event.target.registerEmail.value;
        const password = event.target.registerPassword.value;
        const termsChecked = event.target.termsCheck.checked;

        // Add your registration logic here
        console.log('Register with', firstName, lastName, email, password, termsChecked);
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
