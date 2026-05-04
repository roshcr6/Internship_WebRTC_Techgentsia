const offer = {"type":"offer","sdp":"v=0\r\no=- 1131598428521813067 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 55793 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 192.168.153.1\r\na=candidate:3005695478 1 udp 2122260223 192.168.153.1 55793 typ host generation 0 network-id 1\r\na=candidate:2893755193 1 udp 2122194687 192.168.126.1 55794 typ host generation 0 network-id 2\r\na=candidate:1301123426 1 tcp 1518280447 192.168.153.1 9 typ host tcptype active generation 0 network-id 1\r\na=candidate:1389488045 1 tcp 1518214911 192.168.126.1 9 typ host tcptype active generation 0 network-id 2\r\na=ice-ufrag:mgRC\r\na=ice-pwd:RR7tx8aLIMaAiDRmgAeMyENy\r\na=ice-options:trickle\r\na=fingerprint:sha-256 D6:F8:85:6C:07:1B:F1:CF:C0:1A:82:9D:10:FC:B2:4E:CD:6B:DF:35:D8:67:DC:BB:8A:CB:DD:C9:E5:7D:51:E5\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n"}
const rc = new RTCPeerConnection();

rc.onicecandidate = e => {
    if (e.candidate) {
        console.log("New ICE candidate: " + e.candidate.candidate);
    } else {
        console.log("ICE gathering complete");
    }
};

rc.ondatachannel = e => {
    rc.dc = e.channel;
    console.log("Data channel received from peer");
    
    rc.dc.onmessage = e => console.log("Message received: " + e.data);
    rc.dc.onopen = () => {
        console.log("Data channel opened");
        rc.dc.send("Helloo bruh");
    };
    rc.dc.onerror = e => console.error("Data channel error:", e);
    rc.dc.onclose = () => console.log("Data channel closed");
};

rc.setRemoteDescription(offer)
    .then(() => console.log("Remote offer set"))
    .catch(err => console.error("Failed to set remote description:", err))
    .then(() => rc.createAnswer())
    .then(a => rc.setLocalDescription(a))
    .then(() => console.log("Answer created and set"))
    .catch(err => console.error("Answer creation failed:", err))
