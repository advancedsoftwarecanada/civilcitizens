declare module 'unzipper'

declare module 'shapefile' {
  import type { FeatureCollection } from 'geojson'

  export function read(source: ArrayBuffer | Buffer, dbf?: ArrayBuffer | Buffer): Promise<FeatureCollection>
}
