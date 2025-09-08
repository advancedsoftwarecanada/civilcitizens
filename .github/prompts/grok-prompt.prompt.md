---
mode: agent
---
About:
We are using Meteor3 to build Civil, a social network built specifically for Canadians. We break down user groups to Electoral District Associations. When users join they create their account, select their province, then their riding.

Tech Stack:
We are using Meteor 3. But we do not want to rely on the subscription system, it doesnt scale well. We cannot use FindOne, it's removed in Meteor 3.  You can see all breaking changes here: https://v3-migration-docs.meteor.com/breaking-changes/

Meteor is already running, no need to try to start it from Chat, or do git pushes. I will manage that. But if you need to, do like: ./dev.sh startdev

API Based Approach:
We want to build a front-end cache that begins in client/userManager.js - we want the app to be API based as much as possible, and endpoitns can be found in /server/api/ - therefor using Meteor Subscriptions should only be used for the user's own data, like UserID perhaps, but the more subscriptions we create the less scalable the app becomes.