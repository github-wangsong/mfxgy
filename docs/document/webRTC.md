# 常用aip
## 音视频采集getUserMedia

```js
const getLocalStream = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ // 获取音视频流
    audio: true,
    video: true
  })
  localVideo.value.srcObject = stream
  localVideo.value.play()
  return stream
}

```

## 核心对象 RTCPeerConnection

```js
const peer = new RTCPeerConnection({
  iccServers: [
    {
      url: 'stun:stun.1.google.com:19302'
    },
    {
      urls: 'turn:***',
      credential: '***',
      username: '***'
    }
  ]
})

```

主要会用到以下几个方法

### 媒体协商法
- createOffer
- createAnswer
- setLocalDesccripition
- setRemoteDesccription

### 重要事件

- onicecandidate
- onaddstream