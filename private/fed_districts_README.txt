Place the preprocessed TopoJSON file (fed_2025.topo.json) generated offline here.
Generation outline:
1. ogr2ogr -t_srs EPSG:4326 fed_2025.geojson FED_CA_2025_EN.shp
2. npx mapshaper fed_2025.geojson -simplify 5% keep-shapes -o format=geojson fed_2025_simplified.geojson
3. npx geo2topo districts=fed_2025_simplified.geojson > fed_2025.topo.json
4. (Optional) gzip: gzip -k fed_2025.topo.json
5. Copy fed_2025.topo.json into this folder (Meteor private assets)
