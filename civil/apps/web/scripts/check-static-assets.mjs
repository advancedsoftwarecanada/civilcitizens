const targetUrl = process.argv[2] ?? process.env.CIVIL_ASSET_SMOKE_URL ?? 'https://dev.civilcitizens.ca/profile/edit'

function collectStaticAssets(html) {
  return [...new Set([...html.matchAll(/\/_next\/static[^"' >]+/g)].map((match) => match[0]))]
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' })
  const body = await response.text()
  return { response, body }
}

async function main() {
  const pageUrl = new URL(targetUrl)
  const { response: pageResponse, body: html } = await fetchText(pageUrl)

  if (!pageResponse.ok) {
    throw new Error(`page request failed: ${pageResponse.status} ${pageUrl}`)
  }

  const assets = collectStaticAssets(html)

  if (assets.length === 0) {
    throw new Error(`no Next static assets found in ${pageUrl}`)
  }

  const failures = []

  for (const assetPath of assets) {
    const assetUrl = new URL(assetPath, pageUrl)
    const assetResponse = await fetch(assetUrl, { redirect: 'follow' })
    if (!assetResponse.ok) {
      failures.push(`${assetResponse.status} ${assetUrl}`)
    }
    await assetResponse.arrayBuffer()
  }

  if (failures.length > 0) {
    throw new Error(`static asset failures:\n${failures.join('\n')}`)
  }

  process.stdout.write(`verified ${assets.length} static assets from ${pageUrl}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
