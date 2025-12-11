import Script from 'next/script'

/**
 * GoogleAnalytics component
 * 
 * Only loads Google Analytics tracking when NEXT_PUBLIC_GTAG_ID is set.
 * This allows us to enable GA in production while keeping it disabled in development.
 */
export default function GoogleAnalytics() {
  const gtagId = process.env.NEXT_PUBLIC_GTAG_ID

  // Don't render anything if GTAG ID is not configured
  if (!gtagId) {
    return null
  }

  // Validate GA tag format (G-XXXXXXXXXX or GT-XXXXXXXXXX or AW-XXXXXXXXXX)
  const isValidGtagId = /^(G|GT|AW)-[A-Z0-9]+$/.test(gtagId)
  if (!isValidGtagId) {
    console.error(`Invalid NEXT_PUBLIC_GTAG_ID format: ${gtagId}`)
    return null
  }

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`}
      />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${gtagId}');
          `,
        }}
      />
    </>
  )
}
