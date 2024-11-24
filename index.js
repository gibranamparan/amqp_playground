import amqp from "amqplib";
import cors from "cors";
import express from "express";
import { MongoClient } from "mongodb";
import { request, gql } from "graphql-request";
import { calculateEndDeviceMetrics } from "./end-devices-aggregator.js";
import { calculateExtenderMetrics } from "./extenders-aggregator.js";

const EXCHANGE_NAME = "events"; // Replace with your exchange name
const EXCHANGE_TYPE = "topic"; // Replace with your exchange type (e.g., 'direct', 'topic', 'fanout', 'headers')
const QUEUE_NAME = "global_events"; // Replace with your queue name
const ROUTING_KEY = "events"; // Replace with the appropriate routing key

// MongoDB configuration
const MONGO_URI = "mongodb://developer:developer@headend:27017"; // Replace with your MongoDB URI if it's different
const DATABASE_NAME = "test_events";
const COLLECTION_NAME = "events";

// MongoDB Client
let client;

// Locations GQL query
const locationsQuery = gql`
  query {
    locations {
      id
      locationType
      name
      ancestors {
        id
        locationType
        name
      }
      devices {
        id
        mac
        flavor
      }
    }
    devices {
      mac
      name
      flavor
      transmitterProfile {
        name
        transmitterTypeMappings {
          txType
        }
      }
    }
  }
`;

const endpoint = "http://localhost:5000/graphql";
const configData = await request(endpoint, locationsQuery);

async function connectToDatabase() {
  if (!client) {
    try {
      client = new MongoClient(MONGO_URI);
      await client.connect();
      console.log("Connected to MongoDB successfully.");
    } catch (error) {
      console.error("Error connecting to MongoDB:", error);
      process.exit(1); // Exit the process if the connection fails
    }
  }
  return client.db(DATABASE_NAME);
}

// Method to insert an event into the database
async function insertEvent(eventObject) {
  if (!eventObject || typeof eventObject !== "object") {
    throw new Error("Invalid event object. It must be a non-null object.");
  }

  try {
    const db = await connectToDatabase();
    const collection = db.collection(COLLECTION_NAME);

    const result = await collection.insertOne({
      createdAt: new Date(eventObject.createdAt),
      ...eventObject,
    });
    console.log("Event inserted successfully:", result.insertedId);
    return result.insertedId;
  } catch (error) {
    console.error("Error inserting event:", error);
    throw error;
  }
}

async function startConsumer() {
  try {
    // Connect to RabbitMQ
    const connection = await amqp.connect("amqp://developer:developer@headend"); // Replace 'localhost' with your broker URL
    console.log("Connected to AMQP broker.");

    // Create a channel
    const channel = await connection.createChannel();
    console.log("Channel created.");

    // Assert exchange (creates the exchange if it doesn't exist)
    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
      durable: true,
    });
    console.log(`Exchange "${EXCHANGE_NAME}" asserted.`);

    // Assert queue (creates the queue if it doesn't exist)
    await channel.assertQueue(QUEUE_NAME, { durable: true });
    console.log(`Queue "${QUEUE_NAME}" asserted.`);

    // Bind queue to exchange with the specified routing key
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);
    console.log(
      `Queue "${QUEUE_NAME}" bound to exchange "${EXCHANGE_NAME}" with routing key "${ROUTING_KEY}".`
    );

    // List of event types to watch
    const watchList = [
      "device-event",
      "device-info",
      "sensors",
      "extender-checkins",
      "zigbee-route-neighbors",
    ];

    // Consume messages from the queue
    channel.consume(
      QUEUE_NAME,
      (msg) => {
        if (msg !== null) {
          // Parse message content
          const message = JSON.parse(msg.content.toString());
          // if (watchList.includes(message.payloadType)) {
          //   console.log(`Received message: ${msg.content.toString()}`);
          // } else {
          //   console.log(`Ignoring message: ${message.payloadType}`);
          // }

          // Insert the event into the database
          insertEvent(message);

          // Acknowledge the message
          channel.ack(msg);
        } else {
          console.log("Consumer cancelled by server.");
        }
      },
      { noAck: false } // Set to false to enable manual acknowledgment
    );

    console.log("Waiting for messages...");
  } catch (error) {
    console.error("Error:", error);
  }
}

startConsumer();

// Express app setup
const app = express();
app.use(cors());
const PORT = 1337;

// Method to fetch events based on date range
async function getEventsInRange(startDate, endDate) {
  try {
    const db = await connectToDatabase();
    const collection = db.collection(COLLECTION_NAME);
    const eventTypes = [
      "device-event",
      "device-info",
      "sensors",
      "extender-checkins",
      "zigbee-route-neighbors",
    ];

    const query = {
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
      payloadType: { $in: eventTypes },
    };

    const events = await collection.find(query).toArray();
    return events;
  } catch (error) {
    console.error("Error fetching events:", error);
    throw error;
  }
}

// API Endpoints

// GET /events: Fetch events within a date range
app.get("/itr", async (req, res) => {
  const { startDate, endDate } = req.query;

  console.log("startDate", startDate);
  console.log("endDate", endDate);

  // Validate query parameters
  if (!startDate || !endDate) {
    return res.status(400).json({
      error: "Both startDate and endDate query parameters are required.",
    });
  }

  try {
    const events = await getEventsInRange(startDate, endDate);
    console.log("Number of Events", events.length);

    // Calculate end device metrics
    // const endDeviceMetrics = calculateEndDeviceMetrics(
    //   configData.locations,
    //   configData.devices,
    //   events
    // );

    // Calculate extenders metrics
    const extenderMetrics = calculateExtenderMetrics(
      configData.locations,
      configData.devices,
      events
    );

    res.json({
      // endDevices: endDeviceMetrics,
      extenders: extenderMetrics,
    });
  } catch (error) {
    console.error("Error in GET /events:", error);
    res.status(500).json({ error: "An error occurred while fetching events." });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
