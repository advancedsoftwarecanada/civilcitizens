const mime = require('mime'); // Ensure this is installed (npm install mime)
const path = require('path');

WebApp.connectHandlers.use('/api/files/:id', async (req, res) => {
  const { id } = req.params; // Use `id` from the URL path

  if (!id) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('File ID is required.');
    return;
  }

  try {
    // Fetch file metadata asynchronously from the database
    const file = await Files.findOneAsync({ _id: id });

    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found.');
      return;
    }

    // Redirect to the full CDN URL
    const fileUrl = file.url;

    res.writeHead(302, { Location: fileUrl });
    res.end();
  } catch (error) {
    console.error('Error fetching file:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error.');
  }
});
