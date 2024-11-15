const amqp = require("amqplib");

const EXCHANGE_NAME = "events"; // Replace with your exchange name
const EXCHANGE_TYPE = "topic"; // Replace with your exchange type (e.g., 'direct', 'topic', 'fanout', 'headers')
const QUEUE_NAME = "global_events"; // Replace with your queue name
const ROUTING_KEY = "events"; // Replace with the appropriate routing key

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

    // Consume messages from the queue
    channel.consume(
      QUEUE_NAME,
      (msg) => {
        if (msg !== null) {
          console.log("Received message:", msg.content.toString());
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
