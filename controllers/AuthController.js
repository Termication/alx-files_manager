import sha1 from 'sha1';
import { v4 as uuidv4 } from 'uuid';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

class AuthController {
  // Handle user authentication and return a token
  static async getConnect(request, response) {
    const authData = request.header('Authorization'); // Get the 'Authorization' header
    let userEmail = authData.split(' ')[1]; // Extract the base64-encoded credentials
    const buff = Buffer.from(userEmail, 'base64');
    userEmail = buff.toString('ascii'); // Decode credentials
    const data = userEmail.split(':'); // Split credentials into email and password

    if (data.length !== 2) {
      // If credentials are invalid, return unauthorized
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const hashedPassword = sha1(data[1]); // Hash the provided password
    const users = dbClient.db.collection('users');
    // Check if a user exists with the given email and hashed password
    users.findOne({ email: data[0], password: hashedPassword }, async (err, user) => {
      if (user) {
        const token = uuidv4(); // Generate a unique token
        const key = `auth_${token}`; // Create a Redis key for the token
        await redisClient.set(key, user._id.toString(), 60 * 60 * 24); // Store the token with a 24-hour expiration
        response.status(200).json({ token }); // Respond with the token
      } else {
        // If no user is found, return unauthorized
        response.status(401).json({ error: 'Unauthorized' });
      }
    });
  }

  // Handle user logout by deleting the token from Redis
  static async getDisconnect(request, response) {
    const token = request.header('X-Token'); // Get the token from the 'X-Token' header
    const key = `auth_${token}`; // Construct the Redis key for the token
    const id = await redisClient.get(key); // Check if the token exists in Redis

    if (id) {
      await redisClient.del(key); // Delete the token from Redis
      response.status(204).json({}); // Respond with no content
    } else {
      // If the token is not found, return unauthorized
      response.status(401).json({ error: 'Unauthorized' });
    }
  }
}

module.exports = AuthController;
