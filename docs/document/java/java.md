# java

## 第1章 开始

- [安装jdk](https://www.oracle.com/cn/java/technologies/downloads/#java21)
- 配置path环境变量
  - 新增系统变量`JAVA_HOME`, 变量值为`D:\software-manage\jdk-21`
  - 新增Path变量值`%JAVA_HOME%\bin`

## 第2章 第一个程序 HelloWorld

  ```java
  // 文件名必须和 public 类名一致：HelloWorld.java
  public class HelloWorld {
      // main 方法是程序的入口，写法固定
      public static void main(String[] args) {
          // System.out.println 用于向控制台输出内容并换行
          System.out.println("Hello, World! 欢迎来到 Java 世界！");
      }
  }
  ```
  运行方式：
  ```java
  javac HelloWorld.java   # 编译生成 HelloWorld.class
  java HelloWorld         # 运行
  ```

## 第3章 基础语法

### 3.1 注释
  ```java
  // 单行注释

  /*
    多行注释
  */

  /**
   * 文档注释，生成API文档
  */
  ```

### 3.2 变量与数据类型

- 基本数据类型
  - 整型: `byte`, `short`, `int`, `long`
  - 浮点型: `float`, `double`
  - 字符型: `char`, `boolean`
  - 布尔型: `boolean`
- 引用数据类型
  - 数组: `int[] aaa = new int[5]`, `String[] bbb = {"111", "222"}`
  - 二维数组: `int[][] ccc = new int[5][5]`
  ```java
  public class VariableDemo {
    public static void main(String[] args) {
        // 1. 整数类型
        byte b = 127;              // 1字节，-128~127
        short s = 32767;           // 2字节
        int age = 25;              // 4字节，最常用
        long population = 8000000000L; // 8字节，需加 L 后缀

        // 2. 浮点类型
        float price = 9.99f;       // 4字节，需加 f 后缀
        double pi = 3.1415926535;  // 8字节，默认小数类型

        // 3. 字符类型
        char letter = 'A';         // 2字节，Unicode 编码
        char chinese = '中';

        // 4. 布尔类型
        boolean isJavaFun = true;  // 只有 true/false

        // 5. 字符串（引用类型，不是基本类型）
        String name = "张三";

        final double PI = 3.14; // PI是一个常量

        // 输出变量
        System.out.println("年龄: " + age);
        System.out.println("价格: " + price);
        System.out.println("名字: " + name);
        System.out.println("Java有趣吗? " + isJavaFun);
    }
  }
  ```

类型转换

```java
// 自动转换（小 -> 大）
int num = 100;
double d = num;   // int 自动转 double

// 强制转换（大 -> 小，可能丢失数据）
double pi = 3.14;
int intPi = (int) pi;  // 结果为 3，截断小数
```


### 3.3 运算符

  - 算数运算符： + - * / %
  - 自增自减运算符： ++ --
  - 赋值运算符：= += -= *= /= %=
  - 关系运算符： > < >= <= == !=
  - 三元运算符： condition ? true : false
  - 逻辑运算符： && || ! ^


## 第4章 流程控制
### 4.1 输入输出
```java
Scanner scanner = new Scanner(System.in);
public class Main {
    public static void main(String[] args) {
        System.out.println("请输入用户名");
        String username = scanner.nextLine();
        System.out.printf("欢迎%s", username);  // 格式化输出
            // %d	格式化输出整数
            // %x	格式化输出十六进制整数
            // %f	格式化输出浮点数
            // %e	格式化输出科学计数法表示的浮点数
            // %s	格式化字符串
    }
}

```

### 4.2 条件判断
```java
if (score >= 90) {
    System.out.println("优秀");
} else if (score >= 60) {
    System.out.println("及格");
} else {
    System.out.println("不及格");
}
```
```java
switch (day) {
  case 1:
      System.out.println("星期一");
      break;
  case 2:
      System.out.println("星期二");
      break;
  default:
      System.out.println("其他");
}
```
### 4.3 循环结构
```java
// for
for (int i = 0; i < 10; i++) {
    System.out.print(i + " ");
}

// while
int count = 0;
while (count < 5) {
    System.out.println(count);
    count++;
}

// do-while 至少执行一次
int num = 0;
do {
    System.out.println(num);
    num++;
} while (num < 3);

```
`break` 跳出循环，`continue` 跳过本次循环剩余代码进入下一次。

## 第5章 数组
数组是存储 同一类型 多个元素的容器，长度固定。
```java
// 动态初始化
int[] arr = new int[5];
arr[0] = 10;

// 静态初始化
String[] names = {"张三", "李四", "王五"};

// 遍历
for (int i = 0; i < names.length; i++) {
    System.out.println(names[i]);
}

// 增强for循环， for each
for (String name : names) {
    System.out.println(name);
}

// 排序
int[] ns = { 28, 12, 89, 73, 65, 18, 96, 50, 8, 36 };
Arrays.sort(ns);
System.out.println(Arrays.toString(ns));
```

二维数组：
```java
int[][] matrix = {{1,2,3}, {4,5,6}};
System.out.println(matrix[1][2]); // 6
```

## 第6章 面向对象基础（OOP）

### 6.1 类与对象
  类是对事物的抽象，对象是类的具体实例。
  ```java
  // 定义一个学生类
  class Student {
        // 属性（成员变量）
        String name;
        int age;

        // 方法（行为）
        public void study() {
            System.out.println(name + " 正在学习...");
        }

        // 自我介绍
        public void introduce() {
            System.out.println("我叫 " + name + "，今年 " + age + " 岁。");
        }
    }

    public class OOPDemo1 {
        public static void main(String[] args) {
            // 创建对象（实例化）
            Student stu1 = new Student();
            stu1.name = "小明";
            stu1.age = 20;
            stu1.introduce();  // 调用方法
            stu1.study();

            Student stu2 = new Student();
            stu2.name = "小红";
            stu2.age = 18;
            stu2.introduce();
        }
  }
  ```
  创建对象：
  ```java
  Student stu = new Student("小明", 18);
  stu.study();
  ```
### 方法（函数）
  ```java
  public class MethodDemo {
    // 定义一个方法：返回两个整数的较大值
    public static int getMax(int a, int b) {
        // return 返回结果，方法结束
        return (a > b) ? a : b;
    }

    // 无返回值的方法
    public static void printHello(String name) {
        System.out.println("Hello, " + name + "!");
    }

    // 方法重载：方法名相同，参数列表不同
    public static int add(int a, int b) {
        return a + b;
    }
    public static double add(double a, double b) {
        return a + b;
    }

    public static void main(String[] args) {
        // 调用方法
        int max = getMax(10, 20);
        System.out.println("最大值: " + max);

        printHello("小明");

        System.out.println(add(3, 5));       // 调用 int 版
        System.out.println(add(2.5, 3.5));   // 调用 double 版
    }
  }
  ```
### 6.3 构造方法与 this
  ```java
  class Dog {
    String name;
    int age;

    // 构造方法：与类同名，无返回值，用于初始化对象
    public Dog(String name, int age) {
        this.name = name;  // this.name 指成员变量，name 是参数
        this.age = age;
    }

    // 无参构造（若没写任何构造，系统自动提供无参构造）
    public Dog() {
        // 可以在里面调用其他构造
        this("未命名", 0);  // 调用两个参数的构造
    }

    public void bark() {
        System.out.println(name + " 汪汪叫，年龄 " + age);
    }
  }

  public class OOPDemo2 {
    public static void main(String[] args) {
        Dog d1 = new Dog("旺财", 3);  // 使用有参构造
        d1.bark();

        Dog d2 = new Dog();          // 使用无参构造
        d2.bark();
    }
  }
  ```
### 6.4 封装 (private + getter/setter)
  将属性设为 `private`，提供 `public` 的 `getter`/`setter` 控制访问。
  ```java
  class BankAccount {
    private double balance;  // 私有属性，外部不可直接访问

    // 构造方法
    public BankAccount(double initial) {
        if (initial > 0) {
            this.balance = initial;
        }
    }

    // 公共 getter 方法，获取余额
    public double getBalance() {
        return balance;
    }

    // 公共存款方法，控制逻辑
    public void deposit(double amount) {
        if (amount > 0) {
            balance += amount;
            System.out.println("存入 " + amount + " 元，当前余额: " + balance);
        } else {
            System.out.println("存款金额必须大于0");
        }
    }

    // 取款
    public void withdraw(double amount) {
        if (amount > 0 && amount <= balance) {
            balance -= amount;
            System.out.println("取出 " + amount + " 元，当前余额: " + balance);
        } else {
            System.out.println("余额不足或金额非法");
        }
    }
  }

  public class EncapsulationDemo {
      public static void main(String[] args) {
          BankAccount account = new BankAccount(1000);
          account.deposit(500);
          account.withdraw(200);
          // account.balance = -100; // 编译错误，不能直接访问
          System.out.println("最终余额: " + account.getBalance());
      }
  }
  ```
### 6.5 继承 (extends)
  ```java
  // 父类（基类）
  class Animal {
      String name;

      public Animal(String name) {
          this.name = name;
      }

      public void eat() {
          System.out.println(name + " 正在吃东西");
      }
  }

  // 子类（派生类）继承 Animal
  class Cat extends Animal {
    public Cat(String name) {
        super(name);  // 调用父类构造
    }

    // 子类特有方法
    public void meow() {
        System.out.println(name + " 喵喵叫");
    }

    // 重写父类方法 (Override)
    @Override   // 注解，告诉编译器这是重写，帮助检查
    public void eat() {
        System.out.println("小猫 " + name + " 正在吃鱼");
    }
  }

  public class InheritanceDemo {
      public static void main(String[] args) {
          Cat cat = new Cat("咪咪");
          cat.eat();   // 调用重写后的方法
          cat.meow();  // 调用子类自己的方法
      }
  }
  ```

### 6.6 多态
  多态指同一方法调用在不同对象上表现出不同行为
  ```java
  class Shape {
    public void draw() {
        System.out.println("画一个形状");
    }
  }

  class Circle extends Shape {
      @Override
      public void draw() {
          System.out.println("画一个圆形");
      }
  }

  class Square extends Shape {
      @Override
      public void draw() {
          System.out.println("画一个正方形");
      }
  }

  public class PolymorphismDemo {
      public static void main(String[] args) {
          // 父类引用指向子类对象
          Shape s1 = new Circle();
          Shape s2 = new Square();

          s1.draw();  // 画一个圆形 (动态绑定)
          s2.draw();  // 画一个正方形

          // 数组多态
          Shape[] shapes = {new Circle(), new Square(), new Circle()};
          for (Shape s : shapes) {
              s.draw();  // 根据实际类型调用不同 draw
          }
      }
  }
  ```
## 第7章 抽象类与接口
## 7.1 抽象类
  ```java
  // 抽象类不能直接实例化
  abstract class Vehicle {
      String brand;

      public Vehicle(String brand) {
          this.brand = brand;
      }

      // 抽象方法：没有方法体，子类必须实现
      public abstract void run();

      // 普通方法
      public void info() {
          System.out.println("品牌: " + brand);
      }
  }

  class Car extends Vehicle {
      public Car(String brand) {
          super(brand);
      }

      @Override
      public void run() {
          System.out.println(brand + " 汽车在公路上行驶");
      }
  }

  public class AbstractDemo {
      public static void main(String[] args) {
          // Vehicle v = new Vehicle(); // 错误，抽象类不能实例化
          Car car = new Car("比亚迪");
          car.info();
          car.run();
      }
  }
  ```
### 7.2 接口
接口定义一组行为规范，用 implements 实现。
```java
// 定义一个接口
interface Flyable {
    // 接口中的方法默认 public abstract (可省略)
    void fly();

    // 默认方法 (Java 8+)
    default void land() {
        System.out.println("降落...");
    }
}

interface Swimable {
    void swim();
}

// 一个类可以实现多个接口
class Duck implements Flyable, Swimable {
    @Override
    public void fly() {
        System.out.println("鸭子飞起来啦");
    }

    @Override
    public void swim() {
        System.out.println("鸭子在水里游");
    }
}

public class InterfaceDemo {
    public static void main(String[] args) {
        Duck duck = new Duck();
        duck.fly();
        duck.swim();
        duck.land();  // 使用默认方法
    }
}
```
## 8. 常用类

### 8.1 String 类
```java
public class StringDemo {
    public static void main(String[] args) {
        String s1 = "Hello";
        String s2 = "World";
        String s3 = "   Java 编程  ";

        // 拼接
        System.out.println(s1 + " " + s2);
        System.out.println(s1.concat(s2));

        // 长度
        System.out.println("长度: " + s1.length());

        // 比较 (必须用 equals，== 比较地址)
        String s4 = new String("Hello");
        System.out.println(s1.equals(s4));  // true
        System.out.println(s1 == s4);       // false

        // 提取子串
        System.out.println(s1.substring(1, 4)); // "ell"

        // 去除空白，大小写转换
        System.out.println(s3.trim());
        System.out.println(s1.toUpperCase());
        System.out.println(s1.toLowerCase());

        // 分割
        String csv = "苹果,香蕉,橘子";
        String[] fruits = csv.split(",");
        for (String f : fruits) {
            System.out.println(f);
        }
    }
}
```
### 8.2 包装类与自动装箱/拆箱
```java
public class WrapperDemo {
    public static void main(String[] args) {
        // 基本类型 -> 包装类 (装箱)
        Integer i1 = Integer.valueOf(100);
        Integer i2 = 200;               // 自动装箱

        // 包装类 -> 基本类型 (拆箱)
        int num = i1.intValue();
        int num2 = i2;                  // 自动拆箱

        // 字符串转换
        String str = "123";
        int parsed = Integer.parseInt(str);
        System.out.println(parsed + 10);  // 133

        // 常量池 (-128~127 范围内共享)
        Integer a = 100;
        Integer b = 100;
        System.out.println(a == b);   // true
        Integer c = 200;
        Integer d = 200;
        System.out.println(c == d);   // false，超出范围
    }
}
```

### 8.3 Math 类
```java
System.out.println(Math.abs(-5));      // 5
System.out.println(Math.max(3, 9));    // 9
System.out.println(Math.min(3, 9));    // 3
System.out.println(Math.pow(2, 3));    // 8.0
System.out.println(Math.sqrt(16));     // 4.0
System.out.println(Math.random());     // 0.0~1.0 随机数
```

## 9. 集合框架

### 9.1. ArrayList（动态数组）
```java
import java.util.ArrayList;

public class ArrayListDemo {
    public static void main(String[] args) {
        // 创建 ArrayList，存储字符串
        ArrayList<String> list = new ArrayList<>();

        // 添加元素
        list.add("Java");
        list.add("Python");
        list.add("C++");
        list.add(1, "JavaScript");  // 在索引1处插入

        // 获取元素
        System.out.println("第二个: " + list.get(1));

        // 修改元素
        list.set(0, "Kotlin");

        // 删除元素
        list.remove("C++");
        list.remove(2);  // 按索引删

        // 遍历
        for (String lang : list) {
            System.out.println(lang);
        }

        // 大小
        System.out.println("列表大小: " + list.size());
        System.out.println("是否包含Java: " + list.contains("Java"));
    }
}
```
### 9.2. HashMap（哈希表）
```java
import java.util.HashMap;

public class HashMapDemo {
    public static void main(String[] args) {
        // 创建一个 HashMap，键-姓名，值-年龄
        HashMap<String, Integer> map = new HashMap<>();

        // 添加
        map.put("张三", 20);
        map.put("李四", 22);
        map.put("王五", 18);

        // 获取
        System.out.println("张三的年龄: " + map.get("张三"));

        // 检查是否存在
        if (map.containsKey("李四")) {
            System.out.println("包含李四");
        }

        // 更新
        map.put("张三", 21);  // 键相同会覆盖

        // 删除
        map.remove("王五");

        // 遍历
        for (String key : map.keySet()) {
            System.out.println(key + " -> " + map.get(key));
        }

        // 或者用 entrySet
        for (HashMap.Entry<String, Integer> entry : map.entrySet()) {
            System.out.println(entry.getKey() + " : " + entry.getValue());
        }

        System.out.println("总人数: " + map.size());
    }
}
```

## 10. 异常处理
```java
public class ExceptionDemo {
    public static void main(String[] args) {
        // try-catch 捕获异常
        try {
            int[] arr = {1, 2, 3};
            System.out.println(arr[5]);  // 数组越界
        } catch (ArrayIndexOutOfBoundsException e) {
            System.out.println("捕获异常: " + e.getMessage());
        }

        // try-catch-finally
        try {
            int result = 10 / 0;  // 算术异常
        } catch (ArithmeticException e) {
            System.out.println("除数不能为0");
        } finally {
            System.out.println("finally 块总会被执行，用于释放资源");
        }

        // 手动抛出异常
        int age = -5;
        if (age < 0) {
            throw new IllegalArgumentException("年龄不能为负数");
        }

        // 自定义异常
        try {
            checkAge(200);
        } catch (MyException e) {
            System.out.println("自定义异常: " + e.getMessage());
        }
    }

    // 使用 throws 声明可能抛出的异常
    public static void checkAge(int age) throws MyException {
        if (age < 0 || age > 150) {
            throw new MyException("年龄不合理: " + age);
        }
    }
}

// 自定义异常类：继承 Exception
class MyException extends Exception {
    public MyException(String message) {
        super(message);
    }
}
```

## 11. IO文件
```java
import java.io.*;

public class FileIODemo {
    public static void main(String[] args) {
        // 写文件
        try (BufferedWriter writer = new BufferedWriter(new FileWriter("test.txt"))) {
            writer.write("Hello, Java IO!");
            writer.newLine();
            writer.write("第二行文字");
            System.out.println("文件写入成功");
        } catch (IOException e) {
            e.printStackTrace();
        }

        // 读文件
        try (BufferedReader reader = new BufferedReader(new FileReader("test.txt"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println("读取: " + line);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

## 12. 多线程
### 12.1 继承 Thread 类
```java
class MyThread extends Thread {
    @Override
    public void run() {
        for (int i = 0; i < 5; i++) {
            System.out.println(getName() + " 输出: " + i);
            try {
                Thread.sleep(500); // 休眠 500ms
            } catch (InterruptedException e) {
                e.printStackTrace();
            }
        }
    }
}

public class ThreadDemo {
    public static void main(String[] args) {
        MyThread t1 = new MyThread();
        MyThread t2 = new MyThread();
        t1.start();  // 启动线程，JVM 调用 run()
        t2.start();
        // 注意：直接调用 run() 不会启动新线程！
    }
}
```














### 12.2 实现 Runnable 接口（更常用）
```java
class MyRunnable implements Runnable {
    @Override
    public void run() {
        for (int i = 0; i < 5; i++) {
            System.out.println(Thread.currentThread().getName() + " -> " + i);
        }
    }
}

public class RunnableDemo {
    public static void main(String[] args) {
        Runnable task = new MyRunnable();
        Thread t1 = new Thread(task, "线程A");
        Thread t2 = new Thread(task, "线程B");
        t1.start();
        t2.start();
    }
}
```

### 12.3 同步锁 (synchronized)
```java
class Counter {
    private int count = 0;

    // 同步方法，保证同一时刻只有一个线程能执行
    public synchronized void increment() {
        count++;
    }

    public int getCount() {
        return count;
    }
}

public class SyncDemo {
    public static void main(String[] args) throws InterruptedException {
        Counter counter = new Counter();

        // 创建 1000 个线程，每个对 counter 加 1
        Thread[] threads = new Thread[1000];
        for (int i = 0; i < 1000; i++) {
            threads[i] = new Thread(() -> {
                counter.increment();
            });
            threads[i].start();
        }

        // 等待所有线程结束
        for (Thread t : threads) {
            t.join();
        }

        System.out.println("最终计数: " + counter.getCount()); // 应为 1000
    }
}
```
## 13 网络编程（简易聊天）
服务端
```java
import java.io.*;
import java.net.*;

public class ChatServer {
    public static void main(String[] args) {
        try (ServerSocket serverSocket = new ServerSocket(8888)) {
            System.out.println("服务器启动，等待连接...");
            Socket socket = serverSocket.accept();
            System.out.println("客户端已连接: " + socket.getInetAddress());

            // 获取输入输出流
            BufferedReader in = new BufferedReader(
                new InputStreamReader(socket.getInputStream()));
            PrintWriter out = new PrintWriter(socket.getOutputStream(), true);

            // 读取客户端消息并回复
            String msg;
            while ((msg = in.readLine()) != null) {
                System.out.println("客户端说: " + msg);
                out.println("服务器收到: " + msg);
                if ("bye".equalsIgnoreCase(msg)) break;
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```
客户端
```java
import java.io.*;
import java.net.*;
import java.util.Scanner;

public class ChatClient {
    public static void main(String[] args) {
        try (Socket socket = new Socket("localhost", 8888)) {
            System.out.println("已连接到服务器");
            BufferedReader in = new BufferedReader(
                new InputStreamReader(socket.getInputStream()));
            PrintWriter out = new PrintWriter(socket.getOutputStream(), true);
            Scanner scanner = new Scanner(System.in);

            String userInput;
            while (true) {
                System.out.print("输入消息: ");
                userInput = scanner.nextLine();
                out.println(userInput);
                String response = in.readLine();
                System.out.println("服务器回复: " + response);
                if ("bye".equalsIgnoreCase(userInput)) break;
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

