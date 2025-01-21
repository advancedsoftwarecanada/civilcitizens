Meteor.methods({
  'admin.chambers.buildChambers': async function () {
    // Ensure server-side execution
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

    // Ensure the user is authorized
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
    }

    // Configuration variables
    const GEOCODING_API_KEY = 'AIzaSyAhAqw_XtMPo1mgmDQMdkSWPJry3AxS4GU';
    const BASE_URL = `https://maps.googleapis.com/maps/api/geocode/json`;

    const REBUILD_GEO = false; // Toggle to control geocoding rebuild
    const REBUILD_SEO = true; // Toggle to control SEO URL rebuild

    // Fetch chambers data
    const chambers = await Meteor.call('admin.chambers.fetchChambersJson');
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

      let seoUrl = null;
      if (REBUILD_SEO) {
        seoUrl = name.toLowerCase()
          .replace(/—/g, '-')            // Replace em dash with dash
          .replace(/[^\w\s-]/g, '')      // Remove special characters except dash
          .replace(/\s+/g, '-')          // Replace spaces with dashes
          .replace(/-+/g, '-');          // Remove consecutive dashes
      }

      let lat = null, lng = null;
      if (REBUILD_GEO) {
        const address = `${name}, ${province}, Canada`.trim();
        const geocodeUrl = `${BASE_URL}?address=${encodeURIComponent(address)}&key=${GEOCODING_API_KEY}`;

        try {
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
        } catch (error) {
          console.error(`Error during geocoding: ${name} (${code})`, error);
        }
      }

      try {
        const existingChamber = await Chambers.findOneAsync({ code });

        const chamberData = {
          code,
          name,
          province: provinceCode,
          seoUrl: REBUILD_SEO ? seoUrl : existingChamber?.seoUrl,
          location: REBUILD_GEO && lat && lng ? { lat, lng } : existingChamber?.location,
          createdAt: existingChamber ? existingChamber.createdAt : new Date().getTime(),
          stats: existingChamber?.stats || {
            members: 0,
            posts: 0,
            comments: 0,
            bookmarks: 0,
            upvotes: 0,
            downvotes: 0,
            chambers: 0,
            boards: 0,
          },
        };

        if (existingChamber) {
          await Chambers.updateAsync({ code }, { $set: chamberData });
          console.log(`Updated: ${name} (${code})`);
        } else {
          await Chambers.insertAsync(chamberData);
          console.log(`Inserted: ${name} (${code})`);
        }
      } catch (error) {
        console.error(`Error updating/inserting chamber: ${name} (${code})`, error);
      }

      // Add a delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
    }

    console.log('>>>>>>>>>>>>>> DONE <<<<<<<<<<<<');
    console.log(`ADMIN: Processed ${processedChamberCount} chambers`);
  },
});
