const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

// Generate certificates
const attrs = [{ name: 'commonName', value: '192.168.157.114' }];
const pems = selfsigned.generate(attrs, {
    algorithm: 'sha256',
    days: 365,
    keySize: 2048,
    extensions: [
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: '192.168.157.114' },
                { type: 2, value: 'localhost' }
            ]
        }
    ]
});

// Save private key
fs.writeFileSync('key.pem', pems.private);
console.log('✅ Private key saved to key.pem');

// Save certificate
fs.writeFileSync('cert.pem', pems.cert);
console.log('✅ Certificate saved to cert.pem');

console.log('\n🔒 SSL certificates generated successfully!');
console.log('You can now run: npm run start:https');
