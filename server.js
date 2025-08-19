const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files (HTML, CSS, JS)
app.use(express.static('public'));

// Basic route - serves our main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Phone connection page
app.get('/phone', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

// Socket connection handling
io.on('connection', (socket) => {
  console.log('Device connected:', socket.id);
  socket.data = socket.data || {};
  
  socket.on('device-type', (type) => {
    console.log('Device type:', type, socket.id);
    socket.data.deviceType = type;
    if (type === 'phone') {
      console.log('Phone connected, notifying all laptops');
      socket.broadcast.emit('phone-connected');
      // Also notify this phone about any existing laptops
      socket.emit('laptop-ready');
    }
  });

  // Handle WebRTC signaling
  socket.on('offer', (offer) => {
    socket.broadcast.emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    socket.broadcast.emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate) => {
    socket.broadcast.emit('ice-candidate', candidate);
  });

  // Relay custom events between phone and laptop
  socket.on('detection-results', (results) => {
    socket.broadcast.emit('detection-results', results);
  });

  socket.on('request-track', () => {
    socket.broadcast.emit('request-track');
  });

  socket.on('track-ready', () => {
    socket.broadcast.emit('track-ready');
  });
  
  socket.on('phone-ready', () => {
    console.log('Phone ready:', socket.id);
    // Tell phone that laptop is ready to receive the offer
    socket.emit('laptop-ready');
  });
  
  socket.on('phone-stopped', () => {
    console.log('Phone stopped:', socket.id);
    socket.broadcast.emit('phone-disconnected');
  });
  
  socket.on('disconnect', () => {
    console.log('Device disconnected:', socket.id, 'type:', socket.data?.deviceType);
    if (socket.data?.deviceType === 'phone') {
      socket.broadcast.emit('phone-disconnected');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Laptop view: http://localhost:${PORT}`);
  console.log(`Phone view: http://localhost:${PORT}/phone`);
});