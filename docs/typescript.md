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
## 基本类型和联合类型
  ```typescript
    let v1: number = 1  // 数字类型
    let v2: string = '23'  // 字符串类型
    let v3: boolean = false  // 布尔类型
    let v4: null = null  // null
    let v5: undefined = undefined  // undefined

    let v6: string | null = null  // 联合类型
    let v7: 1 | 4 | 8 = 4

    //数组
    let arr: number[] = [1, 2, 3]
    let arr2: Array<string> = ['a', 'b', 'c']
    let ar3: ReadonlyArray<string> = ['a', 'b', 'c']  // 只读

    //元组
    let t: [number, string, boolean?] =  [1, 'a', false]

    //枚举
    enum myEnum = { A, B, C }
    console.log(myEnum[0]) // 'A'
    console.log(myEnum.A) // 0 



  ```
## 函数
  ```typescript
    function myFun (a = 10, b: string, c?: boolean, ...rest: number[]) :viod {

    }
    myFun(20, 'b', true, 1, 2, 3)



  ```
## 接口
  ```typescript
    interface Obj = {
      aaa: number;
      bbb: string;
      ccc?: boolean; // 可选
      readonly ddd: number; // 只读
      [propName: string]: arr; // 可以额外添加任意数量的属性
    }

    const obj: Obj = {
      aaa: 23,
      bbb: '222',
      ddd: 123
    }

    // 接口继承
    interface Obj2 extends Obj {
      eee: boolean
    }
    const obj2: Obj2 = {
      aaa: 23,
      bbb: '222',
      ddd: 123,
      eee: true
    }




  ```
## 类型别名
  ```typescript
  type myType = sring | number

  const a: myType = 123



  ```
## 泛型
  ```typescript
  function myFun<T> (a: T, b: T): T[] {
    return [a, b]
  }

  myFun<number>(1, 2)
  myFun<string>('a', 'b') 



  ```

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


  ## 类
   
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











