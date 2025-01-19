Meteor.methods({
    'admin.chambers.buildChambers': async function () {

        // if client, return false;
        if (!Meteor.isServer) {
            return false;
        }

      const provinceCodes = {
        "newfoundland and labrador": "nl",
        "prince edward island": "pe",
        "nova scotia": "ns",
        "new brunswick": "nb",
        "quebec": "qc",
        "ontario": "on",
        "manitoba": "mb",
        "saskatchewan": "sk",
        "alberta": "ab",
        "british columbia": "bc",
        "yukon": "yt",
        "northwest territories": "nt",
        "nunavut": "nu",
      };

      // call admin.chambers.fetchChambersJson to get the chambers
      const chambers = await Meteor.call('admin.chambers.fetchChambersJson');
      // console.log('ADMIN: Chambers:', chambers);

      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
      }
      const GEOCODING_API_KEY = 'AIzaSyAhAqw_XtMPo1mgmDQMdkSWPJry3AxS4GU';
      const BASE_URL = `https://maps.googleapis.com/maps/api/geocode/json`;

      console.log('ADMIN: Building Chambers');
      // Count the amount of rows in the CSV
      const chamberCount = chambers.length;
      console.log(`ADMIN: FlatFile Contains: ${chamberCount} chambers`);

      let processedChamberCount = 0;
      for (const chamber of chambers) {

        processedChamberCount++;

        const { code, name, province } = chamber;

        const provinceCode = provinceCodes[province.toLowerCase()];
        if (!provinceCode) {
          console.error(`Invalid province: ${province} for chamber: ${name}`);
          continue;
        }

        const seoUrl = name.toLowerCase()
          .replace(/[^\w\s-]/g, '') // Remove special characters
          .replace(/\s+/g, '-')     // Replace spaces with dashes
          .replace(/-+/g, '-')      // Remove consecutive dashes
          .replace(/—/g, '-');      // Replace em dash with dash

        const address = `${name}, ${province}, Canada`.trim();
        const geocodeUrl = `${BASE_URL}?address=${encodeURIComponent(address)}&key=${GEOCODING_API_KEY}`;
        let lat = null;
        let lng = null;

        try {
          const existingChamber = await Chambers.findOneAsync({ code });

          if (existingChamber) {
            console.log(`Checking: ${name} (${code}) - Exists`);
            // Check if location is already set
            if (existingChamber.location) {
              console.log(`Skipped: ${name} (${code}) - Location Already Set`);
              continue;
            }
          }

          const response = await fetch(geocodeUrl);
          const data = await response.json();

          if (data.status === 'OK' && data.results[0]?.geometry?.location) {
            const location = data.results[0].geometry.location;
            lat = location.lat;
            lng = location.lng;
            console.log(`Geocoded: ${name} (${code}) - Lat: ${lat}, Lng: ${lng}`);
          } else {
            console.warn(`Failed to geocode: ${name} (${code}) - ${data.status}`);
          }

          const chamberData = {
            code,
            name,
            province: provinceCode,
            seoUrl,
            location: lat && lng ? { lat, lng } : null,
            createdAt: existingChamber ? existingChamber.createdAt : new Date().getTime(),
            stats:{
                members: 0,
                posts: 0,
                comments: 0,
                bookmarks: 0,
                upvotes: 0,
                downvotes: 0,
                chambers: 0,
                boards: 0,
            }
          };

          if (existingChamber) {
            // Update existing chamber
            await Chambers.updateAsync({ code }, { $set: chamberData });
            console.log(`Updated: ${name} (${code})`);
          } else {
            // Insert new chamber
            await Chambers.insertAsync(chamberData);
            console.log(`Inserted: ${name} (${code})`);
          }

        } catch (error) {
          console.error(`Error during geocoding: ${name} (${code})`, error);
        }

        // Add a delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }

      console.log('≥>>>>>>>>>>>>>> DONE <<<<<<<<<<<<≤');
      console.log(`ADMIN: Processed ${processedChamberCount} chambers`);

    },
  });
