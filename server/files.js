const EventEmitter = require('events');
const files = new EventEmitter();
const fs = require('fs-extra');
const graphicsMagick = require('gm');
const path = require('path');

// Configuration
const filesPath = Meteor.settings.public.filesPath;
const cdnPath = Meteor.settings.public.cdnPath;

// Function to determine the disk for a file
function getDiskForFile() {
  // Currently, we only have one disk: "disk1"
  // Replace or extend this logic as new disks are added.
  return 'disk1';
}

const bound = Meteor.bindEnvironment((callback) => callback());

// Accepted image types
const acceptedImageTypes = ['png', 'jpeg', 'jpg', 'webp'];

// After upload event
Files.on('afterUpload', async function (fileRef) {
    console.log('UPLOADING NEW FILE TO SERVER:', fileRef);

    const disk = getDiskForFile(); // Get disk dynamically
    const fileUrl = `${cdnPath}/uploads/${disk}/${fileRef._id}.${fileRef.ext}`;
    const outputPath = `${filesPath}/uploads/${disk}/${fileRef._id}.${fileRef.ext}`;
    console.log('File will be stored at:', outputPath);
    console.log('File URL will be:', fileUrl);

    // Ensure directory exists
    fs.ensureDirSync(`${filesPath}/uploads/${disk}`);

    // Validate file type
    if (!acceptedImageTypes.includes(fileRef.ext)) {
        console.error('Unsupported file type:', fileRef.ext);
        throw new Meteor.Error('unsupported-file-type', 'Unsupported file type.');
    }

    console.log('File is an accepted image.');

    // Process image
    graphicsMagick(fileRef.path)
        .quality(70)
        .autoOrient()
        .noProfile()
        .strip()
        .resize(1500)
        .interlace('Line')
        .write(outputPath, async (err) => {
            if (err) {
                console.error('Error processing image:', err);
                throw new Meteor.Error('image-processing-failed', 'Error processing image.');
            }

            console.log('Image successfully processed:', outputPath);

            // Get image dimensions
            graphicsMagick(outputPath).size(async (sizeErr, dimensions) => {
                if (sizeErr) {
                    console.error('Error retrieving image size:', sizeErr);
                    throw new Meteor.Error('dimension-retrieval-failed', 'Error retrieving image dimensions.');
                }

                console.log('Image dimensions:', dimensions);

                // Update file metadata in the database
                try {
                    console.log("UDPPAING FILE _ID: ", fileRef._id);
                    await Files.updateAsync(fileRef._id, {
                        $set: {
                            filePath: `/uploads/${disk}/${fileRef._id}.${fileRef.ext}`,
                            url: fileUrl,
                            dimensions,
                            uploadedAt: new Date(),
                            processing: false,
                            disk,
                            file_reference_id: fileRef._id,
                        },
                    });

                    // Fetch the updated file to confirm metadata
                    const updatedFile = await Files.findOneAsync(fileRef._id);
                    console.log("SERVER FILE ID IS: ", updatedFile._id);

                    console.log('File metadata saved and processing flag updated.');

                    // Remove the original unprocessed file
                    Meteor.setTimeout(() => {
                        fs.remove(fileRef.path, (removeErr) => {
                            if (removeErr) {
                                console.error('Error removing original file:', removeErr);
                            } else {
                                console.log('Original file removed.');
                            }
                        });
                    }, 5000);

                    // Enrich the `fileRef` object with metadata
                    fileRef.filePath = `/uploads/${disk}/${fileRef._id}.${fileRef.ext}`;
                    fileRef.url = fileUrl;
                    fileRef.dimensions = dimensions;
                    fileRef.processing = false;
                    fileRef.id = fileRef._id;

                    console.log('Final fileRef with metadata:', fileRef);

                    // Emit an event to the client (or directly use `fileRef`)
                    files.emit('uploadComplete', {
                        _id: fileRef._id, // Ensure _id is set correctly
                        url: fileUrl,
                        dimensions,
                    });

                    // Update avatar URL if the file is an avatar
                    if (fileRef.meta.type === 'avatar') {
                        Meteor.call('files.updateAvatarUrl', fileUrl, fileRef.userId, (updateErr, updateResult) => {
                            if (updateErr) {
                                console.error('Error updating avatar URL:', updateErr);
                            } else {
                                console.log('Avatar URL updated successfully:', updateResult);
                            }
                        });
                    }

                } catch (dbErr) {
                    console.error('Error updating file metadata in database:', dbErr);
                    throw new Meteor.Error('database-update-failed', 'Error updating file metadata in database.');
                }
            });
        });
});


