declare module 'unzipper'

declare module 'shapefile' {
  export function read(source: ArrayBuffer | Buffer, dbf?: ArrayBuffer | Buffer): Promise<{
    type: 'FeatureCollection'
    features: Array<{ type: 'Feature'; geometry: any; properties?: any }>
  }>
}
