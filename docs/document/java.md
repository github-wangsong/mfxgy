# java

## 开始

- [安装jdk](https://www.oracle.com/cn/java/technologies/downloads/#java21)
- 配置path环境变量
  - 新增系统变量`JAVA_HOME`, 变量值为`D:\software-manage\jdk-21`
  - 新增Path变量值`%JAVA_HOME%\bin`


## 语法


### 注释

- 单行注释: `//`
- 多行注释: `/* */`
- 文档注释: `/** */`

### 数据类型

- 基本数据类型
  - 整型: `byte`, `short`, `int`, `long`
  - 浮点型: `float`, `double`
  - 字符型: `char`, `boolean`
  - 布尔型: `boolean`
- 引用数据类型
  - 数组: `int[] aaa = new int[5]`, `String[] bbb = {"111", "222"}`
  - 二维数组: `int[][] ccc = new int[5][5]`

### 类型转换

- 自动类型转换
  - 类型范围小的变量可以直接赋值给类型范围大的变量
  - 表达式的自动类型转换
    - 表达式的最终结果的类型就是表达式中类型范围大的类型
    - 在表达式中, byte,short,char类型会自动转换为int类型参与运算
- 强制类型转换


### 输入输出
```java
Scanner scanner = new Scanner(System.in);
public class Main {
    public static void main(String[] args) {
        System.out.println("请输入用户名");
        String username = scanner.nextLine();
        System.out.printf("欢迎%s", username);  
    }
}

```

### 类
```java
// 定义一个类, 四种修饰符各来一个
public class Fu {
    private void privateMethod(){
        System.out.println("只能本类");
    }
    void method(){
        System.out.println("本类, 同一个包中的类");
    }
    protected void protectedMethod(
        System.out.println("本类, 同一个包中的类, 子类");
    ){}
    public void publicMethod(){
        System.out.println("任意位置");
    }
    public static void main(String[] args) {}
}

```

#### 类的继承

继承的特点
- java的类继承是单继承, 不支持多继承, 支持多层继承
- java中的祖宗类是Object
- 继承后子类访问成员的特点: 就近原则

