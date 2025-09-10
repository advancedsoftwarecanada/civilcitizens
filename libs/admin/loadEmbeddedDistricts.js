// Loads preprocessed federal electoral districts from private assets (TopoJSON)
// and builds the same processed cache structure used by the dynamic SHP pipeline.

if (Meteor.isServer) {
  global.loadEmbeddedDistricts = async function loadEmbeddedDistricts(version = '2025.v1') {
    if (global.EC_GEO_CACHE && global.EC_GEO_CACHE.version === version && global.EC_GEO_CACHE.processed?.length) {
      return global.EC_GEO_CACHE;
    }

    const fs = await import('fs');
    const topojson = await import('topojson-client');

    // Asset path (placed via private/ folder)
    const filename = 'fed_2025.topo.json';
    try {
      const raw = Assets.getText(filename); // Meteor private asset
  const topo = JSON.parse(raw);
  // Expect an object like { type: 'Topology', objects: { districts: {...} } }
  const geo = topojson.feature(topo, topo.objects.districts);
  const featureList = (geo && geo.type === 'FeatureCollection' && Array.isArray(geo.features)) ? geo.features : [];

      function fixEncoding(str) {
        if (!str) return str;
        const map = { 'â€”': '—', 'â€“': '–', 'Ã©': 'é', 'Ã¨': 'è', 'Ã´': 'ô', 'Ã¢': 'â', 'Ã§': 'ç' };
        let out = str; Object.keys(map).forEach(k => out = out.split(k).join(map[k])); return out;
      }
      function slugify(str) {
        return fixEncoding(str)
          .toLowerCase()
          .replace(/—|–/g, '-')
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-');
      }
      function computeBBox(coords, bbox) {
        if (typeof coords[0] === 'number') {
          const [lng, lat] = coords; if (!bbox) return [lng, lat, lng, lat];
          if (lng < bbox[0]) bbox[0] = lng; if (lat < bbox[1]) bbox[1] = lat;
          if (lng > bbox[2]) bbox[2] = lng; if (lat > bbox[3]) bbox[3] = lat; return bbox;
        }
        return coords.reduce((b, sub) => computeBBox(sub, b), bbox);
      }

      const processed = [];
      const nameIndex = {};
  for (const f of featureList) {
        const name = fixEncoding(f.properties?.ED_NAMEE || f.properties?.ED_NAMEF || '');
        const slug = slugify(name);
        const bbox = computeBBox(f.geometry.coordinates, null);
        const entry = { name, slug, bbox, geometry: f.geometry };
        processed.push(entry); nameIndex[slug] = entry;
      }

      global.EC_GEO_CACHE = {
        success: true,
        version,
        format: 'topojson',
        parsedFeatures: processed.length,
        processed,
        nameIndex,
        message: 'Loaded embedded TopoJSON districts',
        fetchedAt: new Date()
      };
      console.log(`[DISTRICTS] Loaded embedded TopoJSON: ${processed.length} features (v ${version})`);
      return global.EC_GEO_CACHE;
    } catch (e) {
      console.error('Failed loading embedded TopoJSON districts:', e.message);
      throw e;
    }
  };
}
