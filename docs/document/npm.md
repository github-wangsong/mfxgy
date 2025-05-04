# npm

查看版本号
::: code-group
```sh [npm]
npm -v
```
:::

初始化工具包
::: code-group
```sh [npm]
npm init

npm init -y # 快速初始化
```
:::

packge.json
```json
{
  "name": "@zxcvbn/zxcvbn", // 包名
  "version": "1.0.0",       // 版本号
  "description": "",        // 描述
  "main": "index.js",       // 入口文件
  "scripts": {              // 脚本
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "author": "",             // 作者
  "license": "ISC"          // 开源证书
}
```

## 下载和安装包
```sh
npm install <package>
npm install <package> -S # 生产依赖, -S = --save
npm install <package> -D # 开发依赖, -D = --save-dev
npm install <package> -g # 全局安装

```

## 卸载包
```sh
npm uninstall <package>
npm uninstall <package> -g # 全局卸载
npm r <package> # 卸载 r = remove
```

## 配置命令别名
```json
"scripts": {
  "start": "node app.js",
  "dev": "node app.js"
}
```
```sh
npm start
npm run dev
```

## npm 配置淘宝镜像

### 直接配置
```sh
npm config set registry https://registry.npmmirror.com
```

### 使用nrm工具配置
```sh
npm install -g nrm
nrm ls
nrm use taobao
npm config list # 查看registry是否配置成功
```

## 管理发布包

- 注册并激活npm账号
- 使用官方镜像, `nrm use npm`
- 登陆`npm login`
- 发布`npm publish`
- 删除`npm unpublish --force`