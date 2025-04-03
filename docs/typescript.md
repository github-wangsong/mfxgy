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
  a = 23
  ```
## 类型断言
  ```typescript
  let numList = [1, 2, 3]
  const result = numList.find(item => item > 2)
  result * 5 // 会报错,result有为undefined的可能

  // 使用类型断言
  const result2 = numList.find(item => item > 2) as number //确信result2结果一定是number才使用
  result2 * 5 
  ```
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
   
  备注: object 包含 Array, Functio, Date, Error 等
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
//第三种⽅式：加断⾔
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

// 限制throwError函数不需要有任何返回值，任何值都不⾏，像undeifned、null都不⾏
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

- object 与  Object

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
let b:Object //b的值必须是Object的实例对象（除去undefined和null的任何值）

// 以下代码，均⽆警告，因为给a赋的值，都是Object的实例对象
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

// 以下代码均有警告
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
    content: stirng
    aaa?: string
    bbb = 100

    private _tempdate?: string  // 私有
    protected innerdata?: string // 受保护属性
    static author: string // 静态
    private static readonly author: string = 'www' // 可组合使用

    constructor (title: string, content: stirng) {
      this.title = title
      this.content = content
    }

   }

   const a = new Article('标题', '内容')

   ```

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
  :::











