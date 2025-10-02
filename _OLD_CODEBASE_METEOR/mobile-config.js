// Check environment variables passed by the build process
const isDevelopment = process.env.METEOR_ENV === 'development';
const isProduction = process.env.METEOR_ENV === 'production';

// Common access rule for both dev and prod
App.accessRule('*');  // Allow all domains for both dev and prod

// Configure common plugin settings for both dev and prod
App.configurePlugin('cordova-plugin-inappbrowser', {
    'InAppBrowserStatusBarStyle': 'default', // Default value, can be overridden below
});

// Common preferences for both dev and prod
App.setPreference('AllowInlineMediaPlayback', 'false');  // Debugging settings for both

// Production specific settings
App.setPreference('AllowInlineMediaPlayback', 'true');  // Allow inline media in production
App.setPreference('WKWebViewOnly', 'true');  // Ensure WKWebView is used in production

// Override plugin settings for production
App.configurePlugin('cordova-plugin-inappbrowser', {
    'InAppBrowserStatusBarStyle': 'default', // For prod
});

if (isDevelopment) {
    console.log('Development settingsDevelopment settingsDevelopment settingsDevelopment settingsDevelopment settings');
    App.info({
        id: 'com.civilcitizens.app',
        name: 'Civil Citizens',
        description: 'A platform for civic action and community building',
        author: 'Andrew Normore',
        email: 'support@civilcitizens.ca',
        version: '1.0.2' // Same version for both environments (can be updated per build)
    });
} else if (isProduction) {
    console.log('Production buildProduction buildProduction buildProduction buildProduction buildProduction build');
    App.info({
        id: 'com.civilcitizens.app',
        name: 'Civil Citizens',
        description: 'A platform for civic action and community building',
        author: 'Andrew Normore',
        email: 'support@civilcitizens.ca',
        version: '1.0.2' // Same version for both environments (can be updated per build)
    });

}
