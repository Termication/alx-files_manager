import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { ObjectID } from 'mongodb';
import mime from 'mime-types';
import Queue from 'bull';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const fileQueue = new Queue('fileQueue', 'redis://127.0.0.1:6379');

class FilesController {
  // Retrieve the user associated with the provided token
  static async getUser(request) {
    const token = request.header('X-Token'); // Extract token from the request header
    const key = `auth_${token}`;
    const userId = await redisClient.get(key); // Fetch user ID from Redis using the token
    if (userId) {
      const users = dbClient.db.collection('users');
      const idObject = new ObjectID(userId);
      const user = await users.findOne({ _id: idObject }); // Retrieve user from the database
      return user || null;
    }
    return null; // Return null if user not found or token is invalid
  }

  // Handle file upload and save file metadata or content
  static async postUpload(request, response) {
    const user = await FilesController.getUser(request);
    if (!user) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const { name, type, parentId, isPublic = false, data } = request.body;
    if (!name) return response.status(400).json({ error: 'Missing name' });
    if (!type) return response.status(400).json({ error: 'Missing type' });
    if (type !== 'folder' && !data) return response.status(400).json({ error: 'Missing data' });

    const files = dbClient.db.collection('files');
    if (parentId) {
      const idObject = new ObjectID(parentId);
      const parentFile = await files.findOne({ _id: idObject, userId: user._id });
      if (!parentFile) return response.status(400).json({ error: 'Parent not found' });
      if (parentFile.type !== 'folder') return response.status(400).json({ error: 'Parent is not a folder' });
    }

    if (type === 'folder') {
      // Save folder metadata
      files.insertOne({ userId: user._id, name, type, parentId: parentId || 0, isPublic })
        .then((result) =>
          response.status(201).json({ id: result.insertedId, userId: user._id, name, type, isPublic, parentId: parentId || 0 })
        )
        .catch((error) => console.error(error));
    } else {
      // Save file content
      const filePath = process.env.FOLDER_PATH || '/tmp/files_manager';
      const fileName = `${filePath}/${uuidv4()}`;
      const buff = Buffer.from(data, 'base64');
      try {
        await fs.mkdir(filePath, { recursive: true }); // Create the file directory if it doesn't exist
        await fs.writeFile(fileName, buff, 'utf-8'); // Save the file content to disk
      } catch (error) {
        console.error(error);
        return;
      }
      files.insertOne({ userId: user._id, name, type, isPublic, parentId: parentId || 0, localPath: fileName })
        .then((result) => {
          response.status(201).json({ id: result.insertedId, userId: user._id, name, type, isPublic, parentId: parentId || 0 });
          if (type === 'image') {
            fileQueue.add({ userId: user._id, fileId: result.insertedId }); // Add image processing task to the queue
          }
        })
        .catch((error) => console.error(error));
    }
    return null;
  }

  // Retrieve file details for a specific file ID
  static async getShow(request, response) {
    const user = await FilesController.getUser(request);
    if (!user) return response.status(401).json({ error: 'Unauthorized' });

    const fileId = request.params.id;
    const files = dbClient.db.collection('files');
    const idObject = new ObjectID(fileId);
    const file = await files.findOne({ _id: idObject, userId: user._id });

    if (!file) return response.status(404).json({ error: 'Not found' });
    return response.status(200).json(file);
  }

  // List all files for the authenticated user, optionally filtered by parentId
  static async getIndex(request, response) {
    const user = await FilesController.getUser(request);
    if (!user) return response.status(401).json({ error: 'Unauthorized' });

    const { parentId, page = 0 } = request.query;
    const files = dbClient.db.collection('files');
    const query = parentId ? { userId: user._id, parentId: ObjectID(parentId) } : { userId: user._id };

    files.aggregate([
      { $match: query },
      { $sort: { _id: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }, { $addFields: { page: parseInt(page, 10) } }],
          data: [{ $skip: 20 * parseInt(page, 10) }, { $limit: 20 }],
        },
      },
    ]).toArray((err, result) => {
      if (!result) return response.status(404).json({ error: 'Not found' });

      const filesList = result[0].data.map((file) => ({
        ...file,
        id: file._id,
        _id: undefined,
        localPath: undefined,
      }));
      return response.status(200).json(filesList);
    });
    return null;
  }

  // Publish a file by setting its `isPublic` attribute to true
  static async putPublish(request, response) {
    const user = await FilesController.getUser(request);
    if (!user) return response.status(401).json({ error: 'Unauthorized' });

    const { id } = request.params;
    const files = dbClient.db.collection('files');
    const idObject = new ObjectID(id);
    const update = { $set: { isPublic: true } };

    files.findOneAndUpdate({ _id: idObject, userId: user._id }, update, { returnOriginal: false }, (err, file) => {
      if (!file.lastErrorObject.updatedExisting) return response.status(404).json({ error: 'Not found' });
      return response.status(200).json(file.value);
    });
    return null;
  }

  // Unpublish a file by setting its `isPublic` attribute to false
  static async putUnpublish(request, response) {
    const user = await FilesController.getUser(request);
    if (!user) return response.status(401).json({ error: 'Unauthorized' });

    const { id } = request.params;
    const files = dbClient.db.collection('files');
    const idObject = new ObjectID(id);
    const update = { $set: { isPublic: false } };

    files.findOneAndUpdate({ _id: idObject, userId: user._id }, update, { returnOriginal: false }, (err, file) => {
      if (!file.lastErrorObject.updatedExisting) return response.status(404).json({ error: 'Not found' });
      return response.status(200).json(file.value);
    });
    return null;
  }

  // Retrieve and send the content of a file if authorized or public
  static async getFile(request, response) {
    const { id } = request.params;
    const files = dbClient.db.collection('files');
    const idObject = new ObjectID(id);

    files.findOne({ _id: idObject }, async (err, file) => {
      if (!file) return response.status(404).json({ error: 'Not found' });

      if (file.isPublic) {
        if (file.type === 'folder') return response.status(400).json({ error: "A folder doesn't have content" });

        try {
          const size = request.param('size');
          const fileName = size ? `${file.localPath}_${size}` : file.localPath;
          const data = await fs.readFile(fileName);
          const contentType = mime.contentType(file.name);
          return response.header('Content-Type', contentType).status(200).send(data);
        } catch (error) {
          console.error(error);
          return response.status(404).json({ error: 'Not found' });
        }
      } else {
        const user = await FilesController.getUser(request);
        if (!user || file.userId.toString() !== user._id.toString()) return response.status(404).json({ error: 'Not found' });

        if (file.type === 'folder') return response.status(400).json({ error: "A folder doesn't have content" });

        try {
          const size = request.param('size');
          const fileName = size ? `${file.localPath}_${size}` : file.localPath;
          const contentType = mime.contentType(file.name);
          return response.header('Content-Type', contentType).status(200).sendFile(fileName);
        } catch (error) {
          console.error(error);
          return response.status(404).json({ error: 'Not found' });
        }
      }
    });
  }
}

module.exports = FilesController;

