import{_ as e,c as r,o as t,ag as a}from"./chunks/framework.DPDPlp3K.js";const h=JSON.parse('{"title":"","description":"","frontmatter":{},"headers":[],"relativePath":"docs/BaGuWen/write.md","filePath":"docs/BaGuWen/write.md"}'),i={name:"docs/BaGuWen/write.md"};function o(l,n,s,c,u,m){return t(),r("div",null,n[0]||(n[0]=[a(`<h2 id="实现一个new操作符" tabindex="-1">实现一个new操作符 <a class="header-anchor" href="#实现一个new操作符" aria-label="Permalink to &quot;实现一个new操作符&quot;">​</a></h2><details><summary>实现一个new操作符</summary><pre><code>
      /** 手写 new 操作符
      * 用法：创建一个实例化对象
      * 思路：
      *  1、判断传入的 fn 是否为 function
      *  2、创建一个空对象
      *  3、将这个空对象的原型设置为构造函数的 prototype 属性。
      *  4、使用 apply 执行构造函数 并传入参数 arguments 获取函数的返回值
      *  5、判断这个返回值 如果返回的是 Object || Function 类型 就返回该对象 否则返回创建的对象
      * @param {Function} fn 构造函数
      * @return {*}
      */
      function myNew(fn, ...args) {
        // 判断 fn 是否为函数
        if (typeof fn !== &#39;function&#39;) {
          return new TypeError(&#39;fn must be a function&#39;)
        }
        // 创建一个空的对象
        let obj = null
        // 将这个空对象的原型设置为构造函数的 prototype 属性。
        obj = Object.create(fn.prototype)
        // 通过 apply 执行构造函数 传入参数 获取返回值
        let result = fn.apply(obj, args)
        // 判断这个返回值 如果返回的是 Object || Function 类型 就返回该对象 否则返回创建的对象
        const flag = result &amp;&amp; (typeof result === &#39;object&#39; || typeof result === &#39;function&#39;)
        return flag ? result : obj
      }
    </code></pre></details><h2 id="实现一个intanceof操作符" tabindex="-1">实现一个intanceof操作符 <a class="header-anchor" href="#实现一个intanceof操作符" aria-label="Permalink to &quot;实现一个intanceof操作符&quot;">​</a></h2><details><summary>实现一个intanceof操作符</summary><pre><code>
      /** 手写 instanceof 方法
      * 用法：instanceof 运算符用于检测构造函数的 prototype 属性是否出现在某个实例对象的原型链上。
      * 思路：
      *  1、通过 Object.getPrototypeOf 获取 obj 的原型
      *  2、循环判断 objProtoType 是否和 constructor 的原型相等
      *    2.1、如果相等就返回 true
      *    2.2、如果不相等 就重新赋值一下 obj 的原型 进入下一次循环
      *  3、判断是 objProtoType 是否为空 如果为空就说明不存在 返回 false
      * @param {Object} obj 需要判断的数据
      * @param {Object} constructor
      * @return {*}
      */
      function myInstanceof(obj, type) {
        let objPrototype = Object.getPrototypeOf(obj)
        while (true) {
          if (!objPrototype) return false
          if (objPrototype === type.prototype) return true
          objPrototype = Object.getPrototypeOf(objPrototype)
        }
      }
    </code></pre></details><h2 id="手写-object-create" tabindex="-1">手写 Object.create <a class="header-anchor" href="#手写-object-create" aria-label="Permalink to &quot;手写 Object.create&quot;">​</a></h2><details><summary>手写 Object.create</summary><pre><code>
        /** 手写 Object.create
        * 用法：创建一个新的对象，将传入的对象原型指向新对象并返回
        * 思路：
        *  1、将原型写入到一个函数里面，然后将函数返回
        * @param {*} obj
        * @return {*} 
        */
      function myCreate(obj) {
        function F() {}
        F.prototype = obj
        return new F()
      }
    </code></pre></details><h2 id="手写-浅拷贝" tabindex="-1">手写 浅拷贝 <a class="header-anchor" href="#手写-浅拷贝" aria-label="Permalink to &quot;手写 浅拷贝&quot;">​</a></h2><details><summary>手写 浅拷贝</summary><pre><code>
      /** 浅拷贝
      * 用法：浅拷贝是指，一个新的对象对原始对象的属性值进行精确地拷贝，如果拷贝的是基本数据类型，拷贝的就是基本数据类型的值，如果是引用数据类型，拷贝的就是内存地址。如果其中一个对象的引用内存地址发生改变，另一个对象也会发生变化。
      * 思路：
      *  1、判断是否为对象
      *  2、根据obj类型创建一个新的对象
      *  3、for in 遍历对象 拿到 key
      *  4、判断 key 是否在 obj 中
      *  5、将 key 作为新对象的key 并赋值 value
      *
      * @param {*} obj
      * @return {*} 
      */
    function shallowCopy(obj) {
      // 只拷贝对象
      if (!obj || typeof obj !== &#39;object&#39;) {
        return obj
      }
      // 新的对象
      const newObj = Array.isArray(obj) ? [] : {}
      // 循环遍历 obj 将 key 作为 newObj 的 key 并赋值value
      for (const key in obj) {
        // 判断 key 是否在 obj 中
        if (obj.hasOwnProperty(key)) {
          newObj[key] = obj[key]
        }
      }
      return newObj
    }
    </code></pre></details><h2 id="手写-深拷贝" tabindex="-1">手写 深拷贝 <a class="header-anchor" href="#手写-深拷贝" aria-label="Permalink to &quot;手写 深拷贝&quot;">​</a></h2><details><summary>手写 深拷贝</summary><pre><code>
      /** 深拷贝
      * 用法：拷贝一个对象的属性值 如果遇到属性值为引用类型的时候，它新建一个引用类型并将对应的值复制给它，因此对象获得的一个新的引用类型而不是一个原有类型的引用
      * 思路：
      *  1、判断是否为对象
      *  2、判段对象是否在 map 中 如果存在就不需要操作
      *  3、将 obj 放入 map 中 避免重复引用
      *  4、for in 遍历对象 拿到 key 判断 key 是否在 obj 中
      *  5、value 如果为对象 就递归拷贝 否则就赋值
      * @param {*} obj
      * @param {*} [map=new Map()]
      * @return {*} 
      */
    function deepCopy(obj, map = new Map()){
      if (!obj || typeof obj !== &#39;object&#39;){
        return obj
      }
      // 判断 obj 是否在 map 中存在 如果存在就不需要递归调用 直接返回数据
      if (map.get(obj)) {
        return map.get(obj)
      }
      const newObj = Array.isArray(obj) ? [] : {}
      // 放入 map 中 记录当前对象 避免重复拷贝 循环引用
      map.set(obj, newObj)
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          // 如果 value 还是一个对象 递归获取 否则就赋值
          newObj[key] = typeof obj[key] === &#39;object&#39; ? deepCopy(obj[key], map) : obj[key]
        }
      }
      return newObj
    }
    </code></pre></details><h2 id="手写-节流" tabindex="-1">手写 节流 <a class="header-anchor" href="#手写-节流" aria-label="Permalink to &quot;手写 节流&quot;">​</a></h2><details><summary>手写 节流</summary><pre><code>
      /** 手写节流
      * 用法：函数在 n 秒内只执行一次，如果多次触发，则忽略执行。
      * 思路：
      *  1、记录函数上一次执行的时间戳 startTime
      *  2、返回一个闭包函数 当被调用时会记录一下执行时间 nowTime
      *  3、比较两次执行时间间隔 是否超过了 wait 时间
      *  4、如果是大于 wait 时间 说明已经过了一个 wait 时间 可以执行函数
      *    4.1、更新 startTime 方便下次对比
      *    4.2、通过 apply 执行函数fn 传入 arguments 参数
      *  5、如果没有超过 wait 时间  说明是在 wait 时间内又执行了一次  忽略
      * @param {Function} fn 执行函数
      * @param {Number} wait 等待时间
      * @return {*} 
      */
    function throttle(fn, wait) {
      let startTime = Date.now()
      return function () {
        const nowTime = Date.now()
        // 计算两次执行的间隔时间 是否大于 wait 时间
        if (nowTime - startTime &gt;= wait) {
          startTime = nowTime
          return fn.apply(this, arguments)
        }
      }
    }
    </code></pre></details><h2 id="手写-防抖" tabindex="-1">手写 防抖 <a class="header-anchor" href="#手写-防抖" aria-label="Permalink to &quot;手写 防抖&quot;">​</a></h2><details><summary>手写 防抖</summary><pre><code>
    /** 手写防抖
      * 用法：函数在 n 秒后再执行，如果 n 秒内被触发，重新计时，保证最后一次触发事件 n 秒后才执行。
      * 思路：
      *  1、保存一个变量 timer
      *  2、返回一个闭包函数 函数内判断一下 timer 是否有值
      *    2.1、如果有值 说明 定时器已经开启 需要将定时器清空
      *  3、设置定时器 等待 wait 后执行 将定时器赋值给 timer 记录
      *  4、通过 apply 执行函数 传入 arguments
      * @param {*} fn
      * @param {*} wait
      * @param {boolean} [immediate=false]
      * @return {*} 
      */
    function debounce(fn, wait, immediate = false) {
      let timer = null
      return function () {
        // 存在定时器 清空
        if (timer) {
          clearInterval(timer)
          timer = null
        }
        // 立即执行
        if (immediate) {
          // 判断是否执行过  如果执行过 timer 不为空
          const flag = !timer
          // 执行函数
          flag &amp;&amp; fn.apply(this, arguments)
          // n 秒后清空定时器
          timer = setTimeout(() =&gt; {
            timer = null
          }, wait)
        } else {
          timer = setTimeout(() =&gt; {
            fn.apply(this, arguments)
          }, wait)
        }
      }
    }
    </code></pre></details><h2 id="函数柯里化" tabindex="-1">函数柯里化 <a class="header-anchor" href="#函数柯里化" aria-label="Permalink to &quot;函数柯里化&quot;">​</a></h2><details><summary>函数柯里化</summary><pre><code>
      /** 函数柯里化
      * 用法：函数柯里化是一种将接受多个参数的函数转换为接受一系列单一参数的函数的技术
      * 思路：
      *  1、使用 fn.length 获取函数的形参数量
      *  2、如果没有传入初始参数数组 则将其初始化为空数组 在递归的时候会接受上一次的形参
      *  3、返回一个闭包函数 接受函数的实参 将 args 中的形参和当前的形参进行合并 得到 newArgs
      *  4、如果新的参数数组 newArgs 长度大于等于 length 函数的形参数量 调用 apply 执行函数 传入 newArgs
      *  5、如果新的参数数组长度小于函数的形参数量 则再次调用 curry 函数 将新的参数数组作为初始参数传入 返回一个新的闭包函数
      * @param {*} fn
      * @param {*} args
      * @return {*} 
      */
    function curry(fn, args) {
      // 获取 fn 获取 add 函数的形参数量
      const length = fn.length
      // 递归执行时传递的上一次参数 第一次执行 [] 第二次执行 [1]
      args = args || []
      return function () {
        // 将上一次参数和这次的参数进行合并  得到新的参数数组
        const newArgs = [...args, ...arguments]
        // 判断 newArgs 长度是否和 add 函数形参长度一致 如果超过就执行 fn 函数 传递 newArgs
        if (newArgs.length &gt;= length) {
          return fn.apply(this, newArgs)
        } else {
          // 小于 add 函数形参长度 递归调用 curry 函数 累积参数 传递 newArgs
          return curry(fn, newArgs)
        }
      }
    }
    </code></pre></details><h2 id="手写-call" tabindex="-1">手写 call <a class="header-anchor" href="#手写-call" aria-label="Permalink to &quot;手写 call&quot;">​</a></h2><details><summary>手写 call</summary><pre><code>
      /** 手写 call
      * 用法：call 方法用于调用一个函数，并指定函数内部 this 的指向，传入一个对象
      * 思路：
      *  1、判断 this 是否指向一个函数  只有函数才可以执行
      *  2、获取传入的 context 上下文 也就是我们要指向的 如果不存在就指向 window
      *  3、将当前 this 也就是外部需要执行的函数 绑定到 context 上 然后执行获取 result 传入 ...args 确保参数位置正确
      *  4、删除 context 对象的 fn 属性 并将 result 返回
      */
    Function.prototype.myCall = function (context, ...args) {
      if (typeof this !== &#39;function&#39;) {
        return new TypeError(&#39;type error&#39;)
      }
      context = context || window
      // 缓存this
      context.fn = this
      const result = context.fn(...args)
      delete context.fn
      return result
    }
    </code></pre></details><h2 id="手写-promise" tabindex="-1">手写 Promise <a class="header-anchor" href="#手写-promise" aria-label="Permalink to &quot;手写 Promise&quot;">​</a></h2><details><summary>手写 Promise</summary><pre><code>
      class MyPromise {
        constructor(executor) {
          this.state = &#39;pending&#39;
          this.value
          this.reason
          this.onResolveCallbacks = []
          this.onRejectCallbacks = []
          const resolve = (value) =&gt; {
            if (this.state === &#39;pending&#39;) {
              this.value = value
              this.state = &#39;fulfilled&#39;
              this.onResolveCallbacks.forEach((fn) =&gt; fn())
            }
          }
          const reject = (reason) =&gt; {
            if (this.state === &#39;pending&#39;) {
              this.reason = reason
              this.state = &#39;rejected&#39;
              this.onRejectCallbacks.forEach((fn) =&gt; fn())
            }
          }
          try {
            executor(resolve, reject)
          } catch (error) {
            reject(error)
          }
        }
        then(onFulfilled, onRejected) {
          // 判断类型
          onFulfilled = typeof onFulfilled === &#39;function&#39; ? onFulfilled : (value) =&gt; value
          onRejected =
            typeof onRejected === &#39;function&#39;
              ? onRejected
              : (reason) =&gt; {
                  throw reason
                }
          const p2 = new MyPromise((resolve, reject) =&gt; {
            // 执行成功
            // 执行失败
            // pending状态放入任务队列
            if (this.state === &#39;fulfilled&#39;) {
              setTimeout(() =&gt; {
                try {
                  const x = onFulfilled(this.value)
                  this.resolvePromise(p2, x, resolve, reject)
                } catch (error) {
                  reject(error)
                }
              }, 0)
            } else if (this.state === &#39;rejected&#39;) {
              setTimeout(() =&gt; {
                try {
                  const x = onRejected(this.reason)
                  this.resolvePromise(p2, x, resolve, reject)
                } catch (error) {
                  reject(error)
                }
              }, 0)
            } else {
              this.onResolveCallbacks.push(() =&gt; {
                setTimeout(() =&gt; {
                  try {
                    const x = onFulfilled(this.value)
                    this.resolvePromise(p2, x, resolve, reject)
                  } catch (error) {
                    reject(error)
                  }
                }, 0)
              })
              this.onRejectCallbacks.push(() =&gt; {
                setTimeout(() =&gt; {
                  try {
                    const x = onRejected(this.reason)
                    this.resolvePromise(p2, x, resolve, reject)
                  } catch (error) {
                    reject(error)
                  }
                }, 0)
              })
            }
          })
          return p2
        }
        resolvePromise(p2, x, resolve, reject) {
          // 判断 p2 和x是否相等
          if (p2 === x) {
            return reject(new TypeError(&#39;type error&#39;))
          }
          // 执行锁 确保执行一次完resolve或者reject后 不再执行
          let called = false
          // 判断x数据类型  如果是函数 对象 需要递归执行  如果是值类型 直接resolve
          if (x !== null &amp;&amp; (typeof x === &#39;object&#39; || typeof x === &#39;function&#39;)) {
            try {
              // 判断 then是否为函数
              const then = x.then
              if (typeof then === &#39;function&#39;) {
                then.call(
                  x,
                  (y) =&gt; {
                    if (called) return
                    called = true
                    this.resolvePromise(p2, y, resolve, reject)
                  },
                  (r) =&gt; {
                    if (called) return
                    called = true
                    reject(r)
                  },
                )
              } else {
                resolve(x)
              }
            } catch (error) {
              if (called) return
              called = true
              reject(error)
            }
          } else {
            resolve(x)
          }
        }
      }
    </code></pre></details><h2 id="手写-promise-all" tabindex="-1">手写 Promise.all() <a class="header-anchor" href="#手写-promise-all" aria-label="Permalink to &quot;手写 Promise.all()&quot;">​</a></h2><details><summary>手写 Promise.all()</summary><pre><code>
        /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
    all(array) {
      return new MyPromise((resolve, reject) =&gt; {
        if (!Array.isArray(array)) {
          throw new TypeError(&#39;You must pass an array to all.&#39;)
        }
        const result = []
        let count = 0
        // 遍历 array 拿到每一条数据
        array.forEach((promise, index) =&gt; {
          MyPromise.resolve(promise).then(
            (value) =&gt; {
              result[index] = value
              count++
              // 判断 result 结果值的长度 和 array参数的长度相等  执行最外面的 resolve 返回 all 结果
              if (count === array.length) {
                resolve(array)
              }
            },
            (err) =&gt; {
              reject(err)
            },
          )
        })
      })
    }
    </code></pre></details><h2 id="手写-promise-race" tabindex="-1">手写 Promise.race() <a class="header-anchor" href="#手写-promise-race" aria-label="Permalink to &quot;手写 Promise.race()&quot;">​</a></h2><details><summary>手写 Promise.race()</summary><pre><code>
          /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
    race(array) {
      return new MyPromise((resolve, reject) =&gt; {
        if (!Array.isArray(array)) {
          throw new TypeError(&#39;You must pass an array to all.&#39;)
        }
        array.forEach((promise) =&gt; {
          MyPromise.resolve(promise).then(
            (value) =&gt; {
              resolve(value)
            },
            (reason) =&gt; {
              reject(reason)
            },
          )
        })
      })
    }
      </code></pre></details><h2 id="数组扁平化" tabindex="-1">数组扁平化 <a class="header-anchor" href="#数组扁平化" aria-label="Permalink to &quot;数组扁平化&quot;">​</a></h2><details><summary>数组扁平化</summary><pre><code>
          /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
      let arr = [1, [2, [3, 4, 5]]]
      // 递归
      function flatten(arr) {
        let newArr = []
        // 递归获取数据
        for (let index = 0; index &lt; arr.length; index++) {
          const element = arr[index]
          Array.isArray(element) ? (newArr = newArr.concat(flatten(element))) : newArr.push(element)
        }
        return newArr
      }
      // 栈
      function flatten(arr) {
        const stack = [...arr]
        const result = []
        while (stack.length) {
          const next = stack.pop()
          if (Array.isArray(next)) {
            stack.push(...next)
          } else {
            result.push(next)
          }
        }
        return result.reverse()
      }
      // es6结构赋值
      function flatten(arr) {
        while (arr.some((item) =&gt; Array.isArray(item))) {
          arr = [].concat(...arr)
        }
        return arr
      }
    </code></pre></details><h2 id="数组去重" tabindex="-1">数组去重 <a class="header-anchor" href="#数组去重" aria-label="Permalink to &quot;数组去重&quot;">​</a></h2><details><summary>数组去重</summary><pre><code>
      // set
      const arr = [1, 2, 3, 5, 1, 5, 9, 1, 2, 8]
      const uniqueArr = [...new Set(arr)]
      // 使用 filter 和 indexOf
      const uniqueArr = arr.filter((item, index) =&gt; {
        return arr.indexOf(item) === index
      })
      // 使用map存储
      function uniqueArray(array) {
        let map = {}
        let res = []
        for (var i = 0; i &lt; array.length; i++) {
          if (!map.hasOwnProperty([array[i]])) {
            map[array[i]] = 1
            res.push(array[i])
          }
        }
        return res
      }
            </code></pre></details><h2 id="数组方法" tabindex="-1">数组方法 <a class="header-anchor" href="#数组方法" aria-label="Permalink to &quot;数组方法&quot;">​</a></h2><details><summary>数组方法</summary><pre><code>
        // reduce方法
        function myReduce(arr, callback, initialValue) {
          let accumulator = initialValue !== undefined ? initialValue : arr[0];
          const startIndex = initialValue !== undefined ? 0 : 1;
          for (let i = startIndex; i &lt; arr.length; i++) {
            accumulator = callback(accumulator, arr[i], i, arr);
          }
          return accumulator;
        }
          // push方法
        Array.prototype.myPush = function () {
          // 循环遍历 arguments.length 也就是传入的参数个数
          for (let index = 0; index &lt; arguments.length; index++) {
            // this.length 指向调用这个方法的数组 获取数组的长度 将当前元素放入最后一个
            this[this.length] = arguments[index]
          }
          return this.length
        }
        // let arr = [1,2,3]
        // arr.myPush(6, 4, 5)
        Array.prototype.myFilter = function (callback) {
          if (!callback || typeof callback !== &#39;function&#39;) {
            throw Error(&#39;callback must be a function &#39;)
          }
          const res = []
          // this.length 指向调用方法的数组
          for (let index = 0; index &lt; this.length; index++) {
            // 执行 callback 函数传入数据 如果函数返回 true 就将当前数据放入 res 中
            callback(this[index], index) &amp;&amp; res.push(this[index])
          }
          return res
        }
      // let arr = [1, 2, 3]
      // console.log(
      //   arr.myFilter((item, index) =&gt; {
      //     console.log(&#39;item&#39;, item)
      //     console.log(&#39;index&#39;, index)
      //     return item &gt; 2
      //   })
      // )
        // 实现数组map的方法
        Array.prototype.myMap = function (callback) {
          if (!callback || typeof callback !== &#39;function&#39;) {
            throw Error(&#39;callback must be a function &#39;)
          }
          const result = []
          // this.length 指向调用方法的数组
          for (let index = 0; index &lt; this.length; index++) {
            result.push(callback(this[index], index))
          }
          return result
        }
        // const map1 = array1.map((x) =&gt; x * 2)
        // console.log(map1)
    </code></pre></details><h2 id="将数字每千位用逗号隔开" tabindex="-1">将数字每千位用逗号隔开 <a class="header-anchor" href="#将数字每千位用逗号隔开" aria-label="Permalink to &quot;将数字每千位用逗号隔开&quot;">​</a></h2><details><summary>将数字每千位用逗号隔开</summary><pre><code>
        //不带小数
        function format(num) {
          if (!num &amp;&amp; typeof num !== &#39;number&#39;) {
            return num
          }
          let str = num.toString()
          let len = str.length
          // 长度是否超过3
          if (len &lt;= 3) {
            return num
          } else {
            // 判断是否为 3 的倍数
            let remainder = len % 3
            // 不是 3 的整倍数
            if (remainder &gt; 0) {
              //  则根据数字长度对字符串进行拆分，每3位一组，最后再用逗号拼接起来
              // 被 3 整除余下的 也就是最前面第一个数字 如 1234567 最前面就是 1
              const firstNum = str.slice(0, remainder)
              // 获取剩下的数组 每 3 个用 , 拼接  也就是从 remainder 位置到最后一位
              const surplus = str.slice(remainder, len).match(/\\d{3}/g)
              // 组合起来  第一位后面加上 ,
              return firstNum + &#39;,&#39; + surplus
            } else {
              // 是 3 的倍数 上面操作去掉第一位数据操作就是  直接用正则匹配数据 然后 join 拼接 ,
              return str.match(/\\d{3}/g).join(&#39;,&#39;)
            }
          }
        }
        // 带小数
        function format1(num) {
          if (!num &amp;&amp; typeof num !== &#39;number&#39;) {
            return num
          }
          let str = num.toString()
          let len = str.length
          let decimals = &#39;&#39;
          // 获取小数
          str.includes(&#39;.&#39;) ? (decimals = str.split(&#39;.&#39;)[1]) : decimals
          // 长度是否超过3
          if (len &lt;= 3) {
            return num
          } else {
            // 判断是否为 3 的倍数
            let remainder = len % 3
            // 不是 3 的整倍数
            if (remainder &gt; 0) {
              //  则根据数字长度对字符串进行拆分，每3位一组，最后再用逗号拼接起来
              // 被 3 整除余下的 也就是最前面第一个数字 如 1234567 最前面就是 1
              const firstNum = str.slice(0, remainder)
              // 获取剩下的数组 每 3 个用 , 拼接  也就是从 remainder 位置到最后一位
              const surplus = str.slice(remainder, len).match(/\\d{3}/g)
              // 组合起来  第一位后面加上 ,  顺便带上小数
              return firstNum + &#39;,&#39; + surplus + &#39;.&#39; + decimals
            } else {
              // 是 3 的倍数 上面操作去掉第一位数据操作就是  直接用正则匹配数据 然后 join 拼接 , 顺便带上小数
              return str.match(/\\d{3}/g).join(&#39;,&#39;) + &#39;.&#39; + decimals
            }
          }
        }
    </code></pre></details><h2 id="数组转树" tabindex="-1">数组转树 <a class="header-anchor" href="#数组转树" aria-label="Permalink to &quot;数组转树&quot;">​</a></h2><details><summary>数组转树</summary><pre><code>
        function arrToTree(arr) {
          const map = {}
          const result = []
          for (const item of arr) {
            map[item.id] = item
          }
          for (let i = 0; i &lt; arr.length; i++) {
            // 获取 pid  看是否在 map 中查询得到对应的
            const pid = arr[i].pid
            if (map[pid]) {
              // 当前 pid 在 map 中存在 将当前节点作为 map 中节点的子节点
              map[pid].children = map.children || []
              map[pid].children.push(arr[i])
            } else {
              // 不在 map 中 说明是根节点
              result.push(arr[i])
            }
          }
          return result
        }
    </code></pre></details><h2 id="树转数组" tabindex="-1">树转数组 <a class="header-anchor" href="#树转数组" aria-label="Permalink to &quot;树转数组&quot;">​</a></h2><details><summary>数转数组</summary><pre><code>
        function treeToArr(arr) {
          let stack = [...arr]
          const result = []
          while (stack.length) {
            // 从数组中获取第一个
            const first = stack.shift()
            // 判断它有没有children
            if (first[&#39;children&#39;] &amp;&amp; first.children.length) {
              // 有 children 将它展开再放入到栈中
              stack.push(...first.children)
              // 删除 children 属性
              delete first.children
            }
            result.push(first)
          }
          return result
        }
    </code></pre></details><h2 id="发布订阅模式" tabindex="-1">发布订阅模式 <a class="header-anchor" href="#发布订阅模式" aria-label="Permalink to &quot;发布订阅模式&quot;">​</a></h2><details><summary>发布订阅模式</summary><pre><code>
        class EventCenter {
          constructor() {
            // 事件中心
            this.events = {}
          }
          /**
          * 订阅事件
          *
          * @param {string} eventName
          * @param {function} callback
          * @memberof EventCenter
          */
          subscribe(eventName, callback) {
            // 确保当前 eventName 在事件中心是唯一的
            if (!this.events[eventName]) {
              // 创建事件容器
              this.events[eventName] = []
            }
            // 存放事件
            this.events[eventName].push(callback)
          }
          /**
          * 取消订阅
          *
          * @param {string} eventName
          * @param {function} callback
          * @return {*}
          * @memberof EventCenter
          */
          unSubscribe(eventName, callback) {
            // 事件中心里没有这个事件
            if (!this.events[eventName]) {
              return new Error(&#39;not find event &#39; + eventName)
            }
            // 只有事件名 移除事件
            if (!callback) {
              delete this.events[eventName]
            } else {
              // 找到索引
              const index = this.events[eventName].findIndex((el) =&gt; el === callback)
              if (index !== -1) {
                return new Error(&#39;not find callback&#39;)
              }
              // 移除事件下的某个函数
              this.events[eventName].splice(index, 1)
              // 查看事件容器是否为空 如果为空移除事件
              if (this.events[eventName].length === 0) {
                delete this.events[eventName]
              }
            }
          }
          /**
          * 触发事件
          *
          * @param {string} eventName
          * @param {Array} args
          * @return {*}
          * @memberof EventCenter
          */
          dispatch(eventName, ...args) {
            if (!this.events[eventName]) {
              return new Error(&#39;not find event &#39; + eventName)
            }
            // 触发事件
            this.events[eventName].forEach((el) =&gt; {
              el(...args)
            })
          }
        }
        const eventCenter = new EventCenter()
        // 订阅事件
        eventCenter.subscribe(&#39;click&#39;, (x, y) =&gt; {
          console.log(\`clicked at (\${x}, \${y})\`)
        })
        // 发布事件
        eventCenter.dispatch(&#39;click&#39;, 10, 20) // 输出：clicked at (10, 20)
    </code></pre></details><h2 id="排序算法" tabindex="-1">排序算法 <a class="header-anchor" href="#排序算法" aria-label="Permalink to &quot;排序算法&quot;">​</a></h2><details><summary>冒泡排序</summary><pre><code>
          // 冒泡排序
          从数组的第一个元素开始，依次比较相邻的两个元素，如果前一个元素大于后一个元素，就交换它们的位置，这样大的元素会逐步“冒泡”到数组的末尾。经过一轮比较，最大的元素会位于数组的最后一个位置。然后继续进行下一轮比较，但已经排序好的元素不再参与比较。
          function bubbleSort(arr) {
            const n = arr.length;
            for (let i = 0; i &lt; n - 1; i++) {
              for (let j = 0; j &lt; n - i - 1; j++) {
                if (arr[j] &gt; arr[j + 1]) {
                  [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
                }
              }
            }
            return arr;
          }
          // 选择排序
          在未排序部分选择最小的元素，然后将其与未排序部分的第一个元素交换，以此逐步构建已排序部分。在每一轮遍历中，算法会找到未排序部分的最小元素的索引，然后与当前轮的第一个元素交换位置，这样当前轮的第一个元素会是已排序部分的最小元素。
          与冒泡排序不同，选择排序每轮只进行一次交换操作，因此交换次数相对较少，性能稍优。
          function selectionSort(arr) {
            const n = arr.length;
            for (let i = 0; i &lt; n - 1; i++) {
              let minIndex = i;
              for (let j = i + 1; j &lt; n; j++) {
                if (arr[j] &lt; arr[minIndex]) {
                  minIndex = j;
                }
              }
              [arr[i], arr[minIndex]] = [arr[minIndex], arr[i]];
            }
            return arr;
          }
          // 插入排序
          将数组划分为已排序和未排序两个部分，初始状态下，第一个元素被视为已排序部分。然后从未排序部分逐个选择元素插入到已排序部分的正确位置，以此逐步构建有序数组。
          对于每个待插入元素 current，算法会从已排序部分从后往前遍历，将比 current 大的元素往后移动一个位置，直到找到合适的位置插入 current。
          function insertionSort(arr) {
            const n = arr.length;
            for (let i = 1; i &lt; n; i++) {
              let current = arr[i];
              let j = i - 1;
              while (j &gt;= 0 &amp;&amp; arr[j] &gt; current) {
                arr[j + 1] = arr[j];
                j--;
              }
              arr[j + 1] = current;
            }
            return arr;
          }
          // 希尔排序
          function shellSort(arr) {
            const n = arr.length;
            for (let gap = Math.floor(n / 2); gap &gt; 0; gap = Math.floor(gap / 2)) {
              for (let i = gap; i &lt; n; i++) {
                let temp = arr[i];
                let j = i;
                while (j &gt;= gap &amp;&amp; arr[j - gap] &gt; temp) {
                  arr[j] = arr[j - gap];
                  j -= gap;
                }
                arr[j] = temp;
              }
            }
            return arr;
          }
          // 并归排序
          function mergeSort(arr) {
            if (arr.length &lt;= 1) {
              return arr;
            }
            const middle = Math.floor(arr.length / 2);
            const left = arr.slice(0, middle);
            const right = arr.slice(middle);
            return merge(mergeSort(left), mergeSort(right));
          }
          function merge(left, right) {
            let result = [];
            let leftIndex = 0;
            let rightIndex = 0;
            while (leftIndex &lt; left.length &amp;&amp; rightIndex &lt; right.length) {
              if (left[leftIndex] &lt; right[rightIndex]) {
                result.push(left[leftIndex]);
                leftIndex++;
              } else {
                result.push(right[rightIndex]);
                rightIndex++;
              }
            }
            return result.concat(left.slice(leftIndex)).concat(right.slice(rightIndex));
          }
          //快速排序
          function quickSort(arr) {
            if (arr.length &lt;= 1) {
              return arr;
            }
            const pivot = arr[0];
            const left = [];
            const right = [];
            for (let i = 1; i &lt; arr.length; i++) {
              if (arr[i] &lt; pivot) {
                left.push(arr[i]);
              } else {
                right.push(arr[i]);
              }
            }
            return quickSort(left).concat(pivot, quickSort(right));
          }
          // 堆排序
          function heapSort(arr) {
            const n = arr.length;
            for (let i = Math.floor(n / 2) - 1; i &gt;= 0; i--) {
              heapify(arr, n, i);
            }
            for (let i = n - 1; i &gt; 0; i--) {
              [arr[0], arr[i]] = [arr[i], arr[0]];
              heapify(arr, i, 0);
            }
            return arr;
          }
          function heapify(arr, n, i) {
            let largest = i;
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            if (left &lt; n &amp;&amp; arr[left] &gt; arr[largest]) {
              largest = left;
            }
            if (right &lt; n &amp;&amp; arr[right] &gt; arr[largest]) {
              largest = right;
            }
            if (largest !== i) {
              [arr[i], arr[largest]] = [arr[largest], arr[i]];
              heapify(arr, n, largest);
            }
          }
          // 计数排序
          function countingSort(arr) {
            const max = Math.max(...arr);
            const min = Math.min(...arr);
            const range = max - min + 1;
            const countArr = new Array(range).fill(0);
            const output = new Array(arr.length);
            for (let i = 0; i &lt; arr.length; i++) {
              countArr[arr[i] - min]++;
            }
            for (let i = 1; i &lt; range; i++) {
              countArr[i] += countArr[i - 1];
            }
            for (let i = arr.length - 1; i &gt;= 0; i--) {
              output[countArr[arr[i] - min] - 1] = arr[i];
              countArr[arr[i] - min]--;
            }
            for (let i = 0; i &lt; arr.length; i++) {
              arr[i] = output[i];
            }
            return arr;
          }
          // 桶排序
          function bucketSort(arr, bucketSize = 5) {
            if (arr.length === 0) {
              return arr;
            }
            const minValue = Math.min(...arr);
            const maxValue = Math.max(...arr);
            const bucketCount = Math.floor((maxValue - minValue) / bucketSize) + 1;
            const buckets = new Array(bucketCount);
            for (let i = 0; i &lt; bucketCount; i++) {
              buckets[i] = [];
            }
            for (let i = 0; i &lt; arr.length; i++) {
              const bucketIndex = Math.floor((arr[i] - minValue) / bucketSize);
              buckets[bucketIndex].push(arr[i]);
            }
            arr.length = 0;
            for (let i = 0; i &lt; bucketCount; i++) {
              insertionSort(buckets[i]);
              arr.push(...buckets[i]);
            }
            return arr;
          }
          // 基数排序
          function radixSort(arr) {
            const maxDigit = getMaxDigit(arr);
            for (let digit = 0; digit &lt; maxDigit; digit++) {
              const bucketList = Array.from({ length: 10 }, () =&gt; []);
              for (let i = 0; i &lt; arr.length; i++) {
                const digitValue = getDigitValue(arr[i], digit);
                bucketList[digitValue].push(arr[i]);
              }
              arr = bucketList.flat();
            }
            return arr;
          }
          function getMaxDigit(arr) {
            let max = 0;
            for (let i = 0; i &lt; arr.length; i++) {
              max = Math.max(max, arr[i].toString().length);
            }
            return max;
          }
          function getDigitValue(num, digit) {
            return Math.floor(Math.abs(num) / Math.pow(10, digit)) % 10;
          }
    </code></pre></details>`,40)]))}const d=e(i,[["render",o]]);export{h as __pageData,d as default};
