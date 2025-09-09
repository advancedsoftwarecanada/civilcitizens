// Global declarations for Meteor collections and WebApp
/* global Files, Posts, UserMeta, Accounts, Random */

import { WebApp } from 'meteor/webapp';

const mime = require('mime'); // Ensure this is installed (npm install mime)
const path = require('path');
const multer = require('multer');
const fs = require('fs-extra');
const graphicsMagick = require('gm');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(process.env.PWD, 'uploads/temp');
    fs.ensureDirSync(tempDir);
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Configuration
const filesPath = Meteor.settings.public.filesPath;
const cdnPath = Meteor.settings.public.cdnPath;

// Function to determine the disk for a file
function getDiskForFile() {
  return 'disk1';
}

// Accepted image types
const acceptedImageTypes = ['png', 'jpeg', 'jpg', 'webp'];

// Accepted video types
const acceptedVideoTypes = ['mp4', 'avi', 'mov', 'mkv'];

// Create a simple MongoDB collection for API file uploads
const ApiFiles = new Mongo.Collection('apiFiles');

// Process uploaded file
async function processUploadedFile(file, meta) {
  const disk = getDiskForFile();
  const fileId = Random.id();
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const fileUrl = `${cdnPath}/uploads/${disk}/${fileId}.${ext}`;
  const outputPath = `${filesPath}/uploads/${disk}/${fileId}.${ext}`;

  // Ensure directory exists
  fs.ensureDirSync(`${filesPath}/uploads/${disk}`);

  // Validate file type
  if (!acceptedImageTypes.includes(ext) && !acceptedVideoTypes.includes(ext)) {
    throw new Meteor.Error('unsupported-file-type', 'Unsupported file type.');
  }

  // Create file document in API files collection
  const fileDoc = {
    _id: fileId,
    name: file.originalname,
    size: file.size,
    type: file.mimetype,
    ext: ext,
    userId: meta.userId,
    meta: meta,
    createdAt: new Date(),
    url: fileUrl,
    filePath: `/uploads/disk1/${fileId}.${ext}`,
    uploadedAt: new Date(),
    processing: false,
    disk: 'disk1',
    file_reference_id: fileId,
  };

  // Insert into API files collection
  const insertedId = await ApiFiles.insertAsync(fileDoc);
  console.log('Inserted API file with ID:', insertedId);

  // For now, just move the file without processing to test basic functionality
  try {
    await fs.move(file.path, outputPath);

    // Associate with draft post if provided
    if (meta.draftPostId) {
      const postId = meta.draftPostId;
      await Posts.updateAsync(postId, { $push: { images: { id: fileId, url: fileUrl, size: meta.size } } });
    }

    // Clean up temp file
    Meteor.setTimeout(() => {
      fs.remove(file.path.replace(path.basename(file.path), ''), (removeErr) => {
        if (removeErr) {
          console.error('Error removing temp file:', removeErr);
        }
      });
    }, 5000);

  } catch (error) {
    console.error('Error processing file:', error);
    throw new Meteor.Error('file-processing-failed', 'Error processing file.');
  }

  return fileId;
}

// POST /api/files/upload - Upload a file
WebApp.connectHandlers.use('/api/files/upload', upload.single('file'), async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }

  try {
    // Extract the Authorization header
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Missing or invalid token.' }));
      return;
    }

    // Extract and validate the token
    const token = authHeader.replace('Bearer ', '');
    const hashedToken = Accounts._hashLoginToken(token);
    const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });

    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid token.' }));
      return;
    }

    const userId = user._id;

    if (!req.file) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No file uploaded.' }));
      return;
    }

    // Prepare metadata
    const meta = {
      userId: userId,
      type: req.body.type || 'unknown',
      processing: req.body.processing === 'true',
      timeCreated: parseInt(req.body.timeCreated) || Date.now(),
      timeAgo: req.body.timeAgo || new Date().toISOString(),
      draftPostId: req.body.draftPostId || req.body.postId || null,
      size: req.file.size,
    };

    // Process the uploaded file
    const fileId = await processUploadedFile(req.file, meta);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', fileId, message: 'File uploaded successfully.' }));

  } catch (error) {
    console.error('Error uploading file:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});

// GET /api/files/:id - Get file by ID
WebApp.connectHandlers.use('/api/files/', async (req, res) => {
  if (req.method !== 'GET') {
    return;
  }

  const urlParts = req.url.split('/');
  const id = urlParts[urlParts.length - 1];

  if (!id || id === 'files') {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('File ID is required.');
    return;
  }

  try {
    // Fetch file metadata from the API files collection
    const file = await ApiFiles.findOneAsync({ _id: id });

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