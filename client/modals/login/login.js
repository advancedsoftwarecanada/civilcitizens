Template.modalLogin.events({
    'submit #loginModal form': function(event) {
        event.preventDefault();
        const email = event.target.loginEmail.value;
        const password = event.target.loginPassword.value;

        // Add your login logic here
        console.log('Login with', email);

        Meteor.loginWithPassword(email, password, function(error){

			if(error){

				event.preventDefault();
				//$(".login-container button").prop('disabled', false);
				console.log(error);
				Swal.fire({
					title: error.reason,
					text: "",
					type: "error"
				});

			} else {

				//ga("send", "event", "user", "login");
				setTimeout(function(){
					//FlowRouter.go('/cases');
					// Javascript redirct
					window.location.href = "/";
				},100);

			}

		});
    },
});