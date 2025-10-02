console.log("Loaded: chambers.js");

if (Meteor.isServer) {
    Meteor.methods({
        async 'chambers.setHomeChamber'(theProvince, theChamber) {
            check(theProvince, String);
            check(theChamber, String);

            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            const userMeta = await UserMeta.findOneAsync({ ownerUserId: this.userId });
            if (!userMeta) {
                throw new Meteor.Error('user-meta-not-found');
            }

            console.log("SEARCHING FOR HOME CHAMBER:", theProvince, theChamber, this.userId);

            // Remove any existing home chamber
            const existingHomeChamber = await ChamberFollows.findOneAsync({ userId: this.userId, home: true });
            if (existingHomeChamber) {
                await ChamberFollows.removeAsync({ _id: existingHomeChamber._id });
                await Chambers.updateAsync({ province: existingHomeChamber.province, seoUrl: existingHomeChamber.chamber }, { $inc: { 'stats.members': -1 } });
            }

            // Check if the specific chamber already exists
            const chamberFollow = await ChamberFollows.findOneAsync({
                userId: this.userId,
                province: theProvince,
                chamber: theChamber,
            });

            if (chamberFollow) {
                console.log("Updating chamberFollow to set as home");

                // Update existing chamberFollow to set as home
                await ChamberFollows.updateAsync(
                    { _id: chamberFollow._id },
                    { $set: { home: true } }
                );
            } else {
                console.log("Inserting new chamberFollow as home");

                // Insert new chamberFollow as home
                await ChamberFollows.insertAsync({
                    userId: this.userId,
                    province: theProvince,
                    chamber: theChamber,
                    home: true,
                });
            }

            // Increment the members stat for the new home chamber
            await Chambers.updateAsync({ province: theProvince, seoUrl: theChamber }, { $inc: { 'stats.members': 1 } });

            return { status: 'success', message: 'Home chamber set successfully.' };
        },

        'chambers.follow': async function ({ userId, province, chamber }) {
            check(province, String);
            check(chamber, String);

            if (!userId) {
                throw new Meteor.Error('not-authorized');
            }

            const chamberFollow = await ChamberFollows.findOneAsync({
                userId: userId,
                province: province,
                chamber: chamber,
            });

            if (chamberFollow) {
                throw new Meteor.Error('already-following', 'You are already following this chamber.');
            }

            await ChamberFollows.insertAsync({
                userId: userId,
                province: province,
                chamber: chamber,
                home: false,
            });

            await Chambers.updateAsync({ province: province, seoUrl: chamber }, { $inc: { 'stats.followers': 1 } });

            return { status: 'success', message: 'Chamber followed successfully.' };
        },

        'chambers.unfollow': async function ({ userId, province, chamber }) {
            console.log("UNFOLLOWING CHAMBER", userId, province, chamber);

            check(province, String);
            check(chamber, String);

            if (!userId) {
                throw new Meteor.Error('not-authorized');
            }

            const chamberFollow = await ChamberFollows.findOneAsync({
                userId: userId,
                province: province,
                chamber: chamber,
            });

            if (!chamberFollow) {
                throw new Meteor.Error('not-following', 'You are not following this chamber.');
            }

            await ChamberFollows.removeAsync({ _id: chamberFollow._id });

            await Chambers.updateAsync({ province: province, seoUrl: chamber }, { $inc: { 'stats.followers': -1 } });

            return { status: 'success', message: 'Chamber unfollowed successfully.' };
        },

        // Find nearest chamber to supplied coordinates (simple Haversine over all chambers)
        async 'chambers.findNearest'(lat, lng) {
            check(lat, Number);
            check(lng, Number);

            // Optional auth: allow only logged-in to reduce abuse (can relax later)
            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            const raw = Chambers.rawCollection();
            const chambers = await raw.find({ 'location.lat': { $exists: true }, 'location.lng': { $exists: true } }, { projection: { province: 1, seoUrl: 1, name: 1, location: 1 } }).toArray();
            if (!chambers.length) {
                return null;
            }

            const R = 6371; // km
            let best = null;
            for (const c of chambers) {
                const dLat = (c.location.lat - lat) * Math.PI / 180;
                const dLng = (c.location.lng - lng) * Math.PI / 180;
                const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat*Math.PI/180)*Math.cos(c.location.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
                const d = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                if (!best || d < best.distanceKm) {
                    best = { province: c.province, seoUrl: c.seoUrl, name: c.name, distanceKm: Number(d.toFixed(1)) };
                }
            }
            return best;
        },

        // Return up to N nearest chambers
        async 'chambers.findNearestMany'(lat, lng, limit = 5) {
            check(lat, Number);
            check(lng, Number);
            check(limit, Number);
            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }
            if (limit > 25) limit = 25; // safety cap
            const raw = Chambers.rawCollection();
            const chambers = await raw.find({ 'location.lat': { $exists: true }, 'location.lng': { $exists: true } }, { projection: { province: 1, seoUrl: 1, name: 1, location: 1 } }).toArray();
            if (!chambers.length) return [];
            const R = 6371;
            const scored = chambers.map(c => {
                const dLat = (c.location.lat - lat) * Math.PI / 180;
                const dLng = (c.location.lng - lng) * Math.PI / 180;
                const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat*Math.PI/180)*Math.cos(c.location.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
                const d = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                return { province: c.province, seoUrl: c.seoUrl, name: c.name, distanceKm: Number(d.toFixed(1)) };
            });
            scored.sort((a,b)=> a.distanceKm - b.distanceKm);
            return scored.slice(0, limit);
        },

        // Find chamber containing user's coordinates using Elections Canada polygons (geofencing)
        async 'chambers.findContainingPolygon'(lat, lng) {
            check(lat, Number);
            check(lng, Number);

            if (!this.userId) {
                throw new Meteor.Error('not-authorized');
            }

            try {
                // Download and cache EC geospatial data
                const ecGeospatialData = await Meteor.call('admin.chambers.downloadECGeospatialData');

                if (!ecGeospatialData || !ecGeospatialData.geoJson) {
                    console.warn('EC geospatial data not available, falling back to nearest centroid');
                    return await Meteor.call('chambers.findNearest', lat, lng);
                }

                const turf = await import('@turf/turf');
                const point = turf.point([lng, lat]); // Turf expects [lng, lat]
                console.log(`Testing point: [${lng}, ${lat}]`);

                const processed = ecGeospatialData.processed || [];
                if (!processed.length) {
                    console.warn('No processed EC features available');
                    return await Meteor.call('chambers.findNearest', lat, lng);
                }

                // Precompute a cheap bounding box filter in projected -> we will reproject a minimal ring just to derive bbox if necessary.
                // Since we now reproject feature coordinates on-the-fly, we can derive bbox after reprojection per feature; for speed we keep first-hit winner.

                function normalizeName(str){
                    return str
                        .toLowerCase()
                        .replace(/—|–/g,'-')
                        .replace(/[^a-z0-9\s-]/g,'')
                        .replace(/\s+/g,'-')
                        .replace(/-+/g,'-');
                }

                const pointNorm = { lat, lng };

                // Prepare proj4 converter once (Lambert Conformal Conic NAD83 -> WGS84)
                let projConverter = null;
                if (ecGeospatialData.prjString) {
                    try {
                        const proj4 = await import('proj4');
                        // Use stored prj string as source, WGS84 as target
                        projConverter = proj4.default(ecGeospatialData.prjString, 'EPSG:4326');
                    } catch (e) {
                        console.warn('proj4 init failed, proceeding without reprojection (may break geofencing)', e.message);
                    }
                }

                // Find which polygon contains the user's point
                // Fast prefilter by simple bbox first
                for (const feat of processed) {
                    const feature = { properties: { ED_NAMEE: feat.name }, geometry: feat.geometry };
                    if (feat.geometry && (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon')) {
                        try {
                            const ridingName = feature.properties?.ED_NAMEE;
                            if (!ridingName) continue;

                            const [minLng, minLat, maxLng, maxLat] = feat.bbox;
                            if (lng < minLng - 0.2 || lng > maxLng + 0.2 || lat < minLat - 0.2 || lat > maxLat + 0.2) {
                                continue; // outside bbox with small padding
                            }

                            console.log(`Checking polygon (bbox pass) for: ${ridingName}`);
                            // Reproject coordinates lazily (without mutating original) if needed
                            const reprojGeometry = feature.geometry; // already WGS84 from preprocessing

                            let isInside = false;
                            let polygonForDistance;

                            if (reprojGeometry.type === 'Polygon') {
                                polygonForDistance = turf.polygon(reprojGeometry.coordinates);
                                isInside = turf.booleanPointInPolygon(point, polygonForDistance);
                            } else if (reprojGeometry.type === 'MultiPolygon') {
                                polygonForDistance = turf.multiPolygon(reprojGeometry.coordinates);
                                for (const polyCoords of reprojGeometry.coordinates) {
                                    const poly = turf.polygon(polyCoords);
                                    if (turf.booleanPointInPolygon(point, poly)) { isInside = true; break; }
                                }
                            }

                            // Debug: check distance to the polygon
                            const distance = turf.pointToPolygonDistance(point, polygonForDistance, {units: 'kilometers'});
                            console.log(`Distance from point to ${ridingName} polygon: ${distance.toFixed(2)} km`);

                            if (!isInside) {
                                // Attempt slight buffer (50 meters) for edge cases
                                const buffered = turf.buffer(point, 0.05, { units: 'kilometers'});
                                if (reprojGeometry.type === 'Polygon') {
                                    if (turf.booleanIntersects(buffered, polygonForDistance)) isInside = true;
                                } else if (reprojGeometry.type === 'MultiPolygon') {
                                    for (const polyCoords of reprojGeometry.coordinates) {
                                        const poly = turf.polygon(polyCoords);
                                        if (turf.booleanIntersects(buffered, poly)) { isInside = true; break; }
                                    }
                                }
                                if (isInside) console.log(`Edge buffer catch: ${ridingName}`);
                            }

                            if (isInside) {
                                console.log(`✅ FOUND: Point is inside ${ridingName} polygon!`);

                                // Find the corresponding chamber in our database
                                const seoUrl = normalizeName(ridingName);

                                // Fuzzy: also try stripping trailing descriptors if any mismatch
                                const alt = seoUrl.replace(/-(federal|district|riding)$/,'');

                                // Try to find by exact name match first
                                let chamber = await Chambers.findOneAsync({ $or: [ { name: ridingName }, { seoUrl }, { seoUrl: alt } ] });

                                if (chamber) {
                                    return {
                                        province: chamber.province,
                                        seoUrl: chamber.seoUrl,
                                        name: chamber.name,
                                        method: 'geofenced',
                                        confidence: 'high'
                                    };
                                } else {
                                    console.log(`Chamber not found in database: ${ridingName} (${seoUrl})`);
                                }
                            }
                        } catch (polygonError) {
                            console.warn(`Error processing polygon for ${feature.properties?.ED_NAMEE}:`, polygonError.message);
                        }
                    }
                }

                // No polygon contained the point, fall back to nearest centroid
                console.log(`No polygon found containing point (${lat}, ${lng}), falling back to nearest centroid`);
                return await Meteor.call('chambers.findNearest', lat, lng);

            } catch (error) {
                console.error('Error in geofencing:', error);
                // Fall back to nearest centroid method
                return await Meteor.call('chambers.findNearest', lat, lng);
            }
        },
    });
}


Meteor.methods({

    // Submit a new post
    'chambers.do': async function ({ }) {

    },

    //

});
