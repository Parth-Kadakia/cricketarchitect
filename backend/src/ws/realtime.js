import { WebSocketServer } from 'ws';
import { verifyToken } from '../utils/jwt.js';

let broadcaster = () => {};

export function createRealtimeServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  function broadcast(event, payload, channel = 'global') {
    const message = JSON.stringify({ event, payload, channel, at: new Date().toISOString() });

    wss.clients.forEach((client) => {
      if (client.readyState !== 1) {
        return;
      }

      const subscriptions = client.subscriptions || new Set(['global']);
      if (subscriptions.has(channel) || subscriptions.has('global')) {
        client.send(message);
      }
    });
  }

  broadcaster = broadcast;

  wss.on('connection', (socket, request) => {
    socket.subscriptions = new Set(['global']);

    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      const token = requestUrl.searchParams.get('token');

      if (token) {
        const payload = verifyToken(token);
        socket.userId = payload.sub;
      }
    } catch (error) {
      socket.userId = null;
    }

    socket.send(
      JSON.stringify({
        event: 'system:connected',
        payload: {
          message: 'Connected to Global T20 live feed.'
        },
        channel: 'global',
        at: new Date().toISOString()
      })
    );

    socket.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());

        if (message.action === 'subscribe' && typeof message.channel === 'string') {
          socket.subscriptions.add(message.channel);
        }

        if (message.action === 'unsubscribe' && typeof message.channel === 'string') {
          socket.subscriptions.delete(message.channel);
        }
      } catch (error) {
        socket.send(
          JSON.stringify({
            event: 'system:error',
            payload: { message: 'Malformed WebSocket message.' },
            channel: 'global',
            at: new Date().toISOString()
          })
        );
      }
    });
  });

  return wss;
}

export function broadcast(event, payload, channel = 'global') {
  broadcaster(event, payload, channel);
}
