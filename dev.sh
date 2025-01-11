#!/bin/bash

# Display help if no parameters are provided or on "help" command
if [[ $# -eq 0 || $1 == "help" ]]; then
  echo "Usage: ./dev.sh <command>"
  echo ""
  echo "Commands:"
  echo "  help              Show this help message."
  echo "  start             Start the Meteor app locally (web browser only, no mobile app)."
  echo "  buildios          Build both dev and prod iOS apps with appropriate settings."
  echo "  buildandroid      Build both dev and prod Android apps with appropriate settings."
  echo "  buildserver       Build the server bundle for production."
  exit 0
fi

# Define commands
case $1 in
  start)
    echo "Starting Meteor on localhost:3000 (web browser only, no mobile app)..."
    meteor --settings settings-localhost.json
    ;;

  buildios)
    echo "Building iOS app for development..."
    meteor build ../civil-build-ios-NEW/dev --server=http://192.168.2.53 --mobile-settings settings-localhost.json
    echo "Development iOS app built at ../civil-build-ios-NEW/dev"

    echo "Building iOS app for production..."
    meteor build ../civil-build-ios-NEW/prod --server=http://192.168.2.53 --mobile-settings settings.json
    echo "Production iOS app built at ../civil-build-ios-NEW/prod"

    echo "Both development and production iOS apps have been built. You can find them in:"
    echo "  Development: ../civil-build-ios-NEW/dev"
    echo "  Production: ../civil-build-ios-NEW/prod"
    echo "Open the respective Xcode projects to test or deploy."
    ;;

  buildandroid)
    echo "Building Android app for development..."
    meteor build ../civil-build-android-NEW/dev --server=http://appdev.civilcitizens.ca --mobile-settings settings-localhost.json
    echo "Development Android app built at ../civil-build-android-NEW/dev"

    echo "Building Android app for production..."
    meteor build ../civil-build-android-NEW/prod --server=https://civilcitizens.ca --mobile-settings settings.json
    echo "Production Android app built at ../civil-build-android-NEW/prod"

    echo "Both development and production Android apps have been built. You can find them in:"
    echo "  Development: ../civil-build-android-NEW/dev"
    echo "  Production: ../civil-build-android-NEW/prod"
    echo "Open the respective projects in Android Studio to test or deploy."
    ;;

  buildserver)
    echo "Building server bundle for production..."
    meteor build ../bundle_new --directory --server=https://civilcitizens.ca
    echo "Server bundle built at ../bundle_new"
    ;;

  *)
    echo "Unknown command: $1"
    echo "Use './dev.sh help' for a list of available commands."
    exit 1
    ;;
esac
