# 鸿蒙学习

## 1. 开发准备
- 开发工具：[DevEco Studio](https://developer.harmonyos.com/cn/docs/documentation/doc-guides-V3/software_install-0000001053582415-V3)
- 开发语言：[ArkTS](https://developer.harmonyos.com/cn/docs/documentation/doc-guides-V3/arkts-get-started-0000001504769321-V3)
- UI框架：[ArkUI]()

## 2. DevEco Studio的下载与安装
  [跳转](https://b11et3un53m.feishu.cn/wiki/space/7294187573134884867?ccm_open_type=lark_wiki_spaceLink&open_tab_from=wiki_home)
## 3. ArkTS介绍
  HarmonyOS的ArkTS语言是一种基于[TypeScript]()开发的语言，它专为HarmonyOS系统开发而设计
### 3-1 ArkTS的基本组成
  使用DevEco Studio新建项目, 打开entry/src/main/ets/pages/index.ets,见到如下所示

![图片1](https://alliance-communityfile-drcn.dbankcdn.com/FileServer/getFile/cmtyPub/011/111/111/0000000000011111111.20231227152826.68978747729929417932749507993929:50001231000000:2800:B44BA8980A3587F0957937999D38C66140AD85390E5F17FC2CB1A661D3E1875C.png?needInitFileName=true?needInitFileName=true?needInitFileName=true?needInitFileName=true?needInitFileName=true)

### 3-2 常用内置组件介绍(ArkUI)

#### 以Button按钮为例
  在build函数中创建一个button按钮
  ```
  @Entry
  @Component
  struct Index {

    build() {
      Button('按钮')
    }
  }

  ```
  ---
  添加样式, 设置宽/高/背景色
  ```
  @Entry
  @Component
  struct Index {

    build() {
      Button('按钮')
      .width(100)   
      .height(50)
      .backgroundColor('#f00')
    }
  }

  ```
   `属性方法以“.”链式调用的方式配置系统组件的样式和其他属性，建议每个属性方法单独写一行。`

  ---
  配置事件
  ```
    @Entry
    @Component
    struct Index {

      build() {
        Button('按钮')
        .width(100)   
        .height(50)
        .backgroundColor('#f00')
        .onClick(() => {
          this.myText = '点击事件触发';
        })
      }
      
    }
  ```
  `事件方法以“.”链式调用的方式配置系统组件支持的事件，建议每个事件方法单独写一行`

  ---
  其他几个常用内置组件如 row, column, text示例如下:
  ```
  @Entry
  @Component
  struct Index {
    @State count: number = 0

    build() {
      // build函数中根节点唯一且必要
      Row() {  // 行组件
        Column() { // 列组件
          Button('按钮')
          .width(100) // 宽
          .height(50) // 高
          .backgroundColor('#fcc') // 背景色
          .onClick(() => {
            this.count++
          })
          Text(this.count.toString()) // 文本组件
            .fontSize(50)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
      }
      .height('100%')
    }
  }

  ```
  更多组件使用请参考[官方文档](https://developer.harmonyos.com/cn/docs/documentation/doc-references-V3/ts-components-summary-0000001478181369-V3)

### 3-3 自定义组件

创建自定义组件
```
  @Entry
  @Component
  struct Index {
    build() {
      Row() {
        //引用组件
        HelloComponent() 
      }
    }
  }

  //定义组件
  @Component
  struct HelloComponent {
    build() {
      Text('自定义组件')
    }
  }
```

### 3-4 状态管理

### 3-4-1 @State装饰器
  - @State装饰器标记的变量必须初始化,不能为空
  - @State支持Object, ckass, string, number, boolean, enum类型以及这些类型的数组
  - 嵌套类型以及数组中的对象属性无法触发视图更新
  ```
  @Entry
  @Component
  struct MyComponent {
    @State count: number = 0;

    build() {
      Button(`click times: ${this.count}`)
      .onClick(() => {
        this.count += 1;
      })
    }
  }
  ```

### 3-4-2 @Prop, @Link, @Provide, @consume装饰器, 实现组件传参

  @Props 单向同步, 父元素传参给子元素
  - 只支持string, number, boolean, enum类型
  - 父组件传的对象类型, 子组件可使用对象属性
  - 不可以是数组, any
  ```
    @Entry
    @Component
    struct Index {
      @State btnName: string = '按钮名称'
      build() {
        Row() {
          ButtonComponent({textName: this.textName}) // 将textName传给子组件
        }
      }
    }

    @Component
    struct ButtonComponent {
      @Props btnName: string  //使用@props接收(不能设置默认值)
      build() {
        Button(`${this.btnName}`)
      }
    }

  ```

  ---
  @Link, 双向同步, 子组件修改父组件传参
  - 父子类型一致, string, number, boolean, enum, object,class,以及它们的数组
  - 数组中的元素增,删,替换会引起刷新
  - 嵌套类型以及数组中的对象属性无法触发视图更新
  ```
    @Entry
    @Component
    struct Index {
      @State btnName: string = '按钮名称'
      build() {
        Row() {
          ButtonComponent({textName: $textName}) // 将textName传给子组件, 不用this, 用$
        }
      }
    }

    @Component
    struct ButtonComponent {
      @Link btnName: string  //使用@Link接收(不能设置默认值)
      build() {
        Button(`${this.btnName}`)
        .onClick(() => {
          this.btnName='改变按钮名称'
        })
      }
      
    }

  ```

  ---
  @Provide / @Consume, 实现父子,爷孙组件传递数据
  - 父子类型一致, string, number, boolean, enum, object,class,以及它们的数组
  - 数组中的元素增,删,替换会引起刷新
  - 嵌套类型以及数组中的对象属性无法触发视图更新
  ```
    @Entry
    @Component
    struct Index {
      @Provide btnName: string = '按钮名称' // 使用@Provide装饰器
      build() {
        Row() {
          ButtonComponent() // 不需要传参
        }
      }
    }


    @Component
    struct ButtonComponent {
      @Consume btnName: string  //使用@Consume接收(不能设置默认值)
      build() {
        Button(`${this.btnName}`)
        .onClick(() => {
          this.btnName='改变按钮名称'
        })
      }
    }

  ```

### 3-4-3 @ObjectLink, @Observed装饰器, 用于涉及`嵌套对象`或者`数组元素为对象`的场景中进行双向数据同步

  ```
    @Observed
    class ButtonInfo {
      type: number
      name: string
      child: ButtonInfo
      constructor(type: number, name: string, child?:ButtonInfo) {
        this.type = type
        this.name = name
        this.child = child
      }
    }

    @Entry
    @Component
    struct Index {
      @State btn: ButtonInfo = new ButtonInfo(1, '按钮1', new ButtonInfo(2, '按钮2'))
      build() {
        Row() {
          ButtonComponent({btn: this.btn.child}) 
        }
      }
    }

    @Component
    struct ButtonComponent {
      @ObjectLink btn: ButtonInfo  //使用@ObjectLink接收(不能设置默认值)
      build() {
        Button(`${this.btn.name}`)
        .onClick(() => {
          this.btn.name='改变按钮名称'
        })
      }
    }


  ```

### 3-5 循环控制语句

  ForEach 和 if else 的使用
  ```
    class Item {
      name: string
      price: number
      discount: number
      constructor (name: string, price: number, discount: number = 0) {
        this.name = name
        this.price = price
        this.discount = discount
      }
    }


    @Entry
    @Component
    struct Index {

      private list: Array<Item> = [
        new Item('华为1', 9999),
        new Item('华为2', 13999),
        new Item('华为3', 99999, 998),
      ]
      build() {
        Row() {
          ForEach(
            this.list,
            (item: Item) => {
              Row ({space: 10}) {
                Column({space: 4}) {
                  Text('名称' + item.name)
                  Text('价格' + item.price)
                  if (item.discount) {
                    Text('折扣价' + item.discount)
                  }
                }
              }
            }
          )
        }
        .width(100%)
        .height(100%)
        .backgroundColor(#ededed)
        .padding(20)
      }
    }

  ``` 
### 3-6 自定义构建函数
  @Builder装饰器
  ```
      class Item {
        name: string
        price: number
        discount: number
        constructor (name: string, price: number, discount: number = 0) {
          this.name = name
          this.price = price
          this.discount = discount
        }
      }

      //全局自定义构建函数
      @Builder function itemBuilder (item: Item) {
        Row ({space: 10}) {
          Column({space: 4}) {
            Text('名称' + item.name)
            Text('价格' + item.price)
            if (item.discount) {
              Text('折扣价' + item.discount)
            }
          }
        }
      }


      @Entry
      @Component
      struct Index {

        private list: Array<Item> = [
          new Item('华为1', 9999),
          new Item('华为2', 13999),
          new Item('华为3', 99999, 998),
        ]
        build() {
          Row() {
            ForEach(
              this.list,
              (item: Item) => {
                itemBuilder(item) // 调用函数
                // this.itemBuilder2(item) // 使用局部函数用this
              }
            )
          }
          .width(100%)
          .height(100%)
          .backgroundColor(#ededed)
          .padding(20)
        }

        //局部自定义构建函数 (不写function)
        @Builder itemBuilder2 (item: Item) {
          Row ({space: 10}) {
            Column({space: 4}) {
              Text('名称' + item.name)
              Text('价格' + item.price)
              if (item.discount) {
                Text('折扣价' + item.discount)
              }
            }
          }
        }
      }

  ```

  @Extend装饰器
  ```
    // 全局公共样式(设置通用属性)
    @Styles function defaultStyle() {
      .width(100%)
      .height(100%)
      .backgroundColor(#ededed)
      .padding(20)
    }

    // 组件特有的属性使用@Extend(继承模式,只能写在全局)
    @Extend(Text) function textStyle () {
      .fontColor(#333)
      .fontSize(20)
    }

    @Entry
    @Component
    struct Index {
      build() {
        Row() {
          Text('文字')
          .textStyle()
        }
        .defaultStyle()
        .defaultStyle2()
        
      }

      // 局部公共样式(不写function)
      @Styles defaultStyle2() {
        .width(100%)
        .height(100%)
        .backgroundColor(#ededed)
        .padding(20)
      }
    }

  ```
### 其他
- [设置页面路由和组件导航](https://developer.harmonyos.com/cn/docs/documentation/doc-guides-V3/arkts-routing-0000001503325125-V3) 
- [页面和自定义组件生命周期](https://developer.harmonyos.com/cn/docs/documentation/doc-guides-V3/arkts-page-custom-components-lifecycle-0000001524296665-V3)
- [HTTP数据请求](https://developer.harmonyos.com/cn/docs/documentation/doc-guides-V3/http-request-0000001478061585-V3)

