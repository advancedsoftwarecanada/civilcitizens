Template.guest.rendered = function() {

	if( Meteor.userId() ){
		FlowRouter.go('/');
	}

};