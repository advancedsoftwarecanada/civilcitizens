// Minimal local fallback for 'geojson' types to ensure CI builds succeed
// This augments or provides 'geojson' typings if not available in the environment.
declare module 'geojson' {
  export interface GeoJsonProperties { [name: string]: any }
  export interface Geometry { type: string; coordinates: any }
  export interface Point extends Geometry { type: 'Point'; coordinates: [number, number] }
  export interface Polygon extends Geometry { type: 'Polygon'; coordinates: any[] }
  export interface MultiPolygon extends Geometry { type: 'MultiPolygon'; coordinates: any[] }
  export interface Feature<G extends Geometry = Geometry, P = GeoJsonProperties | null> { type: 'Feature'; geometry: G | null; properties: P }
  export interface FeatureCollection<G extends Geometry = Geometry, P = GeoJsonProperties | null> { type: 'FeatureCollection'; features: Array<Feature<G, P>> }
}
