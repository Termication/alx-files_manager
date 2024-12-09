import { createClient } from 'redis';
import { promisify } from 'util';

// Class to interact with the Redis server
class RedisClient {
  constructor() {
    this.client = createClient();
    this.client.on('error', (error) => {
      console.error(`Redis connection error: ${error}`);
    });
  }

  // Check if the Redis client is connected
  isAlive() {
    return this.client.connected;
  }

  // Retrieve the value of a given key
  async get(key) {
    const redisGet = promisify(this.client.get).bind(this.client);
    return await redisGet(key);
  }

  // Store a key-value pair with an expiration time
  async set(key, value, time) {
    const redisSet = promisify(this.client.set).bind(this.client);
    await redisSet(key, value);
    await this.client.expire(key, time);
  }

  // Delete a key-value pair
  async del(key) {
    const redisDel = promisify(this.client.del).bind(this.client);
    await redisDel(key);
  }
}

// Export an instance of RedisClient
const redisClient = new RedisClient();
module.exports = redisClient;

