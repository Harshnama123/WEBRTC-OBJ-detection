const express = require('express');
const https = require('https');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();

// Add security headers
app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Try to load SSL certificates
let httpsServer;
try {
    const options = {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem')
    };
    httpsServer = https.createServer(options, app);
    console.log('HTTPS server created successfully');
} catch (error) {
    console.log('Could not load SSL certificates:', error.message);
    console.log('Falling back to HTTP (camera access may be blocked)');
}

// Create HTTP server as fallback
const httpServer = http.createServer(app);

// Create Socket.IO instance that works with both servers
const io = socketIo(httpsServer || httpServer, {
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

const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Start HTTP server
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`HTTP Server running on port ${HTTP_PORT}`);
    console.log(`Local HTTP URLs (camera may not work):`);
    console.log(`Laptop view: http://localhost:${HTTP_PORT}`);
    console.log(`Phone view: http://localhost:${HTTP_PORT}/phone`);
});

// Start HTTPS server if certificates are available
if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`\nHTTPS Server running on port ${HTTPS_PORT}`);
        console.log(`Local HTTPS URLs (recommended):`);
        console.log(`Laptop view: https://192.168.157.114:${HTTPS_PORT}`);
        console.log(`Phone view: https://192.168.157.114:${HTTPS_PORT}/phone`);
    });
}
