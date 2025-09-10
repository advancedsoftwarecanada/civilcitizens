Meteor.methods({
  'admin.chambers.downloadECGeospatialData': async function () {
    // Ensure server-side execution
    if (!Meteor.isServer) {
      return false;
    }

    // Determine configured SHP ZIP URL (env > settings.public > settings (server) > fallback)
    const configuredUrl = process.env.FEDERAL_SHP_URL ||
      (Meteor.settings && Meteor.settings.public && Meteor.settings.public.federalShpZipUrl) ||
      (Meteor.settings && Meteor.settings.federalShpZipUrl);

    // Fallback to Elections Canada official URL if no override provided
    const defaultShpUrl = 'https://elections.ca/res/cir/mapsCorner/vector/FederalElectoralDistricts_2025_SHP.zip';
    const shpUrlToUse = configuredUrl || defaultShpUrl;

    // Return cached data if available (avoid repeated downloads & rate limiting). If URL changed, invalidate.
    if (global.EC_GEO_CACHE && global.EC_GEO_CACHE.geoJson && global.EC_GEO_CACHE.prjString) {
      if (global.EC_GEO_CACHE.sourceUrl === shpUrlToUse) {
        return { ...global.EC_GEO_CACHE, cached: true };
      } else {
        console.log('ADMIN: EC geospatial cache source URL changed; invalidating old cache. Old:', global.EC_GEO_CACHE.sourceUrl, 'New:', shpUrlToUse);
      }
    }

    // Ensure the user is authorized
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
    }

  console.log('ADMIN: Starting Elections Canada geospatial data download...');
  console.log('ADMIN: Using SHP source URL:', shpUrlToUse, configuredUrl ? '(configured override)' : '(default)');

    try {
  // Use SHP format as it's easier to parse; other formats retained in comments for future expansion
  const shpUrl = shpUrlToUse;
  console.log(`ADMIN: Downloading SHP file from: ${shpUrl}`);

      const response = await fetch(shpUrl);
      if (!response.ok) {
        throw new Meteor.Error('download-failed', `Failed to download SHP: ${response.status}`);
      }

      const shpZipBuffer = await response.arrayBuffer();
      console.log(`ADMIN: Downloaded ${shpZipBuffer.byteLength} bytes of SHP ZIP data`);

      // Unzip the SHP files using unzipper
      const unzipper = await import('unzipper');
      const buffer = Buffer.from(shpZipBuffer);
      const directory = await unzipper.Open.buffer(buffer);

      console.log('ZIP entries:', directory.files.map(f => f.path));

      let shpBuffer = null;
      let dbfBuffer = null;
      let prjBuffer = null;

      for (const file of directory.files) {
        if (file.path.endsWith('.shp')) {
          shpBuffer = await file.buffer();
        } else if (file.path.endsWith('.dbf')) {
          dbfBuffer = await file.buffer();
        } else if (file.path.endsWith('.prj')) {
          prjBuffer = await file.buffer();
        }
      }

      if (!shpBuffer || !dbfBuffer) {
        throw new Meteor.Error('parse-failed', 'Missing .shp or .dbf files in ZIP');
      }

      // Parse shapefile to GeoJSON
      const { read } = await import('shapefile');
      const geoJson = await read(shpBuffer, dbfBuffer);

      console.log(`ADMIN: Parsed ${geoJson.features.length} features from SHP`);
      console.log('First feature properties:', geoJson.features[0].properties);

      // Get projection string from .prj file
      let prjString = null;
      if (prjBuffer) {
        prjString = prjBuffer.toString('utf8');
        console.log('Projection string:', prjString);
      }

      // ---------------- Option C Processing (Precompute) ----------------
      const proj4 = await import('proj4');
      let converter = null;
      try {
        if (prjString) {
          converter = proj4.default(prjString, 'EPSG:4326');
        }
      } catch (e) {
        console.warn('Projection init failed, geometries will remain unconverted (geofencing may fail):', e.message);
      }

      function fixEncoding(str) {
        if (!str || typeof str !== 'string') return str;
        // Attempt common mojibake fixes first
        const map = {
          'â€”': '—', 'â€“': '–', 'â€™': '’', 'â€œ': '“', 'â€\u009d': '”', 'â€˜': '‘', 'â€¢': '•',
          'Ã©': 'é', 'Ã¨': 'è', 'Ãª': 'ê', 'Ã«': 'ë', 'Ã´': 'ô', 'Ã¶': 'ö', 'Ã¢': 'â', 'Ã¤': 'ä',
          'Ã®': 'î', 'Ã¯': 'ï', 'Ã‡': 'Ç', 'Ã§': 'ç', 'Ã¹': 'ù', 'Ã»': 'û', 'Ã¼': 'ü'
        };
        let out = str;
        Object.keys(map).forEach(k => { out = out.split(k).join(map[k]); });
        return out;
      }

      function slugify(str) {
        return fixEncoding(str)
          .toLowerCase()
          .replace(/—|–/g, '-')
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
      }

      function reprojCoordPair(xy) {
        if (!converter) return xy; // assume already lon/lat (unlikely)
        return converter.forward([xy[0], xy[1]]); // returns [lng, lat]
      }

      function reprojCoords(struct) {
        if (typeof struct[0] === 'number') {
          return reprojCoordPair(struct);
        }
        return struct.map(reprojCoords);
      }

      function computeBBox(coords, bbox) {
        if (typeof coords[0] === 'number') {
          const [lng, lat] = coords;
            if (!bbox) return [lng, lat, lng, lat];
            if (lng < bbox[0]) bbox[0] = lng;
            if (lat < bbox[1]) bbox[1] = lat;
            if (lng > bbox[2]) bbox[2] = lng;
            if (lat > bbox[3]) bbox[3] = lat;
            return bbox;
        }
        return coords.reduce((b, sub) => computeBBox(sub, b), bbox);
      }

      const processedFeatures = [];
      const nameIndex = {};

      for (const feature of geoJson.features) {
        const rawName = feature.properties?.ED_NAMEE || feature.properties?.ED_NAMEF || '';
        const cleanName = fixEncoding(rawName);
        const slug = slugify(cleanName);
        let wgs84Geometry = null;
        try {
          if (feature.geometry && feature.geometry.coordinates) {
            const reprojected = reprojCoords(feature.geometry.coordinates);
            wgs84Geometry = { type: feature.geometry.type, coordinates: reprojected };
          }
        } catch (geoErr) {
          console.warn('Reprojection error for', cleanName, geoErr.message);
          continue;
        }
        if (!wgs84Geometry) continue;
        const bbox = computeBBox(wgs84Geometry.coordinates, null);
        const entry = { name: cleanName, slug, bbox, geometry: wgs84Geometry };
        processedFeatures.push(entry);
        nameIndex[slug] = entry;
      }

      console.log(`Processed features with WGS84 geometries: ${processedFeatures.length}`);

      // Use the features directly
      const features = geoJson.features;

      global.EC_GEO_CACHE = {
        success: true,
        format: 'shp',
        size: shpZipBuffer.byteLength,
        parsedFeatures: features.length,
        geoJson: geoJson,
        prjString: prjString,
        message: 'SHP data downloaded and parsed to GeoJSON successfully!',
        dataTypes: ['polygons', 'attributes', 'metadata'],
        fetchedAt: new Date(),
        processed: processedFeatures,
        nameIndex: nameIndex,
        sourceUrl: shpUrl
      };

      return global.EC_GEO_CACHE;

    } catch (error) {
      console.error('Error downloading EC geospatial data:', error);
      throw new Meteor.Error('download-failed', 'Failed to download Elections Canada geospatial data');
    }
  },

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

    // Geocoding address overrides for better accuracy
    const geocodingOverrides = {
      "York—Durham": "Newmarket, Ontario, Canada",
      // Add more riding-specific addresses as needed
    };

    // Elections Canada geospatial data integration
    const USE_EC_GEOSPATIAL = true; // Toggle for Elections Canada geospatial data
    const EC_DATA_URL = 'https://elections.ca/res/cir/mapsCorner/vector/FederalElectoralDistricts_2025_SHP.zip'; // SHP ZIP for easier parsing

    // Download and cache EC geospatial data ONCE at the beginning
    let ecGeospatialData = null;
    if (USE_EC_GEOSPATIAL) {
      try {
        console.log('ADMIN: Downloading Elections Canada SHP geospatial data (this happens only once)...');
        ecGeospatialData = await Meteor.call('admin.chambers.downloadECGeospatialData');
        console.log(`ADMIN: Successfully cached ${ecGeospatialData.size} bytes of geospatial data`);
      } catch (error) {
        console.warn('ADMIN: Failed to download EC geospatial data, will use fallback geocoding:', error.message);
        ecGeospatialData = null;
      }
    }

    const REBUILD_GEO = true; // Toggle to control geocoding rebuild
    const REBUILD_SEO = true; // Toggle to control SEO URL rebuild    // Fetch chambers data
    const USE_XML_SOURCE = true; // Toggle to use XML source instead of static JSON
    let chambers;
    
    if (USE_XML_SOURCE) {
        try {
            chambers = await Meteor.call('admin.chambers.syncFromParliamentXml');
            console.log(`ADMIN: Using XML source - ${chambers.length} chambers`);
        } catch (error) {
            console.warn('Failed to fetch from XML, falling back to static JSON:', error.message);
            chambers = await Meteor.call('admin.chambers.fetchChambersJson');
        }
    } else {
        chambers = await Meteor.call('admin.chambers.fetchChambersJson');
    }
    
    const chamberCount = chambers.length;
    console.log(`ADMIN: Processing ${chamberCount} chambers`);

    let processedChamberCount = 0;
    for (const chamber of chambers) {
      processedChamberCount++;

      const { name, province, currentMember } = chamber;
      const provinceCode = provinceCodes[province.toLowerCase()];

      if (!provinceCode) {
        console.error(`Invalid province: ${province} for chamber: ${name}`);
        continue;
      }

      // Generate SEO URL first for matching
      let seoUrl = name.toLowerCase()
        .replace(/—/g, '-')            // Replace em dash with dash
        .replace(/[^\w\s-]/g, '')      // Remove special characters except dash
        .replace(/\s+/g, '-')          // Replace spaces with dashes
        .replace(/-+/g, '-');          // Remove consecutive dashes

      // Find existing chamber by province and seoUrl
      const existingChamber = await Chambers.findOneAsync({ province: provinceCode, seoUrl });

      let lat = null, lng = null;
      if (REBUILD_GEO) {
        if (USE_EC_GEOSPATIAL && ecGeospatialData) {
          // Use cached Elections Canada SHP geospatial data
          try {
            // Find the matching riding in the cached SHP GeoJSON data
            const features = ecGeospatialData.geoJson?.features || [];
            const matchingFeature = features.find(feature =>
              feature.properties?.ED_NAMEE?.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(feature.properties?.ED_NAMEE?.toLowerCase())
            );

            if (matchingFeature) {
              // Compute centroid using Turf.js
              const turf = await import('@turf/turf');
              const centroid = turf.centroid(matchingFeature);
              [lng, lat] = centroid.geometry.coordinates; // [lng, lat] in WGS84
              console.log(`EC-SHP Geocoded: ${name} (${seoUrl}) - Lat: ${lat}, Lng: ${lng}`);
            } else {
              console.log(`EC-SHP: No exact match found for ${name}, using fallback geocoding`);
              // Fall back to geocoding with overrides
              const address = geocodingOverrides[name] || `${name}, ${province}, Canada`.trim();
              const geocodeUrl = `${BASE_URL}?address=${encodeURIComponent(address)}&key=${GEOCODING_API_KEY}`;

              const response = await fetch(geocodeUrl);
              const data = await response.json();

              if (data.status === 'OK' && data.results[0]?.geometry?.location) {
                const location = data.results[0].geometry.location;
                lat = location.lat;
                lng = location.lng;
                console.log(`EC-Fallback geocoded: ${name} (${seoUrl}) - Lat: ${lat}, Lng: ${lng}`);
              } else {
                console.warn(`EC-Fallback geocoding failed: ${name} (${seoUrl}) - ${data.status}`);
              }
            }
          } catch (ecError) {
            console.warn(`EC geospatial processing failed for ${name}, falling back to regular geocoding:`, ecError.message);
            // Fall back to regular geocoding
            const address = geocodingOverrides[name] || `${name}, ${province}, Canada`.trim();
            const geocodeUrl = `${BASE_URL}?address=${encodeURIComponent(address)}&key=${GEOCODING_API_KEY}`;

            try {
              const response = await fetch(geocodeUrl);
              const data = await response.json();

              if (data.status === 'OK' && data.results[0]?.geometry?.location) {
                const location = data.results[0].geometry.location;
                lat = location.lat;
                lng = location.lng;
                console.log(`Fallback geocoded: ${name} (${seoUrl}) - Lat: ${lat}, Lng: ${lng}`);
              } else {
                console.warn(`Fallback geocoding failed: ${name} (${seoUrl}) - ${data.status}`);
              }
            } catch (fallbackError) {
              console.error(`Fallback geocoding error for ${name} (${seoUrl}):`, fallbackError);
            }
          }
        } else {
          // Original geocoding logic
          const address = geocodingOverrides[name] || `${name}, ${province}, Canada`.trim();
          const geocodeUrl = `${BASE_URL}?address=${encodeURIComponent(address)}&key=${GEOCODING_API_KEY}`;

          try {
            const response = await fetch(geocodeUrl);
            const data = await response.json();

            if (data.status === 'OK' && data.results[0]?.geometry?.location) {
              const location = data.results[0].geometry.location;
              lat = location.lat;
              lng = location.lng;
              console.log(`Geocoded: ${name} (${seoUrl}) - Lat: ${lat}, Lng: ${lng}`);
            } else {
              console.warn(`Failed to geocode: ${name} (${seoUrl}) - ${data.status}`);
            }
          } catch (error) {
            console.error(`Error during geocoding: ${name} (${seoUrl})`, error);
          }
        }
      }

      try {
        const chamberData = {
          name,
          province: provinceCode,
          seoUrl,
          location: REBUILD_GEO && lat && lng ? { lat, lng } : existingChamber?.location,
          createdAt: existingChamber ? existingChamber.createdAt : new Date().getTime(),
          lastCheckedAt: new Date().getTime(),
          status: 'active',
          currentMember: currentMember,
          stats: existingChamber?.stats || {
            members: 0,
            posts: 0,
            comments: 0,
            bookmarks: 0,
            upvotes: 0,
            downvotes: 0,
            chambers: 0,
            boards: 0,
            businesses: 0,
            events: 0,
            followers: 0
          },
        };

        if (existingChamber) {
          await Chambers.updateAsync({ province: provinceCode, seoUrl }, { $set: chamberData });
          console.log(`Updated: ${name} (${seoUrl})`);
        } else {
          await Chambers.insertAsync(chamberData);
          console.log(`Inserted: ${name} (${seoUrl})`);
        }
      } catch (error) {
        console.error(`Error updating/inserting chamber: ${name} (${seoUrl})`, error);
      }

      // Add a delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
    }

    console.log('>>>>>>>>>>>>>> DONE <<<<<<<<<<<<');
    console.log(`ADMIN: Processed ${processedChamberCount} chambers`);
  },
});

// NOTE: The linter may complain about dynamic shapefile feature geometry typing and global Meteor collections.
// This project uses plain JavaScript with dynamic data; suppressing type warnings for geometry.coordinates and global collections.
// eslint-disable-next-line
