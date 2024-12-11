import { MongoClient } from 'mongodb';

// Define database connection parameters
const HOST = process.env.DB_HOST || 'localhost';
const PORT = process.env.DB_PORT || 27017;
const DATABASE = process.env.DB_DATABASE || 'files_manager';
const url = `mongodb://${HOST}:${PORT}`;

class DBClient {
  constructor() {
    // Initialize a new MongoDB client instance with connection options
    this.client = new MongoClient(url, { useUnifiedTopology: true, useNewUrlParser: true });
    // Connect to the database and store the database reference
    this.client.connect().then(() => {
      this.db = this.client.db(`${DATABASE}`);
    }).catch((err) => {
      console.error('Error connecting to MongoDB:', err);
    });
  }

  // Check if the MongoDB client is connected
  isAlive() {
    return this.client.isConnected();
  }

  // Get the count of documents in the 'users' collection
  async nbUsers() {
    const users = this.db.collection('users');
    const usersNum = await users.countDocuments();
    return usersNum;
  }

  // Get the count of documents in the 'files' collection
  async nbFiles() {
    const files = this.db.collection('files');
    const filesNum = await files.countDocuments();
    return filesNum;
  }
}

// Export an instance of the DBClient class
const dbClient = new DBClient();
module.exports = dbClient;
