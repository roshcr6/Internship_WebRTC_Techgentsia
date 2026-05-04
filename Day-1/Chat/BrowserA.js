const lc = new RTCPeerConnection() 
const dc = lc.createDataChannel("Channel");

dc.onmessage = e => console.log("Message received: " + e.data);
dc.onopen = () => {
    console.log("Data channel opened");
    dc.send("hai");
};
dc.onerror = e => console.error("Data channel error:", e);
dc.onclose = () => console.log("Data channel closed");

lc.onicecandidate = e => {
    if (e.candidate) {
        console.log("New ICE candidate: " + e.candidate.candidate);
    } else {
        console.log("ICE gathering complete");
    }
};

lc.createOffer()
    .then(o => lc.setLocalDescription(o))
    .then(() => console.log("Local description set"))
    .catch(err => console.error("Offer creation failed:", err))

const answer = {"type":"answer","sdp":"v=0\r\no=- 1197033283726365310 3 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 55171 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.153.1\r\na=candidate:1744092769 1 udp 2122260223 192.168.153.1 55171 typ host generation 0 network-id 1\r\na=candidate:3774947250 1 udp 2122194687 192.168.126.1 55172 typ host generation 0 network-id 2\r\na=ice-ufrag:/FU4\r\na=ice-pwd:7NB2H+E/DAbFGzuD/iq633tv\r\na=ice-options:trickle\r\na=fingerprint:sha-256 D7:B8:F4:9D:A3:39:59:CD:93:88:5D:32:82:AA:B4:DB:B3:32:97:9C:C1:B0:E3:3F:E7:65:53:ED:C0:B8:8F:9E\r\na=setup:active\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"}

lc.setRemoteDescription(answer)
    .then(() => console.log("Remote description set"))
    .catch(err => console.error("Failed to set remote description:", err))
