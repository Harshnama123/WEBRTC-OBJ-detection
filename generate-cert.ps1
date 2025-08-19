$cert = New-SelfSignedCertificate -DnsName "192.168.157.114", "localhost" -CertStoreLocation "Cert:\LocalMachine\My" -NotAfter (Get-Date).AddYears(1) -FriendlyName "WebRTC Dev Certificate"

$certPassword = ConvertTo-SecureString -String "password" -Force -AsPlainText
$certPath = "cert.pfx"
$keyPath = "key.pem"
$certPemPath = "cert.pem"

# Export PFX
Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $certPassword

# Convert PFX to PEM format
openssl pkcs12 -in cert.pfx -out key.pem -nodes -nocerts -password pass:password
openssl pkcs12 -in cert.pfx -out cert.pem -nodes -nokeys -password pass:password

Write-Host "Certificates generated successfully!"
Write-Host "cert.pem and key.pem are ready for use with the HTTPS server"
