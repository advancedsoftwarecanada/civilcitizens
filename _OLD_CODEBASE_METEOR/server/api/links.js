const https = require('https');
const http = require('http');
const { JSDOM } = require('jsdom');
const url = require('url');
const zlib = require('zlib');
const { WebApp } = require('meteor/webapp');

// Add body parser middleware for JSON parsing (applied globally like posts API)
const bodyParser = require('body-parser');
WebApp.connectHandlers.use(bodyParser.json({ limit: '10mb' }));

async function fetchUrlMetadata(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    // Limit redirects to prevent infinite loops
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (error) {
      reject(new Error('Invalid URL format'));
      return;
    }
    
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreview/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000 // 10 second timeout
    };

    const req = client.request(options, (res) => {
      let chunks = [];

      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, targetUrl).href;
        return fetchUrlMetadata(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
      }

      // Check content type
      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('text/html')) {
        return resolve({
          url: targetUrl,
          title: parsedUrl.hostname,
          description: 'Link to external content',
          image: null
        });
      }

      res.on('data', (chunk) => {
        chunks.push(chunk);
        // Limit response size to prevent memory issues
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (totalLength > 500000) {
          req.destroy();
          return resolve({
            url: targetUrl,
            title: parsedUrl.hostname,
            description: 'Content too large to preview',
            image: null
          });
        }
      });

      res.on('end', async () => {
        const buffer = Buffer.concat(chunks);
        console.log('🔗 Raw response received, length:', buffer.length);
        console.log('🔗 Content-Encoding:', res.headers['content-encoding']);
        console.log('🔗 First 100 bytes of raw data:', buffer.slice(0, 100).toString());

        // Handle compressed responses
        const contentEncoding = res.headers['content-encoding'];

        // Function to check if data looks like HTML
        const looksLikeHtml = (data) => {
          const text = data.toString();
          return text.includes('<html') || text.includes('<!DOCTYPE') || text.includes('<head') || text.includes('<body');
        };

        // Function to get charset from content-type header
        const getCharset = (contentType) => {
          const match = contentType.match(/charset=([^;]+)/i);
          return match ? match[1].toLowerCase() : 'utf-8';
        };

        // Function to try decompression
        const tryDecompression = (data, encoding) => {
          return new Promise((resolve) => {
            console.log('🔗 Buffer length:', data.length);
            console.log('🔗 Buffer first 50 bytes as hex:', data.slice(0, 50).toString('hex'));

            if (encoding === 'gzip') {
              zlib.gunzip(data, (err, decompressed) => {
                if (!err) {
                  console.log('🔗 Gzip decompression successful, decompressed length:', decompressed.length);
                  const text = decompressed.toString();
                  if (looksLikeHtml(decompressed)) {
                    console.log('🔗 Decompressed content looks like HTML');
                    resolve(text);
                  } else {
                    console.log('🔗 Decompressed content does not look like HTML');
                    resolve(text); // Still return it, might be valid
                  }
                } else {
                  console.log('🔗 Gzip decompression failed:', err.message);
                  // Check if the "compressed" data is actually already uncompressed HTML
                  const charset = getCharset(res.headers['content-type'] || '');
                  const rawText = data.toString(charset, 0, Math.min(data.length, 100000));
                  if (looksLikeHtml(Buffer.from(rawText))) {
                    console.log('🔗 Raw data appears to be uncompressed HTML despite gzip header');
                    resolve(rawText);
                  } else {
                    console.log('🔗 Raw data is not HTML, trying deflate');
                    // Try deflate as fallback
                    zlib.inflate(data, (err2, decompressed2) => {
                      if (!err2) {
                        console.log('🔗 Deflate decompression successful, decompressed length:', decompressed2.length);
                        const text = decompressed2.toString();
                        if (looksLikeHtml(decompressed2)) {
                          console.log('🔗 Deflate decompressed content looks like HTML');
                          resolve(text);
                        } else {
                          console.log('🔗 Deflate decompressed content does not look like HTML');
                          resolve(text); // Still return it
                        }
                      } else {
                        console.log('🔗 All decompression attempts failed, trying brotli');
                        // Try brotli as final fallback
                        zlib.brotliDecompress(data, (err3, decompressed3) => {
                          if (!err3) {
                            console.log('🔗 Brotli decompression successful, decompressed length:', decompressed3.length);
                            const text = decompressed3.toString();
                            if (looksLikeHtml(decompressed3)) {
                              console.log('🔗 Brotli decompressed content looks like HTML');
                              resolve(text);
                            } else {
                              console.log('🔗 Brotli decompressed content does not look like HTML');
                              resolve(text);
                            }
                          } else {
                            console.log('🔗 All decompression attempts failed, giving up');
                            resolve(null);
                          }
                        });
                      }
                    });
                  }
                }
              });
            } else if (encoding === 'deflate') {
              zlib.inflate(data, (err, decompressed) => {
                if (!err) {
                  console.log('🔗 Deflate decompression successful, decompressed length:', decompressed.length);
                  const text = decompressed.toString();
                  if (looksLikeHtml(decompressed)) {
                    console.log('🔗 Deflate decompressed content looks like HTML');
                    resolve(text);
                  } else {
                    console.log('🔗 Deflate decompressed content does not look like HTML');
                    resolve(text);
                  }
                } else {
                  console.log('🔗 Deflate decompression failed:', err.message, 'trying gzip');
                  // Try gzip as fallback
                  zlib.gunzip(data, (err2, decompressed2) => {
                    if (!err2) {
                      console.log('🔗 Gzip decompression successful (fallback), decompressed length:', decompressed2.length);
                      const text = decompressed2.toString();
                      if (looksLikeHtml(decompressed2)) {
                        console.log('🔗 Gzip fallback decompressed content looks like HTML');
                        resolve(text);
                      } else {
                        console.log('🔗 Gzip fallback decompressed content does not look like HTML');
                        resolve(text);
                      }
                    } else {
                      console.log('🔗 Gzip fallback failed, trying brotli');
                      zlib.brotliDecompress(data, (err3, decompressed3) => {
                        if (!err3) {
                          console.log('🔗 Brotli decompression successful, decompressed length:', decompressed3.length);
                          const text = decompressed3.toString();
                          if (looksLikeHtml(decompressed3)) {
                            console.log('🔗 Brotli decompressed content looks like HTML');
                            resolve(text);
                          } else {
                            console.log('🔗 Brotli decompressed content does not look like HTML');
                            resolve(text);
                          }
                        } else {
                          console.log('🔗 All decompression attempts failed, trying raw text');
                          const charset = getCharset(res.headers['content-type'] || '');
                          const rawText = data.toString(charset, 0, Math.min(data.length, 100000));
                          if (looksLikeHtml(Buffer.from(rawText))) {
                            console.log('🔗 Raw content looks like HTML');
                            resolve(rawText);
                          } else {
                            console.log('🔗 Raw content does not look like HTML, giving up');
                            resolve(null);
                          }
                        }
                      });
                    }
                  });
                }
              });
            } else if (encoding === 'br') {
              zlib.brotliDecompress(data, (err, decompressed) => {
                if (!err) {
                  console.log('🔗 Brotli decompression successful, decompressed length:', decompressed.length);
                  const text = decompressed.toString();
                  if (looksLikeHtml(decompressed)) {
                    console.log('🔗 Brotli decompressed content looks like HTML');
                    resolve(text);
                  } else {
                    console.log('🔗 Brotli decompressed content does not look like HTML');
                    resolve(text);
                  }
                } else {
                  console.log('🔗 Brotli decompression failed:', err.message, 'trying gzip');
                  // Try gzip as fallback
                  zlib.gunzip(data, (err2, decompressed2) => {
                    if (!err2) {
                      console.log('🔗 Gzip decompression successful (fallback), decompressed length:', decompressed2.length);
                      const text = decompressed2.toString();
                      if (looksLikeHtml(decompressed2)) {
                        console.log('🔗 Gzip fallback decompressed content looks like HTML');
                        resolve(text);
                      } else {
                        console.log('🔗 Gzip fallback decompressed content does not look like HTML');
                        resolve(text);
                      }
                    } else {
                      console.log('🔗 Gzip fallback failed, trying deflate');
                      zlib.inflate(data, (err3, decompressed3) => {
                        if (!err3) {
                          console.log('🔗 Deflate decompression successful, decompressed length:', decompressed3.length);
                          const text = decompressed3.toString();
                          if (looksLikeHtml(decompressed3)) {
                            console.log('🔗 Deflate decompressed content looks like HTML');
                            resolve(text);
                          } else {
                            console.log('🔗 Deflate decompressed content does not look like HTML');
                            resolve(text);
                          }
                        } else {
                          console.log('🔗 All decompression attempts failed, trying raw text');
                          const charset = getCharset(res.headers['content-type'] || '');
                          const rawText = data.toString(charset, 0, Math.min(data.length, 100000));
                          if (looksLikeHtml(Buffer.from(rawText))) {
                            console.log('🔗 Raw content looks like HTML');
                            resolve(rawText);
                          } else {
                            console.log('🔗 Raw content does not look like HTML, giving up');
                            resolve(null);
                          }
                        }
                      });
                    }
                  });
                }
              });
            } else {
              console.log('🔗 No compression encoding specified, trying raw text');
              const charset = getCharset(res.headers['content-type'] || '');
              const rawText = data.toString(charset, 0, Math.min(data.length, 100000));
              if (looksLikeHtml(Buffer.from(rawText))) {
                console.log('🔗 Raw content looks like HTML');
                resolve(rawText);
              } else {
                console.log('🔗 Raw content does not look like HTML');
                resolve(null);
              }
            }
          });
        };

        // Try to decompress the content
        const decompressedHtml = await tryDecompression(buffer, contentEncoding);

        if (decompressedHtml === null) {
          console.log('🔗 Unable to decompress or parse content, returning fallback');
          resolve({
            url: targetUrl,
            title: parsedUrl.hostname || 'Unknown',
            description: 'Unable to parse website content',
            image: null
          });
          return;
        }

        processHtml(decompressedHtml);

        function processHtml(htmlContent) {
          try {
            const metadata = extractMetadata(htmlContent, targetUrl);
            resolve(metadata);
          } catch (error) {
            console.error('Error extracting metadata:', error);
            resolve({
              url: targetUrl,
              title: parsedUrl.hostname || 'Unknown',
              description: 'Unable to extract preview',
              image: null
            });
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

// Function to extract metadata from HTML
function extractMetadata(html, originalUrl) {
  console.log('🔗 Extracting metadata from HTML, length:', html.length);
  console.log('🔗 First 500 chars of HTML:', html.substring(0, 500));

  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Extract Open Graph metadata
  const getMetaContent = (property) => {
    const element = document.querySelector(`meta[property="${property}"]`) ||
                   document.querySelector(`meta[name="${property}"]`);
    const content = element ? element.getAttribute('content') : null;
    console.log(`🔗 Meta tag ${property}:`, content);
    return content;
  };

  // Extract title
  let title = getMetaContent('og:title') ||
              getMetaContent('twitter:title') ||
              document.querySelector('title')?.textContent ||
              document.querySelector('h1')?.textContent ||
              'No title available';

  console.log('🔗 Title found:', title);

  // Clean up title
  title = title.trim().replace(/\s+/g, ' ');

  // Extract description
  let description = getMetaContent('og:description') ||
                   getMetaContent('twitter:description') ||
                   getMetaContent('description') ||
                   document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                   document.querySelector('p')?.textContent ||
                   'No description available';

  console.log('🔗 Description found:', description);

  // Clean up description
  description = description.trim().replace(/\s+/g, ' ').substring(0, 200);

  // Extract image
  let image = getMetaContent('og:image') ||
             getMetaContent('twitter:image') ||
             getMetaContent('twitter:image:src');

  console.log('🔗 Image found:', image);

  // Make image URL absolute if it's relative
  if (image && !image.startsWith('http')) {
    try {
      const baseUrl = new URL(originalUrl);
      if (image.startsWith('//')) {
        image = baseUrl.protocol + image;
      } else if (image.startsWith('/')) {
        image = `${baseUrl.protocol}//${baseUrl.host}${image}`;
      } else {
        image = new URL(image, originalUrl).href;
      }
      console.log('🔗 Image URL made absolute:', image);
    } catch (error) {
      console.warn('🔗 Failed to resolve image URL:', error);
    }
  }

  const result = {
    url: originalUrl,
    title: title,
    description: description,
    image: image
  };

  console.log('🔗 Final metadata result:', result);
  return result;
}

// Mount the specific endpoint to Meteor's WebApp using connectHandlers
WebApp.connectHandlers.use('/api/links', async (req, res) => {
  console.log('🔗 Link preview request received (connect handler)');
  console.log('🔗 Request method:', req.method);
  console.log('🔗 Request URL:', req.url);
  console.log('🔗 Content-Type:', req.headers['content-type']);
  console.log('🔗 Content-Length:', req.headers['content-length']);

  // Only handle POST requests to /preview
  if (req.method !== 'POST' || req.url !== '/preview') {
    console.log('🔗 Method not allowed or wrong path:', req.method, req.url);
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Method not allowed' }));
    return;
  }

  try {
    console.log('🔗 Processing POST request');

    // Use body-parser to get the JSON data
    const { url: targetUrl } = req.body || {};
    console.log('🔗 Successfully parsed JSON, URL:', targetUrl);

    if (!targetUrl) {
      console.log('🔗 No URL provided');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        message: 'URL is required'
      }));
      return;
    }

    // Validate URL format
    try {
      new URL(targetUrl);
      console.log('🔗 URL validation passed');
    } catch (error) {
      console.log('🔗 URL validation failed:', error.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'error',
        message: 'Invalid URL format'
      }));
      return;
    }

    console.log('🔗 Fetching metadata for:', targetUrl);
    // Fetch the URL content
    const metadata = await fetchUrlMetadata(targetUrl);
    console.log('🔗 Metadata fetched successfully:', metadata.title);

    console.log('🔗 Sending success response');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'success',
      metadata: metadata
    }));

  } catch (error) {
    console.error('🔗 Error processing request:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'error',
      message: 'Failed to fetch link preview'
    }));
  }

  // Add timeout to prevent hanging
  setTimeout(() => {
    if (!res.headersSent) {
      console.log('🔗 Request timeout, sending response');
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'Request timeout' }));
    }
  }, 30000); // 30 second timeout
});