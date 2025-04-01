
  ## 1. 标准盒模型和IE盒模型的区别？***
  盒模型都是由四个部分组成的，分别是margin、border、padding和content
  - 标准盒模型：width和height属性的范围只包含了content，
  - IE盒模型：width和height属性的范围包含了border、padding和content
  - box-sizeing: content-box表示标准盒模型（默认值）
  - box-sizeing: border-box表示IE盒模型(IE盒模型)
  ## 2.	行内元素可以设置padding和margin吗？
  - 行内元素margin/padding左右有效，上下无效
  ## 3.	边距重叠？
  边距重叠：如果两个盒子有设置了边距，那么在垂直方向上。会发生重叠的问题，会以绝对值最大的结果显示在页面上；
  边距重叠分为两种：同级元素和父子关系的重叠；
  - 同级元素：垂直方向上外边距会出现这种问题，最后以外边距最大的为标准；
  - 父子元素：如果子元素设置的外边距，在没有把父元素变成BFC的情况下，父元素也会产生外边距；解决办法：父元素设置overflow：hidden
  ## 4.	BFC是什么?***
  - 概念：BFC就是”块级格式化上下文“的意思，他是w3c css2.1中的一个规范，他决定了元素如何对其内容进行定位，以及与其他元素的关系和相互作用；简单的说：就是一个特殊的块，内部有自己的布局方式，不受这个块外面的元素影响；
  - 原理：内部的盒子会在垂直方向上一个接一个的放置，垂直方向上的距离由margin决定(属于同一个BFC的两个相邻的盒子的margin会发生重叠，与方向无关);
  简单来说：内部元素不影响外部、外部元素不影响内部；
  - 触发条件：
  float不为none；
  Position:absolute或者fixed；
  dispaly为inline-block、table-cell、table-caption、flex、inline-flex；
  Overflow不为visible;
  - 使用场景：
  清除元素的内部浮动；
  解决外边距和合并问题；
  制作右侧盒子自适应；
  ## 5.	清除浮动的方法？*****
  - 额外标签法(在最后一个浮动元素后加一个块标签，可使用伪元素，并设置clear:both);
  - 父元素添加overflow:hidden（通过触发BFC，实现清除浮动）；
  - 父元素设置高度
  ## 6. 水平垂直居中的方法有哪些？*****
  - position（定位）有两种
  - display：flex弹性盒
  - display：table-cell
  - overflow：hidden和margin配合
  ## 7	两栏布局、三栏布局、水平垂直居中*****
  - float浮动
  - grid栅格
  - flex弹性盒 
  ## 8.	Css选择器及优先级？***
  标签选择器；Id选择器；类选择器；后代选择器；子代选择器；兄弟选择器；交集选择器；并集选择器；属性选择器；伪类选择器；
  ！Important > 行内样式>id选择器>类选择器>标签选择器>通配符选择器

  ## CSS可继承属性和不可继承属性?
  - 可继承
    - font-weight
    - color
    - font-size
    - line-height
    - cursor

  - 不可继承
    - margin、padding、border
    - display
    - background
    - overflow
    - width、height
    - position

  ## 伪类选择器有哪些？
  - :first-child  第一个子元素(在所有子元素里找)
  - :first-of-type 同类型中的第一个子元素
  - :last-child
  - :last-of-type
  - :nth-child(n)  第n个子元素（odd奇数/even偶数）
    - :nth-of-type(n) 同类型第n个
    - :only-child 唯一一个子元素
    - :only-of-type 同类型中的唯一的一个子元素
    - :empty  匹配空元素
    - :not()  否定伪类，表示除了
  - a的伪类：
    - a:link{}  正常的超链接，设置没有访问过的链接样式
    - a:visited{}    访问过的链接样式（隐私原因，只能改颜色）
    - a:hover{}   鼠标悬停
    - a:active{}  鼠标点击时
  - 属性选择器：
    - [属性名]  获取含有指定属性的元素
    - [title]{}
    - [title='hello']{}  等于hello
    - [title^='h']{}    以h开头
    - [title$='h']{}    以h结尾
    - [title*='h']{}    只要包含h
    - [title*='hello' i]{} 忽略大小写
  - 常见伪元素
    - div::before{content:'hello'; color:yellow;}  表示元素开始的位置
    - div::after{content:''hello'' color:yellow;}     表示元素结束的位置
    - p::first-letter{}   选中第一个单词
    - p::first-line{}  选中第一行
    - p::selection()  鼠标选中内容

  ## 9.	Css3新特性？
  1. 圆角 （border-radius:8px）
  2. 多列布局 （multi-column layout）
  3. 阴影和反射 （Shadoweflect）
  4. 文字特效 （text-shadow）
  5. 文字渲染 （Text-decoration）
  6. 线性渐变 （gradient）
  7. 旋转 （transform） 增加了旋转,缩放,定位,倾斜,动画,多背景
  transition, animation, transform, box-shadow, background-clip
  flex, grid,  盒模型(box-sizing), 媒体查询

  ## 10、img中alt和title区别
    
  ## 11、css创建一个三角形
  transparent

  ## 12、css多列等高如何实现
  利用padding-bottom|margin-bottom正负值相抵
  ## 13、怎么让Chrome支持小于12px 的文字？
  用图片
  缩放

  ## 14、display:none;  visibility: hidden:区别
  - visibility:hidden将元素隐藏，但是在网页中该占的位置还是占着。
  - display:none将元素的显示设为无，即在网页中不占任何的位置。
  ## 15、position的absolute与fixed共同点与不同点

  ## 16、transition和animation区别
  - transition是过度属性，强调过度，它的实现需要触发一个事件（比如鼠标移动上去，焦点，点击等）才执行动画。它类似于flash的补间动画，设置一个开始关键帧，一个结束关键帧
  - animation是动画属性，它的实现不需要触发事件，设定好时间之后可以自己执行，且可以循环一个动画。它也类似于flash的补间动画，但是它可以设置多个关键帧（用@keyframe定义）完成动画。
  ## 17、雪碧图
  ## 18、元素消失的方法: 3种
  1. 使用display: none; 隐藏dom；
  2. 使用visibility: hidden; 隐藏dom；
  3. 使用z-index: -888; 把元素的层级调为负数，然后其他元素覆盖即可；
  4. 使用opacity: 0; 把元素的透明度调为0，也可以达到隐藏；
  5. 使用绝对定位position: absolute; 把元素定位到看不见的区域；
  6. 使用transform: scale(0, 0); 把元素缩放为0，也可以实现元素隐藏。
  7. ## 3. 两栏布局的实现
  一般两栏布局指的是左边一栏宽度固定，右边一栏宽度自适应，两栏布局的具体实现：

  利用浮动，将左边元素宽度设置为200px，并且设置向左浮动。将右边元素的margin-left设置为200px，宽度设置为auto（默认为auto，撑满整个父元素）。
  ```css
  .outer {
    height: 100px;
  }
  .left {
    float: left;
    width: 200px;
    background: tomato;
  }
  .right {
    margin-left: 200px;
    width: auto;
    background: gold;
  }
  ```

  利用浮动，左侧元素设置固定大小，并左浮动，右侧元素设置overflow: hidden; 这样右边就触发了BFC，BFC的区域不会与浮动元素发生重叠，所以两侧就不会发生重叠。
  ```css
  .left{
      width: 100px;
      height: 200px;
      background: red;
      float: left;
  }
  .right{
      height: 300px;
      background: blue;
      overflow: hidden;
  }
  ```

  利用flex布局，将左边元素设置为固定宽度200px，将右边的元素设置为flex:1。
  ```css
  .outer {
    display: flex;
    height: 100px;
  }
  .left {
    width: 200px;
    background: tomato;
  }
  .right {
    flex: 1;
    background: gold;
  }
  ```

  利用绝对定位，将父级元素设置为相对定位。左边元素设置为absolute定位，并且宽度设置为200px。将右边元素的margin-left的值设置为200px。
  ```css
  .outer {
    position: relative;
    height: 100px;
  }
  .left {
    position: absolute;
    width: 200px;
    height: 100px;
    background: tomato;
  }
  .right {
    margin-left: 200px;
    background: gold;
  }
  ```

  利用绝对定位，将父级元素设置为相对定位。左边元素宽度设置为200px，右边元素设置为绝对定位，左边定位为200px，其余方向定位为0。
  ```css
  .outer {
    position: relative;
    height: 100px;
  }
  .left {
    width: 200px;
    background: tomato;
  }
  .right {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 200px;
    background: gold;
  }
  ```
  ## 4. 三栏布局的实现
  三栏布局一般指的是页面中一共有三栏，左右两栏宽度固定，中间自适应的布局，三栏布局的具体实现：

  利用绝对定位，左右两栏设置为绝对定位，中间设置对应方向大小的margin的值。
  ```css
  .outer {
    position: relative;
    height: 100px;
  }

  .left {
    position: absolute;
    width: 100px;
    height: 100px;
    background: tomato;
  }

  .right {
    position: absolute;
    top: 0;
    right: 0;
    width: 200px;
    height: 100px;
    background: gold;
  }

  .center {
    margin-left: 100px;
    margin-right: 200px;
    height: 100px;
    background: lightgreen;
  }
  ```

  利用flex布局，左右两栏设置固定大小，中间一栏设置为flex:1。
  ```css
  .outer {
    display: flex;
    height: 100px;
  }

  .left {
    width: 100px;
    background: tomato;
  }

  .right {
    width: 100px;
    background: gold;
  }

  .center {
    flex: 1;
    background: lightgreen;
  }
  ```

  利用浮动，左右两栏设置固定大小，并设置对应方向的浮动。中间一栏设置左右两个方向的margin值，注意这种方式**，中间一栏必须放到最后：**
  ```css
  .outer {
    height: 100px;
  }

  .left {
    float: left;
    width: 100px;
    height: 100px;
    background: tomato;
  }

  .right {
    float: right;
    width: 200px;
    height: 100px;
    background: gold;
  }

  .center {
    height: 100px;
    margin-left: 100px;
    margin-right: 200px;
    background: lightgreen;
  }
  ```

  圣杯布局，利用浮动和负边距来实现。父级元素设置左右的 padding，三列均设置向左浮动，中间一列放在最前面，宽度设置为父级元素的宽度，因此后面两列都被挤到了下一行，通过设置 margin 负值将其移动到上一行，再利用相对定位，定位到两边。
  ```css
  .outer {
    height: 100px;
    padding-left: 100px;
    padding-right: 200px;
  }

  .left {
    position: relative;
    left: -100px;

    float: left;
    margin-left: -100%;

    width: 100px;
    height: 100px;
    background: tomato;
  }

  .right {
    position: relative;
    left: 200px;

    float: right;
    margin-left: -200px;

    width: 200px;
    height: 100px;
    background: gold;
  }

  .center {
    float: left;

    width: 100%;
    height: 100px;
    background: lightgreen;
  }
  ```

  双飞翼布局，双飞翼布局相对于圣杯布局来说，左右位置的保留是通过中间列的 margin 值来实现的，而不是通过父元素的 padding 来实现的。本质上来说，也是通过浮动和外边距负值来实现的。
  ```css
  .outer {
    height: 100px;
  }

  .left {
    float: left;
    margin-left: -100%;

    width: 100px;
    height: 100px;
    background: tomato;
  }

  .right {
    float: left;
    margin-left: -200px;

    width: 200px;
    height: 100px;
    background: gold;
  }

  .wrapper {
    float: left;

    width: 100%;
    height: 100px;
    background: lightgreen;
  }

  .center {
    margin-left: 100px;
    margin-right: 200px;
    height: 100px;
  }
  ```
  ## 5. 水平垂直居中的实现

  利用绝对定位，先将元素的左上角通过top:50%和left:50%定位到页面的中心，然后再通过translate来调整元素的中心点到页面的中心。该方法需要考虑浏览器兼容问题。
  ```css
  .parent {    position: relative;}
  .child {    position: absolute;    left: 50%;    top: 50%;    transform: translate(-50%,-50%);}
  ```

  利用绝对定位，设置四个方向的值都为0，并将margin设置为auto，由于宽高固定，因此对应方向实现平分，可以实现水平和垂直方向上的居中。该方法适用于盒子有宽高的情况：
  ```css
  .parent {
      position: relative;
  }
  
  .child {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      right: 0;
      margin: auto;
  }
  ```

  利用绝对定位，先将元素的左上角通过top:50%和left:50%定位到页面的中心，然后再通过margin负值来调整元素的中心点到页面的中心。该方法适用于盒子宽高已知的情况
  ```css
  .parent {
      position: relative;
  }
  
  .child {
      position: absolute;
      top: 50%;
      left: 50%;
      margin-top: -50px;     /* 自身 height 的一半 */
      margin-left: -50px;    /* 自身 width 的一半 */
  }
  ```

  使用flex布局，通过align-items:center和justify-content:center设置容器的垂直和水平方向上为居中对齐，然后它的子元素也可以实现垂直和水平的居中。该方法要考虑兼容的问题，该方法在移动端用的较多：
  ```css
  .parent {
      display: flex;
      justify-content:center;
      align-items:center;
  }
  ```
-------