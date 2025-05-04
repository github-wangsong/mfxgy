# 从vue3的视角学习react

## 基础组件结构对比


  ::: code-group
  ```vue [vue3]
  <template>
    <div>
      <!-- 插值表达式 -->
      <h1>{{ title }}</h1>

      <!-- 属性绑定 -->
      <div :style='boxStyle'></div>
    
      <!-- 条件渲染 -->
      <p v-if="show">Visible by v-if</p>
      <p v-show="show">Visible by v-show</p>

      <!-- 列表渲染 -->
      <ul>
        <li v-for="item in list" :key="item">{{ item }}</li>
      </ul>

      <!-- 双向绑定 -->
      <input v-model="form.name" placeholder="Name" />

      <!-- 事件绑定 -->
      <button @click="increment">Count: {{ count }}</button>
    </div>
  </template>

  <script setup>
  import { ref } from 'vue'

  const title = 'Hello Vue 3'
  const boxStyle = { width: '100px', height: '100px', background: 'red' }
  const show = ref(true)
  const list = reactive(['A', 'B', 'C'])
  const form = reactive({ name: '' })

  const count = ref(0)
  function increment() {
    count.value++
  }
  </script>

  ```
  ```jsx [react]
  import { useState } from 'react';

  function MyComponent() {
    const [title] = useState('Hello React');
    const [boxStyle] = useState({ width: '100px', height: '100px', background: 'red' });
    const [show, setShow] = useState(true)
    const [list] = useState(['A', 'B', 'C'])

    const [form, setForm] = useState({ name: '' })
    const handleInput = e => setForm({ ...form, name: e.target.value })

    const [count, setCount] = useState(0);
    function increment() {
      setCount(count + 1);
    }

    return (
      <div>
        {/* 插值表达式 */}
        <h1>{title}</h1>
        
        {/* 属性绑定 */}
        <div style={boxStyle}>333</div>

        {/* 条件渲染 */}
        {show && <p>Visible by v-if</p>}
        <p style={{ display: show ? 'block' : 'none' }}>Visible by v-show</p>

        {/* 列表渲染 */}
        <ul>
          {list.map((item, i) => <li key={i}>{item}</li>)}
        </ul>

        {/* 双向绑定 */}
        <input value={form.name} onChange={handleInput} placeholder="Name" />

        {/* 事件绑定 */}
        <button onClick={increment}>Count: {count}</button>
      </div>
    );
  }

  ```
  :::


## 状态管理对比

### 响应式状态
  ::: code-group
  ```vue [vue3]

  <script setup>
  import { ref, reactive } from 'vue'

  // 基本类型
  const count = ref(0)

  // 对象类型
  const state = reactive({
    user: {
      name: 'Alice',
      age: 25
    }
  })
  </script>

  ```
  ```jsx [react]
  function MyComponent() {
    // 基本类型
    const [count, setCount] = useState(0);
    
    // 对象类型
    const [state, setState] = useState({
      user: {
        name: 'Alice',
        age: 25
      }
    });

    // 更新对象状态
    function updateName() {
      setState(prev => ({
        ...prev,
        user: {
          ...prev.user,
          name: 'Bob'
        }
      }));
    }
  }


  ```
  :::


### 计算属性 vs useMemo

  ::: code-group
  ```vue [vue3]
  <script setup>
  import { ref, computed } from 'vue'
  
  const count = ref(0)
  const doubleCount = computed(() => count.value * 2)
  </script>

  ```
  ```jsx [react]
  import { useMemo, useState } from 'react';
  
  const [count, setCount] = useState(0);
  const doubleCount = useMemo(() => count * 2, [count]);

  ```
  :::


### 引用 DOM 元素

  ::: code-group
  ```vue [vue3]
  <template>
    <input ref="inputRef" />
  </template>

  <script setup>
  import { ref } from 'vue'

  const inputRef = ref(null)

  function focusInput() {
    inputRef.value.focus()
  }
  </script>

  ```
  ```jsx [react]

  import { useRef } from 'react';

  function MyComponent() {
    const inputRef = useRef(null);
    function focusInput() {
      inputRef.current.focus();
    }

    return <input ref={inputRef} />;
  }

  ```
  :::


### 监听状态变化
  ::: code-group
  ```vue [vue3]
  <script setup>
  import { watch } from 'vue'

  watch(count, (newVal, oldVal) => {
    console.log(`Count changed from ${oldVal} to ${newVal}`)
  })
  </script>

  ```
  ```jsx [react]
  import { useEffect, useRef } from 'react';

  function MyComponent() {
    const prevCountRef = useRef();
    
    useEffect(() => {
      if (prevCountRef.current !== undefined) {
        console.log(`Count changed from ${prevCountRef.current} to ${count}`);
      }
      prevCountRef.current = count;
    }, [count]);
  }

  ```
  :::



## 生命周期与副作用
  ::: code-group
  ```vue [vue3]
  <template>
    <div>
      <h1>Vue 3 生命周期演示</h1>
      <p>Count: {{ count }}</p>
      <button @click="count++">Increment</button>
    </div>
  </template>

  <script setup>
  import { 
    ref,
    onBeforeMount,
    onMounted,
    onBeforeUpdate,
    onUpdated,
    onBeforeUnmount,
    onUnmounted,
    onActivated,
    onDeactivated,
    onErrorCaptured
  } from 'vue'

  const count = ref(0)

  // 组件初始化阶段
  console.log('setup - 相当于 constructor')

  onBeforeMount(() => {
    console.log('onBeforeMount - 挂载前: DOM 尚未创建')
  })

  onMounted(() => {
    console.log('onMounted - 挂载完成: 可以访问 DOM')
  })

  // 更新阶段
  onBeforeUpdate(() => {
    console.log('onBeforeUpdate - 更新前: DOM 尚未更新')
    console.log('当前DOM count:', document.querySelector('p').textContent)
  })

  onUpdated(() => {
    console.log('onUpdated - 更新完成: DOM 已更新')
    console.log('更新后DOM count:', document.querySelector('p').textContent)
  })

  // 卸载阶段
  onBeforeUnmount(() => {
    console.log('onBeforeUnmount - 卸载前')
  })

  onUnmounted(() => {
    console.log('onUnmounted - 卸载完成')
  })

  // KeepAlive 相关
  onActivated(() => {
    console.log('onActivated - 被 keep-alive 缓存的组件激活')
  })

  onDeactivated(() => {
    console.log('onDeactivated - 被 keep-alive 缓存的组件停用')
  })

  // 错误捕获
  onErrorCaptured((err, instance, info) => {
    console.log('onErrorCaptured - 捕获到子组件错误:', err)
    return false // 阻止错误继续向上传播
  })

  // 相当于 React 的 getDerivedStateFromError
  // Vue 3 中没有直接等效，可以在 onErrorCaptured 中实现类似功能
  </script>

  ```
  ```jsx [react]
  import React, {
    useState,
    useEffect,
    useLayoutEffect,
    useCallback
  } from 'react';

  class ErrorBoundary extends React.Component {
    state = { hasError: false }

    // 相当于 Vue 的 onErrorCaptured
    static getDerivedStateFromError(error) {
      console.log('getDerivedStateFromError - 捕获到子组件错误:', error)
      return { hasError: true }
    }

    componentDidCatch(error, info) {
      console.log('componentDidCatch - 错误详情:', error, info)
    }

    render() {
      if (this.state.hasError) {
        return <h1>Something went wrong.</h1>
      }
      return this.props.children
    }
  }

  function LifecycleDemo() {
    const [count, setCount] = useState(0)
    const [isActive, setIsActive] = useState(true)

    console.log('render - 渲染阶段')

    // 相当于 componentDidMount + componentDidUpdate
    useEffect(() => {
      console.log('useEffect - 挂载或更新后执行 (类似 onMounted + onUpdated)')
      console.log('当前DOM count:', document.querySelector('p').textContent)
      
      return () => {
        console.log('useEffect cleanup - 下次执行effect前或卸载时执行')
      }
    }, [count]) // 依赖数组决定何时重新执行

    // 相当于 componentDidMount
    useEffect(() => {
      console.log('useEffect with empty deps - 仅挂载时执行 (类似 onMounted)')
      
      return () => {
        console.log('useEffect empty deps cleanup - 卸载时执行 (类似 onUnmounted)')
      }
    }, [])

    // 相当于 onBeforeUpdate (React 没有直接等效，useLayoutEffect 最接近)
    useLayoutEffect(() => {
      console.log('useLayoutEffect - DOM 更新前同步执行')
      console.log('DOM count before update:', document.querySelector('p').textContent)
      
      return () => {
        console.log('useLayoutEffect cleanup - 下次执行前同步执行')
      }
    }, [count])

    // 相当于 onActivated/onDeactivated
    // React 没有内置 keep-alive，需要第三方库或自定义实现
    useEffect(() => {
      if (isActive) {
        console.log('Component is active - 类似 onActivated')
      }
      
      return () => {
        console.log('Component is inactive - 类似 onDeactivated')
      }
    }, [isActive])

    const increment = useCallback(() => {
      setCount(c => c + 1)
    }, [])

    return (
      <div>
        <h1>React 生命周期演示</h1>
        <p>Count: {count}</p>
        <button onClick={increment}>Increment</button>
        <button onClick={() => setIsActive(a => !a)}>
          {isActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    )
  }

  // 使用错误边界包裹组件
  function App() {
    return (
      <ErrorBoundary>
        <LifecycleDemo />
      </ErrorBoundary>
    )
  }

  export default App

  ```
  :::

## 组件通信

### 父传子 Props
  ::: code-group
  ```vue [vue3]
  <!-- 父组件 ./ParentComponent.vue-->
  <template>
    <div>
      <ChildComponent message="hello" :count="1" />
    </div>
  </template>

  <!-- 子组件 ./ChildComponent.vue-->
  <template>
    <div>{{ message }} - {{ count }}</div>
  </template>
  <script setup>
    defineProps({
      message: {
        type: String,
        required: true
      },
      count: {
        type: Number,
        default: 1,
        validator: (val) => val >= 0 // 自定义校验：非负
      }
    })
  </script>

  ```
  ```jsx [react]
  /* 父组件 ./ParentComponent.jsx */
  export default function ParentComponent() {
    return <div>
      <ChildComponent message="hello" count={1} />
    </div>;
  }


  /* 子组件 ./ChildComponent.jsx */
  import PropTypes from 'prop-types'
  export default function ChildComponent({ message, count }) {
    return <div>{message} - {count}</div>;
  }
  // 静态属性定义 prop 类型
  ChildComponent.propTypes = {
    message: PropTypes.string.isRequired,
    count: PropTypes.number,
  }
  // 默认值
  ChildComponent.defaultProps = {
    count: 1
  }

  ```
  :::

### 子传父事件
  ::: code-group
  ```vue [vue3]
  <!-- 父组件 -->
  <template>
    <div>
      <ChildComponent @update="handleUpdate" />
    </div>
  </template>
  <script setup>
    const handleUpdate = (val) => {
      console.log(val)
    }
  </script>

  <!-- 子组件 -->
  <template>
    <button @click="handleClick">Update</button>
  </template>
  <script setup>
    const emit = defineEmits(['update'])
    function handleClick() {
      emit('update', 111)
    }
  </script>

  ```
  ```jsx [react]
  /* 父组件 ./ParentComponent.jsx */
  export default function ParentComponent() {
    const handleUpdate = (val) => {
      console.log(val)
    }
    return <div>
      <ChildComponent onUpdate={handleUpdate} />
    </div>;
  }


  /* 子组件 ./ChildComponent.jsx */
  export default function ChildComponent({ onUpdate }) {
    return <button onClick={() => onUpdate(111)}>Update</button>;
  }

  ```
  :::
### 跨层级组件通信
  ::: code-group
  ```vue [vue3]
  <!-- 祖先组件 -->
  <script setup>
  import { provide, ref } from 'vue'
  const theme = ref('dark')
  provide('theme', theme)
  </script>

  <!-- 后代组件 -->
  <script setup>
  import { inject } from 'vue'
  const theme = inject('theme', 'light') // 默认值 'light'
  </script>

  ```
  ```jsx [react]

  // 创建 Context:
  import { createContext, useState } from 'react'

  const ThemeContext = createContext('light')

  function App() {
    const [theme, setTheme] = useState('dark')
    
    return (
      <ThemeContext.Provider value={theme}>
        <ChildComponent />
      </ThemeContext.Provider>
    )
  }


  // 使用 Context:
  import { useContext } from 'react'
  import ThemeContext from './ThemeContext'

  function ThemedButton() {
    const theme = useContext(ThemeContext)
    
    return (
      <button style={{ background: theme === 'dark' ? '#333': '#eee' }}>
        主题按钮
      </button>
    )
  }

  ```
  :::


### 插槽 vs Children
  ::: code-group
  ```vue [vue3]
    <!-- 父组件 -->
    <template>
      <ContainerComponent>
        <template v-slot:header>
          <h1>这是标题</h1>
        </template>
        
        <p>这是默认内容</p>
        
        <template v-slot:footer="{ message }">
          <p>{{ message }}</p>
        </template>
      </ContainerComponent>
    </template>

    <!-- 子组件 -->
    <template>
      <div class="container">
        <header>
          <slot name="header"></slot>
        </header>
        
        <main>
          <slot></slot> <!-- 默认插槽 -->
        </main>
        
        <footer>
          <slot name="footer" message="来自子组件的数据"></slot>
        </footer>
      </div>
    </template>

  ```
  ```jsx [react]
  // 父组件
  function ParentComponent() {
    return (
      <ContainerComponent
        header={<h1>这是标题</h1>}
        footer={(message) => <p>{message}</p>}
      >
        <p>这是默认内容</p>
      </ContainerComponent>
    )
  }

  // 子组件
  function ContainerComponent({ header, children, footer }) {
    return (
      <div className="container">
        <header>{header}</header>
        <main>{children}</main>
        <footer>{footer?.('来自子组件的数据')}</footer>
      </div>
    )
  }

  ```
  :::

## 全局状态管理
### Pinia 与 Redux 对比
  ::: code-group
  ```js [vue3]
  // stores/counter.js
  import { defineStore } from 'pinia'

  export const useCounterStore = defineStore('counter', {
    state: () => ({ count: 0 }),
    actions: {
      increment() {
        this.count++
      }
    },
    getters: {
      double: (state) => state.count * 2
    }
  })

  ```
  ```js [react]
  // store/counterSlice.js
  import { createSlice } from '@reduxjs/toolkit'

  export const counterSlice = createSlice({
    name: 'counter',
    initialState: { value: 0 },
    reducers: {
      increment: (state) => {
        state.value += 1
      },
    },
  })

  export const { increment } = counterSlice.actions
  export default counterSlice.reducer

  ```
  :::

### 在组件中使用

  ::: code-group
  ```vue [vue3]
  <template>
    <button @click="counter.increment()">
      {{ counter.count }} ({{ counter.double }})
    </button>
  </template>
  <script setup>
    import { useCounterStore } from '@/stores/counter'
    const counter = useCounterStore()
  </script>
 
  ```
  ```jsx [react]

  import { useSelector, useDispatch } from 'react-redux'
  import { increment } from './store/counterSlice'

  function Counter() {
    const count = useSelector(state => state.counter.value)
    const dispatch = useDispatch()

    return (
      <button onClick={() => dispatch(increment())}>
        {count}
      </button>
    )
  }

  ```
  :::


## 路由管理

  ::: code-group
  ```vue [vue3]
  <template>
    <div id="app">
      <!-- 路由链接，点击后会跳转到相应的路由路径 -->
      <router-link to="/">Home</router-link> <!-- 跳转到首页 -->
      <router-link to="/about">About</router-link> <!-- 跳转到关于页 -->
      
      <!-- 路由视图，当前匹配的组件会在此处渲染 -->
      <router-view></router-view> <!-- 动态渲染当前路由的组件 -->
    </div>
  </template>

  <script setup>
    // 引入 vue-router
    import { createRouter, createWebHistory } from 'vue-router'

    // 定义路由规则
    const routes = [
      { path: '/', component: () => import('./views/Home.vue') }, // 配置首页路由
      { path: '/about', component: () => import('./views/About.vue') }, // 配置关于页路由
      { path: '/:pathMatch(.*)*', component: () => import('./views/NotFound.vue') }, // 404 页面，匹配任何路径
    ]

    // 创建路由实例，使用 history 模式
    const router = createRouter({
      history: createWebHistory(),
      routes
    })

    export default {
      router
    }
  </script>


  ```
  ```jsx [react]
  import React from 'react';
  import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';

  // 组件定义
  function Home() {
    return <h1>Home Page</h1>;
  }

  function About() {
    return <h1>About Page</h1>;
  }

  function NotFound() {
    return <h1>404 - Page Not Found</h1>;
  }

  export default function App() {
    return (
      <Router>
        <div>
          {/* 路由链接，点击后会跳转到相应的路由路径 */}
          <Link to="/">Home</Link> {/* 跳转到首页 */}
          <Link to="/about">About</Link> {/* 跳转到关于页 */}
          
          {/* 路由视图，当前匹配的组件会在此处渲染 */}
          <Routes>
            <Route path="/" element={<Home />} /> {/* 首页路由 */}
            <Route path="/about" element={<About />} /> {/* 关于页路由 */}
            <Route path="*" element={<NotFound />} /> {/* 404 页面，匹配任何路径 */}
          </Routes>
        </div>
      </Router>
    );
  }


  ```
  :::



  
