import sha1 from 'sha1';
import { ObjectID } from 'mongodb';
import Queue from 'bull';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const userQueue = new Queue('userQueue', 'redis://127.0.0.1:6379');

class UsersController {
  // Handle the creation of a new user
  static postNew(request, response) {
    const { email } = request.body; // Extract email from the request body
    const { password } = request.body; // Extract password from the request body

    // Validate email input
    if (!email) {
      response.status(400).json({ error: 'Missing email' });
      return;
    }

    // Validate password input
    if (!password) {
      response.status(400).json({ error: 'Missing password' });
      return;
    }

    const users = dbClient.db.collection('users');
    // Check if a user with the provided email already exists
    users.findOne({ email }, (err, user) => {
      if (user) {
        response.status(400).json({ error: 'Already exist' }); // Respond with error if user exists
      } else {
        const hashedPassword = sha1(password); // Hash the password for security
        // Insert the new user into the database
        users.insertOne(
          {
            email,
            password: hashedPassword,
          },
        ).then((result) => {
          // Respond with the created user's ID and email
          response.status(201).json({ id: result.insertedId, email });
          // Add the new user to the processing queue
          userQueue.add({ userId: result.insertedId });
        }).catch((error) => console.error('Error inserting user:', error)); // Log insertion errors
      }
    });
  }

  // Retrieve the authenticated user's information
  static async getMe(request, response) {
    const token = request.header('X-Token'); // Get the authentication token from the request header
    const key = `auth_${token}`; // Construct the Redis key for authentication
    const userId = await redisClient.get(key); // Retrieve the user ID associated with the token

    if (userId) {
      const users = dbClient.db.collection('users');
      const idObject = new ObjectID(userId); // Convert the user ID to an ObjectID
      // Find the user in the database
      users.findOne({ _id: idObject }, (err, user) => {
        if (user) {
          // Respond with the user's ID and email if found
          response.status(200).json({ id: userId, email: user.email });
        } else {
          // Respond with an unauthorized error if the user is not found
          response.status(401).json({ error: 'Unauthorized' });
        }
      });
    } else {
      console.log('User not found in Redis!');
      // Respond with an unauthorized error if the token is invalid or expired
      response.status(401).json({ error: 'Unauthorized' });
    }
  }
}

module.exports = UsersController;
