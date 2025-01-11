App.info({
    id: 'com.civilcitizens.app',
    name: 'Civil Citizens',
    description: 'A platform for civic action and community building',
    author: 'Andrew Normore',
    email: 'support@civilcitizens.ca',
    version: '1.0.0'
});

// Set app icons (provide appropriate paths)
App.icons({
    // iphone: 'resources/icons/ios/icon-60.png',
    // iphone_2x: 'resources/icons/ios/icon-120.png',
    // iphone_3x: 'resources/icons/ios/icon-180.png',
    // ipad: 'resources/icons/ios/icon-76.png',
    // ipad_2x: 'resources/icons/ios/icon-152.png',
});

// Set splash screens (provide appropriate paths)
App.launchScreens({
    // iphone: 'resources/splash/ios/splash-320x480.png',
    // iphone_2x: 'resources/splash/ios/splash-640x960.png',
    // iphone5: 'resources/splash/ios/splash-640x1136.png',
});

// Allow external connections (important for Meteor apps)
App.accessRule('https://civilcitizens.ca/*');
App.accessRule('https://*.civilcitizens.ca/*');
App.accessRule('http://localhost/*'); // Local testing

// Allow YouTube embeds
App.accessRule('https://*.youtube.com/*', { type: 'navigation' });
