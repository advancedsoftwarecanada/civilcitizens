#!/bin/bash

# Display help if no parameters are provided or on "help" command
if [[ $# -eq 0 || $1 == "help" ]]; then
  echo "Usage: ./dev.sh <command>"
  echo ""
  echo "Commands:"
  echo "  help              Show this help message."
  echo "  startdev          Start the app for development (web and mobile hot code push)."
  echo "  startprod         Start the app for production."
  echo "  buildios          Build both dev and prod iOS apps with appropriate settings."
  echo "  buildandroid      Build both dev and prod Android apps with appropriate settings."
  echo "  buildserver       Build the server bundle for production."
  exit 0
fi

# Function to delete and recreate a build directory
clean_build_directory() {
  local build_dir=$1
  echo "Cleaning build directory: $build_dir"
  if [ -d "$build_dir" ]; then
    rm -rf "$build_dir"
  fi
  mkdir -p "$build_dir"
}

# Function to check and kill process using port 3000
kill_port_3000() {
  local pid=$(lsof -t -i:3000)
  if [ -n "$pid" ]; then
    echo "Port 3000 is in use by PID $pid. Terminating process..."
    kill -9 $pid
  else
    echo "Port 3000 is not in use."
  fi
}

# Define commands
case $1 in

  startdev)
    kill_port_3000
    ROOT_URL=https://appdev.civilcitizens.ca
    PORT=3000
    echo "Starting Meteor for development with ROOT_URL=$ROOT_URL..."
    ROOT_URL=$ROOT_URL PORT=$PORT meteor --settings settings-localhost.json --port $PORT
    ;;

  buildios)

    echo "Building iOS app for development..."
    clean_build_directory "../civil-build-ios-NEW/dev"
    ROOT_URL=https://appdev.civilcitizens.ca meteor build ../civil-build-ios-NEW/dev --server https://appdev.civilcitizens.ca --mobile-settings settings-localhost.json
    echo "Development iOS app built at ../civil-build-ios-NEW/dev"

    ROOT_URL=https://civilcitizens.ca

    echo "Building iOS app for production..."
    clean_build_directory "../civil-build-ios-NEW/prod"
    meteor build ../civil-build-ios-NEW/prod --server https://civilcitizens.ca --mobile-settings settings.json
    echo "Production iOS app built at ../civil-build-ios-NEW/prod"

    echo "Both development and production iOS apps have been built. You can find them in:"
    echo "  Development: ../civil-build-ios-NEW/dev"
    echo "  Production: ../civil-build-ios-NEW/prod"
    echo "Open the respective Xcode projects to test or deploy."
    ;;

  buildandroid)
    echo "Building Android app for development..."
    clean_build_directory "../civil-build-android-NEW/dev"
    meteor build ../civil-build-android-NEW/dev --server=https://appdev.civilcitizens.ca --mobile-settings settings-localhost.json
    echo "Development Android app built at ../civil-build-android-NEW/dev"

    echo "Building Android app for production..."
    clean_build_directory "../civil-build-android-NEW/prod"
    meteor build ../civil-build-android-NEW/prod --server=https://civilcitizens.ca --mobile-settings settings.json
    echo "Production Android app built at ../civil-build-android-NEW/prod"

    echo "Both development and production Android apps have been built. You can find them in:"
    echo "  Development: ../civil-build-android-NEW/dev"
    echo "  Production: ../civil-build-android-NEW/prod"
    echo "Open the respective projects in Android Studio to test or deploy."
    ;;

  buildserver)
    echo "Building server bundle for production..."
    clean_build_directory "../bundle_new"
    meteor build ../bundle_new --directory --server=https://civilcitizens.ca --mobile-settings settings.json --server-only
    echo "Server bundle built at ../bundle_new"
    ;;

  *)
    echo "Unknown command: $1"
    echo "Use './dev.sh help' for a list of available commands."
    exit 1
    ;;
esac
