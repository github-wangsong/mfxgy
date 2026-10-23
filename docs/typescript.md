---
title: typescript
date: 2020-10-10
---

## 类型推断
  ```typescript
  let a = '123'
  a = 23 // 会报错

  ```

## 类型注解
  ```typescript
  let a: string
  a = 23 // 报错：不能将 number 赋给 string
  ```
## 类型断言
  ```typescript
  let numList = [1, 2, 3]
  const result = numList.find(item => item > 2)
  result * 5 // 会报错：result 可能为 undefined（需开启 strictNullChecks）

  // 使用类型断言
  const result2 = numList.find(item => item > 2) as number // 确信 result2 结果一定是 number 才使用
  result2 * 5
  ```

  ::: warning
  类型断言只影响编译期，不会改变运行期的值，也不会做任何类型转换。`as unknown as T` 会绕过全部检查，除非确实知道自己在做什么，否则不要用。
  :::

  ::: tip 断言 vs 收窄
  能用 `typeof`、`in`、`instanceof` 等条件收窄时，优先收窄；`as` 只在你比编译器知道得更多时使用。
  :::

## 非空断言与空值处理

  ::: code-group

  ```ts [非空断言 !]
  // 确信值一定不是 null / undefined 时才使用
  const el = document.querySelector('#app')!
  el.innerHTML = 'hello'

  function getUser(user?: { name: string }) {
    return user!.name // 确定调用方一定传了 user
  }
  ```

  ```ts [可选链 ?.]
  // 假设 user 的类型是 User | undefined
  const name = user?.profile?.name
  // 等价于：user && user.profile ? user.profile.name : undefined
  ```

  ```ts [空值合并 ??]
  // 假设 config.port 的类型是 number | undefined
  const port = config.port ?? 3000

  // ?? 只在 null / undefined 时兜底
  // || 还会把 0、''、false 也当成假值
  const count = 0
  console.log(count ?? 10) // 0
  console.log(count || 10) // 10
  ```

  :::

  ::: warning 非空断言不是运行时检查
  `!` 只是告诉编译器「我确定它不是空」，编译后会被完全删除。值真的为 `null` / `undefined` 时，运行期照样会报错。不确定时优先用 `?.` + `??`。
  :::

  ::: tip ! 与 as 的区别
  - `!`：去掉 `null` / `undefined`，只适用于可能为空的表达式。
  - `as`：把类型断言成另一个类型，范围更宽，也不会做运行时转换。
  :::

## 类型声明

  ::: code-group

  ```ts [基本类型]
  let v1: number = 1  // 数字类型
  let v2: string = '23'  // 字符串类型
  let v3: boolean = false  // 布尔类型
  let v4: null = null  // null
  let v5: undefined = undefined  // undefined
  ```
  ```ts [联合类型]
  let v6: string | null = null  // 联合类型
  let v7: 1 | 4 | 8 = 4
  ```
  ```ts [字⾯量类型]
  let a: '你好' //a的值只能为字符串“你好”
  let b: 100 //b的值只能为数字100

  a = '欢迎'//警告：不能将类型“"欢迎"”分配给类型“"你好"”
  b = 200   //警告：不能将类型“200”分配给类型“100”
  ```
  :::

## as const 与 satisfies

  ::: code-group

  ```ts [as const]
  // 让数组/对象按「最窄的字面量类型」推断，并且只读
  const arr = [1, 2, 3] as const
  // arr 的类型：readonly [1, 2, 3]

  const obj = { type: 'success', code: 200 } as const
  // obj.type 的类型：'success'，不是 string

  // arr[0] = 4 // 报错：只读
  ```

  ```ts [satisfies]
  type Config = {
    mode: 'dev' | 'prod'
    port: number
  }

  const config = {
    mode: 'dev',
    port: 3000
  } satisfies Config

  // 既通过了 Config 的校验，又保留了 mode 的字面量类型 'dev'
  // 如果写成 const config: Config，mode 会被拓宽成 'dev' | 'prod'
  ```

  ```ts [组合使用]
  type Route = {
    path: string
    children?: readonly Route[]
  }

  const routes = [
    { path: '/', children: [{ path: '/home' }] }
  ] as const satisfies readonly Route[]
  ```

  :::

  ::: tip as const 与 satisfies 的区别
  - `as const`：把值变成**只读的字面量类型**，是「收窄」。
  - `satisfies`：**校验**值符合某个类型，但不改变值本身的推断结果。
  - 两者可以组合：`as const satisfies Config`。
  :::

  ::: warning
  `as const` 只影响类型推断，不会在运行期冻结对象；需要运行期不可变时用 `Object.freeze`。
  :::

## 类型总览
  ::: details `JavaScript 中的数据类型`
  1. string
  2. number
  3. boolean
  4. null
  5. undefined
  6. bigint
  7. symbol
  8. object
   
  备注: object 包含 Array, Function, Date, Error 等
  :::

  ::: details `TypeScript 中的数据类型`
  1. 上述所有 JavaScript 类型 
  2. 六个新类型：
     1. any 
     2. unknown 
     3. never 
     4. void 
     5. tuple 
     6. enum 
  3. 两个⽤于⾃定义类型的⽅式：
     1. type 
     2. interface
  
  :::
  :::: details `注意点`
  ::: warning 注意
  在JavaScript 中的这些内置构造函数：Number 、String 、Boolean用于创建对应的包装对象， 在⽇常开发时**很少使⽤**，在TypeScript 中也是同理，所以在TypeScript 中进⾏类型声明时，通常都是⽤⼩写的number 、string 、boolean

  例如下⾯代码：
  ```ts
  let str1: string
  str1 = 'hello'
  str1 = new String('hello') //报错

  let str2: String
  str2 = 'hello'
  str2 = new String('hello')
  
  console.log(typeof str1) // string
  console.log(typeof str2) // object
  ```
  :::

  ::: info
  1. 原始类型 VS 包装对象
    - 原始类型：如number 、string 、boolean ，在 JavaScript 中是简单数据类型，它们在内存中占⽤空间少，处理速度快。
    - 包装对象：如Number 对象、String 对象、Boolean 对象，是复杂类型，在内存中占⽤更多空间，在⽇常开发时很少由开发⼈员⾃⼰创建包装对象。
  2. ⾃动装箱：JavaScript 在必要时会⾃动将原始类型包装成对象，以便调⽤⽅法或访问属性

  ```ts
  // 原始类型字符串
  let str = 'hello';

  // 当访问str.length时，JavaScript引擎做了以下⼯作：
  let size = (function() {
    // 1. ⾃动装箱：创建⼀个临时的String对象包装原始字符串
    let tempStringObject = new String(str);
    // 2. 访问String对象的length属性
    let lengthValue = tempStringObject.length;
    return lengthValue;
  })();

  // 3销毁临时对象，返回⻓度值
  // （JavaScript引擎⾃动处理对象销毁，开发者⽆感知）
  console.log(size); // 输出: 5
  ```
  :::
  ::::

## 常用类型

::: code-group
```ts [any]
// 明确的表示a的类型是any —— 【显式的any】
let a: any 
// 以下对a的赋值，均⽆警告
a = 100
a = '你好'
a = false

// 没有明确的表示b的类型是any，但TS主动推断出来b是any —— 隐式的any
 let b 
//以下对b的赋值，均⽆警告
b = 100
b = '你好'
b = false

// 注意点：any类型的变量，可以赋值给任意类型的变量
let c:any
c = 9
let x: string
x = c // ⽆警告
```

```ts [unknown]
1. unknown 可以理解为⼀个类型安全的any。
// 设置a的类型为unknown
 let a: unknown 
//以下对a的赋值，均符合规范
a = 100
a = false
a = '你好'
// 设置x的数据类型为string
let x: string
x = a // 警告：不能将类型“unknown”分配给类型“string

2. unknown会强制开发者在使⽤之前进⾏类型检查，从⽽提供更强的类型安全性。 

// 设置a的类型为unknown
 let a: unknown
 a = 'hello'

//第⼀种⽅式：加类型判断
if(typeof a === 'string'){
  x = a 
  console.log(x)
}
//第⼆种⽅式：加断⾔
x = a as string
//第三种⽅式：加断⾔（尖括号写法在 .tsx 文件中不可用，JSX 场景请用 as）
x = <string>a

3. 读取any 类型数据的任何属性都不会报错，⽽unknown 正好与之相反。

let str1: string
str1 = 'hello'
str1.toUpperCase() //⽆警告

let str2: any
str2 = 'hello'
str2.toUpperCase() //⽆警告

let str3: unknown
str3 = 'hello';
str3.toUpperCase() //警告：“str3”的类型为“未知”

// 使⽤断⾔强制指定str3的类型为string
 (str3 as string).toUpperCase() //⽆警告

```
```ts [never]

// 限制 throwError 函数不需要有任何返回值，任何值都不行，像 undefined、null 都不行
function throwError(str: string): never {
  throw new Error('程序异常退出:' + str)
}
```
```ts [void]
// void 的含义是空，即：函数不返回任何值，调⽤者也不应依赖其返回值进⾏任何操作！

// ⽆警告
function logMessage(msg:string):void{
  console.log(msg)
}
 // ⽆警告
function logMessage(msg:string):void{
  console.log(msg)
  return;
}
 // ⽆警告
function logMessage(msg:string):void{
  console.log(msg)
  return undefined
}

// 和undefined的区别, 不应依赖其返回值进⾏任何操作
let result = logMessage('你好')
if(result){ // 此⾏报错：⽆法测试"void" 类型的表达式的真实性
  console.log('logMessage有返回值')
}

```
```ts [tuple(元组)]

// 第⼀个元素必须是string 类型，第⼆个元素必须是number 类型。
let arr1: [string,number]

// 第⼀个元素必须是number 类型，第⼆个元素是可选的，如果存在，必须是boolean 类型。
let arr2: [number,boolean?]

// 第⼀个元素必须是number 类型，后⾯的元素可以是任意数量的string 类型
let arr3: [number,...string[]]

 // 可以赋值
arr1 = ['hello',123]
arr2 = [100,false]
arr2 = [200]
arr3 = [100,'hello','world']
arr3 = [100]

// 不可以赋值，arr1声明时是两个元素，赋值的是三个
arr1 = ['hello',123,false]
```
```ts [enum(枚举)]
// 定义⼀个描述【上下左右】⽅向的枚举Direction
enum Direction {
  Up,
  Down,
  Left,
  Right
}

// 反向映射
console.log(Direction.Up)
console.log(Direction[0])

// 此⾏代码报错，枚举中的属性是只读的
Direction.Up = 'shang'

// 使用常量枚举编译成js后代码量少
const enum Directions {
  Up,
  Down,
  Left,
  Right
}
```
```ts [type]
1. 基本⽤法
type num = number
let price: num
price = 100

2. 联合类型  
type Status = number | string
type Gender = '男' | '⼥'

3. 交叉类型
//⾯积
type Area = {
  height: number; //⾼
  width: number; //宽
};
//地址
type Address = {
  num: number; //楼号
  cell: number; //单元号
  room: string; //房间号
};
 // 定义类型House，且House是Area和Address组成的交叉类型
type House = Area & Address;
const house: House = {
 height: 180,
 width: 75,
 num: 6,
 cell: 3,
 room: '702'
 };

// 一个特殊情况
type LogFunc = () => void
const f1: LogFunc = () => {
  return 100; // 允许返回⾮空值
};
```
:::

## 类型收窄与类型守卫

  TypeScript 会根据 `if`、`switch`、`typeof`、`instanceof`、`in` 等条件，把联合类型「收窄」成更具体的类型。

  ::: code-group

  ```ts [typeof]
  function format(value: string | number) {
    if (typeof value === 'string') {
      return value.toUpperCase() // 这里 value 是 string
    }
    return value.toFixed(2) // 这里 value 是 number
  }
  ```

  ```ts [instanceof]
  function printDate(value: string | Date) {
    if (value instanceof Date) {
      console.log(value.toISOString())
    } else {
      console.log(value)
    }
  }
  ```

  ```ts [in]
  type Bird = { fly: () => void }
  type Fish = { swim: () => void }

  function move(animal: Bird | Fish) {
    if ('fly' in animal) {
      animal.fly()
    } else {
      animal.swim()
    }
  }
  ```

  ```ts [自定义类型谓词 is]
  function isString(value: unknown): value is string {
    return typeof value === 'string'
  }

  const data: unknown = 'hello'
  if (isString(data)) {
    data.toUpperCase() // 被收窄为 string
  }
  ```

  ```ts [断言函数 asserts]
  function assertIsString(value: unknown): asserts value is string {
    if (typeof value !== 'string') {
      throw new Error('不是字符串')
    }
  }

  const input: unknown = 'hello'
  assertIsString(input)
  input.toUpperCase() // 后面都按 string 处理
  ```

  ```ts [Array.isArray]
  function sum(value: unknown) {
    if (Array.isArray(value)) {
      return value.reduce((a, b) => a + b, 0) // value 被收窄为 any[]
    }
    return 0
  }
  ```

  :::

  ::: warning typeof null
  `typeof null === 'object'`，所以用 `typeof` 判断对象时，还要额外排除 `null`：

  ```ts
  function isObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null
  }
  ```
  :::

## 可辨识联合与 never 穷尽检查

  ::: code-group

  ```ts [可辨识联合]
  type Shape =
    | { kind: 'circle'; radius: number }
    | { kind: 'square'; size: number }

  function getArea(shape: Shape): number {
    if (shape.kind === 'circle') {
      return Math.PI * shape.radius ** 2
    }
    return shape.size ** 2
  }
  // kind 就是「可辨识属性」，if 后 shape 会被自动收窄
  ```

  ```ts [never 穷尽检查]
  type Shape =
    | { kind: 'circle'; radius: number }
    | { kind: 'square'; size: number }
    | { kind: 'triangle'; base: number; height: number }

  function getArea(shape: Shape): number {
    switch (shape.kind) {
      case 'circle':
        return Math.PI * shape.radius ** 2
      case 'square':
        return shape.size ** 2
      case 'triangle':
        return (shape.base * shape.height) / 2
      default: {
        // 所有成员都处理完后，shape 在这里变成 never
        // 以后新增成员却忘记处理时，这一行会立刻报错
        const _exhaustive: never = shape
        return _exhaustive
      }
    }
  }
  ```

  :::

  ::: tip
  `never` 是「永远不会有值」的类型。联合类型的所有成员都被 `switch` 排除后，剩下的类型就是 `never`；把剩下的值赋给 `never`，就能让编译器帮你检查有没有漏掉分支。
  :::

## object 与 Object

::: code-group
```ts [object]
let a:object // a的值可以是任何【⾮原始类型】，包括：对象、函数、数组等

// 以下代码，是将【⾮原始类型】赋给a，所以均符合要求
a = {}
a = {name:'张三'}
a = [1,3,5,7,9]
a = function(){}
a = new String('123')
class Person {}
a = new Person()

// 以下代码，是将【原始类型】赋给a，有警告
a = 1         
a = true      
a = null      
a = '你好'
a = undefined 
```
```ts [Object]
let b: Object // b 的值可以是除 null 和 undefined 外的任何值

// 以下代码均无警告（原始类型会被自动装箱）
b = {}
b = {name:'张三'}
b = [1,3,5,7,9]
b = function(){}
b = new String('123')
class Person {}
b = new Person()

b = 1
b = true
b = '你好'

// 以下代码有警告（strictNullChecks 下）
b = null
b = undefined
```

```ts [声明对象类型]

// 限制person1对象必须有name属性，age为可选属性
let person1: { name: string, age?: number }
// 含义同上，也能⽤分号做分隔
let person2: { name: string; age?: number }
// 含义同上，也能⽤换⾏做分隔
let person3: {
 name: string
 age?: number
}

let person4: {
  name: string
  age?: number
  [key: string]: any // 索引签名，完全可以不⽤key这个单词，换成其他的也可以
}

// 如下赋值均可以
person1 = {name:'李四', age:18}
person2 = {name:'张三'}
person3 = {name:'王五'}
person4 = {
 name:'张三',
 age:18,
 gender:'男' 
}

// 如下赋值不合法，因为person3的类型限制中，没有对gender属性的说明
person3 = {name:'王五',gender:'男'}
```

```ts [声明函数类型]
let count: (a: number, b: number) => number

count = function (x, y) {
  return x + y 
}
```
```ts [声明数组类型]
let arr1: string[] 
let arr2: Array<string> // 泛型
let arr3: ReadonlyArray<string> = ['a', 'b', 'c']  // 只读

arr1 = ['a','b','c']
arr2 = ['hello','world']
```
:::

  ::: warning object 与 Object 的区别
  - `object`：只接受非原始类型（对象、数组、函数、类实例）。
  - `Object`：接受除 `null` / `undefined` 外的所有值，包括原始类型。
  - 日常表示「对象」时优先用 `object`，不要用 `Object`。
  :::


## 函数重载
  ```typescript
  function myFun (age: number): string
  function myFun (name: string): string
  function myFun (val: string | number): string {
    return typeof val
  }

  myFun(1)
  myFun('xiaomhg')



  ```


## 类的属性修饰符

  修饰符|含义|具体规则
  -|-|-
  public    |公开的    |可以被：`类内部`、`⼦类`、`类外部`访问 。 
  protected |受保护的  |可以被：`类内部`、`⼦类`访问。
  private   |私有的    |可以被：`类内部`访问。
  readonly  |只读属性  |属性⽆法修改。
   
   ```typescript

   class Article {
    public title: string // 公共, 可省略
    content: string
    aaa?: string
    bbb = 100

    private _tempdate?: string  // 私有
    protected innerdata?: string // 受保护属性
    static author: string // 静态
    private static readonly author: string = 'www' // 可组合使用

    constructor (title: string, content: string) {
      this.title = title
      this.content = content
    }

   }

   const a = new Article('标题', '内容')

   ```

## 类的更多细节

  ::: code-group

  ```ts [参数属性]
  class User {
    // 在构造器参数前加修饰符，会自动声明同名属性并赋值
    constructor(
      public readonly id: number,
      private name: string
    ) {}

    getName() {
      return this.name
    }
  }

  const user = new User(1, '张三')
  console.log(user.id) // 1
  // console.log(user.name) // 报错：private
  ```

  ```ts [getter / setter]
  class Product {
    private _price = 0

    get price() {
      return this._price
    }

    set price(value: number) {
      if (value < 0) {
        throw new Error('价格不能为负')
      }
      this._price = value
    }
  }

  const product = new Product()
  product.price = 100
  console.log(product.price) // 100
  ```

  ```ts [# 私有字段]
  class Counter {
    #count = 0 // 运行期也私有，类外部无法访问

    increment() {
      this.#count++
    }

    get value() {
      return this.#count
    }
  }

  const counter = new Counter()
  counter.increment()
  console.log(counter.value) // 1
  // console.log(counter.#count) // 报错：Property '#count' is not accessible
  ```

  ```ts [override]
  class Animal {
    speak() {
      console.log('动物叫')
    }
  }

  class Dog extends Animal {
    override speak() {
      console.log('汪汪')
    }
  }
  ```

  :::

  ::: tip private 与 # 的区别
  - `private`：**编译期**私有，编译成 JS 后仍可被访问（只是 TS 报错）。
  - `#`：**运行期**私有，是 ECMAScript 原生私有字段，外部完全拿不到。
  - `override` 是 TS 4.3+ 的关键字；开启 `noImplicitOverride` 后，重写父类方法必须写 `override`。
  :::

## 抽象类

  ::: tip
  - 概述：抽象类是⼀种⽆法被实例化的类，专⻔⽤来定义类的结构和⾏为，类中可以写抽象
⽅法，也可以写具体实现。抽象类主要⽤来为其派⽣类提供⼀个基础结构，要求其派⽣类
必须实现其中的抽象⽅法。  
  - 简记：抽象类不能实例化，其意义是可以被继承，抽象类⾥可以有普通⽅法、也可以有抽
象⽅法。
  :::

  ```ts

  abstract class Package {
    constructor(public weight: number) { }
    // 抽象⽅法：⽤来计算运费，不同类型包裹有不同的计算⽅式
    abstract calculate(): number
    // 通⽤⽅法：打印包裹详情
    printPackage() {}
  }

  // 标准包裹
  class StandardPackage extends Package {
  constructor(
    weight: number,
    public unitPrice: number // 每公⽄的固定费率
  ) { super(weight) }
  // 实现抽象⽅法：计算运费
  calculate(): number {
    return this.weight * this.unitPrice;
  }
  }
  // 创建标准包裹实例
  const s1 = new StandardPackage(10,5)
  s1.printPackage()


  // 特快包裹
  class ExpressPackage extends Package {
    constructor(
      weight: number,
      private unitPrice: number, // 每公⽄的固定费率（快速包裹更⾼）
      private additional: number // 超出10kg以后的附加费
    ) { super(weight) }
    // 实现抽象⽅法：计算运费
    calculate(): number {
      if(this.weight > 10){
        // 超出10kg的部分，每公⽄多收additional对应的价格
        return 10 * this.unitPrice + (this.weight - 10) * this.additional
      }else {
        return this.weight * this.unitPrice;
      }
    }     
  } 
  // 创建特快包裹实例
  const e1 = new ExpressPackage(13,8,2)
  e1.printPackage()

  ```

## 装饰器

  ::: tip
  装饰器是 TypeScript 对类、方法、属性、参数的「元编程」语法。NestJS 的 `@Controller`、`@Injectable`、`@Get` 都是装饰器。
  :::

  ::: code-group

  ```ts [方法装饰器]
  // 旧版实验性装饰器：需要开启 experimentalDecorators
  function log(
    _target: any,
    key: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value

    descriptor.value = function (this: any, ...args: any[]) {
      console.log(`调用 ${key}`, args)
      return original.apply(this, args)
    }
  }

  class UserService {
    @log
    findOne(id: number) {
      return { id }
    }
  }

  new UserService().findOne(1)
  // 输出：调用 findOne [1]
  ```

  ```ts [NestJS 常见写法]
  import { Controller, Get, Param } from '@nestjs/common'
  import { UsersService } from './users.service'

  @Controller('users')
  export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    @Get(':id')
    findOne(@Param('id') id: string) {
      return this.usersService.findOne(id)
    }
  }
  ```

  :::

  ::: warning tsconfig 配置
  NestJS 使用旧版装饰器，需要在 `tsconfig.json` 中开启：

  ```jsonc
  {
    "compilerOptions": {
      "experimentalDecorators": true,
      "emitDecoratorMetadata": true
    }
  }
  ```

  TS 5.0 起支持**标准装饰器**（不需要上面两个选项），但 NestJS 目前仍依赖旧版装饰器与元数据反射。
  :::

  ::: warning 装饰器顺序
  多个装饰器同时作用时，**表达式从上往下求值，执行从下往上**。例如 `@A @B method()` 先执行 `B`，再执行 `A`。
  :::

## interface（接口)

  ::: code-group
  ```ts [定义类结构]
  // PersonInterface接⼝，⽤与限制Person类的格式
interface PersonInterface {
 name: string
 age: number
 speak(n: number): void
 }
 // 定义⼀个类Person，实现PersonInterface 接⼝
class Person implements PersonInterface {
  constructor(
    public name: string,
    public age: number
  ) { }
  // 实现接⼝中的speak ⽅法
  speak(n: number): void {
    for (let i = 0; i < n; i++) {
      // 打印出包含名字和年龄的问候语句
      console.log(`你好，我叫${this.name}，我的年龄是${this.age}`);
    }
  }
}

 // 创建⼀个Person 类的实例 p1，传⼊名字'tom' 和年龄18
 const p1 = new Person('tom', 18);
 p1.speak(3)
 
  ```
  ```ts [定义对象结构]
  interface UserInterface {
    name: string
    readonly gender: string // 只读属性
    age?: number // 可选属性
    run: (n: number) => void
  }
  const user: UserInterface = {
    name: "张三",
    gender: '男',
    age: 18,
    run(n) {
      console.log(`奔跑了${n}⽶`)
    }
  };
  
  ```
  ```ts [定义函数结构]
  interface CountInterface {
    (a: number, b: number): number;
  }
  const count: CountInterface = (x, y) => {
    return x + y
  }
  
  ```
  ```ts [接⼝之间的继承]
  interface PersonInterface {
    name: string // 姓名
    age: number  // 年龄
  }
  interface StudentInterface extends PersonInterface {
    grade: string // 年级
  }
  const stu: StudentInterface = {
    name: "张三",
    age: 25,
    grade: '⾼三',
  }
  
  ```
  ```ts [接⼝⾃动合并（可重复定义）]
  // PersonInterface接⼝
  interface PersonInterface {
    // 属性声明
    name: string
    age: number
  }
  // 给PersonInterface接⼝添加新属性
  interface PersonInterface {
    // ⽅法声明
    speak(): void
  }
  // Person类实现PersonInterface
  class Person implements PersonInterface {
    name: string
    age: number
    // 构造器
    constructor(name: string, age: number) {
      this.name = name
      this.age = age
    }
    // ⽅法
    speak() {
      console.log('你好！我是⽼师:', this.name)
    }
  }
  ```
  :::


## ⼀些相似概念的区别

  ::: tip interface 与 type 的区别
  - 相同点：interface 和 type  都可以⽤于定义对象结构，在定义对象结构时两者可以互换。
  - 不同点：
      1. interface ：更专注于定义对象和类的结构，⽀持继承、合并。
      2. type ：可以定义类型别名、联合类型、交叉类型，但不⽀持继承和⾃动合并。
   
  :::


  ::: tip interface 与 抽象类的区别
  - 相同点：都能定义⼀个类的格式（定义类应遵循的契约）
  - 不同点：
      1. 接⼝：只能描述结构，不能有任何实现代码，⼀个类可以实现多个接⼝
      2. 抽象类：既可以包含抽象⽅法，也可以包含具体⽅法， ⼀个类只能继承⼀个抽象类。
   
  :::


## 类型兼容性（结构化类型）

  ::: tip
  TypeScript 是**结构类型系统**：只要两个类型的成员结构兼容，就可以互相赋值，不要求显式继承。Java、C# 那种「必须声明 implements / extends」的 nominal typing 在 TS 里不是必须的。
  :::

  ::: code-group

  ```ts [结构兼容]
  interface Point {
    x: number
    y: number
  }

  const p1 = { x: 1, y: 2 }
  const p2 = { x: 1, y: 2, z: 3 }

  const point1: Point = p1 // 无警告
  const point2: Point = p2 // 无警告：p2 至少包含 Point 的成员

  // 对象字面量直接赋值会触发「多余属性检查」
  const point3: Point = { x: 1, y: 2, z: 3 } // 报错
  ```

  ```ts [函数兼容]
  type Handler = (a: number) => void

  const handler: Handler = (a) => {
    console.log(a)
  }

  // 参数少的函数可以赋给参数多的函数类型
  const simple: Handler = () => {}

  // 返回任何值都可以赋给返回 void 的函数类型
  const returnMore: Handler = () => 100
  ```

  :::

  ::: warning private / protected 会破坏结构兼容
  如果类里有 `private` 或 `protected` 成员，只有**同一个类**（或它的子类）才能互相赋值，哪怕结构完全一样也不行。
  :::

## keyof、typeof 与索引访问类型

  ::: code-group

  ```ts [keyof]
  type Person = {
    name: string
    age: number
  }

  type PersonKey = keyof Person // 'name' | 'age'

  function getValue<T, K extends keyof T>(obj: T, key: K): T[K] {
    return obj[key]
  }

  const person = { name: '张三', age: 18 }
  const name = getValue(person, 'name') // string
  const age = getValue(person, 'age') // number
  // getValue(person, 'gender') // 报错：'gender' 不在 keyof Person 中
  ```

  ```ts [typeof 类型查询]
  const user = { name: '张三', age: 18 }

  // 在「类型位置」使用 typeof，取的是变量的类型
  type User = typeof user // { name: string; age: number }

  // 常用来从常量反推类型
  const defaultConfig = { port: 3000, host: 'localhost' }
  type Config = typeof defaultConfig
  ```

  ```ts [索引访问类型]
  type Person = {
    name: string
    age: number
  }

  type Name = Person['name'] // string
  type PersonValue = Person[keyof Person] // string | number

  // 配合 as const 从对象反推字面量联合
  const status = { pending: 'pending', done: 'done' } as const
  type StatusKey = keyof typeof status // 'pending' | 'done'
  type StatusValue = typeof status[keyof typeof status] // 'pending' | 'done'
  ```

  :::

  ::: warning typeof 的两副面孔
  - 在**值**位置：`typeof value` 返回运行期的类型字符串，如 `'string'`。
  - 在**类型**位置：`type T = typeof value` 取变量的 TypeScript 类型。
  两者长得一样，但出现的位置不同。
  :::

## 泛型
  ::: code-group
  ```ts [泛型函数]
  function logData<T>(data: T): T {
    console.log(data)
    return data
  }
  logData<number>(100)
  logData<string>('hello')
  ```
  ```ts [泛型可以有多个]
  function logData<T, U>(data1: T, data2: U): T | U {
    console.log(data1,data2)
    return Date.now() % 2 ? data1 : data2
  }
  logData<number, string>(100, 'hello')
  logData<string, boolean>('ok', false)
  ```
  ```ts [泛型接口]

  interface PersonInterface<T> {
    name: string,
    age: number,
    extraInfo: T
  }
  let p1: PersonInterface<string>
  let p2: PersonInterface<number>
  p1 = { name: '张三', age: 18, extraInfo: '⼀个好⼈' }
  p2 = { name: '李四', age: 18, extraInfo: 250 }
    
  ```
  ```ts [泛型约束]
  interface LengthInterface {
    length: number
  }
  // 约束规则是：传⼊的类型T必须具有length 属性
  function logPerson<T extends LengthInterface>(data: T): void {
    console.log(data.length)
  }

  logPerson<string>('hello')
  // 报错：因为number不具备length属性
  // logPerson<number>(100)
 
  ```
  ```ts [泛型类]
  class Person<T> {
    constructor(
      public name: string,
      public age: number,
      public extraInfo: T
    ) { }
    speak() {
      console.log(`我叫${this.name}今年${this.age}岁了`)
      console.log(this.extraInfo)
    }
  }

  // 测试代码1
  const p1 = new Person<number>("tom", 30, 250);
  // 测试代码2
  type JobInfo = {
    title: string;
    company: string;
  }
  const p2 = new Person<JobInfo>("tom", 30, { title: '研发总监', company: '发发发科技公司' });
 
  ```
  ```ts [泛型默认值]
  type Box<T = string> = { value: T }

  const box1: Box = { value: 'hello' } // 不传类型参数时，T 使用默认值 string
  const box2: Box<number> = { value: 100 }
  ```
  ```ts [const 类型参数]
  function tuple<const T extends readonly unknown[]>(...args: T): T {
    return args
  }

  const t = tuple(1, 'a') // readonly [1, 'a']
  ```
  :::

## 常用工具类型

  ::: code-group

  ```ts [对象工具类型]
  interface User {
    id: number
    name: string
    email?: string
  }

  type PartialUser = Partial<User>
  // { id?: number; name?: string; email?: string }

  type RequiredUser = Required<User>
  // id、name、email 全部必填

  type ReadonlyUser = Readonly<User>
  // 所有属性只读

  type NameOnly = Pick<User, 'name'>
  // { name: string }

  type WithoutEmail = Omit<User, 'email'>
  // { id: number; name: string }

  type UserMap = Record<string, User>
  // { [key: string]: User }
  ```

  ```ts [联合与函数工具类型]
  type Role = 'admin' | 'member' | 'guest'

  type AdminRole = Extract<Role, 'admin' | 'member'> // 'admin' | 'member'
  type GuestRole = Exclude<Role, 'guest'> // 'admin' | 'member'

  type NotNull = NonNullable<string | null | undefined> // string

  type Fn = (a: number, b: string) => boolean
  type FnReturn = ReturnType<Fn> // boolean
  type FnParams = Parameters<Fn> // [a: number, b: string]

  type AsyncValue = Awaited<Promise<Promise<number>>> // number

  class Person {
    constructor(public name: string) {}
  }
  type PersonInstance = InstanceType<typeof Person> // Person
  ```

  :::

  ::: tip
  这些工具类型不是魔法，全部由「泛型 + 映射类型 + 条件类型」实现。下一节会看到它们的原理。
  :::

## 条件类型、infer 与映射类型

  ::: code-group

  ```ts [条件类型]
  type IsString<T> = T extends string ? true : false

  type A = IsString<'hello'> // true
  type B = IsString<100> // false
  ```

  ```ts [infer 推断]
  type ElementType<T> = T extends (infer U)[] ? U : never
  type Str = ElementType<string[]> // string

  type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never
  type R = MyReturnType<() => number> // number
  ```

  ```ts [分布式条件类型]
  type ToArray<T> = T extends any ? T[] : never

  type Result = ToArray<string | number> // string[] | number[]

  // 条件类型遇到「裸类型参数」时，会分发到联合类型的每个成员
  // 想避免分发，用元组把类型包起来
  type ToArrayNoDistribute<T> = [T] extends [any] ? T[] : never
  type Result2 = ToArrayNoDistribute<string | number> // (string | number)[]
  ```

  ```ts [映射类型]
  type MyPartial<T> = { [K in keyof T]?: T[K] }
  type MyReadonly<T> = { readonly [K in keyof T]: T[K] }
  type Mutable<T> = { -readonly [K in keyof T]: T[K] }
  type Nullable<T> = { [K in keyof T]: T[K] | null }

  // 键重映射 + 模板字面量类型
  type Getters<T> = {
    [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
  }

  type Person = { name: string; age: number }
  type PersonGetters = Getters<Person>
  // { getName: () => string; getAge: () => number }
  ```

  :::

  ::: warning 分布式条件类型的坑
  `ToArray<string | number>` 的结果是 `string[] | number[]`，不是 `(string | number)[]`。如果希望把联合类型当成一个整体处理，用 `[T] extends [any]` 包起来。
  :::

## 模块与类型声明

  ::: code-group

  ```ts [仅类型导入导出]
  // 只导入类型，编译后整行会被擦除
  import type { User } from './types'

  // 只导出类型
  export type { User }

  // 混合导入：值 + 类型（TS 4.5+）
  import { createUser, type User } from './user'
  ```

  ```ts [声明文件 .d.ts]
  // src/types/env.d.ts
  declare const __APP_VERSION__: string

  // 给静态资源模块补类型
  declare module '*.css' {
    const classes: Record<string, string>
    export default classes
  }

  declare module '*.svg' {
    const src: string
    export default src
  }
  ```

  ```ts [全局扩展]
  // src/types/global.d.ts
  declare global {
    interface Window {
      __APP__: unknown
    }

    interface ImportMetaEnv {
      readonly VITE_API_BASE_URL: string
    }
  }

  export {} // 让文件成为模块，declare global 才会生效
  ```

  :::

  ::: tip 什么时候需要 .d.ts
  - 引用没有类型声明的 JS 库
  - 声明 `*.css`、`*.svg` 等静态资源模块
  - 给 `window`、`ImportMetaEnv` 等全局对象补类型
  - 给第三方库做模块增强（module augmentation）
  :::

  ::: warning 模块增强 vs 全局声明
  - 在**模块文件**（有 `import` / `export`）里写 `declare module 'xxx'` 是「模块增强」，只能扩展已存在的模块。
  - 在**非模块的 `.d.ts`**（没有顶层 `import` / `export`）里写 `declare module '*.css'` 是「环境模块声明」，可以新增模块。
  - 想同时写全局扩展和保持模块身份，用 `declare global { ... }` + `export {}`。
  :::

  ::: tip @types
  没有自带类型的 npm 包，通常安装 `@types/包名`，例如 `npm i -D @types/node`。TypeScript 会自动从 `node_modules/@types` 加载。
  :::

## tsconfig 常用配置

  ```jsonc
  {
    "compilerOptions": {
      "target": "ES2022",                  // 编译到哪个 JS 版本
      "module": "ESNext",                  // 产物模块规范
      "moduleResolution": "Bundler",       // 模块解析策略：Bundler / NodeNext / Node
      "strict": true,                      // 开启全部严格检查
      "noUncheckedIndexedAccess": true,    // 索引访问结果自动加 undefined
      "exactOptionalPropertyTypes": true,  // 可选属性不允许显式赋 undefined
      "esModuleInterop": true,             // 兼容 CommonJS 的默认导入
      "skipLibCheck": true,                // 跳过第三方 .d.ts 检查，加快编译
      "isolatedModules": true,             // 保证每个文件可独立编译
      "outDir": "dist",
      "declaration": true,                 // 额外产出 .d.ts
      "sourceMap": true
    },
    "include": ["src"]
  }
  ```

  ::: tip strict 包含什么
  `strict` 是一组开关的集合，常用成员：
  - `strictNullChecks`：`null` / `undefined` 不能随意赋给其他类型
  - `noImplicitAny`：禁止隐式 `any`
  - `strictPropertyInitialization`：类属性必须在构造器里初始化
  - `strictFunctionTypes`：函数参数使用逆变检查
  - `noImplicitThis`：禁止隐式的 `any` 类型的 `this`
  :::

  ::: warning 两个容易踩的选项
  - `noUncheckedIndexedAccess` 开启后，`arr[0]` 的类型会变成 `T | undefined`，取值前要先判空。
  - `verbatimModuleSyntax` 适合纯 ESM 项目；CommonJS 项目（如默认的 NestJS）开启后，ESM 语法会报错，需改用 `import x = require('x')` 或关闭该选项。
  :::

  ::: tip 常见组合
  - 前端 / Vite / Next.js：`module: ESNext` + `moduleResolution: Bundler`
  - Node / NestJS（CJS）：`module: CommonJS` + `moduleResolution: Node`
  - 纯 ESM Node：`module: NodeNext` + `moduleResolution: NodeNext`
  :::

  ::: tip 路径别名
  ```jsonc
  {
    "compilerOptions": {
      "baseUrl": ".",
      "paths": {
        "@/*": ["./src/*"]
      }
    }
  }
  ```
  `paths` 只影响 TS 的类型解析；运行期还需要打包器或 `tsc-alias` 等工具支持。
  :::











