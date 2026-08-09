## React 核心价值
- 组件化
- 数据驱动视图
## 1. JSX 语法

-  标签
  - HTML tag 首字母小写
  - 自定义组件 首字母大写
  - 标签必须是闭合, 如`<input/>`
  - JSX 只能有一个根节点，或者使用 `<></>` （ Fragment ）
- 属性
  - 和 HTML 属性基本一样
  - 个别
    - `class` 要改为 `className`
    - `style` 要写成 JS 对象（不能是 string），key 采用**驼峰写法**
    - `for` 要改为 `htmlFor`
- 事件
  - `onXxx` 的形式 
- JS 表达式
  - `{xxx}` 格式表示一个 JS 变量或表达式
- 判断
  - 运算符 `&&`
  - 三元表达式 `a ? b : c`
  - 用函数封装
- 循环
  - 使用 `map` 做循环, 必须有 `key`
- 显示 HTML 代码
   - `dangerouslySetInnerHTML={{ __html: 'xxx' }}`

**示例**
```tsx
import React from 'react';
// 1. 自定义组件（首字母大写）
function App({ user, isActive, onDelete }) {
  // 判断逻辑封装在函数中
  const getStatusText = () => {
    if (isActive) return <span>● 在线</span>;
    else return <span >○ 离线</span>;
  };

  return (
    // 2. 必须有一个根节点（使用 Fragment）
    <>
      {/* 3. 标签必须闭合 */}
      <div className="user-card"> {/* class 改为 className */}
        {/* 4. style 使用驼峰命名的对象 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px',
          padding: '10px',
          borderBottom: '1px solid #eee'
        }}>
          {/* 6. JSX 表达式 - 用于属性值 */}
          <img 
            src={user.avatar} 
            alt={user.name}
            className="avatar"
            // 7. 事件处理 - onClick 传递参数
            onClick={(e) => {
              e.preventDefault();
              console.log('点击了用户:', user.name);
              onDelete?.(user.id);
            }}
          />
          
          {/* 8. JSX 表达式 - 用于文本内容 */}
          <div>
            <h3>{user.name}</h3>
            {/* 9. 判断 - 使用 && 运算符 */}
            {user.isVip && <span className="vip-badge">VIP</span>}
            
            {/* 10. 判断 - 使用三元表达式 */}
            <p>状态: {user.isOnline ? '🟢 在线' : '🔴 离线'}</p>
            
            {/* 11. 判断 - 调用封装的函数 */}
            {getStatusText()}
          </div>
          
          {/* 12. 循环 - 使用 map，必须加 key */}
          <div className="tags">
            {user.tags.map((tag, index) => (
              // key 优先使用业务 ID，此处使用 index 仅为演示
              <span key={tag.id || index} className="tag">
                {tag.name}
              </span>
            ))}
          </div>
        </div>
        
        {/* 13. 显示 HTML 代码（dangerouslySetInnerHTML） */}
        <div 
          className="bio"
          dangerouslySetInnerHTML={{ 
            __html: user.bio || '<em>暂无简介</em>' 
          }}
        />
        
        {/* 14. JSX 表达式 - 用于注释（JSX 内的注释写法） */}
        {/* 这是 JSX 中的注释，使用 {/* 和 * /} 包裹 */}
      </div>
    </>
  );
}
export default App;

```

## 2. 组件和 props
**子组件**
```tsx
import React from 'react';

interface UserCardProps {
  name: string;
  age: number;
  isVip: boolean;
  onUpdate: (name: string) => void;
  
  // 插槽
  children?: React.ReactNode;                    // 默认插槽
  header?: React.ReactNode;                      // 具名插槽
  footer?: React.ReactNode;                      // 具名插槽
  renderExtra?: (name: string) => React.ReactNode; // 作用域插槽
}

function UserCard({ 
  name, 
  age, 
  isVip, 
  onUpdate, 
  children,
  header,
  footer,
  renderExtra
}: UserCardProps) {
  return (
    <div className="user-card">
      {/* 具名插槽：header */}
      <div className="card-header">
        {header || <h3>默认标题</h3>}
      </div>

      <div className="card-body">
        <p>姓名: {name}</p>
        <p>年龄: {age}岁</p>
        {isVip && <span>⭐ VIP</span>}
        <button onClick={() => onUpdate(name)}>更新用户</button>
        
        {/* 默认插槽：children */}
        <div>{children}</div>
        
        {/* 作用域插槽：把数据传给父组件 */}
        <div>{renderExtra && renderExtra(name)}</div>
      </div>

      {/* 具名插槽：footer */}
      <div className="card-footer">
        {footer || <small>默认底部</small>}
      </div>
    </div>
  );
}

export default UserCard;
```
**父组件**
```jsx
import React from 'react';
import UserCard from './components/UserCard';

function App() {
  const user = {
    name: '张三',
    age: 25,
    isVip: true
  };

  const handleUpdate = (userName: string) => {
    console.log(`更新用户: ${userName}`);
  };

  return (
    <div>
      <UserCard
        name={user.name}
        age={user.age}
        isVip={user.isVip}
        onUpdate={handleUpdate}  
        // 1. 具名插槽：header
        header={<h2 style={{ color: 'blue' }}>🎯 用户卡片</h2>}
        
        // 2. 具名插槽：footer
        footer={<button onClick={() => alert('点击底部')}>底部按钮</button>}
        
        // 3. 作用域插槽：子组件传数据给父组件
        renderExtra={(name) => (
          <p style={{ color: 'red', border: '1px solid red' }}>
            🔥 {name} 的专属内容
          </p>
        )}
      >
        {/* 4. 默认插槽：children */}
        <p>📧 邮箱: zhangsan@example.com</p>
        <p>📱 电话: 138-0000-0000</p>
      </UserCard>
    </div>
  );
}

export default App;
```

## 3. useState
state 的特点
- 异步更新
- 状态合并
- 状态隔离
每次 state 变化，都会触发组件更新，从新渲染页面。
```tsx
import React, { FC, useState } from 'react'

const Demo: FC = () => {
  // let count = 0 // 普通的 js 变量，无法触发组件的更新

  const [count, setCount] = useState(0) // useState 可以触发组件的更新，
  //   const [name, setName] = useState('双越')

  function add() {
    // count++
    // setCount(count + 1)
    // setCount(count + 1) //只会生效最后一个

    setCount(count => count + 1) 
    setCount(count => count + 1)// 使用函数，state 更新不会被合并

    // setCount(count => count + 1)
    console.log('cur count ', count) // 异步更新，无法直接拿到最新的 state 值
  }

  return (
    <div>
      <button onClick={add}>add {count}</button>
    </div>
  )
}

export default Demo
```

## useEffect

```tsx
import React, { useState, useEffect } from 'react';

function App() {
  const [count, setCount] = useState(0);
  const [data, setData] = useState(null);
  const [isVisible, setIsVisible] = useState(true);

  // 1. 无依赖：每次渲染都执行
  useEffect(() => {
    console.log('每次渲染都执行');
  });

  // 2. 空依赖：只在组件挂载时执行一次
  useEffect(() => {
    console.log('组件挂载时执行一次');

    // 订阅与清理
    const handleResize = () => {
      console.log('窗口大小变化:', window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    
    // 清理函数：组件卸载时执行
    return () => {
      console.log('组件卸载时清理');
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // 3. 有依赖：依赖变化时执行
  useEffect(() => {
    console.log(`count 变化了: ${count}`);
  }, [count]); // 只在 count 变化时执行

  // 4. 监听 props 变化（模拟）
  useEffect(() => {
    console.log('count 或 isVisible 变化了');
    // 可以在这里执行副作用
  }, [count, isVisible]); // 多个依赖

  return (
    <div>
      <h1>useEffect 示例</h1>
      
      <p>count: {count}</p>
      <button onClick={() => setCount(count + 1)}>增加</button>
      
      <button onClick={() => setIsVisible(!isVisible)}>
        切换显示
      </button>
      
      {isVisible && <p>数据: {data ? '已加载' : '加载中...'}</p>}
    </div>
  );
}

export default App;

```

## 其他 Hooks

### useRef
```tsx
import React, { FC, useRef } from 'react'

const Demo1: FC = () => {
  const inputRef = useRef<HTMLInputElement>(null) // 1. 保存 DOM 节点的引用
  const nameRef = useRef('双越') // 2. 不是 DOM 节点，普通的 JS 变量

  function selectInput() {
    const inputElem = inputRef.current
    if (inputElem) inputElem.select() // DOM 节点，DOM 操作 API
  }
  function changeName() {
    nameRef.current = '双越老师' // 修改 ref 值，不会触发 rerender （ state 修改会触发组件 rerender ）
    // console.log(nameRef.current)
  }

  return (
    <>
      <div>
        <input ref={inputRef} defaultValue="hello world" />
        <button onClick={selectInput}>选中 input</button>
      </div>
      <div>
         <p>name {nameRef.current}</p>
        <button onClick={changeName}>change name</button>
      </div>
    </>
  )
}

export default Demo

```

### useMemo
- 函数组件，默认，每次 state 变化都会重新执行
- useMemo 可以缓存某个数据，不用每次都重新生成
- 可用于计算量比较大的数据场景
```tsx
import React, { FC, useMemo, useState } from 'react'

const Demo: FC = () => {
  console.log('demo...')

  const [num1, setNum1] = useState(10)
  const [num2, setNum2] = useState(20)

  const sum = useMemo(() => {
    console.log('gen sum...') // 缓存
    return num1 + num2
  }, [num1, num2])

  return (
    <>
      <p>{sum}</p>
      <p>
        {num1} <button onClick={() => setNum1(num1 + 1)}>add num1</button>
      </p>
      <p>
        {num2} <button onClick={() => setNum2(num2 + 1)}>add num2</button>
      </p>
    </>
  )
}

export default Demo
```

### useCallback
useCallback 就是 useMemo 的语法糖，和 useMemo 一样。用于缓存函数。
```tsx
import React, { FC, useState, useCallback } from 'react'

const Demo: FC = () => {

  const fn1 = () => console.log('fn1 text: ', text)

  const fn2 = useCallback(() => {
    console.log('fn2 text: ', text)
  }, [text])

  return (
    <>
      <div>
        <button onClick={fn1}>fn1</button> &nbsp; <button onClick={fn2}>fn2</button>
      </div>
    </>
  )
}

export default Demo

```

### 自定义hooks
```tsx
import React, { useState } from 'react';
import useCounter from './hooks/useCounter';
import useFetch from './hooks/useFetch';
interface User {
  id: number;
  name: string;
  email: string;
}

function App() {
  // 1. 使用计数器 Hook
  const { count, increment, decrement, reset } = useCounter(10);

  // 2. 使用数据请求 Hook
  const { data, loading, error } = useFetch<User[]>('https://jsonplaceholder.typicode.com/users');
  return (
    <div style={{ padding: '20px' }}>
      <h1>自定义 Hooks 示例</h1>

      {/* 1. 计数器 */}
      <section>
        <h2>1. useCounter</h2>
        <p>计数: {count}</p>
        <button onClick={increment}>+</button>
        <button onClick={decrement}>-</button>
        <button onClick={reset}>重置</button>
      </section>

      {/* 2. 数据请求 */}
      <section>
        <h2>2. useFetch</h2>
        {loading && <p>加载中...</p>}
        {error && <p style={{ color: 'red' }}>错误: {error}</p>}
        {data && (
          <ul>
            {data.slice(0, 3).map(user => (
              <li key={user.id}>{user.name}</li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}

export default App;
```

1. hooks/useCounter.ts - 计数器
```tsx
import { useState } from 'react';

// 自定义 Hook：计数器
function useCounter(initialValue = 0) {
  const [count, setCount] = useState(initialValue);

  const increment = () => setCount(count + 1);
  const decrement = () => setCount(count - 1);
  const reset = () => setCount(initialValue);

  return { count, increment, decrement, reset };
}

export default useCounter;
```

2. hooks/useFetch.ts - 数据请求
```tsx
import { useState, useEffect } from 'react';

// 自定义 Hook：数据请求
function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('请求失败');
        const result = await response.json();
        setData(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [url]);

  return { data, loading, error };
}

export default useFetch;
```

### Hooks 使用规则
- 命名规则
  - Hook 必须 `useXxx` 格式来命名。
- 调用位置, Hook 或自定义 Hook ，只能在两个地方被调用.组件外部，或一个普通函数中，不能调用 Hook
  - 组件内部
  - 其他 Hook 内部

- 顺序一致, Hook 在每次渲染时都按照相同的顺序被调用。
  - Hook 必须是组件“第一层代码”
  - Hook 不可放在 if 等条件语句中 （ 或者前面有 return ，也算是条件 ）
  - Hook 不可放在 for 等循环语句中
 - 闭包陷阱
  - 当**异步函数**中获取 state 时，可能不是最新的 state 值。
  - 解决方案：替换为 `useRef` —— **但 ref 变化不会触发 rerender** ，所以得结合 state 一起
```tsx
import React, { FC, useState, useRef, useEffect } from 'react'

const Demo: FC = () => {
  const [count, setCount] = useState(0)
  const countRef = useRef(0)
  useEffect(() => {
    countRef.current = count
  }, [count])

  function add() {
    setCount(count + 1)
  }

  function alertFn() {
    setTimeout(() => {
      //   alert(count) // count 值类型
      alert(countRef.current) // ref 引用类型
    }, 3000)
  }

  return (
    <>
      <p>闭包陷阱</p>
      <div>
        <span>{count}</span>
        <button onClick={add}>add</button>
        <button onClick={alertFn}>alert</button>
      </div>
    </>
  )
}

export default Demo

```

## css
- 内联 style
  - 和 HTML style 一样，元素的内联样式
  - 必须是 JS 对象形式，不可以是字符串
  - 样式名称用驼峰式写法，如 `fontSize`
- className
  - 和 HTML class 一样，设置 CSS 样式名
  - 和 JS `class` 重复，所以改名 `className`
  - 可用 `clsx` 或 `classnames` 条件判断
- CSS Module
  - 每个 CSS 都是一个独立的模块，命名 `xxx.module.css`
  - 每个模块中的 className 都不一样
  - CRA 原生支持 CSS Module
- CSS-in-js
  - 在 JS 中（组件代码中）写 CSS
  - 不用担心 CSS class 重名的问题
  - CSS-in-js 是一个解决方案，并不是一个工具的名称

## 路由
- 跳转 - Home 页面使用 `useNavigate` 和 `<Link>`
- 获取动态路由参数 - Edit 页面使用 `useParams`
- 获取 query - Home 页面使用 `useSearchParams`

```tsx
import React from 'react';
import { 
  Link, 
  NavLink, 
  useNavigate, 
  useLocation, 
  useParams,
  useSearchParams 
} from 'react-router-dom';

function Navbar() {
  // ============================================
  // 1. useNavigate - 编程式导航
  // ============================================
  const navigate = useNavigate();

  const handleNavigate = () => {
    navigate('/about');  // 跳转到 about
  };

  const handleNavigateWithParams = () => {
    navigate('/user/789');  // 跳转带参数
  };

  const handleNavigateWithState = () => {
    navigate('/user/999', { 
      state: { 
        from: '导航栏', 
        time: new Date().toLocaleString() 
      } 
    });
  };

  const handleNavigateWithReplace = () => {
    navigate('/about', { replace: true });  // 替换历史记录（不能返回）
  };

  const handleGoBack = () => {
    navigate(-1);  // 后退一步
  };

  const handleGoForward = () => {
    navigate(1);  // 前进一步
  };

  // ============================================
  // 2. useLocation - 获取当前位置信息
  // ============================================
  const location = useLocation();
  console.log('当前路径:', location.pathname);
  console.log('查询参数:', location.search);
  console.log('状态数据:', location.state);

  // ============================================
  // 3. useParams - 获取动态参数（演示）
  // ============================================
  const params = useParams();
  console.log('当前路由参数:', params);

  // ============================================
  // 4. useSearchParams - 处理查询参数
  // ============================================
  const [searchParams, setSearchParams] = useSearchParams();
  const keyword = searchParams.get('q') || '';

  const handleSearch = (value: string) => {
    setSearchParams({ q: value });
  };

  return (
    <nav style={{ 
      padding: '15px', 
      background: '#f0f0f0', 
      marginBottom: '20px',
      borderBottom: '2px solid #ddd'
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'center' }}>
        
        {/* ============================================
            跳转方法 1: Link 组件
            ============================================ */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <strong>Link:</strong>
          <Link to="/">首页</Link>
          <Link to="/about">关于</Link>
          <Link to="/user/123">用户 123</Link>
          <Link to="/user/456">用户 456</Link>
        </div>

        {/* ============================================
            跳转方法 2: NavLink（带激活样式）
            ============================================ */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <strong>NavLink:</strong>
          <NavLink 
            to="/"
            style={({ isActive }) => ({
              color: isActive ? 'red' : 'blue',
              fontWeight: isActive ? 'bold' : 'normal',
              borderBottom: isActive ? '2px solid red' : 'none'
            })}
          >
            首页(激活)
          </NavLink>
          <NavLink 
            to="/about"
            className={({ isActive }) => isActive ? 'active' : ''}
          >
            关于(激活)
          </NavLink>
        </div>

        {/* ============================================
            跳转方法 3: navigate() 编程式跳转
            ============================================ */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>navigate:</strong>
          <button onClick={handleNavigate}>跳转到关于</button>
          <button onClick={handleNavigateWithParams}>跳转带参数 (/user/789)</button>
          <button onClick={handleNavigateWithState}>跳转带 state</button>
          <button onClick={handleNavigateWithReplace}>替换跳转 (不能返回)</button>
          <button onClick={handleGoBack}>后退</button>
          <button onClick={handleGoForward}>前进</button>
        </div>

        {/* ============================================
            跳转方法 4: 带查询参数的跳转
            ============================================ */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <strong>查询参数:</strong>
          <Link to="/about?tab=info">关于?tab=info</Link>
          <Link to="/about?tab=contact&id=5">关于?tab=contact&id=5</Link>
          <input
            type="text"
            placeholder="搜索..."
            value={keyword}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ padding: '5px' }}
          />
          <span>关键词: {keyword || '无'}</span>
        </div>

      </div>

      {/* ============================================
          显示当前路由信息
          ============================================ */}
      <div style={{ 
        marginTop: '10px', 
        padding: '10px', 
        background: '#fff',
        border: '1px solid #ddd',
        fontSize: '14px'
      }}>
        <strong>📍 当前路由信息:</strong>
        <span style={{ marginLeft: '10px' }}>
          pathname: {location.pathname}
        </span>
        <span style={{ marginLeft: '10px' }}>
          search: {location.search || '无'}
        </span>
        <span style={{ marginLeft: '10px' }}>
          state: {location.state ? JSON.stringify(location.state) : '无'}
        </span>
      </div>
    </nav>
  );
}

export default Navbar;
```
## 状态管理
### Context
- 向下级组件，跨组件传递信息
- 不用像 props 层层传递
- 例如：切换语言、切换主题等

1. contexts/ThemeContext.tsx - 创建 Context
```tsx
import React, { createContext, useState, useContext } from 'react';

// 定义类型
interface ThemeContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

// 创建 Context
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Provider 组件
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// 自定义 Hook
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme 必须在 ThemeProvider 内部使用');
  return context;
}
```
2. components/ThemeButton.tsx - 使用 Context
```tsx
import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

function ThemeButton() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button onClick={toggleTheme}>
      当前: {theme === 'light' ? '☀️ 亮色' : '🌙 暗色'}
    </button>
  );
}

export default ThemeButton;
```

3. App.tsx - 父组件
```tsx
import React from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import ThemeButton from './components/ThemeButton';

function App() {
  return (
    <ThemeProvider>
      <div>
        <h1>Context 示例</h1>
        <ThemeButton />
        
        {/* 任何子组件都能使用 useTheme() */}
        <p style={{ marginTop: '20px' }}>
          主题切换对所有组件生效
        </p>
      </div>
    </ThemeProvider>
  );
}

export default App;
```

### useReducer
是 `useState` 的代替方案。<br>
当数据简单时用 `useState` ，当数据结构较为复杂时，可以考虑用 `useReducer`

- state 或 store - 存储数据
- action - 动作，格式如 `{ type: 'xxx', ... }`
- reducer - 根据 action 生成新 state —— **不可变数据**
- dispatch - 触发 action

```tsx
import React, { FC, useReducer } from 'react'

type StateType = { count: number }
type ActionType = { type: string }

const initialState: StateType = { count: 100 } // 初始值

// 根据传入的 action 返回新的 state （不可变数据）
function reducer(state: StateType, action: ActionType) {
  switch (action.type) {
    case 'increment':
      return { count: state.count + 1 }
    case 'decrement':
      return { count: state.count - 1 }
    default:
      throw new Error()
  }
}

const CountReducer: FC = () => {
  //   const [count, setCount] = useState(100)
  const [state, dispatch] = useReducer(reducer, initialState)

  return (
    <>
      <span>count: {state.count}</span>
      {/* <button onClick={() => setCount(count + 1)}>+</button>
      <button onClick={() => setCount(count - 1)}>-</button> */}
      <button onClick={() => dispatch({ type: 'increment' })}>+</button>
      <button onClick={() => dispatch({ type: 'decrement' })}>-</button>
    </>
  )
}

export default CountReducer
```

### Redux
redux 和 useReducer 的概念一样
- state 或 store - 存储数据
- action - 动作，格式如 `{ type: 'xxx', ... }`
- reducer - 根据 action 生成新 state —— **不可变数据**
- dispatch - 触发 action

但 redux 和 useReducer 有很多区别
- store 可拆分模块
- 可通过 Hook 获取 state 和 dispatch
- 开发者工具


1. store/counterSlice.ts - 创建 Slice（同步 + 异步）
```tsx
import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';

// ============================================
// 1. 定义状态类型
// ============================================
interface CounterState {
  value: number;
  loading: boolean;      // 异步加载状态
  error: string | null;  // 异步错误信息
}

// 初始状态
const initialState: CounterState = {
  value: 0,
  loading: false,
  error: null,
};

// ============================================
// 2. 创建异步 Thunk（模拟 API 请求）
// ============================================
// 异步 thunk 需要三个东西：
// 1. 名称：'counter/fetchCount'
// 2. 异步函数：执行请求逻辑
// 3. 返回结果：会被放到 action.payload 中

// 使用方式：dispatch(fetchCount(10)) 或 await dispatch(fetchCount(10)).unwrap()

export const fetchCount = createAsyncThunk(
  'counter/fetchCount',  // action 类型前缀
  async (amount: number) => {
    // 模拟异步请求：等待 1 秒
    const response = await new Promise<{ data: number }>((resolve) => {
      setTimeout(() => {
        resolve({ data: amount });
      }, 1000);
    });
    
    // 返回的数据会作为 action.payload
    return response.data;
  }
);

// ============================================
// 3. 创建 Slice
// ============================================
const counterSlice = createSlice({
  name: 'counter',
  initialState,
  
  // ============================================
  // 3.1 同步 reducers（直接修改状态）
  // ============================================
  reducers: {
    increment: (state) => {
      // Redux Toolkit 允许直接修改（内部使用 Immer）
      state.value += 1;
      state.error = null; // 清除错误
    },
    decrement: (state) => {
      state.value -= 1;
      state.error = null;
    },
    incrementByAmount: (state, action: PayloadAction<number>) => {
      state.value += action.payload;
      state.error = null;
    },
    reset: (state) => {
      state.value = 0;
      state.error = null;
    },
  },
  
  // ============================================
  // 3.2 异步 reducers（处理异步 thunk 的不同状态）
  // ============================================
  extraReducers: (builder) => {
    builder
      // 请求开始：设置 loading = true
      .addCase(fetchCount.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      // 请求成功：更新数据，设置 loading = false
      .addCase(fetchCount.fulfilled, (state, action) => {
        state.loading = false;
        state.value += action.payload;  // 加上返回的数据
        state.error = null;
      })
      // 请求失败：设置 error，loading = false
      .addCase(fetchCount.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || '请求失败';
      });
  },
});

// ============================================
// 4. 导出 actions 和 reducer
// ============================================
export const { increment, decrement, incrementByAmount, reset } = counterSlice.actions;
export default counterSlice.reducer;
```
2. store/index.ts - 配置 Store
```tsx
import { configureStore } from '@reduxjs/toolkit';
import counterReducer from './counterSlice';

export const store = configureStore({
  reducer: {
    counter: counterReducer,
  },
});

// 导出类型：用于 TypeScript
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```
3. components/Counter.tsx - 使用 Redux（读取状态 + 触发操作）

```tsx
import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../store';
import { 
  increment, 
  decrement, 
  incrementByAmount, 
  reset,
  fetchCount 
} from '../store/counterSlice';

function Counter() {
  // ============================================
  // 1. 读取状态（同步和异步状态）
  // ============================================
  const count = useSelector((state: RootState) => state.counter.value);
  const loading = useSelector((state: RootState) => state.counter.loading);
  const error = useSelector((state: RootState) => state.counter.error);
  
  // 2. 获取 dispatch
  const dispatch = useDispatch<AppDispatch>();
  
  const [amount, setAmount] = useState(5);

  // ============================================
  // 3. 处理同步操作
  // ============================================
  const handleIncrement = () => {
    dispatch(increment());
  };

  const handleDecrement = () => {
    dispatch(decrement());
  };

  const handleReset = () => {
    dispatch(reset());
  };

  const handleIncrementByAmount = () => {
    dispatch(incrementByAmount(amount));
  };

  // ============================================
  // 4. 处理异步操作
  // ============================================
  const handleAsyncFetch = () => {
    // 方式1：简单调用，不处理结果
    dispatch(fetchCount(amount));
  };

  const handleAsyncFetchWithResult = async () => {
    try {
      // 方式2：使用 unwrap() 获取结果或捕获错误
      const result = await dispatch(fetchCount(amount)).unwrap();
      console.log('异步请求成功，返回结果:', result);
      // result 就是 fetchCount 返回的数据（response.data）
    } catch (err) {
      console.error('异步请求失败:', err);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc' }}>
      <h2>计数器</h2>
      
      {/* ========== 显示状态 ========== */}
      <div>
        <p style={{ fontSize: '24px', fontWeight: 'bold' }}>
          当前值: {count}
        </p>
        
        {/* 加载状态 */}
        {loading && <p style={{ color: 'blue' }}>⏳ 加载中...</p>}
        
        {/* 错误信息 */}
        {error && <p style={{ color: 'red' }}>❌ 错误: {error}</p>}
      </div>

      {/* ========== 同步操作 ========== */}
      <div style={{ margin: '10px 0' }}>
        <h3>同步操作</h3>
        <button onClick={handleIncrement}>+1</button>
        <button onClick={handleDecrement}>-1</button>
        <button onClick={handleReset}>重置</button>
        
        <div style={{ marginTop: '10px' }}>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ width: '60px', marginRight: '10px' }}
          />
          <button onClick={handleIncrementByAmount}>
            增加 {amount}
          </button>
        </div>
      </div>

      {/* ========== 异步操作 ========== */}
      <div style={{ margin: '10px 0', borderTop: '1px solid #eee', paddingTop: '10px' }}>
        <h3>异步操作</h3>
        
        <div>
          <button 
            onClick={handleAsyncFetch}
            disabled={loading}  // 加载时禁用
          >
            {loading ? '加载中...' : `异步获取 ${amount}`}
          </button>
          
          <button 
            onClick={handleAsyncFetchWithResult}
            disabled={loading}
            style={{ marginLeft: '10px' }}
          >
            异步获取并处理结果
          </button>
        </div>
        
        <p style={{ fontSize: '12px', color: '#666' }}>
          提示：异步操作会等待 1 秒，然后将数值累加到计数器中
        </p>
      </div>
    </div>
  );
}

export default Counter;
```

4. App.tsx - 父组件
```tsx
import React from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import Counter from './components/Counter';

function App() {
  return (
    <Provider store={store}>
      <div style={{ padding: '20px' }}>
        <h1>Redux 同步 + 异步示例</h1>
        <Counter />
        
        <div style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5' }}>
          <h4>📖 使用说明</h4>
          <ul>
            <li><strong>同步操作</strong>：点击 +1/-1 立即更新</li>
            <li><strong>异步操作</strong>：点击后等待 1 秒，然后累加</li>
            <li><strong>加载状态</strong>：异步请求时显示 loading</li>
            <li><strong>错误处理</strong>：请求失败显示错误信息</li>
          </ul>
        </div>
      </div>
    </Provider>
  );
}

export default App;
```
## 性能优化
- 缓存数据 减少计算
  - useState 传入函数
    - useState 传入初始化数据
    - 如传入函数，则只在组件渲染执行一次
    - 如果数据结构较复杂，可使用函数 
  - useMemo 缓存数据
    - 函数组件，默认，每次 state 变化都会重新执行
    - useMemo 可以缓存某个数据，不用每次都重新生成
    - 可用于计算量比较大的数据场景
  - useCallback 缓存函数
  - React.memo 缓存组件
- 代码体积和拆分
  - 代码拆分
    - 代码体积分析
    - 路由懒加载
    - 抽离公共代码
    - 合理使用缓存
