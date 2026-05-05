let APP_ID = 'e4c9d93c28c646cb90e68601529b237d';
let token = null;
let uid = String(Math.floor(Math.random() * 10000));
let client;
let channel;

let queryString = window.location.search;
let urlParams = new URLSearchParams(queryString);
let roomId = urlParams.get('room');

if (!roomId) {
    window.location = 'lobby.html';
}

let localStream;
let remoteStream;
let peerConnection;
let remoteUid;
let connectionState = 'disconnected';

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

let constraints = {
    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
};

let updateStatus = (status, message) => {
    let statusEl = document.getElementById('connection-status');
    if (statusEl) {
        statusEl.textContent = `${status}: ${message}`;
        statusEl.className = `status status-${status.toLowerCase()}`;
    }
};

let init = async () => {
    try {
        updateStatus('Connecting', 'Initializing...');
        client = await AgoraRTM.createInstance(APP_ID);
        await client.login({ uid, token });
        channel = await client.createChannel(roomId);
        await channel.join();
        channel.on('MemberJoined', handleUserJoined);
        channel.on('MemberLeft', handleUserLeft);
        client.on('MessageFromPeer', handleMessageFromPeer);
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        document.getElementById('user-1').srcObject = localStream;
        updateStatus('Connected', `Room: ${roomId}`);
    } catch (error) {
        updateStatus('Error', error.message);
    }
};

let handleUserLeft = (MemberId) => {
    if (MemberId === remoteUid) {
        remoteUid = null;
        document.getElementById('user-2').style.display = 'none';
        document.getElementById('user-1').classList.remove('smallFrame');
        updateStatus('Ready', 'Waiting...');
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
            connectionState = 'disconnected';
        }
    }
};

let handleMessageFromPeer = async (message, MemberId) => {
    try {
        message = JSON.parse(message.text);
        if (message.type === 'offer') {
            if (!remoteUid) remoteUid = MemberId;
            await createAnswer(MemberId, message.offer);
        }
        if (message.type === 'answer') {
            if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
            }
        }
        if (message.type === 'candidate') {
            if (peerConnection && peerConnection.remoteDescription) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
                } catch (e) {}
            }
        }
    } catch (error) {}
};

let handleUserJoined = async (MemberId) => {
    if (!remoteUid) {
        remoteUid = MemberId;
        await createOffer(MemberId);
    }
};

let createPeerConnection = async (MemberId) => {
    try {
        if (peerConnection && connectionState !== 'disconnected') return;
        updateStatus('Connecting', 'Creating connection...');
        peerConnection = new RTCPeerConnection(servers);
        remoteStream = new MediaStream();
        document.getElementById('user-2').srcObject = remoteStream;
        document.getElementById('user-2').style.display = 'block';
        document.getElementById('user-1').classList.add('smallFrame');
        
        if (localStream) {
            localStream.getTracks().forEach((track) => {
                peerConnection.addTrack(track, localStream);
            });
        }
        
        peerConnection.ontrack = (event) => {
            event.streams[0].getTracks().forEach((track) => {
                remoteStream.addTrack(track);
            });
            updateStatus('Connected', 'Peer connected');
        };
        
        peerConnection.onicecandidate = async (event) => {
            if (event.candidate) {
                client.sendMessageToPeer({
                    text: JSON.stringify({ 'type': 'candidate', 'candidate': event.candidate })
                }, MemberId);
            }
        };
        
        peerConnection.onconnectionstatechange = () => {
            connectionState = peerConnection.connectionState;
            if (connectionState === 'failed') {
                updateStatus('Error', 'Connection failed');
            } else if (connectionState === 'disconnected' || connectionState === 'closed') {
                updateStatus('Disconnected', 'Peer disconnected');
            }
        };
    } catch (error) {
        updateStatus('Error', 'Connection failed');
    }
};

let createOffer = async (MemberId) => {
    try {
        await createPeerConnection(MemberId);
        let offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        client.sendMessageToPeer({
            text: JSON.stringify({ 'type': 'offer', 'offer': offer })
        }, MemberId);
    } catch (error) {
        updateStatus('Error', 'Offer failed');
    }
};

let createAnswer = async (MemberId, offer) => {
    try {
        await createPeerConnection(MemberId);
        await peerConnection.setRemoteDescription(offer);
        let answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        client.sendMessageToPeer({
            text: JSON.stringify({ 'type': 'answer', 'answer': answer })
        }, MemberId);
    } catch (error) {
        updateStatus('Error', 'Answer failed');
    }
};

let leaveChannel = async () => {
    try {
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        if (peerConnection) peerConnection.close();
        if (channel) await channel.leave();
        if (client) await client.logout();
    } catch (error) {}
};

let toggleCamera = async () => {
    try {
        let videoTrack = localStream.getTracks().find(track => track.kind === 'video');
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            document.getElementById('camera-btn').style.opacity = videoTrack.enabled ? '1' : '0.5';
        }
    } catch (error) {}
};

let toggleMic = async () => {
    try {
        let audioTrack = localStream.getTracks().find(track => track.kind === 'audio');
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            document.getElementById('mic-btn').style.opacity = audioTrack.enabled ? '1' : '0.5';
        }
    } catch (error) {}
};

window.addEventListener('beforeunload', leaveChannel);
window.addEventListener('load', () => {
    let cameraBtn = document.getElementById('camera-btn');
    let micBtn = document.getElementById('mic-btn');
    if (cameraBtn) cameraBtn.addEventListener('click', toggleCamera);
    if (micBtn) micBtn.addEventListener('click', toggleMic);
});

init();