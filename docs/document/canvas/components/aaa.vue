<template>
  <div>
    <canvas id='canvas1' width="300" height="200"></canvas>
  </div>
</template> 

<script>
export default {
  data () {
    return {
      canvas: null,
      ctx: null,
      speed: 0
    }
  },
  mounted () {
    this.$nextTick(() => {
      this.canvas = document.querySelector("#canvas1")
      this.ctx = this.canvas.getContext("2d")
      this.drawCircle(10,10,10,'#ccc','#ccc')
      this.move(() => {
        this.drawCircle(10,10,10,'#ccc','#ccc')
      })
    })
  },
  methods: {
    init () {
      
      //this.drawLine(10,10,50,10, 5)
      //this.drawLine(10,20,50,20, 2)
      //this.drawLine(10,30,50,30, 6)
      //this.drawLine(10,40,50,40)
      //this.continuousLine([[10, 10], [20, 10],[20, 20],[10, 20],[10, 10]])
      //this.drawRect(10,10,40,40)
      //this.drawRect(20,20,20,20)
      //this.drawCircle(30,30,30)
      //this.drawCircle(30,30,20)
      this.drawImage('../../public/logo.png')
    },
    // 画直线
    drawLine (startX, startY, endX, endY, w, lineCap, lineJoin, setLineDash) {
        this.ctx.beginPath()

        this.ctx.lineWidth = w || 1 // 线条粗细
        this.ctx.lineCap = lineCap || 'butt' // 线条开始和结束处的样式butt/round/square
        this.ctx.lineJoin = lineJoin || 'miter' // 线条连接处的样式 miter/bevel/round
        this.ctx.setLineDash(setLineDash || [0, 0]) // 设置线条虚实样式

        this.ctx.moveTo(startX, startY)
        this.ctx.lineTo(endX, endY)
        this.ctx.stroke()
        this.ctx.closePath()
    },
    // 连续画线(多边形)
    continuousLine (arrData) {
      arrData.forEach((item, index) => {
        if (index === 0) {
          this.ctx.moveTo(item[0], item[1])
        } else {
          this.ctx.lineTo(item[0], item[1])
        }
      })
      this.ctx.stroke()
    },
    // 绘制矩形
    drawRect (x, y, w, h, strokeStyle, fillStyle ) {
      this.ctx.rect(x, y, w, h)
      if (strokeStyle) {
        this.ctx.strokeStyle = strokeStyle;
      }
      if (fillStyle) {
        this.ctx.fillStyle = fillStyle;
        this.ctx.fill();
      }
      this.ctx.stroke();
    },
    // 绘制圆形
    drawCircle (x, y, r, strokeStyle, fillStyle) {
      this.ctx.save();

      this.ctx.beginPath()
      this.ctx.arc(x, y, r, 0, 360 * Math.PI/180);
      if (strokeStyle) {
        this.ctx.strokeStyle = strokeStyle;
      }
      if (fillStyle) {
        this.ctx.fillStyle = fillStyle;
        this.ctx.fill();
      }
      this.ctx.stroke();
      this.ctx.closePath()

      this.ctx.restore();
    },
    drawImage (src, ) {
      const img = new Image();
      img.src = src
      img.onload = () => {
        this.ctx.drawImage(img, 10, 10, 100, 100);
      }
    },
    // 移动
    move () {
      this.speed += 2
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.drawCircle(10 + this.speed,10,10,'#ccc','#ccc')
      // requestAnimationFrame(this.move)
    },
    
  }
}
</script>
<style>
  #canvas1 {
    border: 1px solid #ccc;
  }
</style>