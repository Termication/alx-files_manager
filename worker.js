import Queue from 'bull';
import imageThumbnail from 'image-thumbnail';
import { promises as fs } from 'fs';
import { ObjectID } from 'mongodb';
import dbClient from './utils/db';

// Initialize Redis queues for file and user processing
const fileQueue = new Queue('fileQueue', 'redis://127.0.0.1:6379');
const userQueue = new Queue('userQueue', 'redis://127.0.0.1:6379');

/**
 * Generates a thumbnail of the specified width for a given file path.
 * @param {number} width - The width of the thumbnail.
 * @param {string} localPath - The local path of the file.
 * @returns {Promise<Buffer>} - The thumbnail image buffer.
 */
async function thumbNail(width, localPath) {
  return imageThumbnail(localPath, { width });
}

// Process jobs in the file queue
fileQueue.process(async (job, done) => {
  console.log('Processing file queue...');
  
  // Validate job data
  const { fileId, userId } = job.data;
  if (!fileId) return done(new Error('Missing fileId'));
  if (!userId) return done(new Error('Missing userId'));

  console.log(`Processing fileId: ${fileId}, userId: ${userId}`);

  const files = dbClient.db.collection('files');
  const idObject = new ObjectID(fileId);

  // Retrieve file from database
  files.findOne({ _id: idObject }, async (err, file) => {
    if (err || !file) {
      console.error('File not found');
      return done(new Error('File not found'));
    }

    try {
      // Generate thumbnails of different sizes
      const fileName = file.localPath;
      const thumbnail500 = await thumbNail(500, fileName);
      const thumbnail250 = await thumbNail(250, fileName);
      const thumbnail100 = await thumbNail(100, fileName);

      console.log('Writing thumbnail files to the system');
      
      // Save thumbnails to the filesystem
      await fs.writeFile(`${fileName}_500`, thumbnail500);
      await fs.writeFile(`${fileName}_250`, thumbnail250);
      await fs.writeFile(`${fileName}_100`, thumbnail100);
      
      done(); // Job completed successfully
    } catch (error) {
      console.error('Error generating thumbnails:', error);
      done(new Error('Thumbnail generation failed'));
    }
  });
});

// Process jobs in the user queue
userQueue.process(async (job, done) => {
  console.log('Processing user queue...');
  
  // Validate job data
  const { userId } = job.data;
  if (!userId) return done(new Error('Missing userId'));

  const users = dbClient.db.collection('users');
  const idObject = new ObjectID(userId);

  // Retrieve user from database
  const user = await users.findOne({ _id: idObject });
  if (user) {
    console.log(`Welcome ${user.email}!`);
    done(); // Job completed successfully
  } else {
    console.error('User not found');
    done(new Error('User not found'));
  }
});
