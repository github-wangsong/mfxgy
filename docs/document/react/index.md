# reactive

## 初始化项目

- 安装脚手架
```sh
  npm i create-react-app -g
```
- 检查安装情况
```sh
  create-react-app --version
```
- 创建项目
```sh
  create-react-app my-react-app
  cd my-app
  npm start
  
```

- 暴露webpack配置项
```sh
npm run eject
```
- 修改package.json, 解决飘红问题
```json
"eslintConfig": {
  "extends": [
    "react-app",
    "react-app/jest"
  ],
  "parserOptions": {
    "babelOptions": {
      "presets": [
        ["babel-preset-react-app",false],
        "babel-preset-react-app/prod"
      ]
    }
  }
}
```

## 常见的配置修改

### 把sass改成less
- 安装依赖
```sh
npm install less-loader@8 less
npm uninstall sass-loader
```
- 修改webpack.config.js
```js
// const sassRegex = /\.(scss|sass)$/;
// const sassModuleRegex = /\.module\.(scss|sass)$/;
const lessRegex = /\.less$/;
const lessModuleRegex = /\.module\.less$/;

...
          {
            test: lessRegex,
            exclude: lessModuleRegex,
            use: getStyleLoaders(
              {
                importLoaders: 3,
                sourceMap: isEnvProduction
                  ? shouldUseSourceMap
                  : isEnvDevelopment,
                modules: {
                  mode: 'icss',
                },
              },
              'less-loader'
            ),
            // Don't consider CSS imports dead code even if the
            // containing package claims to have no side effects.
            // Remove this when webpack adds a warning or an error for this.
            // See https://github.com/webpack/webpack/issues/6571
            sideEffects: true,
          },
          {
            test: lessModuleRegex,
            use: getStyleLoaders(
              {
                importLoaders: 3,
                sourceMap: isEnvProduction
                  ? shouldUseSourceMap
                  : isEnvDevelopment,
                modules: {
                  mode: 'local',
                  getLocalIdent: getCSSModuleLocalIdent,
                },
              },
              'less-loader'
            ),
          },
```

### 配置路径别名

- 修改webpack.config.js
```js
resolve: {
  alias: {
    '@': paths.appSrc,
  }
}
```
### 修改域名和端口号

- 直接修改`scripct/start.js`
```js
// Tools like Cloud9 rely on this.
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
```

- 基于环境变量修改
```sh
npm install cross-env
```
修改package.json
```json
  "scripts": {
    "start": "cross-env PORT=8080 node scripts/start.js",
    "build": "node scripts/build.js",
    "test": "node scripts/test.js"
  },
```
### 修改浏览器兼容

修改package.json
```json
"browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  ```

::: warning 注意
  - 对postcss生效, 控制css3的前缀
  - 对babel生效, 控制es6语法的编译
  - 无法处理es6内置api的兼容, 我们需要@babel/polyfill对常见的api进行兼容,脚手架中内置了react-app-polyfill
  可以在src/index.js中引入react-app-polyfill
  ```js
  import 'react-app-polyfill/ie9';
  import 'react-app-polyfill/ie11';
  import 'react-app-polyfill/stable';

  ```
:::

### 处理proxy跨域
```sh
npm install http-proxy-middleware@2
```
src中新建setupProxy.js
```js
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    createProxyMiddleware('/api', {
      target: 'http://localhost:3000',
      changeOrigin: true,
      ws: true,
      pathRewrite: {
        '^/api': ''
      },

    })
  )
}
```

## 移动端适配

### 在index.html中加入meta标签
```html
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no" />
```
### 配置rem响应式, `lib-flexible` `postcss-pxtorem`
```sh
npm i postcss-pxtorem lib-flexible
```

webpack.config.js
```js
const px2rem = require('postcss-pxtorem')

...
          postcssOptions: {
            // Necessary for external CSS imports to work
            // https://github.com/facebook/create-react-app/issues/2677
            ident: 'postcss',
            config: false,
            plugins: !useTailwind
              ? [
                  'postcss-flexbugs-fixes',
                  [
                    'postcss-preset-env',
                    {
                      autoprefixer: {
                        flexbox: 'no-2009',
                      },
                      stage: 3,
                    },
                  ],
                  // Adds PostCSS Normalize as the reset css with default options,
                  // so that it honors browserslist config in package.json
                  // which in turn let's users customize the target behavior as per their needs.
                  'postcss-normalize',
                  px2rem({
                    rootValue: 75,
                    propList: ['*'],
                  })
                ]
              : [
                  'tailwindcss',
                  'postcss-flexbugs-fixes',
                  [
                    'postcss-preset-env',
                    {
                      autoprefixer: {
                        flexbox: 'no-2009',
                      },
                      stage: 3,
                    },
                  ],
                  px2rem({
                    rootValue: 75,
                    propList: ['*'],
                  })
                ],
          },
...

```

src/index.js
```js
import 'lib-flexible'

// 处理最大宽度
(function () {
  const handleMax = function handleMax () {
    let html = document.documentElement,
    root = document.getElementById('root'),
    deviceW = html.clientWidth;
    root.style.maxWidth = '750px'
    if (deviceW > 750) {
      html.style.fontSize = '75px'
    }
  }
  handleMax()
} ())
```


## 搭建路由界面

- 创建view文件夹
  - src/view/Home.jsx
  - src/view/Login.jsx
  - src/view/Detail.jsx
  - src/view/Page404.jsx
  - src/view/Personal.jsx
  - src/view/Store.jsx
  - src/view/Update.jsx

以src/view/Home.jsx为例
```jsx
  import React from 'react'

  const Home = function () {
    return (
      <div className='home-box'>Home</div>
    )
  }
  export default Home
```
```sh
npm i react-router-dom
```
创建router文件夹,创建index.js,routes.js
src/router/routes.js
```jsx
import { lazy } from 'react'
import Home from '@/view/Home'
const routes = [
  {
    path: '/',
    name: 'home',
    component: Home,
    meta: { // 路由元数据
      title: '知乎日报',  
    }

  },
  {
    path: '/detail/:id',
    name: 'detail',
    component: lazy(() => import('@/view/Detail')),
    meta: {
      title: '详情',
    }
  },
  {
    path: '/login',
    name: 'login',
    component: lazy(() => import('@/view/Login')),
    meta: {
      title: '登录',
    }
  },
  {
    path: '/store',
    name: 'store',
    component: lazy(() => import('@/view/Store')),
    meta: {
      title: '收藏',
    }
  },
  {
    path: '/update',
    name: 'update',
    component: lazy(() => import('@/view/Update')),
    meta: {
      title: '更新',
    }
  },
  {
    path: '/personal',
    name: 'personal',
    component: lazy(() => import('@/view/Personal')),
    meta: {
      title: '个人中心',
    }
  },
  {
    path: '*',
    name: 'page404',
    component: lazy(() => import('@/view/Page404')),
    meta: {
      title: '404',
    }
  }
]
export default routes
```

src/router/index.js
```js
import React, { Suspense } from 'react'
import  { Routes, Route, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import routes from './routes'
import { Mask, DotLoading } from 'antd-mobile'

// 统一路由配置
const Element = function Element (props) {
  let { component: Component, meta } = props

  // 修改页面title
  document.title = meta?.title || '知乎日报'

  // 获取路由信息, 基于属性传递给组件
  const navigate = useNavigate(),
    location = useLocation(),
    params = useParams(),
    [usp] = useSearchParams()
    return (
      <Component navigate={navigate} location={location} params={params} usp={usp} />
    )
}
const RouterView = function RouterView () {
  return (
    <Suspense fallback={<Mask visible={true}>
        <DotLoading color='primary' />
      </Mask>}>
      <Routes>
        {routes.map((item, index) => {
          let { name, path } = item
          return (
            <Route key={name} path={path} element={<Element  {...item} />} />
          )
        })}
      </Routes>
    </Suspense>
  )
}
export default RouterView

```
修改index.less
```less
  .ant-dot-loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 60px;
  }
```

修改App.jsx
```jsx
import React from 'react'
import RouterView from './router/index'
import { HashRouter } from 'react-router-dom'

const App = function App () {
  return (
    <HashRouter>
      <RouterView />
    </HashRouter>
  )
}
export default App
```
## ant-mobile安装
```sh
npm install --save antd-mobile
```
兼容性配置, 修改webpack.config.js
```js
                presets: [
                  [
                    require.resolve('babel-preset-react-app'),
                    {
                      runtime: hasJsxRuntime ? 'automatic' : 'classic',
                    },
                    {
                      targets: {
                        chrome: 49,
                        ios: 10
                      }
                    }
                  ],
                ],
```

国际化配置, 修改index.js
```js
  import { ConfigProvider } from "antd-mobile";
  import zhCN from 'antd-mobile/es/locales/zh-CN'

  return (
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  )

```

## 配置redux

- 创建store文件夹
  - 创建index.js
  - 创建action-type.js
  - 创建action文件夹
    - 创建index.js
    - 创建base.js
    - 创建store.js
  - 创建reducer文件夹
    - 创建index.js
    - 创建base.js 
    - 创建store.js

store/reducer/base.js
```js
import * as TYPES from '../action-type'
import _ from 'lodash'

let initial = {
  info: null
};
export default function baseReducer(state = initial, action) {
  state = _.cloneDeep(state);
  switch (action.type) {
    default;
  }
  return state;
}

```

store/reducer/store.js
```js
import * as TYPES from '../action-type'
import _ from 'lodash'

let initial = {
  list: null
};
export default function storeReducer(state = initial, action) {
  state = _.cloneDeep(state);
  switch (action.type) {
    default;
  }
  return state;
}

```

store/reducer/index.js
```js
import { combineReducers } from 'redux'
import baseReducer from './base'
import storeReducer from './store'

const reducer = combineReducers({
  base: baseReducer,
  store: storeReducer
})
export default reducer

```

store/action/base.js
```js
import * as TYPES from '../action-type'

const baseAction = {}
export default baseAction
```

store/action/store.js
```js
import * as TYPES from '../action-type'

const storeAction = {}
export default storeAction
```

store/action/index.js
```js
import baseAction from './base'
import storeAction from './store'


const action = {
  base: baseAction,
  store: storeAction
}
export default action
```

store/action-type.js
```js
export const BASE_INFO = 'BASE_INFO'
```

store/index.js
```js
import { createStore, applyMiddleware } from 'redux'
import reduxLogger from 'redux-logger'
import reduxThunk from 'redux-thunk'
import reduxPromise from 'redux-promise'
import reducer from './reducer'

// 根据不同的环境, 使用不同的中间件
let middleware = [reduxPromise, reduxPromise],
env = process.env.NODE_ENV
if (env === 'development') {
  middleware.push(reduxLogger)
}

// 创建store容器
const store = createStore(reducer, applyMiddleware(thunk))
export default store

```

修改index.js
```js
import { Provider } from 'react-redux'
import store from './store'

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ConfigProvider locale={zhCN}>
    <Provider store={store}>
      <App />
    </Provider>
  </ConfigProvider>
);

```