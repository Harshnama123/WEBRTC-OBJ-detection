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
  
  socket.on('device-type', (type) => {
    console.log('Device type:', type, socket.id);
    if (type === 'phone') {
      socket.broadcast.emit('phone-connected');
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
  
  socket.on('phone-ready', () => {
    console.log('Phone ready:', socket.id);
    socket.broadcast.emit('phone-connected');
    // Tell phone that laptop is ready to receive the offer
    socket.emit('laptop-ready');
  });
  
  socket.on('phone-stopped', () => {
    console.log('Phone stopped:', socket.id);
    socket.broadcast.emit('phone-disconnected');
  });
  
  socket.on('disconnect', () => {
    console.log('Device disconnected:', socket.id);
    socket.broadcast.emit('phone-disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Laptop view: http://localhost:${PORT}`);
  console.log(`Phone view: http://localhost:${PORT}/phone`);
});