let APP_ID='e4c9d93c28c646cb90e68601529b237d'
let token =null;
let uid=String(Math.floor(Math.random()*10000))
let client;
let channel;
let localStream;
let RemoteStream;
let peerConnection;
const servers={
    iceServers:[
        {
            urls: ['stun:stun1.l.google.com:19302','stun:stun2.l.google.com:19302']
        }
    ]
}

let init=async()=>{
    client=await AgoraRTM.createInstance(APP_ID)
    await client.login({uid,token})
    channel=await client.createChannel('main')
    await channel.join()
    channel.on('MemberJoined',handleUserJoined)
    client.on('MessageFromPeer',handleMessageFromPeer)
    localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true})
    document.getElementById('user-1').srcObject = localStream;
}
let handleMessageFromPeer=async(message,MemberId)=>{
    message=JSON.parse(message.text)
    console.log('Message from peer: ',message)
    }

let handleUserJoined=async(MemberId)=>{
    console.log('A new user joined the channel: ',MemberId)
    await createroffer(MemberId)
}
let createroffer=async (MemberId)=>{
    peerConnection=new RTCPeerConnection()
    RemoteStream=new MediaStream()
    document.getElementById('user-2').srcObject = RemoteStream
    if(!peerConnection.currentRemoteDescription){
        peerConnection.onnegotiationneeded=async()=>{
            let offer =await peerConnection.createOffer()
            await peerConnection.setLocalDescription(offer)
            console.log('offer: ', offer)}}
    localStream.getTracks().forEach((track)=>{
        peerConnection.addTrack(track,localStream)})
  peerConnection.ontrack=(event)=>{
        event.streams[0].getTracks().forEach((track)=>{RemoteStream.addTrack(track)})
    }

    peerConnection.onicecandidate=async(event)=>{
        if(event.candidate){
            client.sendMessageToPeer({text: JSON.stringify({'type': 'candidate', 'candidate': event.candidate})},MemberId)
        }
    }
    let offer =await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    console.log('offer: ', offer)

    client.sendMessageToPeer({text: JSON.stringify({'type': 'offer', 'offer': offer})},MemberId)
}
init()