#!/bin/bash

# Display help if no parameters are provided or on "help" command
if [[ $# -eq 0 || $1 == "help" ]]; then
  echo "Usage: ./dev.sh <command>"
  echo ""
  echo "Commands:"
  echo "  help           Show this help message."
  echo "  start          Start the Meteor app locally (web browser only, no mobile app)."
  echo "  buildios       Build the iOS app and prepare it for testing in Xcode."
  echo "  buildandroid   Build the Android app and prepare it for testing in Android Studio."
  echo "  buildserver    Note: Run this on the prod server to build the server bundle (output: ../bundle_new). , where the CICD actions can update the production node server."
  exit 0
fi

# Define commands
case $1 in
  start)
    echo "Starting Meteor on localhost:3000 (web browser only, no mobile app)..."
    meteor --settings settings-localhost.json
    ;;

  buildios)
    echo "Building iOS app for testing or production..."
    meteor build ../civil-build-ios --server=http://appdev.civilcitizens.ca
    echo "iOS app built at ../civil-build-ios"
    echo "Current directory: $(pwd)"
    echo "Full path to iOS build: $(pwd)/../civil-build-ios"
    echo "Open the Xcode project in ../civil-build-ios to test or deploy."
    ;;

  buildandroid)
    echo "Building Android app for testing or production..."
    meteor build ../civil-build-android --server=http://appdev.civilcitizens.ca
    echo "Android app built at ../civil-build-android"
    echo "Current directory: $(pwd)"
    echo "Full path to Android build: $(pwd)/../civil-build-android"
    echo "Open the project in ../civil-build-android using Android Studio to test or deploy."
    ;;

  buildserver)
    echo "Note: This command is intended to be run on the production server."
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
