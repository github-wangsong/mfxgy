import{_ as i,c as a,o as e,ag as o}from"./chunks/framework.DPDPlp3K.js";const p=JSON.parse('{"title":"","description":"","frontmatter":{},"headers":[],"relativePath":"docs/BaGuWen/browser.md","filePath":"docs/BaGuWen/browser.md"}'),t={name:"docs/BaGuWen/browser.md"};function r(n,l,s,d,u,c){return e(),a("div",null,l[0]||(l[0]=[o(`<h2 id="xss-跨站脚本攻击" tabindex="-1">XSS（跨站脚本攻击） <a class="header-anchor" href="#xss-跨站脚本攻击" aria-label="Permalink to &quot;XSS（跨站脚本攻击）&quot;">​</a></h2><ul><li>XSS 攻击指的是跨站脚本攻击，是一种代码注入攻击。攻击者通过在网站注入恶意脚本，使之在用户的浏览器上运行，从而盗取用户的信息如 cookie 等。</li><li>避免方式 <ul><li>不用服务器端拼接后返回（不使用服务端渲染）。</li><li>对一些敏感信息进行保护，比如 cookie 使用 http-only，使得脚本无法获取。</li><li>对用户输入的地方和变量都需要仔细检查长度和对 ”&lt;”,”&gt;”,”;”,”’” 等字符做过滤</li></ul></li></ul><h2 id="csrf-跨站请求伪造" tabindex="-1">CSRF（跨站请求伪造） <a class="header-anchor" href="#csrf-跨站请求伪造" aria-label="Permalink to &quot;CSRF（跨站请求伪造）&quot;">​</a></h2><ul><li>CSRF 攻击的本质是利用 cookie 会在同源请求中携带发送给服务器的特点，以此来实现用户的冒充。</li><li>避免方式 <ul><li>添加验证码验证</li><li>使用token验证</li><li>限制 cookie 不能作为被第三方使用</li><li>进行同源检测</li></ul></li></ul><h2 id="什么进程和线程-有什么区别" tabindex="-1">什么进程和线程？有什么区别 <a class="header-anchor" href="#什么进程和线程-有什么区别" aria-label="Permalink to &quot;什么进程和线程？有什么区别&quot;">​</a></h2><details><summary>Title</summary><pre>    <b>进程（Process）</b>
      进程是计算机中正在运行的程序的实例，一个进程就是一个程序运行实例。它拥有独立的内存空间、代码和数据，并且由操作系统负责调度和管理。每个进程在执行时都会分配独立的内存空间，不同进程之间的内存是隔离的，一个进程的错误不会直接影响其他进程。 进程之间通过进程间通信（IPC）机制来交换数据和进行通信，常见的IPC方式包括管道、消息队列、共享内存等。进程的切换开销较大，因为需要保存和恢复进程的完整状态，涉及到内存保护和虚拟内存的切换。
    <b>线程（Thread）</b>
      线程是进程的子任务，一个进程可以包含多个线程。它们共享相同的代码和数据，但拥有独立的执行栈和寄存器集合。多个线程可以在同一进程内并发执行，共享进程的资源，如内存空间、打开的文件等。线程间的通信和数据交换比进程间的通信更加方便，因为它们共享相同的地址空间。线程的切换开销较小，因为线程共享进程的地址空间，切换时不需要切换内存页表，速度较快。
    <b>区别</b>
      进程和线程都可以实现并发执行，但进程是独立的执行实体，而线程是依赖于进程的。
      进程之间资源相互隔离，线程共享所属进程的资源。
      创建和销毁线程的开销较小，而创建和销毁进程的开销较大。
      多线程程序的编程复杂度通常比单线程程序高，但多线程可以更好地利用多核处理器来提高程序的执行效率。
    </pre></details><h2 id="浏览器有哪些进程" tabindex="-1">浏览器有哪些进程 <a class="header-anchor" href="#浏览器有哪些进程" aria-label="Permalink to &quot;浏览器有哪些进程&quot;">​</a></h2><ul><li>主进程：负责处理用户输入、渲染页面等主要任务。</li><li>渲染进程：渲染进程负责解析HTML、CSS和JavaScript，并将网页渲染成可视化内容。</li><li>GPU进程：负责处理浏览器中的GPU加速任务。</li><li>网络线程：网络进程负责处理浏览器中的网络请求和响应，包括下载网页和资源等。</li><li>插件进程：负责浏览器插件运行。</li></ul><h2 id="协商缓存和强缓存的区别" tabindex="-1">协商缓存和强缓存的区别 <a class="header-anchor" href="#协商缓存和强缓存的区别" aria-label="Permalink to &quot;协商缓存和强缓存的区别&quot;">​</a></h2><details><summary>Title</summary><pre>        如果设置强缓存，无需发起请求，直接使用缓存内容。如果没有命中强缓存，设置了协商缓存，也不需要发起请求，使用缓存。
    命中协商缓存条件：
      Cache-Control: no-cache
      max-age时间过期
    在使用协商缓存时，会先向服务器发送一个请求，如果资源没有发生修改，则请求返回304状态，让浏览器使用本地缓存。如果资源发生修改，则返回修改后的内容
    在request headers中的Etag属性和Last-Modified属性，来进行设置。其中，ETage优先于Last-Modified。
    Etag文件改动
      服务器在返回资源的时候，在头信息中添加Etag属性，这个属性是资源的唯一标识符。当资源改变，这个值也会改变。下次请求资源时，会在请求头中添加If-None-Match属性，为上一次请求的资源的Etag值。服务端会通过这个属性和资源最后一次修改时间进行对比，以此来判断资源是否修改。这种方式比Last-Modified更加准确。
    Last-Modified 上次修改时间
      服务器通过在响应头上添加Last-Modified属性，来指出资源最后一次修改时间。当浏览器发起请求时，会在请求头上添加一个IF-Modified-Since属性，值为上一次资源请求的Last-Modified的值。服务区会通过这个属性和最后修改时间来进行比较，以此来判断资源是否修改。如果没有资源修改，返回304状态，使用本地缓存。如果资源修改，就返回最新资源，200状态。
    这种方式有个缺点，Last-Modified标记的时间只能精确到1秒，如果文件在1秒内修改，但是 Last-Modified 却没有改变，这样会造成缓存命中的不准确。
    区别
      强缓存优先级高于协商缓存
      协商缓存不论命中与否都会发送一次请求
      强缓存返回200，协商缓存命中返回304
      Ctrl+F5 会强制刷新会跳过所有缓存，而F5刷新跳过强缓存，但是会检查协商缓存。
    </pre></details><h2 id="常见浏览器所用内核" tabindex="-1">常见浏览器所用内核 <a class="header-anchor" href="#常见浏览器所用内核" aria-label="Permalink to &quot;常见浏览器所用内核&quot;">​</a></h2><ul><li>IE浏览器内核，Trident 内核，也是俗称的IE内核；</li><li>Chrome 浏览器内核，以前是 Webkit 内核，现在是 Blink内核；</li><li>Firefox 浏览器内核：Gecko 内核，俗称 Firefox 内核；</li><li>Safari 浏览器内核：Webkit 内核；</li><li>360浏览器、猎豹浏览器内核：IE + Chrome 双内核；</li></ul><h2 id="浏览器的渲染过程" tabindex="-1">浏览器的渲染过程 <a class="header-anchor" href="#浏览器的渲染过程" aria-label="Permalink to &quot;浏览器的渲染过程&quot;">​</a></h2><ul><li>解析文档，生成DOM树</li><li>解析CSS，根据CSS规则生成CSSOM规则树</li><li>在CSSOM树和DOM树生成完后，合并DOM、CSSOM树构建渲染树</li><li>渲染树构建完成后，开始计算元素大小和位置【回流发生在这个阶段】</li><li>根据计算好的位置信息将内容渲染到屏幕上【重绘发生在这个阶段】</li></ul><h2 id="浏览器渲染优化" tabindex="-1">浏览器渲染优化 <a class="header-anchor" href="#浏览器渲染优化" aria-label="Permalink to &quot;浏览器渲染优化&quot;">​</a></h2><ul><li><p>优化javaScript，JavaScript会阻塞HTML的解析，改变JavaScrip加载方式。</p><ul><li>将JavaScript放到body最后面</li><li>尽量使用异步加载JS资源，这样不会阻塞DOM解析，如defer、async</li></ul></li><li><p>优化CSS加载，</p><ul><li>CSS样式少，使用内嵌样式</li><li>导入外部样式使用link，而不是@import，因为它会阻塞渲染。</li></ul></li><li><p>减少回流重绘</p><ul><li>避免频繁操作样式</li><li>避免频繁操作DOM</li><li>复杂动画使用定位脱离文当流</li><li>使用transform替代动画</li></ul></li></ul><h2 id="cookie、localstorage、sessionstorage区别" tabindex="-1">Cookie、LocalStorage、SessionStorage区别 <a class="header-anchor" href="#cookie、localstorage、sessionstorage区别" aria-label="Permalink to &quot;Cookie、LocalStorage、SessionStorage区别&quot;">​</a></h2><ul><li><p>Cookie</p><ul><li>大小只有4kb</li><li>跨域不能共享</li><li>不安全，容易被劫持</li><li>只存在请求头中</li></ul></li><li><p>SessionStorage</p><ul><li>存储在内存中，体积相对较大</li><li>页面关闭，数据会消失</li><li>相对Cookie安全</li></ul></li><li><p>LocalStorage</p><ul><li>体积大，可以存储更多内容。</li><li>生命周期长，除非手动删除，不然会一直存在</li><li>存储在硬盘中，不会像Cookie一样被请求携带</li></ul></li></ul><h2 id="如何解决跨越问题" tabindex="-1">如何解决跨越问题 <a class="header-anchor" href="#如何解决跨越问题" aria-label="Permalink to &quot;如何解决跨越问题&quot;">​</a></h2><ul><li>CORS：服务器开启跨域资源共享</li><li>JSONP：利用<code>&lt;script&gt;</code>标签不存在跨域限制，只支持GET请求，且不安全。</li><li>nginx代理跨域</li><li>nodejs 中间件代理跨域，通过node开启一个代理服务器。</li></ul><h2 id="事件流" tabindex="-1">事件流 <a class="header-anchor" href="#事件流" aria-label="Permalink to &quot;事件流&quot;">​</a></h2><ul><li>捕获阶段：事件从最外层的节点，也就是文档对象开始，逐级向下传播，直到事件的目标节点上。</li><li>目标阶段：事件到达目标节点，触发目标节点上的事件处理函数。</li><li>冒泡阶段：事件从目标节点开始，逐级向上传播，直到到达最外层节点（文档对象）</li></ul><h2 id="事件冒泡和捕获的区别" tabindex="-1">事件冒泡和捕获的区别？ <a class="header-anchor" href="#事件冒泡和捕获的区别" aria-label="Permalink to &quot;事件冒泡和捕获的区别？&quot;">​</a></h2><p>事件冒泡和事件捕获是两种不同的事件传播方式，默认是冒泡，它们的区别在于传播方向不同：</p><ul><li>事件冒泡是从自下而上，从子元素冒泡到父元素，执行父元素上的事件处理。</li><li>事件捕获是事件从文档的根元素开始，逐级向下传播到较为具体的元素（即从父元素到子元素）。</li><li>阻止冒泡 <ul><li>普通浏览器：event.stopPropagation()</li><li>IE浏览器：event.cancelBubble = true;</li></ul></li></ul><h2 id="对事件委托的理解" tabindex="-1">对事件委托的理解 <a class="header-anchor" href="#对事件委托的理解" aria-label="Permalink to &quot;对事件委托的理解&quot;">​</a></h2><p>利用浏览器事件冒泡机制。事件在冒泡的过程中会传到父节点，并且父节点可以通过事件对象获取到目标节点，可以吧子节点的监听函数定义在父节点上，由父节点的监听函数统一处理多个子元素的事件</p><h2 id="回流与重绘" tabindex="-1">回流与重绘 <a class="header-anchor" href="#回流与重绘" aria-label="Permalink to &quot;回流与重绘&quot;">​</a></h2><ul><li><p>回流 当DOM变化影响了元素，比如元素的尺寸、布局、显示隐藏等改变了，需要重写构建。每个页面至少需要一次回流，就是在页面第一次加载的时候，这个时候一定会发生回流。</p></li><li><p>重绘 当一个元素的外观发生变化，但是没有改变布局，重新渲染元素的外观。比如background-color、color</p></li><li><p>如何避免回流重绘：</p><ul><li>避免使用table布局</li><li>尽可能在DOM树的最末端改变class</li><li>不要频繁的操作元素的样式</li><li>避免设置多层内联样式</li><li>开启GPU加速</li><li>使用absolute或者fixed，脱离标准文档流</li></ul></li><li><p>回流必将引起重绘，而重绘不一定会引起回流</p></li></ul><h2 id="对浏览器事件循环的理解" tabindex="-1">对浏览器事件循环的理解 <a class="header-anchor" href="#对浏览器事件循环的理解" aria-label="Permalink to &quot;对浏览器事件循环的理解&quot;">​</a></h2><ul><li>执行顺序 <ul><li>执行宏任务中的同步代码，遇到宏任务或微任务，分别放入对应的任务队列，等待执行。</li><li>当所有同步任务执行完毕后，执行栈为空，首先执行微任务队列中的任务</li><li>微任务执行完毕后，检查这次执行中是否产生新的微任务，如果存在，重复执行步骤，直到微任务执行完毕。</li></ul></li><li>开始下一轮Event Loop，执行宏任务中的代码</li></ul><details><summary>Title</summary><pre>      事件循环是一种机制，它会不断的轮询任务队列，并将队列中的任务依此执行。
      JavaScript的任务分为两种同步和异步：
      同步任务：在主线程上排队执行的任务，只有一个任务执行完毕，才能执行下一个任务，
      异步任务：不进入主线程，而是放在任务队列中，若有多个异步任务则需要在任务队列中排队等待，任务队列类似于缓冲区，任务下一步会被移到执行栈然后主线程执行调用栈的任务。
      因为js是单线程，在执行代码的时候将所有函数压入执行栈中。同步任务会按照后进先出的原则以此执行。遇到异步任务时，将其放入任务队列中。当前执行栈里事件执行完毕后，就会从任务队列中取出对应异步任务的回调函数放入执行栈中继续执行。
      宏观任务(MacroTask|Task)、微观任务(MicorTask)。
      宏任务：script全部代码、setTimeout、setInterval、I/O、UI渲染
      微任务：Promise.then、Process.nexTick(Node独有)、MutationObserver
      任务队列中的任务分为宏任务和微任务，当执行栈清空后，会先检查任务队列中是否有微任务，如果有就按照先进先出的原则，压入执行栈中执行。微任务中产生了新的微任务不会推迟到下一个循环中，而是在当前循环中继续执行。 当执行这一轮的微任务完毕后，开启下一轮循环，执行任务队列中的宏任务。
      一次 Eventloop 循环会处理一个宏任务和所有这次循环中产生的微任务。
  </pre></details><h2 id="对node事件循环的理解" tabindex="-1">对node事件循环的理解 <a class="header-anchor" href="#对node事件循环的理解" aria-label="Permalink to &quot;对node事件循环的理解&quot;">​</a></h2><details><summary>Title</summary><pre>      Node事件循环分为6个阶段，每进入一个阶段，都会去对应的回调队列中取出函数执行。
      Timers阶段：执行timer（setTimeout、setInterval）的回调，由poll阶段控制；
      I/O callbacks阶段：系统调用相关的回调
      idle prepare阶段：Nodejs内部执行，可以忽略
      poll阶段：轮询
      在该阶段如果没有timer的话，会出现一下情况
      poll队列不为空，会遍历回调队列并同步执行，直到队列为空或者达到系统限制；
      poll队列对空，会出现以下两种情况
      如果有 setImmediate 回调需要执行，poll 阶段会停止并且进入到 check 阶段执行回调；
      如果没有 setImmediate 回调需要执行，就会等待回调被天加到队列中，然后立即执行。
      如果设置里有timer，并且 poll 队列为空，就会判断是否有 timer 超时，如果有就回到 timers 阶段执行回调。
      check阶段：执行 setImmediate 回调
      colse callbacks阶段：执行一些关闭回调，比如socket.on(&#39;close&#39;, ...)等。
  </pre></details>`,34)]))}const m=i(t,[["render",r]]);export{p as __pageData,m as default};
