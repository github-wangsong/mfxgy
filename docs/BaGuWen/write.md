
  ## 实现一个new操作符

  <details> <summary>实现一个new操作符</summary>

  ```js
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
      if (typeof fn !== 'function') {
        return new TypeError('fn must be a function')
      }
      // 创建一个空的对象
      let obj = null
      // 将这个空对象的原型设置为构造函数的 prototype 属性。
      obj = Object.create(fn.prototype)
      // 通过 apply 执行构造函数 传入参数 获取返回值
      let result = fn.apply(obj, args)
      // 判断这个返回值 如果返回的是 Object || Function 类型 就返回该对象 否则返回创建的对象
      const flag = result && (typeof result === 'object' || typeof result === 'function')
      return flag ? result : obj
    }
  ```
  </details>
    
  ## 实现一个intanceof操作符
  <details> <summary>实现一个intanceof操作符</summary>
    
  ```js
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
  ```
  </details>

  ## 手写 Object.create
  <details> <summary>手写 Object.create</summary>

  ```js
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
  ```
  </details>

  ## 手写 浅拷贝
  <details> <summary>手写 浅拷贝</summary>

  ```js
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
      if (!obj || typeof obj !== 'object') {
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
  ```
  </details>

  ## 手写 深拷贝
  <details> <summary>手写 深拷贝</summary>

  ```js
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
      if (!obj || typeof obj !== 'object'){
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
          newObj[key] = typeof obj[key] === 'object' ? deepCopy(obj[key], map) : obj[key]
        }
      }
      return newObj
    }
  ```
  </details>

  ## 手写 节流
  <details> <summary>手写 节流</summary>

  ```js
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
        if (nowTime - startTime >= wait) {
          startTime = nowTime
          return fn.apply(this, arguments)
        }
      }
    }
  ```
  </details>

  ## 手写 防抖
  <details> <summary>手写 防抖</summary>

  ```js
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
          flag && fn.apply(this, arguments)
          // n 秒后清空定时器
          timer = setTimeout(() => {
            timer = null
          }, wait)
        } else {
          timer = setTimeout(() => {
            fn.apply(this, arguments)
          }, wait)
        }
      }
    }
  ```
  </details>

  ## 函数柯里化
  <details> <summary>函数柯里化</summary>

  ```js
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
        if (newArgs.length >= length) {
          return fn.apply(this, newArgs)
        } else {
          // 小于 add 函数形参长度 递归调用 curry 函数 累积参数 传递 newArgs
          return curry(fn, newArgs)
        }
      }
    }
  ```
  </details>

  ## 手写 call
  <details> <summary>手写 call</summary>

  ```js
    /** 手写 call
    * 用法：call 方法用于调用一个函数，并指定函数内部 this 的指向，传入一个对象
    * 思路：
    *  1、判断 this 是否指向一个函数  只有函数才可以执行
    *  2、获取传入的 context 上下文 也就是我们要指向的 如果不存在就指向 window
    *  3、将当前 this 也就是外部需要执行的函数 绑定到 context 上 然后执行获取 result 传入 ...args 确保参数位置正确
    *  4、删除 context 对象的 fn 属性 并将 result 返回
    */
    Function.prototype.myCall = function (context, ...args) {
      if (typeof this !== 'function') {
        return new TypeError('type error')
      }
      context = context || window
      // 缓存this
      context.fn = this
      const result = context.fn(...args)
      delete context.fn
      return result
    }
  ```
  </details>

  ## 手写 Promise
  <details> <summary>手写 Promise</summary>

  ```js
    class MyPromise {
      constructor(executor) {
        this.state = 'pending'
        this.value
        this.reason
        this.onResolveCallbacks = []
        this.onRejectCallbacks = []
        const resolve = (value) => {
          if (this.state === 'pending') {
            this.value = value
            this.state = 'fulfilled'
            this.onResolveCallbacks.forEach((fn) => fn())
          }
        }
        const reject = (reason) => {
          if (this.state === 'pending') {
            this.reason = reason
            this.state = 'rejected'
            this.onRejectCallbacks.forEach((fn) => fn())
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
        onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : (value) => value
        onRejected =
          typeof onRejected === 'function'
            ? onRejected
            : (reason) => {
                throw reason
              }
        const p2 = new MyPromise((resolve, reject) => {
          // 执行成功
          // 执行失败
          // pending状态放入任务队列
          if (this.state === 'fulfilled') {
            setTimeout(() => {
              try {
                const x = onFulfilled(this.value)
                this.resolvePromise(p2, x, resolve, reject)
              } catch (error) {
                reject(error)
              }
            }, 0)
          } else if (this.state === 'rejected') {
            setTimeout(() => {
              try {
                const x = onRejected(this.reason)
                this.resolvePromise(p2, x, resolve, reject)
              } catch (error) {
                reject(error)
              }
            }, 0)
          } else {
            this.onResolveCallbacks.push(() => {
              setTimeout(() => {
                try {
                  const x = onFulfilled(this.value)
                  this.resolvePromise(p2, x, resolve, reject)
                } catch (error) {
                  reject(error)
                }
              }, 0)
            })
            this.onRejectCallbacks.push(() => {
              setTimeout(() => {
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
          return reject(new TypeError('type error'))
        }
        // 执行锁 确保执行一次完resolve或者reject后 不再执行
        let called = false
        // 判断x数据类型  如果是函数 对象 需要递归执行  如果是值类型 直接resolve
        if (x !== null && (typeof x === 'object' || typeof x === 'function')) {
          try {
            // 判断 then是否为函数
            const then = x.then
            if (typeof then === 'function') {
              then.call(
                x,
                (y) => {
                  if (called) return
                  called = true
                  this.resolvePromise(p2, y, resolve, reject)
                },
                (r) => {
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
  ```
  </details>

  ## 手写 Promise.all()
  <details> <summary>手写 Promise.all()</summary>

  ```js
      /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
    all(array) {
      return new MyPromise((resolve, reject) => {
        if (!Array.isArray(array)) {
          throw new TypeError('You must pass an array to all.')
        }
        const result = []
        let count = 0
        // 遍历 array 拿到每一条数据
        array.forEach((promise, index) => {
          MyPromise.resolve(promise).then(
            (value) => {
              result[index] = value
              count++
              // 判断 result 结果值的长度 和 array参数的长度相等  执行最外面的 resolve 返回 all 结果
              if (count === array.length) {
                resolve(array)
              }
            },
            (err) => {
              reject(err)
            },
          )
        })
      })
    }
  ```
  </details>

  ## 手写 Promise.race()
  <details> <summary>手写 Promise.race()</summary>

  ```js
    /**
    * 1.返回一个新的promise对象
    * 2.遍历传入的数据，将数据包装成一个 promise 对象
    * 3. 执行resolve 或者reject
    * 4. 返回结果
    * 这里的代码是一个 forEach 循环，对于每个 Promise，调用 MyPromise.resolve 方法将其转换为 Promise 对象，然后调用 then 方法，将 fulfilled 的值存储到 results 数组中，count 加 1。当 count 等于 promises 数组的长度时，说明所有的 Promise 都 fulfilled，此时调用 resolve 方法，将 results 数组作为返回值传递给新的 Promise。
    * 在遍历时记录当前promise在数组中的位置，这个位置就是index。
    */
    race(array) {
      return new MyPromise((resolve, reject) => {
        if (!Array.isArray(array)) {
          throw new TypeError('You must pass an array to all.')
        }
        array.forEach((promise) => {
          MyPromise.resolve(promise).then(
            (value) => {
              resolve(value)
            },
            (reason) => {
              reject(reason)
            },
          )
        })
      })
    }
  ```
  </details>

  ## 数组扁平化
  <details> <summary>数组扁平化</summary>
  
  ```js
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
      for (let index = 0; index < arr.length; index++) {
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
      while (arr.some((item) => Array.isArray(item))) {
        arr = [].concat(...arr)
      }
      return arr
    }
  ```
  </details>

  ## 数组去重
  <details> <summary>数组去重</summary>

  ```js
    // set
    const arr = [1, 2, 3, 5, 1, 5, 9, 1, 2, 8]
    const uniqueArr = [...new Set(arr)]
    // 使用 filter 和 indexOf
    const uniqueArr = arr.filter((item, index) => {
      return arr.indexOf(item) === index
    })
    // 使用map存储
    function uniqueArray(array) {
      let map = {}
      let res = []
      for (var i = 0; i < array.length; i++) {
        if (!map.hasOwnProperty([array[i]])) {
          map[array[i]] = 1
          res.push(array[i])
        }
      }
      return res
    }
  ```
  </details>

  ## 数组方法
  <details> <summary>数组方法</summary>
    
  ```js
    // reduce方法
    function myReduce(arr, callback, initialValue) {
      let accumulator = initialValue !== undefined ? initialValue : arr[0];
      const startIndex = initialValue !== undefined ? 0 : 1;
      for (let i = startIndex; i < arr.length; i++) {
        accumulator = callback(accumulator, arr[i], i, arr);
      }
      return accumulator;
    }
      // push方法
    Array.prototype.myPush = function () {
      // 循环遍历 arguments.length 也就是传入的参数个数
      for (let index = 0; index < arguments.length; index++) {
        // this.length 指向调用这个方法的数组 获取数组的长度 将当前元素放入最后一个
        this[this.length] = arguments[index]
      }
      return this.length
    }
    // let arr = [1,2,3]
    // arr.myPush(6, 4, 5)
    Array.prototype.myFilter = function (callback) {
      if (!callback || typeof callback !== 'function') {
        throw Error('callback must be a function ')
      }
      const res = []
      // this.length 指向调用方法的数组
      for (let index = 0; index < this.length; index++) {
        // 执行 callback 函数传入数据 如果函数返回 true 就将当前数据放入 res 中
        callback(this[index], index) && res.push(this[index])
      }
      return res
    }
    // let arr = [1, 2, 3]
    // console.log(
    //   arr.myFilter((item, index) => {
    //     console.log('item', item)
    //     console.log('index', index)
    //     return item > 2
    //   })
    // )
    // 实现数组map的方法
    Array.prototype.myMap = function (callback) {
      if (!callback || typeof callback !== 'function') {
        throw Error('callback must be a function ')
      }
      const result = []
      // this.length 指向调用方法的数组
      for (let index = 0; index < this.length; index++) {
        result.push(callback(this[index], index))
      }
      return result
    }
    // const map1 = array1.map((x) => x * 2)
    // console.log(map1)
  ```
  </details>

  ## 将数字每千位用逗号隔开
  <details> <summary>将数字每千位用逗号隔开</summary>
  
  ```js
    //不带小数
    function format(num) {
      if (!num && typeof num !== 'number') {
        return num
      }
      let str = num.toString()
      let len = str.length
      // 长度是否超过3
      if (len <= 3) {
        return num
      } else {
        // 判断是否为 3 的倍数
        let remainder = len % 3
        // 不是 3 的整倍数
        if (remainder > 0) {
          //  则根据数字长度对字符串进行拆分，每3位一组，最后再用逗号拼接起来
          // 被 3 整除余下的 也就是最前面第一个数字 如 1234567 最前面就是 1
          const firstNum = str.slice(0, remainder)
          // 获取剩下的数组 每 3 个用 , 拼接  也就是从 remainder 位置到最后一位
          const surplus = str.slice(remainder, len).match(/\d{3}/g)
          // 组合起来  第一位后面加上 ,
          return firstNum + ',' + surplus
        } else {
          // 是 3 的倍数 上面操作去掉第一位数据操作就是  直接用正则匹配数据 然后 join 拼接 ,
          return str.match(/\d{3}/g).join(',')
        }
      }
    }
    // 带小数
    function format1(num) {
      if (!num && typeof num !== 'number') {
        return num
      }
      let str = num.toString()
      let len = str.length
      let decimals = ''
      // 获取小数
      str.includes('.') ? (decimals = str.split('.')[1]) : decimals
      // 长度是否超过3
      if (len <= 3) {
        return num
      } else {
        // 判断是否为 3 的倍数
        let remainder = len % 3
        // 不是 3 的整倍数
        if (remainder > 0) {
          //  则根据数字长度对字符串进行拆分，每3位一组，最后再用逗号拼接起来
          // 被 3 整除余下的 也就是最前面第一个数字 如 1234567 最前面就是 1
          const firstNum = str.slice(0, remainder)
          // 获取剩下的数组 每 3 个用 , 拼接  也就是从 remainder 位置到最后一位
          const surplus = str.slice(remainder, len).match(/\d{3}/g)
          // 组合起来  第一位后面加上 ,  顺便带上小数
          return firstNum + ',' + surplus + '.' + decimals
        } else {
          // 是 3 的倍数 上面操作去掉第一位数据操作就是  直接用正则匹配数据 然后 join 拼接 , 顺便带上小数
          return str.match(/\d{3}/g).join(',') + '.' + decimals
        }
      }
    }
  ```
  </details>

  ## 数组转树
  <details> <summary>数组转树</summary>

  ```js
    function arrToTree(arr) {
      const map = {}
      const result = []
      for (const item of arr) {
        map[item.id] = item
      }
      for (let i = 0; i < arr.length; i++) {
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
  ```
  </details>

  ## 树转数组
  <details> <summary>数转数组</summary>

  ```js
    function treeToArr(arr) {
      let stack = [...arr]
      const result = []
      while (stack.length) {
        // 从数组中获取第一个
        const first = stack.shift()
        // 判断它有没有children
        if (first['children'] && first.children.length) {
          // 有 children 将它展开再放入到栈中
          stack.push(...first.children)
          // 删除 children 属性
          delete first.children
        }
        result.push(first)
      }
      return result
    }
  ```
  </details>

  ## 发布订阅模式
  <details> <summary>发布订阅模式</summary>

  ```js
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
            return new Error('not find event ' + eventName)
          }
          // 只有事件名 移除事件
          if (!callback) {
            delete this.events[eventName]
          } else {
            // 找到索引
            const index = this.events[eventName].findIndex((el) => el === callback)
            if (index !== -1) {
              return new Error('not find callback')
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
            return new Error('not find event ' + eventName)
          }
          // 触发事件
          this.events[eventName].forEach((el) => {
            el(...args)
          })
        }
      }
      const eventCenter = new EventCenter()
      // 订阅事件
      eventCenter.subscribe('click', (x, y) => {
        console.log(`clicked at (${x}, ${y})`)
      })
      // 发布事件
      eventCenter.dispatch('click', 10, 20) // 输出：clicked at (10, 20)
  ```
  </details>

  ## 排序算法
  <details> <summary>排序算法</summary>

  ::: code-group
  ```js [冒泡排序]
    //从数组的第一个元素开始，依次比较相邻的两个元素，如果前一个元素大于后一个元素，就交换它们的位置，这样大的元素会逐步“冒泡”到数组的末尾。经过一轮比较，最大的元素会位于数组的最后一个位置。然后继续进行下一轮比较，但已经排序好的元素不再参与比较。
    function bubbleSort(arr) {
      const n = arr.length;
      for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < n - i - 1; j++) {
          if (arr[j] > arr[j + 1]) {
            [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
          }
        }
      }
      return arr;
    }
  ```
  ```js [选择排序]
    //在未排序部分选择最小的元素，然后将其与未排序部分的第一个元素交换，以此逐步构建已排序部分。在每一轮遍历中，算法会找到未排序部分的最小元素的索引，然后与当前轮的第一个元素交换位置，这样当前轮的第一个元素会是已排序部分的最小元素。
    //与冒泡排序不同，选择排序每轮只进行一次交换操作，因此交换次数相对较少，性能稍优。
    function selectionSort(arr) {
      const n = arr.length;
      for (let i = 0; i < n - 1; i++) {
        let minIndex = i;
        for (let j = i + 1; j < n; j++) {
          if (arr[j] < arr[minIndex]) {
            minIndex = j;
          }
        }
        [arr[i], arr[minIndex]] = [arr[minIndex], arr[i]];
      }
      return arr;
    }
  ```
  ```js [插入排序]
    //将数组划分为已排序和未排序两个部分，初始状态下，第一个元素被视为已排序部分。然后从未排序部分逐个选择元素插入到已排序部分的正确位置，以此逐步构建有序数组。
    //对于每个待插入元素 current，算法会从已排序部分从后往前遍历，将比 current 大的元素往后移动一个位置，直到找到合适的位置插入 current。
    function insertionSort(arr) {
      const n = arr.length;
      for (let i = 1; i < n; i++) {
        let current = arr[i];
        let j = i - 1;
        while (j >= 0 && arr[j] > current) {
          arr[j + 1] = arr[j];
          j--;
        }
        arr[j + 1] = current;
      }
      return arr;
    }
  ```
  ```js [希尔排序]
    function shellSort(arr) {
      const n = arr.length;
      for (let gap = Math.floor(n / 2); gap > 0; gap = Math.floor(gap / 2)) {
        for (let i = gap; i < n; i++) {
          let temp = arr[i];
          let j = i;
          while (j >= gap && arr[j - gap] > temp) {
            arr[j] = arr[j - gap];
            j -= gap;
          }
          arr[j] = temp;
        }
      }
      return arr;
    }
  ```
  ```js [并归排序]
    function mergeSort(arr) {
      if (arr.length <= 1) {
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
      while (leftIndex < left.length && rightIndex < right.length) {
        if (left[leftIndex] < right[rightIndex]) {
          result.push(left[leftIndex]);
          leftIndex++;
        } else {
          result.push(right[rightIndex]);
          rightIndex++;
        }
      }
      return result.concat(left.slice(leftIndex)).concat(right.slice(rightIndex));
    }
  ```
  ```js [快速排序]
    function quickSort(arr) {
      if (arr.length <= 1) {
        return arr;
      }
      const pivot = arr[0];
      const left = [];
      const right = [];
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] < pivot) {
          left.push(arr[i]);
        } else {
          right.push(arr[i]);
        }
      }
      return quickSort(left).concat(pivot, quickSort(right));
    }
  ```
  ```js [其他]
    // 堆排序
    function heapSort(arr) {
      const n = arr.length;
      for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
        heapify(arr, n, i);
      }
      for (let i = n - 1; i > 0; i--) {
        [arr[0], arr[i]] = [arr[i], arr[0]];
        heapify(arr, i, 0);
      }
      return arr;
    }
    function heapify(arr, n, i) {
      let largest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && arr[left] > arr[largest]) {
        largest = left;
      }
      if (right < n && arr[right] > arr[largest]) {
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
      for (let i = 0; i < arr.length; i++) {
        countArr[arr[i] - min]++;
      }
      for (let i = 1; i < range; i++) {
        countArr[i] += countArr[i - 1];
      }
      for (let i = arr.length - 1; i >= 0; i--) {
        output[countArr[arr[i] - min] - 1] = arr[i];
        countArr[arr[i] - min]--;
      }
      for (let i = 0; i < arr.length; i++) {
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
      for (let i = 0; i < bucketCount; i++) {
        buckets[i] = [];
      }
      for (let i = 0; i < arr.length; i++) {
        const bucketIndex = Math.floor((arr[i] - minValue) / bucketSize);
        buckets[bucketIndex].push(arr[i]);
      }
      arr.length = 0;
      for (let i = 0; i < bucketCount; i++) {
        insertionSort(buckets[i]);
        arr.push(...buckets[i]);
      }
      return arr;
    }
    // 基数排序
    function radixSort(arr) {
      const maxDigit = getMaxDigit(arr);
      for (let digit = 0; digit < maxDigit; digit++) {
        const bucketList = Array.from({ length: 10 }, () => []);
        for (let i = 0; i < arr.length; i++) {
          const digitValue = getDigitValue(arr[i], digit);
          bucketList[digitValue].push(arr[i]);
        }
        arr = bucketList.flat();
      }
      return arr;
    }
    function getMaxDigit(arr) {
      let max = 0;
      for (let i = 0; i < arr.length; i++) {
        max = Math.max(max, arr[i].toString().length);
      }
      return max;
    }
    function getDigitValue(num, digit) {
      return Math.floor(Math.abs(num) / Math.pow(10, digit)) % 10;
    }
  ```
  :::
  </details>
