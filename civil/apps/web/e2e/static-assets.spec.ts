import { expect, test } from '@playwright/test'

function decodeHtmlAttribute(value: string) {
  return value.replace(/&amp;/g, '&')
}

function extractStaticAssets(html: string) {
  const assets = new Set<string>()
  const attributePattern = /(?:href|src)=["'](\/_next\/static\/[^"'<>]+)["']/g

  let match = attributePattern.exec(html)
  while (match) {
    assets.add(decodeHtmlAttribute(match[1]))
    match = attributePattern.exec(html)
  }

  return [...assets]
}

function expectedContentType(assetPath: string) {
  if (assetPath.includes('.css')) return 'text/css'
  if (assetPath.includes('.js')) return 'javascript'
  return ''
}

test.describe('App shell assets', () => {
  test('profile edit page serves all referenced Next static assets', async ({ request }) => {
    const pageResponse = await request.get('/profile/edit')
    expect(pageResponse.ok(), `profile edit page returned ${pageResponse.status()}`).toBeTruthy()

    const html = await pageResponse.text()
    const assets = extractStaticAssets(html)

    expect(assets.length, 'expected profile edit page to reference Next static assets').toBeGreaterThan(0)

    for (const assetPath of assets) {
      const assetResponse = await request.get(assetPath)
      expect(assetResponse.ok(), `${assetPath} returned ${assetResponse.status()}`).toBeTruthy()

      const expectedType = expectedContentType(assetPath)
      if (!expectedType) continue

      const contentType = assetResponse.headers()['content-type'] ?? ''
      expect(
        contentType.toLowerCase(),
        `${assetPath} returned unexpected content type ${contentType || '<missing>'}`,
      ).toContain(expectedType)
    }
  })
})
